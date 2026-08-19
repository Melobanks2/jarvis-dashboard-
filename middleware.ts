import { NextRequest, NextResponse } from 'next/server'

// Simple shared-password gate for the whole dashboard UI.
// Credentials come from env vars (repo is public — never hard-code them):
//   DASHBOARD_USER  (defaults to "jarvis")
//   DASHBOARD_PASS  (required — if unset, everything is locked)
// Set both in Vercel (Project → Settings → Environment Variables) and in .env.local for dev.
// Machine-to-machine endpoints that must stay reachable without credentials,
// because Telnyx and GHL post to them and cannot send an auth header. Kept as
// an explicit allowlist rather than a regex hole in the matcher: the previous
// blanket `/api` exclusion also exposed /api/jarvis/proxy/dialer/leads, which
// serves every seller's name, phone and address in one 145 KB response. That
// was publicly readable the moment the dashboard went on a tunnel.
const PUBLIC_PATHS = [
  '/api/dialer-webhook',
  '/api/elevenlabs-webhook',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const USER = process.env.DASHBOARD_USER || 'jarvis'
  const PASS = process.env.DASHBOARD_PASS

  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      const i = decoded.indexOf(':')
      const user = decoded.slice(0, i)
      const pass = decoded.slice(i + 1)
      if (user === USER && !!PASS && pass === PASS) {
        return NextResponse.next()
      }
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Jarvis Command Center"' },
  })
}

// Protect every route — pages AND the /api/jarvis/* data endpoints — excluding
// only Next.js static internals. Machine-to-machine exceptions are handled by
// PUBLIC_PATHS above, so that the allowlist is visible and auditable in one
// place instead of hidden in this pattern.
//
// Browsers resend basic-auth credentials automatically on same-origin requests,
// so the dashboard's own fetches to /api/jarvis/* keep working once the page
// itself has been unlocked.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
