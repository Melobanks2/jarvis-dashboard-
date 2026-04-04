/**
 * POST /api/dialer-call
 * Initiates 3 simultaneous Telnyx outbound calls to leads.
 * Stores session state in Supabase dialer_sessions table.
 *
 * Body: { sessionId, leads: [{name, phone, address, notes}], webhookBase }
 */

const { createClient } = require('@supabase/supabase-js');

const TELNYX_API_KEY       = process.env.TELNYX_API_KEY;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID;
const TELNYX_FROM          = process.env.TELNYX_PHONE || '+13212489749';
const SB_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

const DIALER_SESSION_SQL = `
CREATE TABLE IF NOT EXISTS public.dialer_sessions (
  id            TEXT PRIMARY KEY,
  status        TEXT DEFAULT 'dialing',
  winner_call_id TEXT,
  chris_call_id  TEXT,
  current_leads  JSONB,
  call_ids       JSONB,
  answered_lead  JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
`.trim();

async function telnyxCall(to, sessionId, leadIdx, lead, webhookUrl) {
  const clientState = Buffer.from(JSON.stringify({
    type: 'lead',
    sessionId,
    leadIdx,
    lead,
  })).toString('base64');

  const r = await fetch('https://api.telnyx.com/v2/calls', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connection_id: TELNYX_CONNECTION_ID,
      to,
      from: TELNYX_FROM,
      webhook_url: webhookUrl,
      webhook_url_method: 'POST',
      client_state: clientState,
      timeout_secs: 30,
    }),
  });
  const body = await r.json();
  return body?.data?.call_control_id || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { sessionId, leads, webhookBase } = req.body || {};
  if (!sessionId || !leads?.length) return res.status(400).json({ error: 'sessionId and leads required' });

  const webhookUrl = `${webhookBase}/api/dialer-webhook`;
  const sb = createClient(SB_URL, SB_KEY);

  // Dial up to 3 simultaneously
  const batch = leads.slice(0, 3);
  const callPromises = batch.map((lead, idx) => {
    const phone = lead.phone?.replace(/\D/g, '');
    const e164 = phone?.startsWith('1') ? `+${phone}` : `+1${phone}`;
    return telnyxCall(e164, sessionId, idx, lead, webhookUrl).catch(err => {
      console.error(`Telnyx call failed for lead ${idx}:`, err.message);
      return null;
    });
  });
  const callIds = await Promise.all(callPromises);

  // Store session in Supabase
  const { error } = await sb.from('dialer_sessions').upsert({
    id: sessionId,
    status: 'dialing',
    current_leads: batch,
    call_ids: callIds,
    winner_call_id: null,
    chris_call_id: null,
    answered_lead: null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    if (error.message?.includes('does not exist')) {
      console.log('Create dialer_sessions table:\n' + DIALER_SESSION_SQL);
    }
    // Non-fatal — calls are already dialing
    console.error('Supabase session store error:', error.message);
  }

  return res.status(200).json({ ok: true, sessionId, callIds });
};
