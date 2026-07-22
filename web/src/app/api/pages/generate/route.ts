import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { callClaude, setApiCaller } from '@/lib/claude'
import { checkRateLimit } from '@/lib/rate-limit'

export const maxDuration = 30

// The connected AI authors an ENTIRE frame — atmosphere AND any text/content —
// as one self-contained `fn fieldEffect(...)`. Everything is procedural: text is
// drawn with the built-in 5x7 font, so a frame is a single imagined image that runs.
const SYSTEM_PROMPT = `You are a frame engine. You imagine a whole rectangular panel of a webpage and emit ONE WGSL function that renders it — background, atmosphere, AND any text, all procedurally. The panel fills its rectangle edge to edge.

Write exactly this function (no globals, no uniforms, no textures — only its params and the pre-loaded utility library):

fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f { ... }

COORDINATES:
- Use uv = regionUV(cellPos, regionMin, regionMax) → 0..1 across the whole panel.
- (0,0) is the TOP-LEFT corner, (1,1) is the BOTTOM-RIGHT. y increases downward.
- regionUVCentered(...) → -1..1 centered if you want a symmetric composition.
- Always return vec4f(r, g, b, 1.0) — alpha is always 1.0 and you fill every pixel.

PRE-LOADED HELPERS (do not redeclare):
- Noise: vnoise(vec2f)→0..1, gnoise(vec2f)→-1..1, fbm(vec2f, i32 octaves), hash11(f32), hash21(vec2f), hash22(vec2f), warp(vec2f p, f32 strength, f32 time)
- Shapes (signed distance, negative = inside): sdCircle(p,r), sdBox(p,b), sdRoundedBox(p,b,r), sdSegment(p,a,b), sdEquilateralTriangle(p,r), sdStar(p,r,n,m); combine with opUnion/opSubtract/opIntersect/opSmoothUnion(a,b,k)
- Color: hsv2rgb(vec3f), palette(f32 t, vec3f a, vec3f b, vec3f c, vec3f d), rot2(f32)→mat2x2f, glow(f32 d, vec3f col, f32 intensity, f32 radius)
- Math: glsl_mod(x,y) instead of the % operator

TEXT — draw words with the 5x7 font. char5x7(p, code) returns glyph coverage for p in [0,1]² (y down), code = ASCII ('A'=65 … 'Z'=90, digits '0'=48). Lay each letter in its own horizontal cell. Pattern to draw a word:
  var codes = array<i32, 5>(72, 69, 76, 76, 79); // "HELLO"
  let n = 5.0; let x0 = 0.1; let x1 = 0.9; let yc = 0.5; let ch = 0.18;
  let lx = (uv.x - x0) / ((x1 - x0) / n);
  let li = i32(floor(lx));
  if (li >= 0 && li < 5) {
    let cy = (uv.y - (yc - ch * 0.5)) / ch;
    if (cy >= 0.0 && cy <= 1.0) {
      let ink = char5x7(vec2f(fract(lx), cy), codes[li]);
      col = mix(col, vec3f(1.0), ink);
    }
  }
Use a fixed-size array<i32, N> literal sized to the exact letter count. Keep words short (a title, a label, a number). printInt(p, value, digits) draws a right-aligned integer.

STRICT WGSL RULES:
- WGSL only. Explicit constructors: vec2f(), vec3f(), vec4f() — never vec2()/vec3()/vec4().
- No ternary operator — use select(falseVal, trueVal, condition) or if/else.
- Use glsl_mod() not %. Loops must be bounded. Do NOT redeclare any helper.
- You may define your own helper fns before fieldEffect.

MAKE IT BEAUTIFUL: rich color, depth (background → mid → detail → highlight), gentle animation with time. Match the requested mood. If the request asks for words, render them clearly.

Respond in EXACTLY this format:

DESCRIPTION: one short line

\`\`\`wgsl
fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  // ...
}
\`\`\``

// Robustly pull the WGSL out of the model's reply — any fence style, or a
// brace-balanced fallback that captures every fn from the first one to the last brace.
function extractWgsl(text: string): string | null {
  const fence = text.match(/```(?:wgsl|glsl|rust|c\+\+|cpp|c)?\s*\n?([\s\S]*?)```/i)
  if (fence?.[1] && /fn\s+fieldEffect/.test(fence[1])) return fence[1].trim()
  if (/fn\s+fieldEffect/.test(text)) {
    const start = text.search(/fn\s+[A-Za-z_]/)
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) return text.slice(start, end + 1).trim()
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    // Open on localhost so the composer works during development; gated in production.
    if (!userId && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }

    const limited = await checkRateLimit('pages_generate', userId || 'local-dev')
    if (limited) {
      return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
    }

    const body = await req.json()
    const prompt: string = body?.prompt ?? ''
    if (!prompt.trim() || prompt.trim().length < 3) {
      return NextResponse.json({ error: 'Prompt must be at least 3 characters' }, { status: 400 })
    }
    if (prompt.trim().length > 500) {
      return NextResponse.json({ error: 'Prompt too long (max 500 characters)' }, { status: 400 })
    }

    setApiCaller('pages_generate')

    const userMessage = `Imagine this panel: "${prompt.trim()}"

It is one rectangular frame of a mobile-first page. Fill it edge to edge. If the request implies words (a title, a name, a label), render them with the 5x7 font, clearly and upright.`

    // A whole frame (backdrop + detail + text) needs real headroom — a small cap truncates the shader.
    const result = await callClaude(SYSTEM_PROMPT, [{ role: 'user', content: userMessage }], 'sonnet', 4096)

    const descMatch = result.match(/DESCRIPTION:\s*(.+)/)
    const description = descMatch?.[1]?.trim() || 'Imagined frame'
    const wgsl = extractWgsl(result)

    if (!wgsl) {
      console.error('pages/generate: no WGSL in response:', result.substring(0, 500))
      return NextResponse.json({ error: 'The AI response could not be parsed. Try rephrasing.' }, { status: 502 })
    }

    return NextResponse.json({ wgsl, description })
  } catch (err) {
    console.error('pages/generate error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
