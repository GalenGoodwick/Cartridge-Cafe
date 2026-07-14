import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { callClaude, setApiCaller } from '@/lib/claude'
import { checkRateLimit } from '@/lib/rate-limit'

export const maxDuration = 30

// BREW YOUR ICON — the AI never writes shader code. It only CHOOSES from a fixed
// vocabulary of safe, fixed-cost looks and a few bounded numbers. There is no
// strobe/flash parameter to reach for, and every value is clamped server-side
// below — so an AI-brewed icon is structurally incapable of flashing or of
// costing more GPU than any hand-picked one. The look is realised by cf_player
// in cafe-cartridge.mjs; this route only produces its (fx, hue, size) descriptor.
const SYSTEM_PROMPT = `You design a player's little dancing avatar for a cafe of worlds. You do NOT write code. You reply with ONLY a compact JSON object, no prose, no code fence.

Schema (all fields required):
{
  "fx":   integer 0-3,   // the look: 0 = comet (a glowing tail), 1 = ring (a halo), 2 = eyes (a face that looks around), 3 = spark (a five-point star)
  "hue":  number 0.0-1.0,// color around the wheel: 0 red, ~0.15 gold, ~0.35 green, ~0.55 cyan, ~0.7 blue/purple, ~0.85 magenta
  "size": number 0.5-2.0 // 0.5 small & quick, 1.0 normal, 2.0 large & mellow
}

Pick the look and hue that best match the player's description. Choose eyes for anything creature/animal/character-like, ring for calm/holy/orbit, spark for energetic/star/fire, comet otherwise. Reply with the JSON object only.`

type Icon = { fx: number; hue: number; size: number }

const DEFAULT_ICON: Icon = { fx: 0, hue: 0.55, size: 1 }

// The clamp IS the safety boundary — never trust the model's numbers.
function clampIcon(raw: unknown): Icon {
  const o = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown, lo: number, hi: number, d: number): number => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
  }
  const fxRaw = Math.round(Number(o.fx))
  const fx = fxRaw >= 0 && fxRaw <= 3 ? fxRaw : 0
  return {
    fx,
    hue: num(o.hue, 0, 1, DEFAULT_ICON.hue),
    size: num(o.size, 0.5, 2, DEFAULT_ICON.size),
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }

    const limited = await checkRateLimit('engine_icon', session.user.id)
    if (limited) {
      return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
    }

    const body = await req.json().catch(() => ({}))
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    if (prompt.length < 3) {
      return NextResponse.json({ error: 'Describe your icon in a few words' }, { status: 400 })
    }
    if (prompt.length > 200) {
      return NextResponse.json({ error: 'Keep it short (max 200 characters)' }, { status: 400 })
    }

    setApiCaller('engine_icon')
    const result = await callClaude(
      SYSTEM_PROMPT,
      [{ role: 'user', content: `Describe: "${prompt}"` }],
      'haiku',
      200,
    )

    // Pull the first {...} out of the reply, however the model wrapped it.
    let parsed: unknown = null
    const match = result.match(/\{[\s\S]*\}/)
    if (match) { try { parsed = JSON.parse(match[0]) } catch { /* clamp handles it */ } }

    const icon = clampIcon(parsed)
    return NextResponse.json({ icon })
  } catch (err) {
    console.error('Engine icon error:', err)
    return NextResponse.json({ error: 'Could not brew icon. Try again.' }, { status: 500 })
  }
}
