/**
 * POST /api/lead-note  { contactId, note, name?, address? }
 * Appends a note to the GHL contact (prefixed so David/Chris see it's a
 * dashboard note) and pings Telegram. Used by the "note for David" box
 * on each lead card.
 */

const GHL_TOKEN = process.env.GHL_TOKEN;
const GHL_API   = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = {
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

  const { contactId, note, name, address } = req.body || {};
  if (!contactId || !note || !note.trim()) {
    return res.status(400).json({ error: 'contactId and note required' });
  }
  if (!GHL_TOKEN) return res.status(500).json({ error: 'missing_env', detail: 'GHL_TOKEN not configured' });

  try {
    const body = `📝 Note for David (dashboard): ${note.trim()}`;
    const r = await fetch(`${GHL_API}/contacts/${contactId}/notes`, {
      method:  'POST',
      headers: GHL_HEADERS,
      body:    JSON.stringify({ body, userId: null }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'ghl_note_failed', detail: t.slice(0, 300) });
    }

    await tg(
      `📝 <b>Note added for David</b>\n` +
      `👤 ${name || 'Lead'}${address ? `\n📍 ${address}` : ''}\n\n` +
      `“${note.trim()}”`
    );

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'note_error', detail: e.message });
  }
};
