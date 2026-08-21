import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/session'

// Shared-password gate for the whole dashboard.
// Credentials come from env vars (repo is public — never hard-code them):
//   DASHBOARD_USER  (defaults to "jarvis")
//   DASHBOARD_PASS  (required — if unset, everything is locked)
//
// Auth is a SIGNED SESSION COOKIE, not HTTP basic auth. Basic auth re-prompted
// on effectively every visit, and no browser will satisfy it with Touch ID or
// Face ID — so it was retyped by hand several times a day. The cookie lasts 30
// days and can be issued by a passkey, which is what makes biometrics possible.
// Basic auth is still ACCEPTED (not offered) so curl and existing scripts keep
// working without a login round-trip.
//
// Machine-to-machine endpoints that must stay reachable without credentials,
// because Telnyx and GHL post to them and cannot send an auth header. Kept as
// an explicit allowlist rather than a regex hole in the matcher: a blanket
// `/api` exclusion also exposed /api/jarvis/proxy/dialer/leads, which serves
// every seller's name, phone and address in one 145 KB response.
const PUBLIC_PATHS = [
  '/api/dialer-webhook',
  '/api/elevenlabs-webhook',
]

// The login page and the endpoints that issue a session must be reachable
// while logged out, or there is no way in.
const AUTH_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/passkey',
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }
  if (AUTH_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const USER = process.env.DASHBOARD_USER || 'jarvis'
  const PASS = process.env.DASHBOARD_PASS

  // 1) Session cookie — the normal path once signed in.
  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, PASS || '')
  if (user) return NextResponse.next()

  // 2) Basic auth — still honoured for curl and scripts. Not advertised via
  //    WWW-Authenticate, so browsers show the login page instead of a dialog.
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      const i = decoded.indexOf(':')
      if (decoded.slice(0, i) === USER && !!PASS && decoded.slice(i + 1) === PASS) {
        return NextResponse.next()
      }
    } catch {
      // fall through
    }
  }

  // 3) API calls get JSON, not a redirect into an HTML page.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', pathname + req.nextUrl.search)
  return NextResponse.redirect(url)
}

// Protect every route — pages AND the /api/jarvis/* data endpoints — excluding
// only Next.js static internals. Machine-to-machine exceptions are handled by
// PUBLIC_PATHS above, so that the allowlist is visible and auditable in one
// place instead of hidden in this pattern.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
