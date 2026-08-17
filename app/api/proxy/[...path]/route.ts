import { NextRequest } from 'next/server';

/**
 * Server-side proxy to the dialer server, so the shared secret never reaches a
 * browser.
 *
 * dialer-server.js waves through requests that arrive from 127.0.0.1 but
 * requires `x-dialer-secret` for anything remote — and it deliberately counts
 * tunnelled traffic as remote (cloudflared runs on the same host, so a socket-IP
 * check alone would treat the whole internet as local). That means once the Mac
 * is exposed through a tunnel, every call needs the secret.
 *
 * The secret cannot live in a NEXT_PUBLIC_* value: those are inlined into the
 * client bundle and readable by anyone who opens the deployed site. So the
 * browser calls this same-origin route, and the server attaches the secret.
 *
 * Enable it by pointing the client at this route:
 *     NEXT_PUBLIC_DIALER_API=/api/proxy
 * and configuring the real upstream server-side:
 *     DIALER_ORIGIN=https://<tunnel>.trycloudflare.com
 *     DIALER_SECRET=<value from sarah-dialer/.env>
 *
 * Every hook already builds URLs as `${DIALER_API}/dialer/...`, so a request for
 * /api/proxy/dialer/leads forwards to ${DIALER_ORIGIN}/dialer/leads unchanged.
 */

const ORIGIN = (process.env.DIALER_ORIGIN || 'http://127.0.0.1:3007').replace(/\/$/, '');
const SECRET = process.env.DIALER_SECRET || '';

const TIMEOUT_MS = 45_000;

// Hop-by-hop and identity headers that must not be forwarded upstream.
// The x-forwarded-* / cf-* set matters especially: dialer-server treats any
// request carrying them as remote, so relaying the browser's copies would make
// a local server-to-server call fail its localhost check.
const STRIP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'cookie', 'authorization',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port',
  'forwarded', 'cf-connecting-ip', 'cf-ray', 'cf-ipcountry', 'x-real-ip', 'x-vercel-id',
]);

async function forward(req: NextRequest, path: string[], method: 'GET' | 'POST' | 'PUT') {
  const suffix = path.join('/');
  const search = req.nextUrl.search || '';
  const target = `${ORIGIN}/${suffix}${search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!STRIP.has(k.toLowerCase())) headers.set(k, v); });
  if (SECRET) headers.set('x-dialer-secret', SECRET);

  let body: string | undefined;
  if (method !== 'GET') {
    body = await req.text();
    if (body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  }

  try {
    const upstream = await fetch(target, {
      method, headers, body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'follow',
    });

    // Pass the body through untouched so streaming endpoints keep streaming.
    const out = new Headers();
    const ct = upstream.headers.get('content-type');
    if (ct) out.set('content-type', ct);
    out.set('cache-control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    const msg = (e as Error).message;
    const hint = /timeout|abort/i.test(msg)
      ? `Timed out reaching ${ORIGIN}. Is the dialer server running (and the tunnel up, if remote)?`
      : `Could not reach ${ORIGIN}: ${msg}`;
    return Response.json({ error: hint }, { status: 502 });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path, 'GET');
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path, 'POST');
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path, 'PUT');
}
