/**
 * POST /api/twilio-sms-webhook
 * Receives inbound SMS from Twilio (permanent URL for Twilio config).
 * Queues payload in jarvis_log as 'sms_inbound_pending'.
 * jarvis-server.js polls and processes: saves to david_messages + Telegram alert.
 */

const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  // Twilio requires TwiML response — empty means no auto-reply
  res.setHeader('Content-Type', 'text/xml');

  if (req.method !== 'POST') {
    return res.status(405).send('<Response></Response>');
  }

  try {
    const sb = createClient(SB_URL, SB_KEY);
    // req.body is URL-encoded: { From, Body, MessageSid, ... }
    await sb.from('jarvis_log').insert({
      type:     'sms_inbound_pending',
      source:   'vercel-sms',
      priority: 'high',
      message:  JSON.stringify(req.body || {}),
    });
  } catch (e) {
    console.error('[SMS Webhook] Queue error:', e.message);
  }

  return res.status(200).send('<Response></Response>');
};
