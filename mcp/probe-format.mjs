// probe-format.mjs — the pure glue shared by BOTH eyes (in-process + cloud) so
// they report identically. Kept separate from index.mjs (which opens the stdio
// transport on import) purely so it can be unit-tested. No I/O here.

/** THE NOTHING ERROR + read-hint. A blank render (coverage<1) becomes a
 *  first-class error the AI can't skip; the raw pixel-stats get a prose key.
 *  Mirrors web/src/lib/render-service.ts so the local eye speaks the same. */
export function enrichReport(out) {
  if (out && out.ok && typeof out.coveragePct === 'number' && out.coveragePct < 1) {
    out.nothing = true
    out.error = `NOTHING RENDERED — the world drew ~${out.coveragePct}% of the frame. Almost always: a field with NO visualType (renders as nothing), a WGSL shader that failed to compile (check errors[]), or content built off the 0..512 grid (check offscreenHint). Fix, then re-probe — do not trust this build.`
  }
  if (out && out.ok) out.next = 'meanLum=brightness, coveragePct=how much is drawn, bbox=where, dominantColors=palette, motion=movement over time. image is base64 PNG. If coveragePct<1 the world is ~blank; if offscreenHint set, content is mis-placed.'
  return out
}

/** Keep only the renderable state from a bridge GET body — the shape the
 *  render-service /render endpoint wants. Returns null if there's nothing to
 *  render (no fields), so the caller knows to skip the local eye. */
export function shapeSnapshot(j) {
  if (!j || !Array.isArray(j.fields)) return null
  return {
    fields: j.fields ?? [],
    visualTypes: j.visualTypes ?? [],
    modules: j.modules ?? [],
    worldData: j.worldData ?? {},
    stepHooks: j.stepHooks ?? [],
    worldParams: j.worldParams ?? {},
    interactionRules: j.interactionRules ?? [],
    interactionEffects: j.interactionEffects ?? [],
  }
}

/** Shape a render report (from EITHER eye) into MCP tool content: the JSON
 *  stats + the PNG, or the eye-is-closed warning when nothing came back. */
export function probeContent(r, eye) {
  const { image, png, ...report } = r || {}
  report.eye = eye
  const img = image || png
  const content = [{ type: 'text', text: JSON.stringify(report, null, 2) }]
  if (typeof img === 'string' && img.length) {
    content.push({ type: 'image', data: img.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' })
  } else {
    content.push({ type: 'text', text: '⚠ NO IMAGE — the eye is CLOSED: nothing rendered. Usually an unskinned field (needs a visualType) or a WGSL compile error above. Fix it and re-probe; do not trust this build.' })
  }
  return { content }
}
