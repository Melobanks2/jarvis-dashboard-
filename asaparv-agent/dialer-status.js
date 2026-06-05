/**
 * GET /dialer/status?sessionId=X
 *
 * Returns live per-lane state + David state + session totals + progress.
 * Frontend polls this every ~1.5s while a session is active.
 */

'use strict';

const state = require('./dialer-state');
const thunder = require('./dialer-thunder-instances');

module.exports = async function handler(req, res) {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = await state.getSession(sessionId);
  if (!session) return res.status(404).json({ status: 'unknown' });

  const lanes = Array.isArray(session.lanes) && session.lanes.length === state.LANE_COUNT
    ? session.lanes
    : state.blankLanes([]);

  const progress = await state.getProgress(sessionId);

  res.json({
    sessionId,
    status: session.status,
    lanes,
    david: {
      state: session.david_state || 'idle',
      lane: session.david_lane,
    },
    winner_lane: session.winner_lane,
    answered_lead: session.answered_lead,
    totals: {
      total_calls:      session.total_calls      || 0,
      contacted_count:  session.contacted_count  || 0,
      hot_count:        session.hot_count        || 0,
      duration_seconds: session.duration_seconds || 0,
      goal_target:      session.goal_target      || 200,
    },
    progress: progress || { cursor: 0, total_leads: 0, completed: 0, remaining: 0 },
    thunder: thunder.snapshotAll(),
    updated_at: session.updated_at,
    ended_at:   session.ended_at,
  });
};
