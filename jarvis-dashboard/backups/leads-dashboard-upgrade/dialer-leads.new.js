/**
 * dialer-leads.js — Leads dashboard backend (served by dialer-server.js on :3007).
 *
 *   GET  /dialer/leads                  → list opportunities from BOTH pipelines
 *                                         (Cold Outbound = VA♦️Leads, iSpeed = i Speed To Lead)
 *   POST /dialer/lead-action?action=note      → add a "note for David" to the contact
 *   POST /dialer/lead-action?action=callback  → move opp to Hot stage (schedule callback)
 *   POST /dialer/lead-action?action=settemp   → move opp to the canonical stage for a
 *                                               temperature (HOT/WARM/COLD/DEAD) — board drag-drop
 *
 * Lives on the VPS (not Vercel) because the dashboard's Vercel Hobby plan is
 * already at its 12 serverless-function cap. Reuses the GHL token from the
 * shared .env. Exposes { list, action } handlers wired into dialer-server.js.
 */

'use strict';

const GHL_TOKEN    = process.env.GHL_API_TOKEN;
const GHL_LOCATION = process.env.GHL_LOCATION || 'AymErWPrH9U1ddRouslC';
const GHL_API      = 'https://services.leadconnectorhq.com';
const GHL_HEADERS  = {
  Authorization: `Bearer ${GHL_TOKEN}`,
  Version:       '2021-07-28',
  'Content-Type':'application/json',
};

// Two pipelines surfaced in the dashboard, each tagged with a `source`.
const PIPELINES = [
  { id: 'o4kqU2y8DYjA73aKUxNu', source: 'cold',   label: 'Cold Outbound' }, // VA♦️Leads (multi-dialer VA pipeline)
  { id: 'VJwMSSMaP8KhiPiUfSG0', source: 'ispeed', label: 'iSpeed' },        // i Speed To Lead🐆💥
];
const PIPELINE_BY_ID = Object.fromEntries(PIPELINES.map(p => [p.id, p]));

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

// Pick the canonical stage id for a temperature within a single pipeline's stage list.
// Matches the dedicated "fallow ups" / "Dead" stages so a board drop lands somewhere sane.
function canonicalStageForTemp(stages, temp) {
  const wants = {
    hot:  s => s.includes('hot') && s.includes('fallow'),
    warm: s => s.includes('warm') && s.includes('fallow'),
    cold: s => s.includes('cold') && s.includes('fallow'),
    dead: s => s.includes('dead'),
  }[temp];
  if (!wants) return null;
  const hit = (stages || []).find(s => wants((s.name || '').toLowerCase()));
  return hit ? hit.id : null;
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
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (_) { /* non-fatal */ }
}

// Fetch every pipeline's stages once and cache the raw stage arrays for this request.
async function fetchPipelineStages() {
  const pr = await fetch(`${GHL_API}/opportunities/pipelines?locationId=${GHL_LOCATION}`, { headers: GHL_HEADERS });
  const pd = await pr.json();
  const byId = {};
  (pd.pipelines || []).forEach(p => { byId[p.id] = p.stages || []; });
  return byId;
}

async function fetchPipelineOpps(pipelineId) {
  let opps = [], page = 1;
  while (page <= 10) {
    const r = await fetch(
      `${GHL_API}/opportunities/search?location_id=${GHL_LOCATION}&pipeline_id=${pipelineId}&limit=100&page=${page}`,
      { headers: GHL_HEADERS }
    );
    const d = await r.json();
    const batch = d.opportunities || [];
    opps = opps.concat(batch);
    if (batch.length < 100) break;
    page++;
  }
  return opps;
}

function emptyStats() {
  return { total: 0, hot: 0, warm: 0, cold: 0, dead: 0, newLeads: 0 };
}
function tallyStats(stats, temp) {
  stats.total++;
  if (temp === 'hot') stats.hot++;
  else if (temp === 'warm') stats.warm++;
  else if (temp === 'cold') stats.cold++;
  else if (temp === 'dead') stats.dead++;
  else stats.newLeads++;
}

// GET /dialer/leads
async function list(_req, res) {
  if (!GHL_TOKEN) return res.status(500).json({ error: 'missing_env', detail: 'GHL_API_TOKEN not configured' });
  try {
    const stagesByPipeline = await fetchPipelineStages();

    // stageMap: stageId -> name (across both pipelines, for display)
    // tempStages: pipelineId -> { hot,warm,cold,dead: stageId } (for board drag-drop)
    const stageMap = {};
    const tempStages = {};
    for (const p of PIPELINES) {
      const stages = stagesByPipeline[p.id] || [];
      stages.forEach(s => { stageMap[s.id] = s.name; });
      tempStages[p.id] = {
        hot:  canonicalStageForTemp(stages, 'hot'),
        warm: canonicalStageForTemp(stages, 'warm'),
        cold: canonicalStageForTemp(stages, 'cold'),
        dead: canonicalStageForTemp(stages, 'dead'),
      };
    }

    let leads = [];
    for (const p of PIPELINES) {
      const opps = await fetchPipelineOpps(p.id);
      const mapped = opps.map(o => {
        const cf = o.customFields || [];
        const stageName = stageMap[o.pipelineStageId] || '—';
        const contact = o.contact || {};
        return {
          id:          o.id,
          contactId:   o.contactId || contact.id || null,
          source:      p.source,                 // 'cold' | 'ispeed'
          pipelineId:  p.id,
          stageId:     o.pipelineStageId || null,
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
      leads = leads.concat(mapped);
    }

    leads.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    // Overall + per-source stats
    const stats = emptyStats();
    const statsBySource = { cold: emptyStats(), ispeed: emptyStats() };
    for (const l of leads) {
      tallyStats(stats, l.temp);
      if (statsBySource[l.source]) tallyStats(statsBySource[l.source], l.temp);
    }

    return res.json({ leads, stats, statsBySource, stages: stageMap, tempStages });
  } catch (e) {
    return res.status(502).json({ error: 'ghl_fetch_failed', detail: e.message });
  }
}

// Find the opportunity for a contact, preferring one in the requested pipeline.
async function findOpp(contactId, pipelineId) {
  const sr = await fetch(
    `${GHL_API}/opportunities/search?location_id=${GHL_LOCATION}&contact_id=${contactId}&limit=20`,
    { headers: GHL_HEADERS }
  );
  const sd = await sr.json();
  const list = sd.opportunities || [];
  if (pipelineId) {
    const match = list.find(o => o.pipelineId === pipelineId || o.pipeline_id === pipelineId);
    if (match) return match;
  }
  // fall back to either known pipeline, then anything
  return list.find(o => PIPELINE_BY_ID[o.pipelineId || o.pipeline_id]) || list[0] || null;
}

// POST /dialer/lead-action?action=note|callback|settemp
async function action(req, res) {
  if (!GHL_TOKEN) return res.status(500).json({ error: 'missing_env', detail: 'GHL_API_TOKEN not configured' });
  const act = (req.query && req.query.action) || '';
  const { contactId, note, name, address, temp, pipelineId } = req.body || {};

  try {
    if (act === 'note') {
      if (!contactId || !note || !note.trim()) return res.status(400).json({ error: 'contactId and note required' });
      const r = await fetch(`${GHL_API}/contacts/${contactId}/notes`, {
        method:  'POST',
        headers: GHL_HEADERS,
        body:    JSON.stringify({ body: `📝 Note for David (dashboard): ${note.trim()}`, userId: null }),
      });
      if (!r.ok) return res.status(502).json({ error: 'ghl_note_failed', detail: (await r.text()).slice(0, 300) });
      await tg(`📝 <b>Note added for David</b>\n👤 ${name || 'Lead'}${address ? `\n📍 ${address}` : ''}\n\n“${note.trim()}”`);
      return res.json({ ok: true });
    }

    if (act === 'callback') {
      if (!contactId) return res.status(400).json({ error: 'contactId required' });
      const opp = await findOpp(contactId, pipelineId);
      if (!opp) return res.status(404).json({ error: 'opportunity_not_found' });

      const stages = (await fetchPipelineStages())[opp.pipelineId || opp.pipeline_id] || [];
      const hotStage = canonicalStageForTemp(stages, 'hot');
      if (!hotStage) return res.status(404).json({ error: 'hot_stage_not_found' });

      const ur = await fetch(`${GHL_API}/opportunities/${opp.id}`, {
        method:  'PUT',
        headers: GHL_HEADERS,
        body:    JSON.stringify({ pipelineStageId: hotStage, status: 'open' }),
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
      return res.json({ ok: true, oppId: opp.id });
    }

    if (act === 'settemp') {
      const t = (temp || '').toLowerCase();
      if (!contactId) return res.status(400).json({ error: 'contactId required' });
      if (!['hot', 'warm', 'cold', 'dead'].includes(t)) return res.status(400).json({ error: 'temp must be hot|warm|cold|dead' });

      const opp = await findOpp(contactId, pipelineId);
      if (!opp) return res.status(404).json({ error: 'opportunity_not_found' });

      const stages = (await fetchPipelineStages())[opp.pipelineId || opp.pipeline_id] || [];
      const targetStage = canonicalStageForTemp(stages, t);
      if (!targetStage) return res.status(404).json({ error: 'target_stage_not_found' });

      const ur = await fetch(`${GHL_API}/opportunities/${opp.id}`, {
        method:  'PUT',
        headers: GHL_HEADERS,
        body:    JSON.stringify({ pipelineStageId: targetStage, status: t === 'dead' ? 'lost' : 'open' }),
      });
      if (!ur.ok) return res.status(502).json({ error: 'ghl_stage_failed', detail: (await ur.text()).slice(0, 300) });

      await tg(`🌡️ <b>Lead moved to ${t.toUpperCase()}</b>\n👤 ${name || 'Lead'}${address ? `\n📍 ${address}` : ''}`);
      return res.json({ ok: true, oppId: opp.id, temp: t });
    }

    return res.status(400).json({ error: 'unknown_action', detail: 'action must be note|callback|settemp' });
  } catch (e) {
    return res.status(502).json({ error: 'lead_action_error', detail: e.message });
  }
}

module.exports = { list, action };
