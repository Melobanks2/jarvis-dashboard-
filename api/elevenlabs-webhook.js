/**
 * POST /api/elevenlabs-webhook
 * Permanent webhook receiver for ElevenLabs post-call events.
 *
 * Inserts the raw payload into jarvis_log as 'el_webhook_pending'.
 * jarvis-server.js polls jarvis_log every 30s and processes new entries.
 * This decouples receipt (Vercel, permanent URL) from processing (Mac, heavy logic).
 */

const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const sb = createClient(SB_URL, SB_KEY);
    await sb.from('jarvis_log').insert({
      type:     'el_webhook_pending',
      source:   'vercel-webhook',
      priority: 'high',
      message:  JSON.stringify(req.body || {}),
    });
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('[EL Webhook] Queue insert error:', e.message);
    // Always 200 — prevents ElevenLabs from retrying indefinitely
    return res.status(200).json({ received: true, warn: e.message });
  }
};
