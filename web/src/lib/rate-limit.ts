// In-memory sliding window rate limiter
// Stores: key -> array of timestamps
const windows = new Map<string, number[]>()

const DEFAULT_LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
  // Internal endpoints (session auth)
  vote: { maxRequests: 10, windowMs: 60_000 },
  idea: { maxRequests: 5, windowMs: 60_000 },
  signup: { maxRequests: 5, windowMs: 3_600_000 },
  password_reset: { maxRequests: 3, windowMs: 3_600_000 },
  passkey: { maxRequests: 10, windowMs: 60_000 },
  deliberation: { maxRequests: 3, windowMs: 3_600_000 },
  join: { maxRequests: 20, windowMs: 60_000 },
  enter: { maxRequests: 10, windowMs: 60_000 },
  follow: { maxRequests: 30, windowMs: 60_000 },
  comment: { maxRequests: 10, windowMs: 60_000 },
  upvote: { maxRequests: 30, windowMs: 60_000 },
  login: { maxRequests: 10, windowMs: 60_000 },
  collective_chat: { maxRequests: 8, windowMs: 60_000 },
  ask_ai: { maxRequests: 1, windowMs: 300_000 },
  // v1 API endpoints (API key auth) — cadence-aligned to task resolution feed
  // Task-active agents (completed a task in last 5 min) get 2x these limits
  v1_poll: { maxRequests: 4, windowMs: 60_000 },
  v1_register: { maxRequests: 3, windowMs: 3_600_000 },
  v1_read: { maxRequests: 10, windowMs: 60_000 },
  v1_write: { maxRequests: 5, windowMs: 60_000 },
  v1_upvote: { maxRequests: 10, windowMs: 60_000 },
  v1_admin: { maxRequests: 3, windowMs: 60_000 },
  v1_chat: { maxRequests: 10, windowMs: 60_000 },
  v1_mint: { maxRequests: 3, windowMs: 3_600_000 },
  // Engine
  engine_generate: { maxRequests: 3, windowMs: 60_000 },
  engine_icon: { maxRequests: 8, windowMs: 60_000 },
}

function getConfig(endpoint: string): { maxRequests: number; windowMs: number; enabled: boolean } {
  const config = DEFAULT_LIMITS[endpoint]
  if (config) return { ...config, enabled: true }
  return { maxRequests: 10, windowMs: 60_000, enabled: true }
}

/**
 * Check rate limit for a given endpoint and key.
 * Returns true if rate limited (should block), false if allowed.
 */
export async function checkRateLimit(endpoint: string, key: string): Promise<boolean> {
  const config = await getConfig(endpoint)

  // If disabled in admin, allow all
  if (!config.enabled) return false

  const rateKey = `${endpoint}:${key}`
  const now = Date.now()

  // Get or create window
  let timestamps = windows.get(rateKey) || []

  // Remove expired timestamps
  timestamps = timestamps.filter(t => now - t < config.windowMs)

  // Check limit
  if (timestamps.length >= config.maxRequests) {
    windows.set(rateKey, timestamps)
    return true // Rate limited
  }

  // Record this request
  timestamps.push(now)
  windows.set(rateKey, timestamps)

  return false // Allowed
}

// Periodic cleanup of stale windows (run every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    const maxWindow = 3_600_000 // 1 hour max
    for (const [key, timestamps] of windows) {
      const valid = timestamps.filter(t => now - t < maxWindow)
      if (valid.length === 0) {
        windows.delete(key)
      } else {
        windows.set(key, valid)
      }
    }
    // Clean up stale task completion logs
    for (const [userId, log] of taskCompletionLog) {
      const valid = log.filter(t => now - t < maxWindow)
      if (valid.length === 0) taskCompletionLog.delete(userId)
      else taskCompletionLog.set(userId, valid)
    }
  }, 5 * 60_000)
}


// ── Chat CAPTCHA strike tracking ──
// Tracks how many times a user has been rate-limited in chat.
// Escalates CAPTCHA difficulty with each strike. Resets after 10 min idle.
const STRIKE_RESET_MS = 10 * 60_000 // 10 minutes
const MUTE_DURATION_MS = 5 * 60_000 // 5 minutes

const chatStrikes = new Map<string, { count: number; lastStrike: number; mutedUntil: number }>()

export function getChatStrike(userId: string): { strike: number; mutedUntil: number | null } {
  const entry = chatStrikes.get(userId)
  if (!entry) return { strike: 0, mutedUntil: null }

  const now = Date.now()

  // Check if muted
  if (entry.mutedUntil > now) {
    return { strike: entry.count, mutedUntil: entry.mutedUntil }
  }

  // Reset if idle long enough
  if (now - entry.lastStrike > STRIKE_RESET_MS) {
    chatStrikes.delete(userId)
    return { strike: 0, mutedUntil: null }
  }

  return { strike: entry.count, mutedUntil: null }
}

export function incrementChatStrike(userId: string): { strike: number; mutedUntil: number | null } {
  const now = Date.now()
  const entry = chatStrikes.get(userId)

  let count = 1
  if (entry && now - entry.lastStrike < STRIKE_RESET_MS) {
    count = entry.count + 1
  }

  const mutedUntil = count >= 4 ? now + MUTE_DURATION_MS : 0

  chatStrikes.set(userId, { count, lastStrike: now, mutedUntil })

  return { strike: count, mutedUntil: mutedUntil > 0 ? mutedUntil : null }
}

export function resetChatStrike(userId: string) {
  chatStrikes.delete(userId)
}

export function resetRateWindow(endpoint: string, key: string) {
  windows.delete(`${endpoint}:${key}`)
}


// ── Task-active rate limit extension (1-for-1) ──
// Each completed task (vote, comment, upvote, join, submit idea) earns +1 to all
// v1 rate limits. Maps directly to the factory loop: poll → execute → poll.
// Productive agents earn headroom linearly. Idle pollers stay at base limits.
const TASK_WINDOW_MS = 60_000 // Same window as most rate limits
const taskCompletionLog = new Map<string, number[]>() // userId -> timestamps

export function recordTaskCompletion(userId: string) {
  const now = Date.now()
  const log = taskCompletionLog.get(userId) || []
  log.push(now)
  taskCompletionLog.set(userId, log)
}

function getTaskCompletions(userId: string, windowMs: number): number {
  const log = taskCompletionLog.get(userId)
  if (!log) return 0
  const now = Date.now()
  const valid = log.filter(t => now - t < windowMs)
  if (valid.length !== log.length) taskCompletionLog.set(userId, valid)
  return valid.length
}

export type RateLimitInfo = {
  limited: boolean
  limit: number
  remaining: number
  resetMs: number
}

/**
 * Check rate limit with rich info for v1 API endpoints.
 * Each task completed in the window earns +1 to the limit (1-for-1).
 * Returns limit info for 429 response headers.
 */
export function checkRateLimitWithInfo(endpoint: string, key: string): RateLimitInfo {
  const config = getConfig(endpoint)
  const bonus = endpoint.startsWith('v1_') ? getTaskCompletions(key, config.windowMs) : 0
  const maxRequests = config.maxRequests + bonus

  const rateKey = `${endpoint}:${key}`
  const now = Date.now()

  let timestamps = windows.get(rateKey) || []
  timestamps = timestamps.filter(t => now - t < config.windowMs)

  if (timestamps.length >= maxRequests) {
    windows.set(rateKey, timestamps)
    const oldestInWindow = timestamps[0]
    const resetMs = (oldestInWindow + config.windowMs) - now
    return { limited: true, limit: maxRequests, remaining: 0, resetMs: Math.max(resetMs, 1000) }
  }

  timestamps.push(now)
  windows.set(rateKey, timestamps)

  const resetMs = timestamps.length > 0
    ? (timestamps[0] + config.windowMs) - now
    : config.windowMs

  return { limited: false, limit: maxRequests, remaining: maxRequests - timestamps.length, resetMs }
}
