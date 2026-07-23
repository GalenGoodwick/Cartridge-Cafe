/** Copy to clipboard, for real. The modern API is absent on http and rejects
 *  when the document isn't focused; the textarea fallback silently selects
 *  NOTHING on iOS unless the range is set explicitly. Returns whether the text
 *  actually landed on the clipboard, so callers can show COPIED ✓ / a manual
 *  select-and-copy fallback instead of failing silently. */
export async function copyText(t: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(t); return true } catch { /* fall through */ }
  }
  const ta = document.createElement('textarea')
  ta.value = t
  ta.setAttribute('readonly', '')                 // no iOS keyboard flash
  // 16px: below that iOS zooms the page on focus and never restores it
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'
  document.body.appendChild(ta)
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, t.length)             // iOS: select() alone selects nothing
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta.remove()
  }
}
