import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_DAYS, signSession, safeEqual } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/auth/login — trade the shared password for a 30-day session.
 *
 * Deliberately slow to brute force: a fixed delay on failure. This endpoint is
 * reachable from the public tunnel, and the whole dashboard sits behind one
 * password, so an unthrottled endpoint is a lead database waiting to leak.
 */
const FAIL_DELAY_MS = 600;

export async function POST(req: NextRequest) {
  const PASS = process.env.DASHBOARD_PASS;
  const USER = process.env.DASHBOARD_USER || 'jarvis';

  if (!PASS) {
    return NextResponse.json(
      { error: 'DASHBOARD_PASS is not set on the server — nobody can sign in.' },
      { status: 503 },
    );
  }

  let body: { user?: string; password?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }

  const okUser = safeEqual(String(body.user ?? USER), USER);
  const okPass = safeEqual(String(body.password ?? ''), PASS);

  if (!okUser || !okPass) {
    await new Promise(r => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  const token = await signSession(USER, PASS);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // The tunnel is https; localhost dev is not. Secure on http would silently
    // drop the cookie and look like "login does nothing".
    secure: req.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}

/** DELETE /api/auth/login — sign out everywhere on this browser. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
