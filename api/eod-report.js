/**
 * POST /api/eod-report
 *
 * Sends the daily EOD Telegram report exactly once per day.
 * Callers (jarvis-server.js) should POST here instead of sending
 * directly to Telegram — this endpoint checks Supabase first and
 * silently skips if a report has already been sent today.
 *
 * Body (all optional — defaults to zeros/empty):
 *   {
 *     totalCalls:       number,
 *     conversations:    number,
 *     hotLeads:         number,
 *     qualified:        number,
 *     lastAlphaScraper: string,
 *     tomorrowSchedule: string,
 *   }
 */

const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8779808673:AAFEbPGq7S8dJDqQFdiRHlqPODkzONp3K_w';
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID   || '8105811341';

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sb = createClient(SB_URL, SB_KEY);

  // ── Dedup check: has an EOD report already been sent today? ──
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: existing } = await sb
    .from('jarvis_log')
    .select('id, created_at')
    .eq('type', 'eod_report_sent')
    .gte('created_at', todayStart.toISOString())
    .limit(1);

  if (existing && existing.length > 0) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'already_sent_today', sentAt: existing[0].created_at });
  }

  // ── Build the report message ──────────────────────────────────
  const {
    totalCalls       = 0,
    conversations    = 0,
    hotLeads         = 0,
    qualified        = 0,
    lastAlphaScraper = 'No scraper activity today',
    tomorrowSchedule = 'David calls at 9am, 11am, 1pm, 3pm, 5pm, 6pm, 7pm EST',
  } = req.body || {};

  const msg =
    `📊 Daily EOD Report\n` +
    `──────────────────────────\n` +
    `📞 Total Calls: ${totalCalls}\n` +
    `🗣 Conversations: ${conversations}\n` +
    `🔥 Hot Leads: ${hotLeads}\n` +
    `✅ Qualified: ${qualified}\n` +
    `🕷 Last Alpha Scraper: ${lastAlphaScraper}\n` +
    `──────────────────────────\n` +
    `Tomorrow: ${tomorrowSchedule}`;

  // ── Record send BEFORE sending Telegram (prevents race conditions) ──
  await sb.from('jarvis_log').insert({
    type:    'eod_report_sent',
    source:  'vercel-eod-report',
    message: JSON.stringify({ totalCalls, conversations, hotLeads, qualified, lastAlphaScraper, tomorrowSchedule }),
    priority: 'normal',
  });

  await sendTelegram(msg);

  return res.status(200).json({ ok: true, skipped: false });
};
