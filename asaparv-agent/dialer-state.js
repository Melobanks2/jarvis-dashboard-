/**
 * Supabase session state helpers for the multi-line dialer.
 *
 * Session shape (extends existing dialer_sessions table — see dialer-schema.sql):
 *   id                  TEXT PRIMARY KEY
 *   status              TEXT  -- dialing | connecting | connected | ended | stopped
 *   lanes               JSONB -- array of 5 lane objects (see LANE shape below)
 *   david_state         TEXT  -- idle | on_call | qualifying
 *   david_lane          INT
 *   winner_lane         INT
 *   winner_call_id      TEXT
 *   chris_call_id       TEXT
 *   answered_lead       JSONB
 *   total_calls         INT
 *   contacted_count     INT
 *   hot_count           INT
 *   duration_seconds    INT
 *   goal_target         INT  default 200
 *   created_at / updated_at / ended_at
 *   progress            JSONB -- { cursor: number, total_leads: number }
 *
 * LANE shape:
 *   { idx: 0..4, state: 'idle'|'ringing'|'connected'|'voicemail'|'no_answer'|'ended',
 *     lead: {name, phone, address, notes} | null,
 *     call_control_id: string | null,
 *     started_at: ISO | null,
 *     ended_at: ISO | null,
 *     amd_result: 'human'|'machine'|'not_sure' | null,
 *     attempt_count: number (for multi-pass dialing),
 *     max_attempts: number (configurable retry limit) }
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

const sb = createClient(SB_URL, SB_KEY);

const LANE_COUNT = 5;
const DEFAULT_MAX_ATTEMPTS = 3;  // Configurable retry limit

function blankLanes(leads, cursor, totalLeads) {
  const lanes = [];
  for (let i = 0; i < LANE_COUNT; i++) {
    const lead = leads[i] || null;
    lanes.push({
      idx: i,
      state: lead ? 'ringing' : 'idle',
      lead,
      call_control_id: null,
      started_at: lead ? new Date().toISOString() : null,
      ended_at: null,
      amd_result: null,
      attempt_count: 0,
      max_attempts: DEFAULT_MAX_ATTEMPTS,
    });
  }
  return lanes;
}

async function createSession(sessionId, leads, cursor = 0, totalLeads = leads.length) {
  const batch = leads.slice(0, LANE_COUNT);
  const lanes = blankLanes(batch, cursor, totalLeads);
  const row = {
    id: sessionId,
    status: 'dialing',
    lanes,
    david_state: 'idle',
    david_lane: null,
    winner_lane: null,
    winner_call_id: null,
    chris_call_id: null,
    answered_lead: null,
    current_leads: batch,
    call_ids: [],
    total_calls: lanes.filter(l => l.lead).length,
    contacted_count: 0,
    hot_count: 0,
    duration_seconds: 0,
    goal_target: 200,
    progress: {
      cursor,
      total_leads: totalLeads,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('dialer_sessions').upsert(row);
  if (error) console.error('[state] createSession error:', error.message);
  return row;
}

async function getSession(sessionId) {
  const { data, error } = await sb.from('dialer_sessions')
    .select('*').eq('id', sessionId).single();
  if (error) return null;
  return data;
}

async function updateSession(sessionId, patch) {
  const { error } = await sb.from('dialer_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) console.error('[state] updateSession error:', error.message);
}

async function patchLane(sessionId, laneIdx, patch) {
  const session = await getSession(sessionId);
  if (!session) return null;
  const lanes = Array.isArray(session.lanes) ? [...session.lanes] : blankLanes([], 0, 0);
  if (!lanes[laneIdx]) return null;
  lanes[laneIdx] = { ...lanes[laneIdx], ...patch };
  await updateSession(sessionId, { lanes });
  return lanes[laneIdx];
}

async function findLaneByCallId(sessionId, callControlId) {
  const session = await getSession(sessionId);
  if (!session?.lanes) return { session: null, lane: null };
  const lane = session.lanes.find(l => l.call_control_id === callControlId);
  return { session, lane };
}

async function getProgress(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return null;
  const progress = session.progress || { cursor: 0, total_leads: 0 };
  const completed = progress.cursor;
  const remaining = progress.total_leads - completed;
  const lanes = Array.isArray(session.lanes) ? session.lanes : [];
  return {
    cursor: progress.cursor,
    total_leads: progress.total_leads,
    completed,
    remaining,
    batch_index: Math.floor(progress.cursor / LANE_COUNT),
    lanes_done: lanes.filter(l => l.state === 'ended' || l.state === 'voicemail' || (l.state === 'no_answer' && l.attempt_count >= (l.max_attempts || DEFAULT_MAX_ATTEMPTS))).length,
  };
}

module.exports = {
  sb,
  LANE_COUNT,
  DEFAULT_MAX_ATTEMPTS,
  blankLanes,
  createSession,
  getSession,
  updateSession,
  patchLane,
  findLaneByCallId,
  getProgress,
};
