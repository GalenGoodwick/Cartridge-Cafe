import { NextRequest, NextResponse } from 'next/server'

// Feature flags — experimental subsystems (default OFF)
const FEATURE_SHELL = process.env.NEXT_PUBLIC_FEATURE_SHELL === 'true'
const FEATURE_EYE = process.env.NEXT_PUBLIC_FEATURE_EYE === 'true'
const FEATURE_CRADLE = process.env.NEXT_PUBLIC_FEATURE_CRADLE === 'true'

const FEATURE_GATED_PREFIXES: Array<{ prefix: string; enabled: boolean }> = [
  { prefix: '/api/shell/', enabled: FEATURE_SHELL },
  { prefix: '/api/cron/shell-heartbeat', enabled: FEATURE_SHELL },
  { prefix: '/api/eye/', enabled: FEATURE_EYE },
  { prefix: '/eye', enabled: FEATURE_EYE },
  { prefix: '/api-eye', enabled: FEATURE_EYE },
  { prefix: '/api/cradle', enabled: FEATURE_CRADLE },
  { prefix: '/api/cradle-chat', enabled: FEATURE_CRADLE },
  { prefix: '/api/cradle-trajectory', enabled: FEATURE_CRADLE },
  { prefix: '/api/bonded-chat', enabled: FEATURE_SHELL },
]

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

const CSRF_EXEMPT_PATHS = [
  '/api/cron/',
  '/api/auth/',
  '/api/admin/test/',
  '/api/v1/',
  '/api/embed/',
  '/api/ask-ai',
  '/api/shell/',
  '/api/eye/',
  '/api/claude-bridge',
  '/api/engine/agent',
  '/api/engine/bridge',
  '/api/companion/world',   // agent-facing: authed by uc_ck_ Bearer, no browser origin
  '/api/companion/me',      // agent-facing: the companion's own seat (icon, identity)
  '/api/pay/webhook',       // Stripe server-to-server: no browser origin; authed by HMAC signature
]

// Patterns that match via regex (for dynamic segments)
const CSRF_EXEMPT_PATTERNS: RegExp[] = [
]

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Feature flag gates — return 404 for disabled subsystems ──
  for (const { prefix, enabled } of FEATURE_GATED_PREFIXES) {
    if (!enabled && pathname.startsWith(prefix)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  // ── CORS preflight for embed API routes ──
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/embed/')) {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Plugin-Token, X-Community-Slug',
      },
    })
  }

  // ── Backward-compat: /talks/* → /chants/* ──
  if (pathname.startsWith('/talks')) {
    const newPath = pathname.replace(/^\/talks/, '/chants') + req.nextUrl.search
    return NextResponse.redirect(new URL(newPath, req.url), 301)
  }

  // ── CSRF protection for API mutations ──
  if (MUTATION_METHODS.includes(req.method) && pathname.startsWith('/api/')) {
    if (CSRF_EXEMPT_PATHS.some(p => pathname.startsWith(p)) ||
        CSRF_EXEMPT_PATTERNS.some(p => p.test(pathname))) {
      return NextResponse.next()
    }

    // Bearer-authed mutations carry no ambient cookie credential, so they are
    // not a CSRF vector — a hostile page can't make a browser attach a Bearer
    // token. This unblocks server-to-server agent callers (the house/volunteer
    // builders mint tokens + drive the build queue) that send no Origin header.
    const authz = req.headers.get('authorization')
    if (authz?.startsWith('Bearer ')) return NextResponse.next()

    const origin = req.headers.get('origin')
    if (!origin) {
      return NextResponse.json({ error: 'Forbidden: missing origin' }, { status: 403 })
    }

    const allowed = req.nextUrl.origin
    if (origin !== allowed) {
      return NextResponse.json({ error: 'Forbidden: origin mismatch' }, { status: 403 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/chants', '/talks/:path*', '/api/:path*', '/eye/:path*', '/api-eye'],
}
