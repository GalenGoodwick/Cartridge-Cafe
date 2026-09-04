// mesh-bake.test.mjs — the bake math proven against a mesh whose SDF is known
// analytically (a UV sphere). Proper-always law: new math is unit-tested
// before it ships. Run: node --test mcp/mesh-bake.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import zlib from 'node:zlib'
import { bakeField, packSheetPNG, tileLayout, silhouetteCoverage, wgslSampler, bakeMesh } from './mesh-bake.mjs'

// --- procedural UV sphere mesh (radius R, center C) --------------------------
function sphereMesh(R = 1.0, rings = 24, segs = 48) {
  const verts = [], tris = []
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * 2 * Math.PI
      verts.push(R * Math.sin(phi) * Math.cos(th), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(th))
    }
  }
  const idx = (r, s) => r * (segs + 1) + s
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    tris.push(idx(r, s), idx(r + 1, s), idx(r, s + 1))
    tris.push(idx(r, s + 1), idx(r + 1, s), idx(r + 1, s + 1))
  }
  return { verts: Float64Array.from(verts), tris: Uint32Array.from(tris) }
}

const RES = 48
const PAD = 0.10
// after normalization the sphere fills the cube minus padding: radius in cube units
const RCUBE = (1 - 2 * PAD) / 2

test('sphere bake: sign, distance accuracy, silhouette', () => {
  const { field, band, stats } = bakeField(sphereMesh(), { res: RES, pad: PAD })
  assert.ok(stats.insideVoxels > 0, 'has interior voxels')

  const at = (x, y, z) => {
    const ix = Math.floor(x * RES), iy = Math.floor(y * RES), iz = Math.floor(z * RES)
    return field[(iz * RES + iy) * RES + ix]
  }
  // center is deep inside → clamped to -band
  assert.ok(at(0.5, 0.5, 0.5) <= -band * 0.95, `center should be -band, got ${at(0.5, 0.5, 0.5)}`)
  // corner is far outside → clamped to +band
  assert.ok(at(0.02, 0.02, 0.02) >= band * 0.95, 'corner should be +band')

  // near-surface accuracy: sample along +x from center, compare to analytic d = |p|-R
  let worst = 0, checked = 0
  for (let k = 0; k < RES; k++) {
    const x = (k + 0.5) / RES
    const analytic = Math.abs(x - 0.5) - RCUBE
    if (Math.abs(analytic) > band * 0.8) continue      // only judge inside the band
    const baked = at(x, 0.5 + 0.001, 0.5 + 0.001)
    worst = Math.max(worst, Math.abs(baked - analytic))
    checked++
  }
  assert.ok(checked >= 2, 'sampled points inside the band')
  // tolerance: 1.5 voxels — point-cloud distance + voxel-center offset
  assert.ok(worst < 1.5 / RES, `surface distance error ${worst} exceeds 1.5 voxels (${1.5 / RES})`)

  // silhouette of a sphere ≈ π r² of the tile area
  const sil = silhouetteCoverage(field, RES, 2)
  const expected = Math.PI * RCUBE * RCUBE
  assert.ok(Math.abs(sil - expected) < expected * 0.15, `silhouette ${sil} vs analytic ${expected}`)
})

test('png pack round-trips distances within quantization', () => {
  const { field, band } = bakeField(sphereMesh(), { res: RES, pad: PAD })
  const { png, cols } = packSheetPNG(field, RES, band)
  assert.ok(png.length > 1000 && png.readUInt32BE(0) === 0x89504e47, 'valid PNG')

  // decode the IDAT back and compare a mid-volume slice voxel by voxel
  let off = 8, idat = Buffer.alloc(0), W = 0
  while (off < png.length) {
    const len = png.readUInt32BE(off), tag = png.toString('ascii', off + 4, off + 8)
    if (tag === 'IHDR') W = png.readUInt32BE(off + 8)
    if (tag === 'IDAT') idat = Buffer.concat([idat, png.subarray(off + 8, off + 8 + len)])
    off += 12 + len
  }
  const raw = zlib.inflateSync(idat)
  const stride = W * 4 + 1
  const iz = RES >> 1
  const tx = (iz % cols) * RES, ty = Math.floor(iz / cols) * RES
  let worst = 0
  for (let iy = 0; iy < RES; iy++) for (let ix = 0; ix < RES; ix++) {
    assert.strictEqual(raw[(ty + iy) * stride], 0, 'rows written unfiltered')
    const a = raw[(ty + iy) * stride + 1 + (tx + ix) * 4 + 3]
    const decoded = (a / 255 * 2 - 1) * band
    worst = Math.max(worst, Math.abs(decoded - field[(iz * RES + iy) * RES + ix]))
  }
  assert.ok(worst <= band / 100, `round-trip error ${worst} exceeds one quantization step`)
})

test('tile layout covers all slices for non-square resolutions', () => {
  for (const r of [24, 32, 48, 64, 80, 96]) {
    const { cols, rows } = tileLayout(r)
    assert.ok(cols * rows >= r, `${r}: ${cols}x${rows} covers`)
    assert.ok(cols * rows - r < cols, `${r}: no wasted row`)
  }
})

test('wgsl emitter parameterizes base slot, res, and band', () => {
  const w = wgslSampler({ base: 7, res: 48, cols: 7, band: 4 / 48, prefix: 'fox' })
  assert.ok(w.includes('sprite(7 + cz'), 'base slot inlined')
  assert.ok(w.includes('clamp(ix, 0, 47)'), 'res inlined')
  assert.ok(w.includes('fn fox_sdf'), 'prefix applied')
})

test('bakeMesh end-to-end self-check accepts a sphere', () => {
  // serialize the sphere as a minimal GLB and run the full pipeline
  const { verts, tris } = sphereMesh()
  const pos = Buffer.alloc(verts.length * 4)
  for (let i = 0; i < verts.length; i++) pos.writeFloatLE(verts[i], i * 4)
  const idx = Buffer.alloc(tris.length * 4)
  for (let i = 0; i < tris.length; i++) idx.writeUInt32LE(tris[i], i * 4)
  const bin = Buffer.concat([pos, idx])
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < verts.length; i += 3) for (let a = 0; a < 3; a++) {
    mn[a] = Math.min(mn[a], verts[i + a]); mx[a] = Math.max(mx[a], verts[i + a])
  }
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: verts.length / 3, type: 'VEC3', min: mn, max: mx },
      { bufferView: 1, componentType: 5125, count: tris.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: pos.length, byteLength: idx.length },
    ],
    buffers: [{ byteLength: bin.length }],
  }
  let jsonBuf = Buffer.from(JSON.stringify(gltf))
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - jsonBuf.length % 4, 0x20)])
  let binBuf = bin
  if (binBuf.length % 4) binBuf = Buffer.concat([binBuf, Buffer.alloc(4 - binBuf.length % 4)])
  const glb = Buffer.alloc(12 + 8 + jsonBuf.length + 8 + binBuf.length)
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(jsonBuf.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); jsonBuf.copy(glb, 20)
  glb.writeUInt32LE(binBuf.length, 20 + jsonBuf.length); glb.writeUInt32LE(0x004e4942, 24 + jsonBuf.length)
  binBuf.copy(glb, 28 + jsonBuf.length)

  const out = bakeMesh(glb, { res: 32 })
  assert.strictEqual(out.res, 32)
  assert.ok(out.stats.silhouette.z > 0.3, 'sphere silhouette present')
  assert.ok(out.png.length > 500, 'png produced')
  assert.ok(out.wgsl(5).includes('sprite(5 + cz'), 'wgsl closure carries base')
})
