// Unit tests for the eye's pure glue — run: node --test probe-format.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enrichReport, shapeSnapshot, probeContent } from './probe-format.mjs'
import * as localEye from './local-eye.mjs'

test('enrichReport: a near-blank render becomes THE NOTHING ERROR', () => {
  const out = enrichReport({ ok: true, coveragePct: 0.4 })
  assert.equal(out.nothing, true)
  assert.match(out.error, /NOTHING RENDERED/)
  assert.ok(out.next, 'a read-hint is attached')
})

test('enrichReport: a drawn frame is not flagged, but still gets the read-hint', () => {
  const out = enrichReport({ ok: true, coveragePct: 42 })
  assert.equal(out.nothing, undefined)
  assert.equal(out.error, undefined)
  assert.ok(out.next)
})

test('enrichReport: a failed render is left alone (no false read-hint)', () => {
  const out = enrichReport({ ok: false, error: 'boom' })
  assert.equal(out.next, undefined)
  assert.equal(out.error, 'boom')
})

test('shapeSnapshot: keeps renderable state and defaults the missing arrays', () => {
  const snap = shapeSnapshot({
    space: { slug: 'x' }, spaceId: 'id', hookErrors: [],   // wrapper noise dropped
    fields: [{ id: 'f' }], visualTypes: [{ name: 'v' }], worldData: { a: 1 },
  })
  assert.deepEqual(snap.fields, [{ id: 'f' }])
  assert.deepEqual(snap.visualTypes, [{ name: 'v' }])
  assert.deepEqual(snap.worldData, { a: 1 })
  assert.deepEqual(snap.modules, [])
  assert.deepEqual(snap.stepHooks, [])
  assert.equal(snap.space, undefined, 'wrapper fields are not passed to the renderer')
})

test('shapeSnapshot: nothing to render → null', () => {
  assert.equal(shapeSnapshot({ space: { slug: 'x' } }), null)
  assert.equal(shapeSnapshot(null), null)
})

test('probeContent: an image report → stats + PNG, labeled by eye', () => {
  const { content } = probeContent({ ok: true, meanLum: 0.5, image: 'data:image/png;base64,AAAB' }, 'local')
  assert.equal(content.length, 2)
  const report = JSON.parse(content[0].text)
  assert.equal(report.eye, 'local')
  assert.equal(report.image, undefined, 'the base64 blob is not duplicated into the JSON')
  assert.equal(content[1].type, 'image')
  assert.equal(content[1].data, 'AAAB', 'the data: prefix is stripped')
})

test('probeContent: accepts the png key too (cloud shape)', () => {
  const { content } = probeContent({ ok: true, png: 'ZZZ' }, 'cloud')
  assert.equal(content[1].type, 'image')
  assert.equal(content[1].data, 'ZZZ')
})

test('probeContent: no image → the eye-is-closed warning', () => {
  const { content } = probeContent({ ok: false, error: 'nope' }, 'cloud')
  assert.equal(content.length, 2)
  assert.equal(content[1].type, 'text')
  assert.match(content[1].text, /NO IMAGE/)
  assert.equal(JSON.parse(content[0].text).eye, 'cloud')
})

test('localEye: available() is a boolean and why() explains it', () => {
  assert.equal(typeof localEye.available(), 'boolean')
  assert.equal(typeof localEye.why(), 'string')
})

test('worlds-store: roundtrip, dedupe by slug, survives a fresh load', async () => {
  const os = await import('node:os'); const fs = await import('node:fs'); const path = await import('node:path')
  const file = path.join(os.homedir(), '.cartridge-cafe', 'worlds.json')
  const backup = fs.existsSync(file) ? fs.readFileSync(file) : null
  try {
    const { loadWorlds, saveWorlds } = await import('./worlds-store.mjs')
    const base = 'https://test.invalid'
    saveWorlds(base, [
      { name: 'a', slug: 'a', token: 't1', viewUrl: 'u' },
      { name: 'b', slug: 'b', token: 't2', viewUrl: 'u' },
      { name: 'a2', slug: 'a', token: 't3', viewUrl: 'u' },   // same slug — latest wins
    ])
    const back = loadWorlds(base)
    assert.equal(back.length, 2)
    assert.equal(back.find(w => w.slug === 'a').token, 't3')
    assert.equal(back.find(w => w.slug === 'b').token, 't2')
    // other bases untouched
    assert.deepEqual(loadWorlds('https://other.invalid'), [])
  } finally {
    if (backup) fs.writeFileSync(file, backup); else fs.rmSync(file, { force: true })
  }
})
