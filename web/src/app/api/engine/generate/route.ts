import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { callClaude, setApiCaller } from '@/lib/claude'
import { checkRateLimit } from '@/lib/rate-limit'

export const maxDuration = 30

const SYSTEM_PROMPT = `You are a pixel art engine. You write WGSL that renders animated pixel art sprites on a grid where each cell = 1 pixel of solid color.

Your output is clipped to the user's painted region (which may be any shape — circle, blob, freeform). You fill the bounding box with your design and the shape acts as a stencil.

Write ONE function with this exact signature:

fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f { ... }

INPUTS:
- cellPos: integer-snapped cell center (e.g. vec2f(120.5, 245.5)) — one call per pixel
- regionMin/regionMax: bounding box of the painted workspace
- time: seconds elapsed (for animation)
- params: vec4f of 0-1 user knobs

OUTPUT: vec4f(r, g, b, 1.0) — always return a=1.0 (the stencil handles clipping)

COORDINATE HELPERS (pre-defined — just call them):
- regionUV(cellPos, regionMin, regionMax) → 0..1 normalized position in region
- regionUVCentered(cellPos, regionMin, regionMax) → -1..1 centered
- regionUVAspect(cellPos, regionMin, regionMax) → -1..1 aspect-corrected

NOISE (pre-defined):
- vnoise(vec2f) → 0..1, gnoise(vec2f) → -1..1, fbm(vec2f, i32 octaves) → layered noise
- hash21(vec2f) → 0..1, hash22(vec2f) → vec2f, warp(vec2f, f32 strength, f32 time) → warped coords

SHAPES (pre-defined):
- sdCircle(vec2f p, f32 r), sdBox(vec2f p, vec2f b), sdRoundedBox(vec2f p, vec2f b, f32 r)
- sdSegment(vec2f p, vec2f a, vec2f b), sdEquilateralTriangle(vec2f p, f32 r), sdStar(vec2f p, f32 r, i32 n, f32 m)
- opSmoothUnion(f32, f32, f32), opSubtract(f32, f32) — combine SDFs

COLOR (pre-defined):
- hsv2rgb(vec3f(h,s,v)), palette(f32 t, vec3f a, vec3f b, vec3f c, vec3f d) → rainbow from cosine palette
- rot2(f32 angle) → mat2x2f rotation matrix

MATH:
- glsl_mod(x: f32, y: f32) → GLSL-style mod (x - y * floor(x / y))

TECHNIQUE — build sprites like this:
1. Get uv = regionUV(cellPos, regionMin, regionMax) for 0..1 position
2. Define shapes using SDFs — compose them for complex objects
3. Use step() or < 0.0 checks on SDF distances to get hard pixel edges (NOT smoothstep — this is pixel art)
4. Color each region differently — use noise to add texture variation within shapes
5. Animate with time: offset positions, cycle colors, flicker intensity
6. Layer: background → main shape → details → highlights

EXAMPLE — campfire:
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = regionUV(cellPos, regionMin, regionMax);
  let center = uv - vec2f(0.5);
  // Logs
  let log1 = sdBox(center - vec2f(-0.15, 0.3), vec2f(0.25, 0.04));
  let log2 = sdBox(center - vec2f(0.1, 0.35), vec2f(0.2, 0.04));
  // Flame body — wobble with noise
  var flameP = center - vec2f(0.0, -0.05);
  flameP.x += gnoise(vec2f(time * 2.0, uv.y * 3.0)) * 0.08;
  let flame = sdCircle(flameP * vec2f(1.0, 0.6), 0.2 - uv.y * 0.15);
  // Inner flame
  let inner = sdCircle(flameP * vec2f(1.2, 0.7), 0.1 - uv.y * 0.08);
  // Sparks
  var spark = 0.0;
  if (hash21(floor(cellPos * 0.5) + floor(time * 3.0)) > 0.97 && uv.y < 0.3) { spark = 1.0; }
  // Compose color
  var col = vec3f(0.1, 0.05, 0.02); // dark bg
  if (log1 < 0.0 || log2 < 0.0) { col = vec3f(0.35, 0.18, 0.06) + vnoise(cellPos * 0.5) * 0.1; }
  if (flame < 0.0) { col = vec3f(0.9, 0.3 + vnoise(cellPos + time) * 0.2, 0.05); }
  if (inner < 0.0) { col = vec3f(1.0, 0.85, 0.2); }
  if (spark > 0.0) { col = vec3f(1.0, 0.7, 0.1); }
  return vec4f(col, 1.0);
}

RULES:
- WGSL syntax only. No GLSL. Use fn, let, var, vec2f, vec3f, vec4f, f32, i32, mat2x2f
- No uniforms/textures/globals — only function params + the utility library above
- Do NOT redeclare any utility function
- You CAN define helper functions before fieldEffect (use fn name(args) -> return_type { } syntax)
- Always return a=1.0
- Make it look GOOD — rich colors, detail, animation. This should look like quality sprite art.
- Use the FULL workspace — scale your design to fill regionMin→regionMax
- WGSL requires explicit type constructors: vec2f(), vec3f(), vec4f() — NOT vec2(), vec3(), vec4()
- Ternary operator does NOT exist in WGSL — use select(falseVal, trueVal, condition) or if/else
- Use glsl_mod() instead of the % operator for float modulus

Respond in this exact format:

DESCRIPTION: one line

\`\`\`wgsl
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  // code
}
\`\`\``

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }

    const limited = await checkRateLimit('engine_generate', session.user.id)
    if (limited) {
      return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
    }

    const body = await req.json()
    const { prompt, bounds } = body

    if (!prompt?.trim() || prompt.trim().length < 3) {
      return NextResponse.json({ error: 'Prompt must be at least 3 characters' }, { status: 400 })
    }
    if (prompt.trim().length > 500) {
      return NextResponse.json({ error: 'Prompt too long (max 500 characters)' }, { status: 400 })
    }

    setApiCaller('engine_generate')

    const width = (bounds?.maxX ?? 512) - (bounds?.minX ?? 0)
    const height = (bounds?.maxY ?? 512) - (bounds?.minY ?? 0)

    const userMessage = `Create: "${prompt.trim()}"

Workspace: ${width}x${height} cells (from (${bounds?.minX ?? 0}, ${bounds?.minY ?? 0}) to (${bounds?.maxX ?? 512}, ${bounds?.maxY ?? 512}) on a 512x512 grid). You have ${width * height} pixels to work with. Make every pixel count.`

    const result = await callClaude(
      SYSTEM_PROMPT,
      [{ role: 'user', content: userMessage }],
      'sonnet',
      2048
    )

    // Extract WGSL from code fence and description from text
    const wgslMatch = result.match(/```wgsl\s*\n([\s\S]*?)```/)
      || result.match(/```\s*\n([\s\S]*?)```/)
    const descMatch = result.match(/DESCRIPTION:\s*(.+)/)

    let glsl = wgslMatch?.[1]?.trim()
    const description = descMatch?.[1]?.trim() || 'Generated effect'

    // Fallback: if no code fence, try to extract the function directly
    if (!glsl) {
      const funcMatch = result.match(/(fn\s+fieldEffect\s*\([\s\S]*\})\s*$/)
      glsl = funcMatch?.[1]?.trim()
    }

    if (!glsl) {
      console.error('Failed to extract WGSL from response:', result.substring(0, 500))
      return NextResponse.json(
        { error: 'Failed to parse AI response. Try a different prompt.' },
        { status: 502 }
      )
    }

    return NextResponse.json({ glsl, description })
  } catch (err) {
    console.error('Engine generate error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
