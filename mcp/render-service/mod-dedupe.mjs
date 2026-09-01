// mod-dedupe.mjs — VERBATIM port of maskComments + deduplicateModCode from
// web/src/app/engine/shaders.ts (the Jul-23 WORLD3 fix). The browser strips
// duplicate/prelude-colliding module functions before composing the uber-shader;
// the probe must strip them IDENTICALLY or its compile verdicts diverge from
// the live engine (a world that runs fine live "fails" headless, and vice
// versa). parity-check.mjs asserts this port still matches the TS source —
// change shaders.ts and this file TOGETHER.

/** Replace comment contents with spaces, PRESERVING string length/indices, so
 *  function-name scans can't be fooled by `fn name(...)` appearing in docs. */
export function maskComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
}

/**
 * Strip duplicate WGSL function definitions from mod code.
 * Single pass: accumulates seen names as it goes, so both base conflicts
 * and cross-mod conflicts are handled.
 */
export function deduplicateModCode(code, seen) {
  // Scan a comment-MASKED copy (same length, so indices line up) and slice the
  // ORIGINAL — a `fn name(...)` in a doc comment must neither claim a name nor
  // let the return-type matcher run across lines to a distant brace.
  const masked = maskComments(code)
  const funcStartRegex = /fn\s+(\w+)\s*\([^)]*\)\s*(?:->[^{\n]+)?\{/g
  let result = ''
  let lastEnd = 0

  let match
  while ((match = funcStartRegex.exec(masked)) !== null) {
    const funcName = match[1]
    const braceStart = match.index + match[0].length - 1
    let depth = 1
    let pos = braceStart + 1
    while (pos < masked.length && depth > 0) {
      if (masked[pos] === '{') depth++
      else if (masked[pos] === '}') depth--
      pos++
    }

    if (seen.has(funcName)) {
      result += code.slice(lastEnd, match.index)
      lastEnd = pos
      funcStartRegex.lastIndex = pos
    } else {
      seen.add(funcName)
    }
  }
  result += code.slice(lastEnd)
  return result
}

/** Function names defined in a WGSL source blob (comment-masked scan). */
export function funcNamesOf(code) {
  const names = new Set()
  const masked = maskComments(code)
  const re = /fn\s+(\w+)\s*\(/g
  let m
  while ((m = re.exec(masked)) !== null) names.add(m[1])
  return names
}
