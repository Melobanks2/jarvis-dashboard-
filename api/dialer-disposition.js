/**
 * POST /api/dialer-disposition
 * Saves call disposition: updates GHL stage + note, logs to jarvis_calls.
 *
 * Body: { disposition, lead: {name, phone, address, notes}, callDuration, sessionId }
 * disposition: 'hot' | 'warm' | 'cold' | 'no_answer' | 'wrong_number' | 'refund'
 */

const { createClient } = require('@supabase/supabase-js');

const GHL_TOKEN    = process.env.GHL_API_TOKEN    || 'pit-fde168ed-ad3e-4ba4-bd04-11c45f9be529';
const GHL_LOCATION = 'AymErWPrH9U1ddRouslC';
const GHL_PIPELINE = 'o4kqU2y8DYjA73aKUxNu';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

const GHL_HDR = {
  'Authorization': `Bearer ${GHL_TOKEN}`,
  'Version': '2021-07-28',
  'Content-Type': 'application/json',
};

// GHL Pipeline Stage IDs
const STAGE_IDS = {
  hot:          '898845b3-7e76-42be-b8a7-cb8a85a0daa2', // Hot Follow Up
  warm:         '47f767a6-24af-48f2-9df2-5d664f031bb7', // Warm Follow Up
  cold:         '234e7689-663f-4191-8c6a-7bf73da1045c', // Cold Follow Up
  no_answer:    '659159ac-34e8-46c2-a821-98389a0934aa', // Attempt 3-5
  wrong_number: '2a6c834c-4180-4833-b9e2-4d7e576e302f', // Dead
  refund:       'bc003c1e-8c6f-4951-900d-266be155fab0', // Disposition (flagged)
};

const STAGE_LABELS = {
  hot: 'Hot Follow Up', warm: 'Warm Follow Up', cold: 'Cold Follow Up',
  no_answer: 'No Answer', wrong_number: 'Wrong Number – Dead', refund: 'Refund Requested',
};

async function findGHLContact(phone) {
  const clean = phone.replace(/\D/g, '');
  const e164  = clean.startsWith('1') ? `+${clean}` : `+1${clean}`;
  const url   = `https://services.leadconnectorhq.com/contacts/search?phone=${encodeURIComponent(e164)}&locationId=${GHL_LOCATION}`;
  const r     = await fetch(url, { headers: GHL_HDR });
  const body  = await r.json();
  return body?.contacts?.[0] || null;
}

async function upsertGHLContact(lead) {
  const phone = lead.phone.replace(/\D/g, '');
  const e164  = phone.startsWith('1') ? `+${phone}` : `+1${phone}`;

  // Try create
  const r = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST',
    headers: GHL_HDR,
    body: JSON.stringify({
      locationId: GHL_LOCATION,
      firstName: lead.name?.split(' ')[0] || lead.name,
      lastName:  lead.name?.split(' ').slice(1).join(' ') || '',
      phone: e164,
      address1: lead.address,
    }),
  });
  const body = await r.json();
  if (r.ok) return body?.contact?.id || body?.id;
  // If duplicate, extract ID from error
  const dupId = body?.meta?.contactId;
  return dupId || null;
}

async function getOrCreateGHLOpportunity(contactId, contactName) {
  // Check existing opportunities for this contact in our pipeline
  const url = `https://services.leadconnectorhq.com/opportunities/search?contact_id=${contactId}&pipeline_id=${GHL_PIPELINE}&location_id=${GHL_LOCATION}`;
  const r   = await fetch(url, { headers: GHL_HDR });
  const body = await r.json();
  const existing = body?.opportunities?.[0];
  if (existing) return existing.id;

  // Create new opportunity
  const cr = await fetch('https://services.leadconnectorhq.com/opportunities/', {
    method: 'POST',
    headers: GHL_HDR,
    body: JSON.stringify({
      pipelineId: GHL_PIPELINE,
      locationId: GHL_LOCATION,
      contactId,
      name: contactName,
      pipelineStageId: STAGE_IDS.cold,
      status: 'open',
    }),
  });
  const cb = await cr.json();
  return cb?.opportunity?.id || cb?.id || null;
}

async function updateGHLOpportunityStage(oppId, stageId) {
  return fetch(`https://services.leadconnectorhq.com/opportunities/${oppId}`, {
    method: 'PUT',
    headers: GHL_HDR,
    body: JSON.stringify({ pipelineStageId: stageId }),
  });
}

async function addGHLNote(contactId, text) {
  return fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: GHL_HDR,
    body: JSON.stringify({ body: text, userId: null }),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { disposition, lead, callDuration = 0, sessionId } = req.body || {};
  if (!disposition || !lead) return res.status(400).json({ error: 'disposition and lead required' });

  const sb        = createClient(SB_URL, SB_KEY);
  const stageId   = STAGE_IDS[disposition] || STAGE_IDS.cold;
  const stageLabel = STAGE_LABELS[disposition] || disposition;
  const errors    = [];

  // ── GHL: Find or create contact ────────────────────────────────────────────
  let contactId = null;
  try {
    const found = await findGHLContact(lead.phone);
    contactId   = found?.id || await upsertGHLContact(lead);
  } catch (e) { errors.push('GHL contact: ' + e.message); }

  // ── GHL: Find or create opportunity, update stage ─────────────────────────
  if (contactId) {
    try {
      const oppId = await getOrCreateGHLOpportunity(contactId, lead.name);
      if (oppId) await updateGHLOpportunityStage(oppId, stageId);
    } catch (e) { errors.push('GHL opportunity: ' + e.message); }

    // ── GHL: Add note ──────────────────────────────────────────────────────
    try {
      const mins = Math.floor(callDuration / 60);
      const secs = callDuration % 60;
      const durStr = callDuration > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : 'N/A';
      const noteText = [
        `📞 Multi-Dialer Call — ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`,
        `Disposition: ${stageLabel}`,
        `Duration: ${durStr}`,
        lead.notes ? `Notes: ${lead.notes}` : null,
        sessionId  ? `Session: ${sessionId}` : null,
      ].filter(Boolean).join('\n');
      await addGHLNote(contactId, noteText);
    } catch (e) { errors.push('GHL note: ' + e.message); }
  }

  // ── Supabase: Log to jarvis_calls ─────────────────────────────────────────
  try {
    await sb.from('jarvis_calls').insert({
      contact_name:  lead.name,
      phone:         lead.phone,
      address:       lead.address,
      call_duration: callDuration,
      stage_before:  'Multi-Dialer',
      stage_after:   stageLabel,
      summary:       lead.notes || '',
      notes:         `Disposition: ${stageLabel}. Session: ${sessionId}`,
      called_at:     new Date().toISOString(),
    });
  } catch (e) { errors.push('Supabase log: ' + e.message); }

  // ── Mark session as logged ─────────────────────────────────────────────────
  if (sessionId) {
    await sb.from('dialer_sessions').update({
      status: 'logged',
      updated_at: new Date().toISOString(),
    }).eq('id', sessionId).catch(() => {});
  }

  return res.status(200).json({ ok: true, contactId, stageLabel, errors });
};
