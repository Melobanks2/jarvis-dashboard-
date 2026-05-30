/**
 * POST /api/lead-callback  { contactId, name?, address?, note? }
 * "Approve → schedule David callback" button on a lead card.
 *
 * Moves the GHL opportunity into the Hot follow-up stage of the VA♦️Leads
 * pipeline (so it surfaces in David's call queue) and alerts Telegram.
 * Mirrors the moveGHLStage pattern in /api/approve-deal.js.
 */

const GHL_TOKEN    = process.env.GHL_TOKEN;
const GHL_LOCATION = process.env.GHL_LOCATION || 'AymErWPrH9U1ddRouslC';
const PIPELINE_ID  = 'o4kqU2y8DYjA73aKUxNu';
const HOT_STAGE_ID = '898845b3-7e76-42be-b8a7-cb8a85a0daa2'; // ⛹🏿‍♀️🔥Hot fallow ups
const GHL_API      = 'https://services.leadconnectorhq.com';
const GHL_HEADERS  = {
  Authorization: `Bearer ${GHL_TOKEN}`,
  Version:       '2021-07-28',
  'Content-Type':'application/json',
};

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

async function tg(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { contactId, name, address, note } = req.body || {};
  if (!contactId) return res.status(400).json({ error: 'contactId required' });
  if (!GHL_TOKEN) return res.status(500).json({ error: 'missing_env', detail: 'GHL_TOKEN not configured' });

  try {
    // Find the contact's opportunity in this pipeline
    const sr = await fetch(
      `${GHL_API}/opportunities/search?location_id=${GHL_LOCATION}&contact_id=${contactId}&limit=10`,
      { headers: GHL_HEADERS }
    );
    const sd  = await sr.json();
    const opp = (sd.opportunities || []).find(o => o.pipelineId === PIPELINE_ID || o.pipeline_id === PIPELINE_ID)
             || (sd.opportunities || [])[0];
    if (!opp) return res.status(404).json({ error: 'opportunity_not_found' });

    const ur = await fetch(`${GHL_API}/opportunities/${opp.id}`, {
      method:  'PUT',
      headers: GHL_HEADERS,
      body:    JSON.stringify({ pipelineStageId: HOT_STAGE_ID, status: 'open' }),
    });
    if (!ur.ok) {
      const t = await ur.text();
      return res.status(502).json({ error: 'ghl_stage_failed', detail: t.slice(0, 300) });
    }

    if (note && note.trim()) {
      await fetch(`${GHL_API}/contacts/${contactId}/notes`, {
        method:  'POST',
        headers: GHL_HEADERS,
        body:    JSON.stringify({ body: `📞 Callback approved (dashboard): ${note.trim()}`, userId: null }),
      }).catch(() => {});
    }

    await tg(
      `📞 <b>DAVID CALLBACK SCHEDULED</b>\n\n` +
      `👤 ${name || 'Lead'}${address ? `\n📍 ${address}` : ''}\n\n` +
      `Moved to 🔥 Hot follow-ups — David will call back.` +
      (note && note.trim() ? `\n\n📝 ${note.trim()}` : '')
    );

    return res.status(200).json({ ok: true, oppId: opp.id });
  } catch (e) {
    return res.status(502).json({ error: 'callback_error', detail: e.message });
  }
};
