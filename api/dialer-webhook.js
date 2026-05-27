/**
 * POST /api/dialer-webhook — proxy to VPS multi-dialer.
 * Forwards Telnyx webhook events to https://api.jarviscommandcenter.space/dialer/webhook
 *
 * Returns 200 immediately to Telnyx, then fires the forward async. Telnyx
 * requires a fast 2xx; the VPS handler is the source of truth.
 */

const UPSTREAM = 'https://api.jarviscommandcenter.space/dialer/webhook';

module.exports = async function handler(req, res) {
  res.status(200).end();
  if (req.method !== 'POST') return;

  try {
    await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
  } catch (e) {
    console.error('[dialer-webhook proxy] upstream error:', e.message);
  }
};
