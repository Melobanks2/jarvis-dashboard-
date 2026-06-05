/**
 * POST /dialer/call
 *
 * Body: { sessionId, leads: [{name, phone, address, notes}], webhookBase?, cursor?, totalLeads? }
 *
 * Fires 5 simultaneous Telnyx outbound calls with AMD enabled. AMD result
 * arrives later via the webhook; only confirmed-human lanes trigger Thunder
 * spin-up and the Chris-bridge handshake.
 */

'use strict';

const state  = require('./dialer-state');
const brain  = require('./dialer-david-brain');

// TELNYX — KEY PENDING REGENERATION
const TELNYX_API_KEY       = process.env.TELNYX_API_KEY;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID;
const TELNYX_FROM          = process.env.TELNYX_PHONE || '+13212489749';

const DEFAULT_WEBHOOK_BASE = process.env.DIALER_WEBHOOK_BASE || 'https://api.jarviscommandcenter.space';

function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}

// TELNYX — KEY PENDING REGENERATION
async function placeCall({ to, sessionId, laneIdx, lead, webhookUrl }) {
  const clientState = Buffer.from(JSON.stringify({
    type: 'lead', sessionId, laneIdx, lead,
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
      timeout_secs: 25,
      // AMD: only let humans through to the bridge. Voicemails get hung up.
      answering_machine_detection: 'premium',
    }),
  });

  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`[call] telnyx error lane=${laneIdx} status=${r.status}`, body);
    return null;
  }
  return body?.data?.call_control_id || null;
}

module.exports = async function handler(req, res) {
  const { sessionId, leads, webhookBase, cursor, totalLeads } = req.body || {};
  if (!sessionId)              return res.status(400).json({ error: 'sessionId required' });
  if (!Array.isArray(leads) || !leads.length) return res.status(400).json({ error: 'leads required' });

  const batch = leads.slice(0, state.LANE_COUNT);
  const cursorVal = cursor != null ? cursor : 0;
  const totalLeadsVal = totalLeads != null ? totalLeads : leads.length;

  // Check if session exists (resuming from browser refresh)
  const existingSession = await state.getSession(sessionId);
  if (existingSession && existingSession.status !== 'ended') {
    console.log('[call] Session exists, updating progress and resuming');
    // Update progress info if provided
    const patch = { progress: { cursor: cursorVal, total_leads: totalLeadsVal } };
    await state.updateSession(sessionId, patch);
    // Re-fetch session
    const session = await state.getSession(sessionId);
    return res.status(200).json({
      ok: true,
      sessionId,
      lanes: session.lanes,
      existing: true,
    });
  }

  const session = await state.createSession(sessionId, batch, cursorVal, totalLeadsVal);

  if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID) {
    console.warn('[call] TELNYX_API_KEY/CONNECTION_ID not set — session created but no calls placed (KEY PENDING REGENERATION)');
    return res.status(200).json({
      ok: true,
      sessionId,
      lanes: session.lanes,
      warning: 'TELNYX — KEY PENDING REGENERATION; no live calls placed',
    });
  }

  const base = webhookBase || DEFAULT_WEBHOOK_BASE;
  const webhookUrl = `${base.replace(/\/$/, '')}/dialer/webhook`;

  // Pre-render David's 7 scripted lines per lead BEFORE placing the Telnyx call.
  // F5-TTS is ~6s/line sequential = ~43s; if we don't do this first, the call
  // gets answered before the WAVs exist and Telnyx playback_start 422s.
  // Lead-keyed cache means subsequent sessions for the same lead are instant.
  await Promise.all(batch.map(lead => brain.prerenderForLead(lead).catch(e =>
    console.error('[call] prerenderForLead lead=' + (lead?.phone || '?') + ' threw:', e.message))));

  // Fire all 5 in parallel. The greet (prefix WAV + F5 address + suffix WAV) is
  // pre-warmed up front via brain.prerenderForLead() above; dialer-opener.js is
  // intentionally NOT used during calls.
  const results = await Promise.all(batch.map(async (lead, laneIdx) => {
    const to = toE164(lead.phone);
    if (!to) return { laneIdx, callId: null, error: 'bad phone' };
    const callId = await placeCall({ to, sessionId, laneIdx, lead, webhookUrl });
    return { laneIdx, callId, error: callId ? null : 'telnyx failed' };
  }));

  console.log("[call] placed sessionId=" + sessionId + " results=" + JSON.stringify(results));

  // Persist call_control_ids onto lanes.
  const lanes = [...session.lanes];
  for (const { laneIdx, callId } of results) {
    if (lanes[laneIdx]) {
      lanes[laneIdx].call_control_id = callId;
      lanes[laneIdx].state = callId ? 'ringing' : 'no_answer';
    }
  }
  await state.updateSession(sessionId, {
    lanes,
    call_ids: results.map(r => r.callId),
  });

  return res.status(200).json({ ok: true, sessionId, lanes, results, cursor: cursorVal, totalLeads: totalLeadsVal });
};
