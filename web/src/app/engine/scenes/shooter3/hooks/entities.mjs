// entities — publish worldData.__entities so the ENGINE's inspect toggle names
// the demons. They live in __vf.en + the gpuPopulation buffer, invisible to the
// field hit-map (the whole world is one raymarch field). This projects each live
// demon through the SAME camera the shader marches (uniforms u[240..246], fov
// u[243]), so a click resolves "Scene › entity #N (demon)". Additive: reads
// state, writes only wd.__entities. The universal legibility contract — identity
// in data, the engine reads it — retrofitted onto a shipped 3D world.
export function vfEntities(sim /* , dt */) {
  const wd = sim.worldData
  const V = wd.__vf, u = wd.gpuUniforms
  if (!V || !Array.isArray(V.en) || !Array.isArray(u) || u.length < 247) return
  const ro = [u[240], u[241], u[242]], fov = u[243] || 1.2, ta = [u[244], u[245], u[246]]
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
  const fw = norm(sub(ta, ro))
  const rgt = norm(cross([0, 1, 0], fw))
  const up = cross(fw, rgt)
  const ents = []
  for (let i = 0; i < V.en.length; i++) {
    const e = V.en[i]
    if (!e || e.hp <= 0) continue
    const W = [e.x, 0.9, e.z]                 // demon center, ~waist height
    const d = sub(W, ro), df = dot(d, fw)
    if (df <= 0.3) continue                    // behind camera / too close
    const xc = dot(d, rgt) / df, yc = dot(d, up) / df
    const sx = (1 - xc / fov) * 256            // veilfire ray uses rt = cross(fw, worldup) → mirror X
    const sy = (1 - yc / fov) * 256
    if (sx < -40 || sx > 552 || sy < -40 || sy > 552) continue
    const r = Math.max(28, Math.min(110, (1.1 / (fov * Math.max(df, 0.5))) * 256))
    ents.push({ id: i, kind: 1, label: 'demon', sx, sy, r })
  }
  wd.__entities = ents
}
