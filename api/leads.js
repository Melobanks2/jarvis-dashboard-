/**
 * /api/leads — single serverless function for the Leads dashboard.
 * (Consolidated into one file to stay within Vercel's 12-function limit.)
 *
 *   GET  /api/leads                  → list VA♦️Leads pipeline opportunities
 *   POST /api/leads?action=note      → add a "note for David" to the contact
 *   POST /api/leads?action=callback  → move opp to Hot stage (schedule callback)
 *
 * Pulls the GHL VA♦️Leads pipeline (o4kqU2y8DYjA73aKUxNu), maps stage →
 * HOT/WARM/COLD/DEAD/NEW, and unpacks the opportunity-level custom fields
 * David populates. GHL token is read from process.env only (never the client).
 */

const GHL_TOKEN    = process.env.GHL_TOKEN;
const GHL_LOCATION = process.env.GHL_LOCATION || 'AymErWPrH9U1ddRouslC';
const PIPELINE_ID  = 'o4kqU2y8DYjA73aKUxNu'; // VA♦️Leads
const HOT_STAGE_ID = '898845b3-7e76-42be-b8a7-cb8a85a0daa2'; // 🔥Hot fallow ups
const GHL_API      = 'https://services.leadconnectorhq.com';
const GHL_HEADERS  = {
  Authorization: `Bearer ${GHL_TOKEN}`,
  Version:       '2021-07-28',
  'Content-Type':'application/json',
};

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

// Opportunity-level custom field IDs (authoritative — from alpha-scraper.js CF map)
const CF = {
  motivation:  '8iQ5bTtag1FoawrSJunx',
  condition:   'Lji5u2shyhw8OJDJEY8b',
  timeline:    '4oI5ZS8uRSw2FtOFPE0K',
  mortgage:    'hsI5aCkN2rkKukwF7WVM',
  occupancy:   'saOCIAWeKyrHgdYndtxS',
  askingPrice: 'iTdV1YDnBY23ZstRHQ1Z',
  marketValue: 'nrf56A59NAxgmkNxfOye',
  rehabCost:   'YZjGRzhqk8CTMJhE1Yr0',
  arv:         'n0v6O9y0BkMoiW8AURtn',
  ownerName:   'iH4GqPMkAy5VnnQvL9Gz',
  address:     'SGJdYcttaxyiWDHydcc6',
};

function tempFromStage(name = '') {
  const n = name.toLowerCase();
  if (n.includes('dead') || n.includes('signed with someone')) return 'dead';
  if (n.includes('hot') || n.includes('decision pending') ||
      n.includes('contract') || n.includes('under contract') ||
      n.includes('dispos') || n.includes('closed')) return 'hot';
  if (n.includes('warm')) return 'warm';
  if (n.includes('cold')) return 'cold';
  return 'new';
}

function cfVal(fields, id) {
  const f = (fields || []).find(x => x.id === id);
  if (!f) return null;
  if (f.fieldValueString != null && f.fieldValueString !== '') return f.fieldValueString;
  if (f.fieldValueNumber != null && f.fieldValueNumber !== 0)   return f.fieldValueNumber;
  if (Array.isArray(f.fieldValueArray) && f.fieldValueArray.length) return f.fieldValueArray.join(', ');
  return null;
}

async function tg(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

// ── GET: list leads ──────────────────────────────────────────────────────────
async function listLeads(res) {
  // 1. Pipeline stages → id→name map
  const pr = await fetch(`${GHL_API}/opportunities/pipelines?locationId=${GHL_LOCATION}`, { headers: GHL_HEADERS });
  const pd = await pr.json();
  const pipe = (pd.pipelines || []).find(p => p.id === PIPELINE_ID);
  const stageMap = {};
  (pipe?.stages || []).forEach(s => { stageMap[s.id] = s.name; });

  // 2. Opportunities (paginate)
  let opps = [], page = 1;
  while (page <= 10) {
    const r = await fetch(
      `${GHL_API}/opportunities/search?location_id=${GHL_LOCATION}&pipeline_id=${PIPELINE_ID}&limit=100&page=${page}`,
      { headers: GHL_HEADERS }
    );
    const d = await r.json();
    const batch = d.opportunities || [];
    opps = opps.concat(batch);
    if (batch.length < 100) break;
    page++;
  }

  const leads = opps.map(o => {
    const cf = o.customFields || [];
    const stageName = stageMap[o.pipelineStageId] || '—';
    const contact = o.contact || {};
    return {
      id:          o.id,
      contactId:   o.contactId || contact.id || null,
      name:        cfVal(cf, CF.ownerName) || o.name || contact.name || 'Unknown',
      phone:       contact.phone || null,
      address:     cfVal(cf, CF.address) || null,
      stageName,
      temp:        tempFromStage(stageName),
      value:       o.monetaryValue || 0,
      pain:        cfVal(cf, CF.motivation) || null,
      timeline:    cfVal(cf, CF.timeline) || null,
      askingPrice: cfVal(cf, CF.askingPrice) || null,
      condition:   cfVal(cf, CF.condition) || null,
      occupancy:   cfVal(cf, CF.occupancy) || null,
      marketValue: cfVal(cf, CF.marketValue) || null,
      arv:         cfVal(cf, CF.arv) || null,
      mortgage:    cfVal(cf, CF.mortgage) || null,
      status:      o.status,
      updatedAt:   o.updatedAt || o.dateUpdated || o.createdAt || null,
    };
  });

  leads.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const stats = {
    total: leads.length,
    hot:   leads.filter(l => l.temp === 'hot').length,
    warm:  leads.filter(l => l.temp === 'warm').length,
    cold:  leads.filter(l => l.temp === 'cold').length,
    dead:  leads.filter(l => l.temp === 'dead').length,
    newLeads: leads.filter(l => l.temp === 'new').length,
  };

  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
  return res.status(200).json({ leads, stats, stages: stageMap });
}

// ── POST ?action=note: add a note for David ──────────────────────────────────
async function addNote(req, res) {
  const { contactId, note, name, address } = req.body || {};
  if (!contactId || !note || !note.trim()) {
    return res.status(400).json({ error: 'contactId and note required' });
  }
  const r = await fetch(`${GHL_API}/contacts/${contactId}/notes`, {
    method:  'POST',
    headers: GHL_HEADERS,
    body:    JSON.stringify({ body: `📝 Note for David (dashboard): ${note.trim()}`, userId: null }),
  });
  if (!r.ok) return res.status(502).json({ error: 'ghl_note_failed', detail: (await r.text()).slice(0, 300) });

  await tg(`📝 <b>Note added for David</b>\n👤 ${name || 'Lead'}${address ? `\n📍 ${address}` : ''}\n\n“${note.trim()}”`);
  return res.status(200).json({ ok: true });
}

// ── POST ?action=callback: schedule David callback (move to Hot stage) ────────
async function scheduleCallback(req, res) {
  const { contactId, name, address, note } = req.body || {};
  if (!contactId) return res.status(400).json({ error: 'contactId required' });

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
  if (!ur.ok) return res.status(502).json({ error: 'ghl_stage_failed', detail: (await ur.text()).slice(0, 300) });

  if (note && note.trim()) {
    await fetch(`${GHL_API}/contacts/${contactId}/notes`, {
      method:  'POST',
      headers: GHL_HEADERS,
      body:    JSON.stringify({ body: `📞 Callback approved (dashboard): ${note.trim()}`, userId: null }),
    }).catch(() => {});
  }

  await tg(
    `📞 <b>DAVID CALLBACK SCHEDULED</b>\n\n👤 ${name || 'Lead'}${address ? `\n📍 ${address}` : ''}\n\n` +
    `Moved to 🔥 Hot follow-ups — David will call back.` +
    (note && note.trim() ? `\n\n📝 ${note.trim()}` : '')
  );
  return res.status(200).json({ ok: true, oppId: opp.id });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!GHL_TOKEN) return res.status(500).json({ error: 'missing_env', detail: 'GHL_TOKEN not configured' });

  try {
    if (req.method === 'GET') return await listLeads(res);
    if (req.method === 'POST') {
      const action = (req.query && req.query.action) || '';
      if (action === 'note')     return await addNote(req, res);
      if (action === 'callback') return await scheduleCallback(req, res);
      return res.status(400).json({ error: 'unknown_action', detail: 'action must be note|callback' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'leads_handler_error', detail: e.message });
  }
};
