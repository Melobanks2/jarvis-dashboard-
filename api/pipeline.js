// /api/pipeline.js — Vercel serverless function to proxy GHL pipeline data
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const GHL_TOKEN = 'pit-c40b9d94-28dd-4d00-9602-d6f765877cd8';
  const GHL_LOCATION = 'AymErWPrH9U1ddRouslC';
  const GHL_PIPELINE = 'o4kqU2y8DYjA73aKUxNu';
  try {
    const r = await fetch(
      `https://services.leadconnectorhq.com/opportunities/?pipelineId=${GHL_PIPELINE}&locationId=${GHL_LOCATION}&limit=100`,
      { headers: { 'Authorization': `Bearer ${GHL_TOKEN}`, 'Version': '2021-07-28' } }
    );
    const data = await r.json();
    // Count opportunities per stage name
    const stageCounts = {};
    for (const opp of (data.opportunities || [])) {
      const stage = opp.pipelineStage?.name || 'Unknown';
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }
    res.json({ stageCounts, total: (data.opportunities || []).length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
