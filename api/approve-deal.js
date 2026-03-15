/**
 * POST /api/approve-deal
 * Actions: approve_cash | approve_novation | pass
 *
 * Updates david_pending_approvals in Supabase,
 * moves GHL opportunity stage, sends Telegram to Chris (+ David alert).
 */

const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY     || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

const GHL_TOKEN    = process.env.GHL_TOKEN    || 'pit-dada4af8-bbe3-4334-906b-361b9f03bffa';
const GHL_LOCATION = process.env.GHL_LOCATION || 'AymErWPrH9U1ddRouslC';
const GHL_API      = 'https://services.leadconnectorhq.com';
const GHL_HEADERS  = {
  Authorization:  `Bearer ${GHL_TOKEN}`,
  Version:        '2021-07-28',
  'Content-Type': 'application/json',
};

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8779808673:AAFdlbN_AKqREGaJDEYk4vqlVKNLNMnTkSs';
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID   || '8105811341';

function fmt$(n) { return n ? `$${Math.round(n).toLocaleString()}` : '—'; }

async function tg(text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

async function moveGHLStage(contactId, stageName) {
  try {
    // Search for opportunity by contact
    const res = await fetch(
      `${GHL_API}/opportunities/search?location_id=${GHL_LOCATION}&contact_id=${contactId}&limit=5`,
      { headers: GHL_HEADERS }
    );
    const data = await res.json();
    const opp  = data.opportunities?.[0];
    if (!opp) return;

    // Get pipeline stages
    const pr   = await fetch(`${GHL_API}/opportunities/pipelines/${opp.pipeline_id}`, { headers: GHL_HEADERS });
    const pd   = await pr.json();
    const stage = pd.pipeline?.stages?.find(s => s.name.toLowerCase().includes(stageName.toLowerCase()));
    if (!stage) return;

    await fetch(`${GHL_API}/opportunities/${opp.id}`, {
      method:  'PUT',
      headers: GHL_HEADERS,
      body:    JSON.stringify({ pipelineStageId: stage.id, status: 'open' }),
    });
  } catch (e) {
    console.error('GHL move error:', e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { approvalId, action, contactId } = req.body || {};

  if (!approvalId || !action) {
    return res.status(400).json({ error: 'approvalId and action required' });
  }

  const validActions = ['approve_cash', 'approve_novation', 'pass'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
  }

  const sb = createClient(SB_URL, SB_KEY);

  // Fetch approval record
  const { data: approval, error: fetchErr } = await sb
    .from('david_pending_approvals')
    .select('*')
    .eq('id', approvalId)
    .single();

  if (fetchErr || !approval) {
    return res.status(404).json({ error: fetchErr?.message || 'Approval not found' });
  }

  // Determine new status
  const newStatus =
    action === 'pass'              ? 'passed' :
    action === 'approve_novation'  ? 'approved_novation' : 'approved_cash';

  // Update Supabase
  const { error: updateErr } = await sb
    .from('david_pending_approvals')
    .update({ status: newStatus, approved_type: action, decided_at: new Date().toISOString() })
    .eq('id', approvalId);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // Move GHL stage
  const cid = contactId || approval.contact_id;
  if (cid) {
    const ghlStage = action === 'pass' ? 'cold' : 'offer';
    moveGHLStage(cid, ghlStage).catch(() => {});
  }

  // Telegram notifications
  if (action === 'approve_cash') {
    await tg(
      `✅ <b>CASH DEAL APPROVED — David Call Back</b>\n\n` +
      `👤 ${approval.contact_name}\n📍 ${approval.address}\n\n` +
      `💰 60%: <b>${fmt$(approval.offer_60)}</b>  |  65%: ${fmt$(approval.offer_65)}  |  70%: ${fmt$(approval.offer_70)}\n` +
      `ARV: ${fmt$(approval.arv)}  ·  Payoff: ${fmt$(approval.mortgage_payoff)}\n\n` +
      `📞 David is being notified to call back.`
    );
  } else if (action === 'approve_novation') {
    await tg(
      `✨ <b>NOVATION DEAL APPROVED — David Call Back</b>\n\n` +
      `👤 ${approval.contact_name}\n📍 ${approval.address}\n\n` +
      `💰 Novation: <b>${fmt$(approval.novation_offer)}</b>\n` +
      `ARV: ${fmt$(approval.arv)}  ·  Payoff: ${fmt$(approval.mortgage_payoff)}\n\n` +
      `📞 David is being notified to call back.`
    );
  } else {
    await tg(
      `❌ <b>Deal Passed</b>\n\n👤 ${approval.contact_name}\n📍 ${approval.address}\nARV: ${fmt$(approval.arv)}`
    );
  }

  return res.status(200).json({ ok: true, status: newStatus });
};
