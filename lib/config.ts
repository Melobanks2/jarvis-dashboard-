/**
 * Single source of truth for where the dashboard's data comes from.
 *
 * Local-first: `dialer-server.js` (:3007) and `marketing-intel.js` (:3008) run
 * on this MacBook out of ~/projects/sarah-dialer — the same code the VPS ran.
 * nginx there only proxied api.jarviscommandcenter.space/dialer/* → :3007 and
 * /marketing-intel/* → :3008, so pointing at the ports directly is equivalent.
 *
 * Why the default is environment-aware: these are NEXT_PUBLIC_* values, which
 * are inlined into the client bundle at BUILD time and then run in the
 * visitor's browser. A deployed build that inlined 127.0.0.1 would make every
 * visitor fetch from their own machine and show nothing. So:
 *
 *   dev  (this MacBook)      → localhost   — all data through your device
 *   prod (Vercel build)      → REMOTE_HOST — a public site can't reach a laptop
 *
 * To make production local-first too, expose this machine through a tunnel
 * (e.g. cloudflared) and set NEXT_PUBLIC_DIALER_API to the tunnel URL in the
 * Vercel project settings. Then the VPS can be switched off.
 */

const LOCAL_DIALER = 'http://127.0.0.1:3007';
const LOCAL_MKT = 'http://127.0.0.1:3008/marketing-intel';

// Remote fallback for deployed builds. Replace with the tunnel URL once this
// machine is publicly reachable; that is the last step of the VPS cutover.
const REMOTE_HOST = 'https://api.jarviscommandcenter.space';

const isDev = process.env.NODE_ENV !== 'production';

const stripSlash = (u: string) => u.replace(/\/$/, '');

/** Base for every /dialer/* route. No trailing slash. */
export const DIALER_API = stripSlash(
  process.env.NEXT_PUBLIC_DIALER_API || (isDev ? LOCAL_DIALER : REMOTE_HOST),
);

/** Base for the marketing-intel v2 metrics builder. No trailing slash. */
export const MKT_API = stripSlash(
  process.env.NEXT_PUBLIC_MKT_API || (isDev ? LOCAL_MKT : `${REMOTE_HOST}/marketing-intel`),
);

/**
 * Host serving the pre-rendered training WAVs. Still remote by default even in
 * dev — /var/www/jarvis-audio is 817 MB / 15k files and has not been copied to
 * this machine yet.
 */
export const AUDIO_BASE = stripSlash(process.env.NEXT_PUBLIC_AUDIO_BASE || REMOTE_HOST);

/** True when the dashboard is reading data off this machine. */
export const IS_LOCAL = /(^|\/\/)(127\.0\.0\.1|localhost)/.test(DIALER_API);
