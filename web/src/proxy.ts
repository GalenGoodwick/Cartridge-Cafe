import { NextRequest, NextResponse } from 'next/server'

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

const CSRF_EXEMPT_PATHS = [
  '/api/auth/',
  '/api/admin/test/',
  '/api/v1/',
  '/api/embed/',
  '/api/ask-ai',
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
  matcher: ['/', '/chants', '/talks/:path*', '/api/:path*'],
}
