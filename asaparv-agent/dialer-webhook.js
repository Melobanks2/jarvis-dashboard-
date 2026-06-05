/**
 * POST /dialer/webhook — Telnyx Call Control event handler.
 *
 * Phase-1 + Phase-2a baseline behavior is unchanged. Phase-2b qualification
 * flow activates only when DIALER_PHASE2B_ENABLED=true in the environment:
 *
 *   call.machine.detection.ended (human) → greet begins
 *   call.playback.ended (first playback)
 *       PHASE2B OFF: bridge Chris (legacy safety net)
 *       PHASE2B ON : instance1.ensureUp() + stall.wav loop, then
 *                    david-brain.startQualification(); VAD is already running
 *                    via the recording WS inbound tap.
 *   call.playback.ended (david_turn) → notify brain so it listens for next
 *                                      seller utterance.
 *   call.hangup → finalize lane/session + brain.endCall().
 *
 * Multi-pass dialing: Lanes now track attempt_count. If a call ends with
 * no_answer and attempts < max_attempts, the same lead is redialed.
 */

'use strict';

const state     = require('./dialer-state');
const recording = require('./dialer-recording');
const thunder   = require('./dialer-thunder-instances');
const stall     = require('./dialer-stall');
const vad       = require('./dialer-vad');
const brain     = require('./dialer-david-brain');

const TELNYX_API_KEY       = process.env.TELNYX_API_KEY;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID;
const TELNYX_FROM          = process.env.TELNYX_PHONE || '+13212489749';
const CHRIS_PHONE          = process.env.CHRIS_PHONE  || '+13479704969';

const DEFAULT_WEBHOOK_BASE = process.env.DIALER_WEBHOOK_BASE || 'https://api.jarviscommandcenter.space';
const PHASE2B_ENABLED      = process.env.DIALER_PHASE2B_ENABLED === 'true';

const MACHINE_RESULTS = new Set(['machine']);

async function telnyxAction(callControlId, action, body = {}) {
  if (!TELNYX_API_KEY) return null;
  try {
    const r = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.error(`[webhook] telnyx action ${action} ${r.status}`);
    return r;
  } catch (e) {
    console.error(`[webhook] telnyx action ${action} threw:`, e.message);
  }
}

async function callChris(sessionId, leadCallControlId, webhookUrl) {
  if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID) return null;
  const clientState = Buffer.from(JSON.stringify({
    type: 'chris', sessionId, leadCallControlId,
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
      webhook_url: webhookUrl,
      webhook_url_method: 'POST',
      client_state: clientState,
      timeout_secs: 30,
    }),
  });
  const body = await r.json().catch(() => ({}));
  return body?.data?.call_control_id || null;
}

// Pipeline inference from lead metadata.
// CSV/cold-outbound (default) → va_leads. iSpeed/CRM → ispeed.
function pipelineFor(lead) {
  const src = String(lead?.source || lead?.pipeline || '').toLowerCase();
  if (src.includes('ispeed') || src.includes('speed-to-lead') || src.includes('crm')) {
    return 'ispeed';
  }
  return 'va_leads';
}

async function startPhase2bQualification({ callControlId, sessionId, lead }) {
  const pipeline = pipelineFor(lead);
  console.log(`[webhook] PHASE-2B start qualify call=${callControlId.slice(0,12)} pipeline=${pipeline}`);

  // Wire VAD tap into recording WS — fires onUtterance(wav) when seller talks.
  recording.registerInboundTap(callControlId, (pcm16) => {
    vad.feed(callControlId, pcm16);
  });
  vad.register(callControlId, (wavBuffer) => {
    brain.onUtterance(callControlId, wavBuffer).catch(e =>
      console.error('[webhook] brain.onUtterance threw:', e.message));
  });

  // Stall loop while Instance 1 warms up.
  await stall.start(callControlId).catch(() => {});
  try {
    await thunder.instance1.ensureUp();
  } catch (e) {
    console.error('[webhook] instance1.ensureUp failed:', e.message, '— falling back to Chris bridge');
    await stall.stop(callControlId).catch(() => {});
    return null;
  }
  // Spin up Instance 2 in parallel — Gemma is on Instance 2 and brain.onUtterance hits it.
  // Phase-2c: Instance 2 retired — Qwen on Instance 1 handles /decide.
  // (Was: thunder.instance2.ensureUp().catch(...))

  await stall.stop(callControlId).catch(() => {});

  await brain.startQualification({
    sessionId, callControlId, lead, pipeline,
  }).catch(e => console.error('[webhook] startQualification threw:', e.message));

  return true;
}

// Check if a lane can retry (no_answer with attempts < max_attempts)
function canRetry(lane) {
  if (!lane) return false;
  const maxAttempts = lane.max_attempts || state.DEFAULT_MAX_ATTEMPTS;
  return lane.state === 'no_answer' && lane.attempt_count < maxAttempts;
}

// Place a new call for the same lead (retry)
async function retryCall(sessionId, laneIdx, lead, webhookUrl) {
  if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID) return null;
  const to = String(lead?.phone || '').replace(/\D/g, '');
  if (!to) return null;
  if (!to.startsWith('1')) to = '1' + to;

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
      to: `+${to}`,
      from: TELNYX_FROM,
      webhook_url: webhookUrl,
      webhook_url_method: 'POST',
      client_state: clientState,
      timeout_secs: 25,
      answering_machine_detection: 'premium',
    }),
  });

  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`[retry] telnyx error lane=${laneIdx} status=${r.status}`, body);
    return null;
  }
  return body?.data?.call_control_id || null;
}

module.exports = async function handler(req, res) {
  res.status(200).end();

  const event = req.body?.data;
  if (!event) { console.log("[webhook] no event body"); return; }
  console.log("[webhook] RAW event_type=" + event.event_type + " call=" + (event.payload?.call_control_id||"").slice(0,12) + " result=" + (event.payload?.result||"-"));

  const eventType      = event.event_type;
  const payload        = event.payload || {};
  const callControlId  = payload.call_control_id;
  const rawClientState = payload.client_state;
  if (!callControlId || !rawClientState) return;

  let ctx;
  try { ctx = JSON.parse(Buffer.from(rawClientState, 'base64').toString('utf8')); }
  catch { return; }

  const { type, sessionId, laneIdx } = ctx;
  if (!sessionId) return;

  console.log("[webhook] event=" + eventType + " type=" + type + " lane=" + laneIdx + " call=" + callControlId.slice(0,12) + " result=" + (payload.result || "-"));

  const webhookUrl = `${DEFAULT_WEBHOOK_BASE.replace(/\/$/, '')}/dialer/webhook`;

  if (eventType === 'call.initiated' && type === 'lead') {
    await state.patchLane(sessionId, laneIdx, { state: 'ringing' });
    return;
  }

  if (eventType === 'call.answered' && type === 'lead') {
    recording.startStreamingForCall(callControlId).catch(() => {});
    // Kick off David's script prerender in background — gives ~15-25s headroom
    // (AMD detection) before brain.startQualification fires.
    if (PHASE2B_ENABLED && ctx.lead) {
      brain.prerenderForCall(callControlId, ctx.lead).catch(e =>
        console.error('[webhook] prerenderForCall threw:', e.message));
    }
    return;
  }

  if ((eventType === 'call.machine.detection.ended' || eventType === 'call.machine.premium.detection.ended') && type === 'lead') {
    const amdResult = payload.result || 'not_sure';

    if (MACHINE_RESULTS.has(amdResult)) {
      await state.patchLane(sessionId, laneIdx, {
        state: 'voicemail',
        amd_result: amdResult,
        ended_at: new Date().toISOString(),
      });
      await telnyxAction(callControlId, 'hangup');
      return;
    }

    const session = await state.getSession(sessionId);
    if (!session) return;

    if (session.winner_lane != null && session.winner_lane !== laneIdx) {
      await state.patchLane(sessionId, laneIdx, {
        state: 'ended', amd_result: amdResult, ended_at: new Date().toISOString(),
      });
      await telnyxAction(callControlId, 'hangup');
      return;
    }

    await state.updateSession(sessionId, {
      status: 'connecting',
      winner_lane: laneIdx,
      winner_call_id: callControlId,
      answered_lead: ctx.lead,
      david_state: 'qualifying',
      david_lane: laneIdx,
    });
    await state.patchLane(sessionId, laneIdx, {
      state: 'connected',
      amd_result: amdResult,
    });

    const losers = (session.lanes || []).filter(l => l.idx !== laneIdx && l.call_control_id);
    for (const l of losers) {
      telnyxAction(l.call_control_id, 'hangup').catch(() => {});
      await state.patchLane(sessionId, l.idx, {
        state: 'ended',
        ended_at: new Date().toISOString(),
      });
    }

    // Opener WAV removed (2026-05-29): David speaks directly via ElevenLabs from connect.
    if (PHASE2B_ENABLED) {
      const ok = await startPhase2bQualification({
        callControlId, sessionId, lead: ctx.lead,
      }).catch(e => { console.error('[webhook] phase2b failed on AMD:', e.message); return null; });
      if (ok) return;
    }
    // Fallback: bridge to Chris if Phase-2b unavailable.
    try {
      const chrisCallId = await callChris(sessionId, callControlId, webhookUrl);
      await state.updateSession(sessionId, { chris_call_id: chrisCallId });
    } catch (e) {
      console.error('[webhook] chris bridge fallback failed:', e.message);
    }
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // call.playback.ended — first playback finished OR David's turn finished.
  // ──────────────────────────────────────────────────────────────────────────
  if (eventType === 'call.playback.ended') {
    let pbCtx = null;
    try { pbCtx = JSON.parse(Buffer.from(payload.client_state || rawClientState, 'base64').toString('utf8')); }
    catch {}
    const kind = pbCtx?.kind;

    // David turn finished → tell brain to start listening.
    if (kind === 'david_turn') {
      brain.onPlaybackEnded(callControlId, pbCtx).catch(e =>
        console.error('[webhook] brain.onPlaybackEnded threw:', e.message));
      return;
    }
    // Stall loop ended (when we explicitly stop it) — no-op.
    if (kind === 'stall') return;

    // Non-david/non-stall playback ended — branch on Phase-2b flag.
    const session = await state.getSession(sessionId);
    if (!session || session.winner_call_id !== callControlId) return;
    if (session.chris_call_id) return;

    if (PHASE2B_ENABLED) {
      const ok = await startPhase2bQualification({
        callControlId, sessionId, lead: ctx.lead || session.answered_lead,
      }).catch(e => { console.error('[webhook] phase2b failed:', e.message); return null; });
      if (ok) return;
      // Fall through to Chris-bridge if Phase-2b couldn't start.
    }

    const chrisCallId = await callChris(sessionId, callControlId, webhookUrl);
    await state.updateSession(sessionId, { chris_call_id: chrisCallId });
    return;
  }

  if (eventType === 'call.answered' && type === 'chris') {
    const { leadCallControlId } = ctx;
    if (!leadCallControlId) return;
    await telnyxAction(callControlId, 'bridge', { call_control_id: leadCallControlId });
    await state.updateSession(sessionId, {
      status: 'connected',
      david_state: 'on_call',
    });
    if (PHASE2B_ENABLED) thunder.instance1.markActivity();
    return;
  }

  if (eventType === 'call.hangup') {
    // Clean up Phase-2b state if active.
    if (brain.isActive(callControlId)) brain.endCall(callControlId, 'hangup');
    recording.unregisterInboundTap(callControlId);
    vad.unregister(callControlId);

    const { session, lane } = await state.findLaneByCallId(sessionId, callControlId);
    if (lane) {
      const next = lane.state === 'connected' ? 'ended'
                 : lane.state === 'voicemail' ? 'voicemail'
                 : 'no_answer';

      // Check if this lane can retry (multi-pass dialing)
      const maxAttempts = lane.max_attempts || state.DEFAULT_MAX_ATTEMPTS;
      if (next === 'no_answer' && lane.attempt_count < maxAttempts) {
        // Increment attempt count and retry
        const newAttemptCount = (lane.attempt_count || 0) + 1;
        console.log(`[webhook] Lane ${lane.idx} no_answer, attempt ${newAttemptCount}/${maxAttempts}, retrying...`);

        // Update lane with incremented attempt count
        await state.patchLane(sessionId, lane.idx, {
          attempt_count: newAttemptCount,
          last_attempt_at: new Date().toISOString(),
        });

        // Schedule retry - wait 3 seconds before redialing
        setTimeout(async () => {
          const retryLead = lane.lead;
          if (retryLead) {
            const retryCallId = await retryCall(sessionId, lane.idx, retryLead, webhookUrl);
            if (retryCallId) {
              await state.patchLane(sessionId, lane.idx, {
                state: 'ringing',
                call_control_id: retryCallId,
                started_at: new Date().toISOString(),
                ended_at: null,
                amd_result: null,
              });
              console.log(`[webhook] Lane ${lane.idx} retry initiated, call_control_id=${retryCallId.slice(0,12)}`);
            } else {
              console.log(`[webhook] Lane ${lane.idx} retry failed`);
            }
          }
        }, 3000);

        return;
      }

      // No retry available, mark as ended
      await state.patchLane(sessionId, lane.idx, {
        state: next,
        ended_at: new Date().toISOString(),
      });

      if (session?.winner_call_id === callControlId) {
        const startedAt = lane.started_at ? new Date(lane.started_at).getTime() : null;
        const durSecs = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
        await state.updateSession(sessionId, {
          status: 'ended',
          ended_at: new Date().toISOString(),
          duration_seconds: durSecs,
          contacted_count: (session.contacted_count || 0) + 1,
          david_state: 'idle',
          david_lane: null,
        });
        if (PHASE2B_ENABLED) thunder.instance1.markIdleStart();
      } else {
        // No human ever won this batch. If every lane has now reached a terminal
        // state (no_answer / voicemail / ended), end the session so the frontend
        // can advance to the next batch. Re-fetch to include the lane just patched
        // above. The winner_call_id == null guard ensures we never end a session
        // while a human is still connected on another lane.
        const fresh = await state.getSession(sessionId);
        const TERMINAL = new Set(['no_answer', 'voicemail', 'ended']);
        if (fresh && fresh.status !== 'ended' && fresh.winner_call_id == null &&
            Array.isArray(fresh.lanes) && fresh.lanes.length === state.LANE_COUNT &&
            fresh.lanes.every(l => TERMINAL.has(l.state))) {
          await state.updateSession(sessionId, {
            status: 'ended',
            ended_at: new Date().toISOString(),
            david_state: 'idle',
            david_lane: null,
          });
        }
      }
    } else if (session?.chris_call_id === callControlId) {
      await state.updateSession(sessionId, {
        status: 'ended',
        ended_at: new Date().toISOString(),
        david_state: 'idle',
        david_lane: null,
      });
      if (PHASE2B_ENABLED) thunder.instance1.markIdleStart();
    }
    return;
  }
};
