/**
 * POST /api/call-feedback  — Save a coaching comment on a specific transcript line
 * GET  /api/call-feedback?sessionId=X — Get all feedback for a mock session
 *
 * Supabase table: call_feedback
 */

const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY     || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

const CALL_FEEDBACK_SQL = `
CREATE TABLE IF NOT EXISTS public.call_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   TEXT NOT NULL,
  line_index   INTEGER NOT NULL,
  line_text    TEXT,
  reaction     TEXT,   -- 'thumbs_up' | 'thumbs_down' | 'flag' | 'star'
  comment      TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_feedback_session_idx ON public.call_feedback(session_id);
`.trim();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sb = createClient(SB_URL, SB_KEY);

  // ── GET — fetch feedback for a session ──────────────────────────────────────
  if (req.method === 'GET') {
    const sessionId = req.query?.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const { data, error } = await sb
      .from('call_feedback')
      .select('*')
      .eq('session_id', sessionId)
      .order('line_index');

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ feedback: data || [] });
  }

  // ── POST — save feedback ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { sessionId, lineIndex, lineText, reaction, comment } = req.body || {};

    if (!sessionId || lineIndex == null) {
      return res.status(400).json({ error: 'sessionId and lineIndex required' });
    }

    const { data, error } = await sb
      .from('call_feedback')
      .insert({ session_id: sessionId, line_index: lineIndex, line_text: lineText, reaction, comment })
      .select('id')
      .single();

    if (error) {
      if (error.message.includes('does not exist')) {
        return res.status(500).json({ error: `Create call_feedback table first:\n${CALL_FEEDBACK_SQL}` });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true, id: data?.id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
