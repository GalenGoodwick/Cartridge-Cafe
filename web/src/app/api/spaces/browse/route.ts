import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/browse — Public worlds gallery; signed-in callers also see
 *  their own private/blank worlds (fuel for the MY WORLDS submain) */
export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null)
  const uid = session?.user?.id
  const spaces = await prisma.playerSpace.findMany({
    where: uid ? { OR: [{ isPublic: true }, { ownerId: uid }] } : { isPublic: true },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      updatedAt: true,
      owner: { select: { id: true, name: true, image: true } },
      forkOf: { select: { slug: true, name: true } },
      _count: { select: { versions: true, forks: true, flags: true } },
      snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  })
  // the world's own palette → a single hue the door's living emblem wears, so a
  // player world's bubble carries its real color (the tidepool reads teal) with
  // no screenshot and nothing stored. Pick the most saturated field color.
  const hueOf = (fields: Array<{ color?: number[] }>): number | null => {
    let best = -1, bestHue = null as number | null
    for (const f of fields) {
      const c = f.color
      if (!Array.isArray(c) || c.length < 3) continue
      const [r, g, b] = c
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
      const sat = mx <= 0 ? 0 : d / mx
      if (sat <= best || d === 0) continue
      let h = 0
      if (mx === r) h = ((g - b) / d) % 6
      else if (mx === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      best = sat; bestHue = ((h / 6) % 1 + 1) % 1
    }
    return bestHue
  }
  // AUTOMATIC WORLD CAPTURE → a shader. Background = the shader on the biggest
  // field. Then the world's other fields are baked in as colored blobs at their
  // real positions, so the tidepool icon carries its anemones, not just water.
  // The result is one self-contained `visual_icon` — ~2-4KB of text, nothing
  // stored extra, rendered live in the bubble (and animated on hover).
  type F = { color?: number[]; visualTypeName?: string; w?: number; h?: number; radius?: number; transform?: { x?: number; y?: number } }
  const num = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(3)
  const iconWgslOf = (fields: F[], visuals: Array<{ name?: string; wgsl?: string }>): string | null => {
    let bg: F | null = null, bgArea = -1
    for (const f of fields) {
      if (!f.visualTypeName) continue
      const w = f.w ?? (f.radius ? f.radius * 2 : 0), h = f.h ?? (f.radius ? f.radius * 2 : 0)
      const a = (w || 1) * (h || 1)
      if (a > bgArea) { bgArea = a; bg = f }
    }
    if (!bg) return null
    const v = visuals.find(v => v.name === bg!.visualTypeName)
    const fnm = v?.wgsl?.match(/fn\s+(visual_\w+)\s*\(/)
    if (!v?.wgsl || !fnm) return null
    const bgFn = fnm[1]
    const cx = bg.transform?.x ?? 256, cy = bg.transform?.y ?? 256
    const half = (Math.max(bg.w ?? 512, bg.h ?? 512) / 2) || 256
    const others = fields
      .filter(f => f !== bg && Array.isArray(f.color) && f.color.length >= 3)
      .map(f => { const w = f.w ?? (f.radius ? f.radius * 2 : 20), h = f.h ?? (f.radius ? f.radius * 2 : 20); return { f, area: w * h, w, h } })
      .sort((a, b) => b.area - a.area).slice(0, 14)
    let blobs = ''
    for (const { f, w, h } of others) {
      const nx = Math.max(-0.95, Math.min(0.95, ((f.transform?.x ?? cx) - cx) / half))
      const ny = Math.max(-0.95, Math.min(0.95, ((f.transform?.y ?? cy) - cy) / half))
      const rr = Math.max(0.05, Math.min(0.34, (Math.max(w, h) / 2) / half))
      const [r, g, b] = f.color as number[]
      blobs += `  { let d = length(uv - vec2f(${num(nx)}, ${num(ny)})); let m = smoothstep(${num(rr)}, ${num(rr * 0.5)}, d); c = mix(c, vec3f(${num(r)}, ${num(g)}, ${num(b)}), m); c += vec3f(${num(r)}, ${num(g)}, ${num(b)}) * exp(-d * d * 22.0) * 0.4; }\n`
    }
    return `${v.wgsl}\nfn visual_icon(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {\n  var c = ${bgFn}(uv, -1.0, color, time, params, behind).rgb;\n${blobs}  return vec4f(c, 1.0);\n}`
  }
  // a world is BLANK until it holds something; only unblank worlds join the door
  const out = spaces.map(({ snapshot, ...rest }) => {
    const sn = snapshot as { fields?: F[]; stepHooks?: unknown[]; visualTypes?: Array<{ name?: string; wgsl?: string }>; worldData?: { icon_wgsl?: unknown } } | null
    const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
    const hue = sn?.fields?.length ? hueOf(sn.fields) : null
    // a bespoke icon the maker's AI authored (MAKE ICON) wins; else the world's
    // own dominant visual; else (null) the door falls back to the color emblem.
    const bespoke = typeof sn?.worldData?.icon_wgsl === 'string' && /fn\s+visual_\w+\s*\(/.test(sn.worldData.icon_wgsl as string)
      ? (sn!.worldData!.icon_wgsl as string) : null
    const iconWgsl = bespoke || ((sn?.fields?.length && sn?.visualTypes?.length) ? iconWgslOf(sn.fields, sn.visualTypes) : null)
    return { ...rest, blank, hue, iconWgsl }
  })
  return NextResponse.json({ spaces: out })
}
