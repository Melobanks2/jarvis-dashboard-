import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSb() {
  return createClient(
    process.env.SUPABASE_URL || 'https://afwdfyofjcpbyydbxntr.supabase.co',
    process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  );
}

const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '8779808673:AAFEbPGq7S8dJDqQFdiRHlqPODkzONp3K_w';
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID   || '8105811341';
const TW_SID     = process.env.TWILIO_ACCOUNT_SID;

async function tg(msg: string) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode: 'HTML' }),
    });
  } catch {}
}

export async function POST(req: NextRequest) {
  const sb = getSb();
  try {
    const body  = await req.formData();
    const recSid  = body.get('RecordingSid')  as string;
    const duration= body.get('RecordingDuration') as string;
    const callSid = body.get('CallSid') as string;
    const status  = body.get('RecordingStatus') as string;

    if (status !== 'completed' || !recSid) {
      return NextResponse.json({ ok: true });
    }

    const mp3Url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Recordings/${recSid}.mp3`;
    const durationSec = parseInt(duration || '0', 10);

    const { data: callRow } = await sb
      .from('jarvis_calls')
      .select('id, contact_name, phone')
      .eq('twilio_call_sid', callSid)
      .single();

    if (callRow?.id) {
      await sb.from('jarvis_calls').update({
        recording_url:      mp3Url,
        recording_duration: durationSec,
      }).eq('id', callRow.id);
    }

    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    await tg(`🎙️ <b>Recording Ready</b>\n👤 ${callRow?.contact_name || 'Unknown'} (${callRow?.phone || '—'})\n⏱ ${mins}:${String(secs).padStart(2,'0')}\n🔗 <a href="${mp3Url}">Play Recording</a>`);

    await sb.from('jarvis_log').insert({
      type:    'success',
      source:  'RECORDING',
      message: `Recording saved for ${callRow?.contact_name || callSid} (${mins}:${String(secs).padStart(2,'0')})`,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
