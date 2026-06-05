/**
 * GET /api/dialer-status?sessionId=X — proxy to VPS multi-dialer.
 * Forwards to https://api.jarviscommandcenter.space/dialer/status
 */

const UPSTREAM = 'https://api.jarviscommandcenter.space/dialer/status';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const qs = new URLSearchParams(req.query || {}).toString();
  const url = qs ? `${UPSTREAM}?${qs}` : UPSTREAM;

  try {
    const r = await fetch(url);
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: 'upstream', detail: e.message });
  }
};
