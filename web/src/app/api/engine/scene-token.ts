import crypto from 'crypto'

/** Branch-scoped tokens — the missing piece behind the "AI overwrote main + the
 *  branch" bug. A cafe-shell branch is a SCENE in the file store, not a PlayerSpace
 *  DB row, so it has nothing to hang a DB-backed space token on. Instead the token
 *  is STATELESS and self-describing: it carries the scene name plus an HMAC of it,
 *  signed with a server secret. No table, no migration. Validation recomputes the
 *  HMAC — a token is authentic iff it was minted here, and it is bound to exactly
 *  ONE scene name, so the bridge can scope every read/write to that one branch.
 *
 *  Format:  uc_sc_<base64url(sceneName)>.<hmacHex(sceneName), 32 chars>
 */

const PREFIX = 'uc_sc_'

// The secret already guards the app (NextAuth). Fall back to the engine admin
// token, then a dev constant so local branching works before either is set.
function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.ENGINE_AGENT_TOKEN || 'cc-dev-scene-secret'
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}
function unb64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8')
}
function sign(sceneName: string): string {
  return crypto.createHmac('sha256', secret()).update('scene:' + sceneName).digest('hex').slice(0, 32)
}

/** Mint a token bound to one scene name. Callers MUST authorize first (only the
 *  branch owner or admin may mint) — this function only signs, it does not check. */
export function mintSceneToken(sceneName: string): string {
  return PREFIX + b64url(sceneName) + '.' + sign(sceneName)
}

/** Validate a token and return the scene name it is bound to, or null. */
export function validateSceneToken(token: string): { sceneName: string } | null {
  if (!token.startsWith(PREFIX)) return null
  const body = token.slice(PREFIX.length)
  const dot = body.lastIndexOf('.')
  if (dot < 1) return null
  const namePart = body.slice(0, dot)
  const sig = body.slice(dot + 1)
  let sceneName: string
  try { sceneName = unb64url(namePart) } catch { return null }
  if (!sceneName) return null
  const expected = sign(sceneName)
  // constant-time compare (equal length guaranteed by fixed slice)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return { sceneName }
}
