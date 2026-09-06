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
  '/api/pay/webhook',       // Stripe server-to-server: no browser origin; authed by HMAC signature
]

// Patterns that match via regex (for dynamic segments)
const CSRF_EXEMPT_PATTERNS: RegExp[] = [
]

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── COMPANY TENANTS (Galen, Aug 27): fortis.cartridge.cafe style — a
  // premium company's private-dev door. Any non-www subdomain of the apex
  // serves the company shelf at /c/<sub> (pages only; /api and assets pass
  // through untouched). DNS + Vercel wildcard-domain config are dashboard
  // steps — this rewrite is ready the moment they exist.
  {
    const host = (req.headers.get('host') || '').toLowerCase().split(':')[0]
    const m = host.match(/^([a-z0-9-]+)\.cartridge\.cafe$/)
    const sub = m?.[1]
    if (sub && sub !== 'www' && sub !== 'api' &&
        !pathname.startsWith('/api/') && !pathname.startsWith('/_next') && !pathname.startsWith('/c/') &&
        req.method === 'GET' && !pathname.includes('.')) {
      // REDIRECT to the apex path, never rewrite (Galen, Sep 5): Google OAuth
      // can't register wildcard callbacks, so auth on a subdomain always
      // breaks — the session lives on cartridge.cafe. The path is the door.
      return NextResponse.redirect(`https://cartridge.cafe/company/${sub}`, 307)
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
  matcher: ['/', '/chants', '/talks/:path*', '/api/:path*'],
}
