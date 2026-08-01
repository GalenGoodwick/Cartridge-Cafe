// shader — the eye a UNIT test can hold: visual_pentarch must COMPILE on a real
// GPU. A shader alone renders blank (empty population), so we verify it compiles
// (with the engine's pop/popCount builtins stubbed) rather than that it draws —
// the drawing is verified at the `integrate` node, where real scenes push entities.
import { test } from 'node:test'
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { visualSource } from '../shader.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('visual_pentarch is well-formed', () => {
  const wgsl = visualSource()
  assert.match(wgsl, /fn\s+visual_pentarch\s*\(/, 'must define fn visual_pentarch(...)')
  assert.ok(wgsl.length > 200, 'shader looks empty')
})

test('visual_pentarch compiles on the GPU (engine pop/popCount stubbed)', () => {
  const wgsl = visualSource()
  writeFileSync('/tmp/pentarch-shader.wgsl', wgsl)
  writeFileSync('/tmp/pentarch-stubs.wgsl', 'fn pop(i: i32) -> vec4f { return vec4f(0.0); }\nfn popCount() -> i32 { return 0; }\n')
  const out = execFileSync('deno', [
    'run', '--unstable-webgpu', '-A', join(REPO, 'tools/wgsl-render-check.mjs'),
    '--module', '/tmp/pentarch-stubs.wgsl', '--visual', '/tmp/pentarch-shader.wgsl',
    '--name', 'pentarch', '--out', '/tmp/pentarch-shadercheck.png',
  ], { cwd: REPO, encoding: 'utf8' })
  const j = JSON.parse(out.trim().split('\n').filter(Boolean).pop())
  assert.ok(j.ok, 'shader WGSL failed to compile: ' + JSON.stringify(j.errors || []).slice(0, 500))
})
