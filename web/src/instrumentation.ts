// OOM WATCH (Galen, Sep 14: "throw admin errors if we get oom").
//
// A function that truly runs out of memory dies without a chance to report
// itself — the only in-process signal is the climb. So: sample RSS on a slow
// tick, and the first time an instance crosses the high-water line, shout on
// BOTH channels an admin actually sees — console.error (Vercel's error feed)
// and a Notif row to every admin (the bell). Hard kills that skip the climb
// still surface in Vercel's function-error dashboard; this catches the creep
// before the kill, with the route name attached to the log line's invocation.
//
// One warning per instance lifetime (the flag), sampled every 15s — idle
// instances are paused between requests, so the timer costs nothing when
// nothing runs.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (!process.env.VERCEL) return   // local dev: the machine's memory is not the lambda's

  const limitMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) || 1769
  const warnAt = limitMb * 0.85
  const g = globalThis as { __oomWatch?: boolean; __oomWarned?: boolean }
  if (g.__oomWatch) return
  g.__oomWatch = true

  const timer = setInterval(async () => {
    if (g.__oomWarned) { clearInterval(timer); return }
    const rssMb = process.memoryUsage().rss / (1024 * 1024)
    if (rssMb < warnAt) return
    g.__oomWarned = true
    const line = `⚠ OOM WATCH: instance at ${Math.round(rssMb)}MB of ${limitMb}MB (${Math.round((rssMb / limitMb) * 100)}%) — near the kill line`
    console.error('[oom-watch]', line)
    try {
      const { adminUsers, notifyUser } = await import('@/lib/notify')
      for (const a of await adminUsers()) await notifyUser(a.id, 'oom', line)
    } catch { /* the console.error already landed in Vercel's error feed */ }
  }, 15_000)
  timer.unref?.()
}
