/**
 * POST /api/dialer-webhook
 * Telnyx Call Control webhook handler.
 *
 * Flow:
 *   1. Lead call answered → if no winner yet: mark winner, call Chris, hang up other legs
 *   2. Chris call answered → bridge to lead call
 *   3. Hangup → update session status
 */

const { createClient } = require('@supabase/supabase-js');

const TELNYX_API_KEY       = process.env.TELNYX_API_KEY;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID;
const TELNYX_FROM          = process.env.TELNYX_PHONE || '+13212489749';
const CHRIS_PHONE          = '+13479704969';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

async function telnyxAction(callControlId, action, body = {}) {
  return fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function callChris(sessionId, leadCallControlId, webhookBase) {
  const clientState = Buffer.from(JSON.stringify({
    type: 'chris',
    sessionId,
    leadCallControlId,
  })).toString('base64');

  const r = await fetch('https://api.telnyx.com/v2/calls', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connection_id: TELNYX_CONNECTION_ID,
      to: CHRIS_PHONE,
      from: TELNYX_FROM,
      webhook_url: `${webhookBase}/api/dialer-webhook`,
      webhook_url_method: 'POST',
      client_state: clientState,
      timeout_secs: 30,
    }),
  });
  const body = await r.json();
  return body?.data?.call_control_id || null;
}

module.exports = async function handler(req, res) {
  // Telnyx requires 200 response quickly
  res.status(200).end();

  if (req.method !== 'POST') return;

  const event = req.body?.data;
  if (!event) return;

  const eventType       = event.event_type;
  const callControlId   = event.payload?.call_control_id;
  const rawClientState  = event.payload?.client_state;
  if (!callControlId || !rawClientState) return;

  let ctx;
  try {
    ctx = JSON.parse(Buffer.from(rawClientState, 'base64').toString('utf8'));
  } catch {
    return;
  }

  const { type, sessionId } = ctx;
  if (!sessionId) return;

  const sb = createClient(SB_URL, SB_KEY);
  const webhookBase = `https://${req.headers.host}`;

  // ── LEAD CALL ANSWERED ─────────────────────────────────────────────────────
  if (eventType === 'call.answered' && type === 'lead') {
    const { data: session } = await sb
      .from('dialer_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (!session) return;

    if (session.winner_call_id) {
      // Another lead already won — hang this one up
      await telnyxAction(callControlId, 'hangup');
      return;
    }

    // This lead wins — store winner and call Chris
    const chrisCallId = await callChris(sessionId, callControlId, webhookBase);

    await sb.from('dialer_sessions').update({
      status: 'connecting',
      winner_call_id: callControlId,
      chris_call_id: chrisCallId,
      answered_lead: ctx.lead,
      updated_at: new Date().toISOString(),
    }).eq('id', sessionId);

    // Hang up other legs (all call_ids that aren't the winner)
    const allIds = session.call_ids || [];
    await Promise.all(
      allIds
        .filter(id => id && id !== callControlId)
        .map(id => telnyxAction(id, 'hangup').catch(() => {}))
    );
  }

  // ── CHRIS CALL ANSWERED — BRIDGE ───────────────────────────────────────────
  if (eventType === 'call.answered' && type === 'chris') {
    const { leadCallControlId } = ctx;
    if (!leadCallControlId) return;

    // Bridge Chris's leg to the lead's leg
    await telnyxAction(callControlId, 'bridge', { call_control_id: leadCallControlId });

    await sb.from('dialer_sessions').update({
      status: 'connected',
      updated_at: new Date().toISOString(),
    }).eq('id', sessionId);
  }

  // ── HANGUP ─────────────────────────────────────────────────────────────────
  if (eventType === 'call.hangup') {
    const { data: session } = await sb
      .from('dialer_sessions')
      .select('status, winner_call_id, chris_call_id')
      .eq('id', sessionId)
      .single();

    if (!session) return;

    // Only mark ended if the winner leg or Chris leg hung up
    const isKeyLeg = callControlId === session.winner_call_id ||
                     callControlId === session.chris_call_id;

    if (isKeyLeg && session.status !== 'ended') {
      const endedAt = new Date().toISOString();
      await sb.from('dialer_sessions').update({
        status: 'ended',
        updated_at: endedAt,
      }).eq('id', sessionId);
    }
  }
};
