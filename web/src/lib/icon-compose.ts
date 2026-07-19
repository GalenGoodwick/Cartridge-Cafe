/** Turn a world/scene snapshot into a tiny self-contained icon shader — the
 *  shared logic behind both player-world icons (spaces/browse) and house-scene
 *  icons (engine/scene-icons). No images, nothing stored: the WGSL is derived
 *  from the snapshot the world already carries. */

export type IconField = { color?: number[]; visualTypeName?: string; w?: number; h?: number; radius?: number; transform?: { x?: number; y?: number } }
export type IconVisual = { name?: string; wgsl?: string }

const num = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(3)

/** the world's dominant palette → one hue for its living emblem fallback */
export function dominantHue(fields: IconField[]): number | null {
  let best = -1, bestHue: number | null = null
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

/** Background shader on the biggest field + the other fields baked in as blobs.
 *  A bespoke `icon_wgsl` (from MAKE ICON) wins outright. A state/feedback visual
 *  is returned RAW (the renderer evolves it; blobs would corrupt its state).
 *  The world's `modules` ride along: a visual that calls mod_* functions is
 *  un-iconable without them — bundling them is what lets module-built worlds
 *  auto-icon at all (the icon pipeline compiles each icon in isolation). */
export function composeIcon(fields: IconField[], visuals: IconVisual[], bespoke?: unknown, modules?: IconVisual[]): string | null {
  if (typeof bespoke === 'string' && /fn\s+visual_\w+\s*\(/.test(bespoke)) return bespoke
  if (!fields?.length || !visuals?.length) return null
  const modWgsl = (modules || []).map(m => m?.wgsl || '').filter(Boolean).join('\n')
  let bg: IconField | null = null, bgArea = -1
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
  if (/\bprevAt\b|\bprevHere\b/.test(v.wgsl)) return modWgsl ? `${modWgsl}\n${v.wgsl}` : v.wgsl   // state visual → raw (+ its modules)
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
  return `${modWgsl ? modWgsl + '\n' : ''}${v.wgsl}\nfn visual_icon(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {\n  var c = ${bgFn}(uv, -1.0, color, time, params, behind).rgb;\n${blobs}  return vec4f(c, 1.0);\n}`
}
