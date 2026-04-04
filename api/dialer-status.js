/**
 * GET /api/dialer-status?sessionId=X
 * Returns current session state for frontend polling.
 */

const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const sb = createClient(SB_URL, SB_KEY);
  const { data, error } = await sb
    .from('dialer_sessions')
    .select('id, status, answered_lead, created_at, updated_at')
    .eq('id', sessionId)
    .single();

  if (error) return res.status(404).json({ status: 'unknown' });
  return res.status(200).json(data);
};
