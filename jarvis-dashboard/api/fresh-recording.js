// GET /api/fresh-recording?cid={call_control_id}
// Fetches a fresh Telnyx recording URL for a given call_control_id.
// Telnyx presigned S3 URLs expire after ~10 minutes — this gets a current one.

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { cid } = req.query;
  if (!cid) return res.status(400).json({ error: 'cid (call_control_id) required' });

  const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
  if (!TELNYX_API_KEY) return res.status(500).json({ error: 'TELNYX_API_KEY not configured' });

  try {
    const r = await fetch(
      `https://api.telnyx.com/v2/recordings?filter[call_control_id]=${encodeURIComponent(cid)}`,
      {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!r.ok) {
      const body = await r.text();
      console.error('[fresh-recording] Telnyx error:', r.status, body);
      return res.status(502).json({ error: `Telnyx ${r.status}`, detail: body });
    }

    const json = await r.json();
    const recordings = json.data || [];

    if (!recordings.length) {
      return res.status(404).json({ error: 'No recording found for this call' });
    }

    // Return the most recent recording's download URL
    const rec = recordings[0];
    const url = rec.download_url || rec.url || null;

    if (!url) return res.status(404).json({ error: 'Recording has no download URL' });

    return res.json({ url, duration: rec.duration_millis, created_at: rec.created_at });
  } catch (e) {
    console.error('[fresh-recording] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
