const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8779808673:AAFEbPGq7S8dJDqQFdiRHlqPODkzONp3K_w';
const TELEGRAM_CHAT_ID = '8105811341';

async function sendTelegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch {}
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Twilio sends urlencoded — Vercel auto-parses into req.body
    const {
      RecordingSid,
      RecordingDuration,
      CallSid,
      RecordingStatus,
    } = req.body || {};

    if (!RecordingSid || !CallSid) {
      return res.status(400).json({ error: 'Missing RecordingSid or CallSid' });
    }

    // Only process completed recordings
    if (RecordingStatus && RecordingStatus !== 'completed') {
      return res.status(200).json({ ok: true, skipped: RecordingStatus });
    }

    const mp3Url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${RecordingSid}.mp3`;
    const duration = parseInt(RecordingDuration || '0', 10);

    // Update jarvis_calls row by twilio_call_sid
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: rows } = await sb
      .from('jarvis_calls')
      .select('id, contact_name, phone')
      .eq('twilio_call_sid', CallSid)
      .limit(1);

    const row = rows && rows[0];

    if (row) {
      await sb
        .from('jarvis_calls')
        .update({ recording_url: mp3Url, recording_duration: duration })
        .eq('id', row.id);
    }

    // Send Telegram alert
    const name = row ? `${row.contact_name || 'Unknown'} (${row.phone || ''})` : `CallSid: ${CallSid}`;
    const msg = `🎙️ <b>Call Recording Ready</b>\n👤 ${name}\n⏱ ${duration}s\n🔗 <a href="${mp3Url}">Play Recording</a>`;
    await sendTelegram(msg);

    // Also log to supabase jarvis_log
    await sb.from('jarvis_log').insert({
      type: 'recording',
      message: JSON.stringify({ call_sid: CallSid, recording_sid: RecordingSid, duration, mp3_url: mp3Url }),
      source: 'vercel-recording-webhook',
      priority: 'normal',
    });

    return res.status(200).json({ ok: true, mp3Url, contact: name });
  } catch (e) {
    console.error('recording-complete error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
