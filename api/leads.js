/**
 * GET /api/leads
 * Pulls every opportunity in the VA♦️Leads pipeline (o4kqU2y8DYjA73aKUxNu)
 * from GHL, maps stage → HOT/WARM/COLD/DEAD/NEW, and unpacks the
 * opportunity-level custom fields David populates (pain, timeline, asking
 * price, condition, occupancy, ARV, market value, mortgage).
 *
 * Returns { leads: [...], stats: {...}, stages: {...} }.
 * Server-side so the GHL token never reaches the browser (matches
 * the pattern in /api/approve-deal.js).
 */

const GHL_TOKEN    = process.env.GHL_TOKEN;
const GHL_LOCATION = process.env.GHL_LOCATION || 'AymErWPrH9U1ddRouslC';
const PIPELINE_ID  = 'o4kqU2y8DYjA73aKUxNu'; // VA♦️Leads
const GHL_API      = 'https://services.leadconnectorhq.com';
const GHL_HEADERS  = {
  Authorization: `Bearer ${GHL_TOKEN}`,
  Version:       '2021-07-28',
  'Content-Type':'application/json',
};

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

// Map a stage name → temperature bucket used by the badge + filter tabs.
function tempFromStage(name = '') {
  const n = name.toLowerCase();
  if (n.includes('dead') || n.includes('signed with someone')) return 'dead';
  if (n.includes('hot') || n.includes('decision pending') ||
      n.includes('contract') || n.includes('under contract') ||
      n.includes('dispos') || n.includes('closed')) return 'hot';
  if (n.includes('warm')) return 'warm';
  if (n.includes('cold')) return 'cold';
  return 'new'; // New Lead / Attempt N / No contact / Unresponsive
}

function cfVal(fields, id) {
  const f = (fields || []).find(x => x.id === id);
  if (!f) return null;
  if (f.fieldValueString != null && f.fieldValueString !== '') return f.fieldValueString;
  if (f.fieldValueNumber != null && f.fieldValueNumber !== 0)   return f.fieldValueNumber;
  if (Array.isArray(f.fieldValueArray) && f.fieldValueArray.length) return f.fieldValueArray.join(', ');
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!GHL_TOKEN) return res.status(500).json({ error: 'missing_env', detail: 'GHL_TOKEN not configured' });

  try {
    // 1. Pipeline stages → id→name map
    const pr = await fetch(`${GHL_API}/opportunities/pipelines?locationId=${GHL_LOCATION}`, { headers: GHL_HEADERS });
    const pd = await pr.json();
    const pipe = (pd.pipelines || []).find(p => p.id === PIPELINE_ID);
    const stageMap = {};
    (pipe?.stages || []).forEach(s => { stageMap[s.id] = s.name; });

    // 2. Opportunities in the pipeline (paginate to be safe)
    let opps = [];
    let page = 1;
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
      const temp = tempFromStage(stageName);
      const contact = o.contact || {};
      return {
        id:          o.id,
        contactId:   o.contactId || contact.id || null,
        name:        cfVal(cf, CF.ownerName) || o.name || contact.name || 'Unknown',
        phone:       contact.phone || null,
        address:     cfVal(cf, CF.address) || null,
        stageName,
        temp,
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

    // Sort newest-updated first
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
  } catch (e) {
    return res.status(502).json({ error: 'ghl_fetch_failed', detail: e.message });
  }
};
