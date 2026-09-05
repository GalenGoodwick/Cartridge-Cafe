// mesh-bake.mjs — ACTUAL 3D MESH import: glTF binary → signed-distance volume →
// tiled sprite sheet, pure JS, zero dependencies. The AI runs this conversion
// (import_mesh tool); the engine only ever sees a define_sheet upload. The same
// module is written to be vendorable into the web SPRITES panel later (a MESH
// tab running it client-side in a worker) — ONE pipeline, two doors.
//
// Encoding contract (do not change without versioning):
//  · The volume is res³ voxels, packed as cols×rows tiles of res×res in one PNG,
//    slice index z = tile index, row-major.
//  · Distance lives in the ALPHA channel: a = (d/band)*0.5+0.5, band = 4/res in
//    unit-cube units. RGB is free for future baked albedo. ALPHA and not RGB
//    because the engine's sprite() LINEARIZES rgb (sRGB→linear) which corrupts
//    encoded data — alpha passes through untouched. Learned Sep 4 2026.
//  · Mesh is normalized into the unit cube with PAD margin, y kept glTF-up.
//
// Sign is z-column ray parity (odd crossings below = inside): robust for
// closed-ish meshes, tolerant of small holes. Unsigned distance comes from an
// area-weighted surface point cloud + spatial-hash nearest neighbor.

import zlib from 'node:zlib'

// ---------------------------------------------------------------- glb parsing

/** Parse a .glb buffer → { verts: Float64Array xyz…, tris: Uint32Array } with
 *  node transforms applied. Throws on non-GLB or unindexed primitives. */
export function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (magic mismatch)')
  let off = 12, json = null, bin = null
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString())
    if (type === 0x004e4942) bin = data
    off += 8 + len
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk')

  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const mul = (a, b) => {           // column-major 4x4
    const o = new Array(16)
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
    return o
  }
  const trs = (n) => {              // translation/rotation(quat)/scale → matrix
    const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1]
    const [x, y, z, w] = q
    const m = [
      (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
      (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
      (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
      t[0], t[1], t[2], 1,
    ]
    return m
  }

  const prims = []
  const walk = (ni, parent) => {
    const node = json.nodes[ni]
    let m = parent
    if (node.matrix) m = mul(parent, node.matrix)
    else if (node.translation || node.rotation || node.scale) m = mul(parent, trs(node))
    if (node.mesh !== undefined) for (const p of json.meshes[node.mesh].primitives) prims.push({ p, m })
    for (const c of node.children || []) walk(c, m)
  }
  const scene = json.scenes[json.scene || 0]
  for (const ni of scene.nodes) walk(ni, I4)
  if (!prims.length) throw new Error('GLB has no mesh primitives in the default scene')

  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView]
    return { a, bv, start: (bv.byteOffset || 0) + (a.byteOffset || 0) }
  }
  const verts = [], tris = []
  for (const { p, m } of prims) {
    const base = verts.length / 3
    const pa = acc(p.attributes.POSITION)
    const stride = pa.bv.byteStride || 12
    for (let i = 0; i < pa.a.count; i++) {
      const px = bin.readFloatLE(pa.start + i * stride)
      const py = bin.readFloatLE(pa.start + i * stride + 4)
      const pz = bin.readFloatLE(pa.start + i * stride + 8)
      verts.push(
        m[0] * px + m[4] * py + m[8] * pz + m[12],
        m[1] * px + m[5] * py + m[9] * pz + m[13],
        m[2] * px + m[6] * py + m[10] * pz + m[14],
      )
    }
    if (p.indices !== undefined) {
      const ia = acc(p.indices)
      const rd = ia.a.componentType === 5125 ? (k) => bin.readUInt32LE(ia.start + k * 4)
        : ia.a.componentType === 5123 ? (k) => bin.readUInt16LE(ia.start + k * 2)
        : (k) => bin.readUInt8(ia.start + k)
      for (let k = 0; k < ia.a.count; k++) tris.push(base + rd(k))
    } else {
      // unindexed primitive (e.g. Khronos Fox) — triangle soup, 3 verts per tri
      for (let k = 0; k < pa.a.count; k++) tris.push(base + k)
    }
  }
  return { verts: Float64Array.from(verts), tris: Uint32Array.from(tris) }
}

// ------------------------------------------------------------------- the bake

/** Bake { verts, tris } → { field: Float32Array res³ (index (z*res+y)*res+x,
 *  clamped ±band), band, stats }. Mesh is normalized into the unit cube. */
export function bakeField({ verts: srcVerts, tris }, { res = 64, pad = 0.10, pointBudget } = {}) {
  const band = 4 / res
  const verts = Float64Array.from(srcVerts)

  // normalize into unit cube, uniform scale, centered, PAD margin
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < verts.length; i += 3) for (let a = 0; a < 3; a++) {
    if (verts[i + a] < mn[a]) mn[a] = verts[i + a]
    if (verts[i + a] > mx[a]) mx[a] = verts[i + a]
  }
  const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1
  const s = (1 - 2 * pad) / span
  for (let i = 0; i < verts.length; i += 3)
    for (let a = 0; a < 3; a++) verts[i + a] = 0.5 + (verts[i + a] - (mn[a] + mx[a]) / 2) * s

  const V = (i) => [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]]

  // area-weighted surface point cloud (deterministic LCG so bakes reproduce)
  const TARGET = pointBudget || Math.round(2200 * res)
  let totalA = 0
  const areas = new Float64Array(tris.length / 3)
  for (let t = 0; t < tris.length; t += 3) {
    const A = V(tris[t]), B = V(tris[t + 1]), C = V(tris[t + 2])
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2]
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2]
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
    areas[t / 3] = Math.hypot(cx, cy, cz) / 2
    totalA += areas[t / 3]
  }
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const pts = []
  for (let t = 0; t < tris.length; t += 3) {
    const n = Math.max(1, Math.round(areas[t / 3] / totalA * TARGET))
    const A = V(tris[t]), B = V(tris[t + 1]), C = V(tris[t + 2])
    for (let k = 0; k < n; k++) {
      const r1 = Math.sqrt(rnd()), r2 = rnd()
      const u = 1 - r1, v = r1 * (1 - r2), w = r1 * r2
      pts.push(u * A[0] + v * B[0] + w * C[0], u * A[1] + v * B[1] + w * C[1], u * A[2] + v * B[2] + w * C[2])
    }
  }
  const NP = pts.length / 3

  // spatial hash — expanding-ring nearest neighbor
  const HC = Math.max(24, Math.min(64, Math.round(res * 0.75)))
  const buckets = new Map()
  const bkey = (x, y, z) => (x * HC + y) * HC + z
  const clampi = (v) => Math.min(HC - 1, Math.max(0, v))
  for (let i = 0; i < NP; i++) {
    const k = bkey(clampi(Math.floor(pts[i * 3] * HC)), clampi(Math.floor(pts[i * 3 + 1] * HC)), clampi(Math.floor(pts[i * 3 + 2] * HC)))
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(i)
  }
  // ring search is only ever called for voxels the band mark says are NEAR the
  // surface, so it terminates within a couple of rings — cap it there. (The
  // first version ran this search for EVERY voxel, including the ~95% of the
  // volume that clamps to ±band anyway: a thin mesh in a mostly-empty cube
  // made it crawl — Fox at 80³ took 8.5 min. Banding took it to seconds.)
  const RING_CAP = Math.ceil(((band * 1.8) * HC)) + 2
  const nearest = (x, y, z) => {
    const bx = clampi(Math.floor(x * HC)), by = clampi(Math.floor(y * HC)), bz = clampi(Math.floor(z * HC))
    let best = Infinity
    for (let r = 0; r <= RING_CAP; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue
        const cx = bx + dx, cy = by + dy, cz = bz + dz
        if (cx < 0 || cy < 0 || cz < 0 || cx >= HC || cy >= HC || cz >= HC) continue
        const cell = buckets.get(bkey(cx, cy, cz))
        if (!cell) continue
        for (const i of cell) {
          const ddx = pts[i * 3] - x, ddy = pts[i * 3 + 1] - y, ddz = pts[i * 3 + 2] - z
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz
          if (d2 < best) best = d2
        }
      }
      // a hit at ring r bounds the true nearest within ring r+1 — one more ring closes it
      if (best !== Infinity && Math.sqrt(best) <= (r + 1) / HC) break
    }
    return Math.sqrt(best)   // Infinity when nothing within RING_CAP (caller clamps)
  }

  // THE BAND MARK — the whole reason the bake is fast. Exact distance is only
  // meaningful within ±band (everything else is clamped), so: splat each
  // surface point into a voxel mark grid, dilate it band+1 voxels outward
  // (26-neighbor passes), and compute exact distance ONLY where marked.
  const mark = new Uint8Array(res * res * res)
  for (let i = 0; i < NP; i++) {
    const ix = Math.min(res - 1, Math.max(0, Math.floor(pts[i * 3] * res)))
    const iy = Math.min(res - 1, Math.max(0, Math.floor(pts[i * 3 + 1] * res)))
    const iz = Math.min(res - 1, Math.max(0, Math.floor(pts[i * 3 + 2] * res)))
    mark[(iz * res + iy) * res + ix] = 1
  }
  const DILATE = 5   // band is 4 voxels; +1 for voxel-center offset
  let cur = mark
  for (let pass = 0; pass < DILATE; pass++) {
    const nxt = Uint8Array.from(cur)
    for (let iz = 0; iz < res; iz++) for (let iy = 0; iy < res; iy++) for (let ix = 0; ix < res; ix++) {
      if (cur[(iz * res + iy) * res + ix]) continue
      let hit = false
      for (let dz = -1; dz <= 1 && !hit; dz++) for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) {
        const nx = ix + dx, ny = iy + dy, nz = iz + dz
        if (nx < 0 || ny < 0 || nz < 0 || nx >= res || ny >= res || nz >= res) continue
        if (cur[(nz * res + ny) * res + nx]) hit = true
      }
      if (hit) nxt[(iz * res + iy) * res + ix] = 1
    }
    cur = nxt
  }
  const banded = cur

  // sign: z-column crossings per (x,y) column, parity below the voxel = inside
  const crossings = Array.from({ length: res * res }, () => [])
  for (let t = 0; t < tris.length; t += 3) {
    const A = V(tris[t]), B = V(tris[t + 1]), C = V(tris[t + 2])
    const d = [B[0] - A[0], B[1] - A[1]], e = [C[0] - A[0], C[1] - A[1]]
    const det = d[0] * e[1] - d[1] * e[0]
    if (Math.abs(det) < 1e-12) continue
    const minx = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]) * res))
    const maxx = Math.min(res - 1, Math.ceil(Math.max(A[0], B[0], C[0]) * res))
    const miny = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]) * res))
    const maxy = Math.min(res - 1, Math.ceil(Math.max(A[1], B[1], C[1]) * res))
    for (let ix = minx; ix <= maxx; ix++) for (let iy = miny; iy <= maxy; iy++) {
      const px = (ix + 0.5) / res - A[0], py = (iy + 0.5) / res - A[1]
      const u = (px * e[1] - py * e[0]) / det
      const v = (d[0] * py - d[1] * px) / det
      if (u < 0 || v < 0 || u + v > 1) continue
      crossings[ix * res + iy].push(A[2] + u * (B[2] - A[2]) + v * (C[2] - A[2]))
    }
  }
  for (const c of crossings) c.sort((a, b) => a - b)

  const field = new Float32Array(res * res * res)
  let inside = 0
  for (let iz = 0; iz < res; iz++) {
    const z = (iz + 0.5) / res
    for (let iy = 0; iy < res; iy++) {
      const y = (iy + 0.5) / res
      for (let ix = 0; ix < res; ix++) {
        const x = (ix + 0.5) / res
        const o = (iz * res + iy) * res + ix
        const cl = crossings[ix * res + iy]
        let below = 0
        for (const cz of cl) { if (cz < z) below++; else break }
        const isInside = (below & 1) === 1
        if (isInside) inside++
        let d
        if (banded[o]) {
          d = nearest(x, y, z)
          if (!Number.isFinite(d)) d = band
          if (isInside) d = -d
        } else {
          d = isInside ? -band : band   // outside the band: the clamp IS the answer
        }
        field[o] = Math.max(-band, Math.min(band, d))
      }
    }
  }
  return { field, band, stats: { verts: srcVerts.length / 3, tris: tris.length / 3, points: NP, insideVoxels: inside } }
}

// ------------------------------------------------------------------ packaging

/** Tile layout for a given resolution: smallest near-square grid ≥ res tiles. */
export function tileLayout(res) {
  const cols = Math.ceil(Math.sqrt(res))
  const rows = Math.ceil(res / cols)
  return { cols, rows }
}

/** Pack the field into an RGBA PNG — alpha = distance, rgb = flat tint. */
export function packSheetPNG(field, res, band, { rgb = [231, 180, 60] } = {}) {
  const { cols, rows } = tileLayout(res)
  const W = res * cols, H = res * rows
  const img = new Uint8Array(W * H * 4)
  for (let iz = 0; iz < res; iz++) {
    const tx = (iz % cols) * res, ty = Math.floor(iz / cols) * res
    for (let iy = 0; iy < res; iy++) for (let ix = 0; ix < res; ix++) {
      const d = field[(iz * res + iy) * res + ix]
      const o = ((ty + iy) * W + tx + ix) * 4
      img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2]
      img[o + 3] = Math.round((d / band * 0.5 + 0.5) * 255)
    }
  }
  return { png: pngEncode(W, H, img), cols, rows, width: W, height: H }
}

function pngEncode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)).copy(raw, y * (w * 4 + 1) + 1)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  const crcTable = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (tag, data) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0); out.write(tag, 4); data.copy(out, 8)
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tag), data])), 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// -------------------------------------------------------------- verification

/** Orthographic silhouette coverage along an axis (0=x 1=y 2=z): fraction of
 *  columns containing at least one inside voxel. The bake self-check — a
 *  broken sign pass reads ~0, a solid bake reads the object's real profile. */
export function silhouetteCoverage(field, res, axis) {
  let cols = 0
  for (let a = 0; a < res; a++) for (let b = 0; b < res; b++) {
    let hit = false
    for (let c = 0; c < res && !hit; c++) {
      const [x, y, z] = axis === 0 ? [c, a, b] : axis === 1 ? [a, c, b] : [a, b, c]
      if (field[(z * res + y) * res + x] < 0) hit = true
    }
    if (hit) cols++
  }
  return cols / (res * res)
}

// ------------------------------------------------------------- WGSL emission

/** Ready-to-paste WGSL: trilinear SDF sampler over the uploaded sheet. The
 *  caller inlines these fns into a visual and raymarches `<prefix>_sdf(p)`
 *  (p in the 0..1 unit cube, y up = glTF up). */
export function wgslSampler({ base = 0, res = 64, cols = 8, band, prefix = 'msh' } = {}) {
  const b = band ?? 4 / res
  return `
fn ${prefix}_tex(ix: i32, iy: i32, iz: i32) -> f32 {
  let cx = clamp(ix, 0, ${res - 1});
  let cy = clamp(iy, 0, ${res - 1});
  let cz = clamp(iz, 0, ${res - 1});
  let cuv = (vec2f(f32(cx), f32(cy)) + vec2f(0.5)) / ${res}.0;
  return (sprite(${base} + cz, cuv).a * 2.0 - 1.0) * ${b.toFixed(6)};
}

fn ${prefix}_sdf(p: vec3f) -> f32 {
  let g = clamp(p, vec3f(0.0), vec3f(1.0)) * ${res}.0 - vec3f(0.5);
  let g0 = floor(g);
  let f = g - g0;
  let x0 = i32(g0.x); let y0 = i32(g0.y); let z0 = i32(g0.z);
  let d000 = ${prefix}_tex(x0, y0, z0);         let d100 = ${prefix}_tex(x0 + 1, y0, z0);
  let d010 = ${prefix}_tex(x0, y0 + 1, z0);     let d110 = ${prefix}_tex(x0 + 1, y0 + 1, z0);
  let d001 = ${prefix}_tex(x0, y0, z0 + 1);     let d101 = ${prefix}_tex(x0 + 1, y0, z0 + 1);
  let d011 = ${prefix}_tex(x0, y0 + 1, z0 + 1); let d111 = ${prefix}_tex(x0 + 1, y0 + 1, z0 + 1);
  let dx00 = mix(d000, d100, f.x); let dx10 = mix(d010, d110, f.x);
  let dx01 = mix(d001, d101, f.x); let dx11 = mix(d011, d111, f.x);
  return mix(mix(dx00, dx10, f.y), mix(dx01, dx11, f.y), f.z);
}`
}

// ------------------------------------------------------------- orchestration

/** Full pipeline: glb buffer → { png, cols, rows, res, band, stats, wgsl }.
 *  Throws if the self-check finds an empty bake (sign pass produced nothing). */
export function bakeMesh(buffer, { res = 64, pad = 0.10, rgb, prefix } = {}) {
  if (res < 24 || res > 96) throw new Error('resolution must be 24..96 (64 is the sweet spot)')
  const mesh = parseGLB(buffer)
  const { field, band, stats } = bakeField(mesh, { res, pad })
  const sil = {
    x: silhouetteCoverage(field, res, 0),
    y: silhouetteCoverage(field, res, 1),
    z: silhouetteCoverage(field, res, 2),
  }
  if (Math.max(sil.x, sil.y, sil.z) < 0.005) {
    throw new Error('bake self-check failed: no interior voxels — mesh may be unclosed planes or degenerate. Try a watertight model.')
  }
  const packed = packSheetPNG(field, res, band, { rgb })
  return {
    png: packed.png, cols: packed.cols, rows: packed.rows, res, band,
    stats: { ...stats, silhouette: sil },
    wgsl: (base = 0) => wgslSampler({ base, res, cols: packed.cols, band, prefix }),
  }
}
