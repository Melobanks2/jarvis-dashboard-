/**
 * GET /dialer/progress?sessionId=X
 *
 * Returns session progress metrics: cursor, total_leads, completed, remaining.
 */

'use strict';

const state = require('./dialer-state');

module.exports = async function handler(req, res) {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const progress = await state.getProgress(sessionId);
  if (!progress) return res.status(404).json({ error: 'session not found' });

  res.json(progress);
};
