export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);

  const GHL_TOKEN    = 'pit-c40b9d94-28dd-4d00-9602-d6f765877cd8';
  const GHL_LOCATION = 'AymErWPrH9U1ddRouslC';
  const GHL_PIPELINE = 'o4kqU2y8DYjA73aKUxNu';
  const HDR = { 'Authorization': `Bearer ${GHL_TOKEN}`, 'Version': '2021-07-28' };

  const STAGE_MAP = {
    '92d0031c-00f8-4692-bc9f-235a76fa3201': 'New Lead',
    'ccef1b7a-f245-4f1d-a5c6-5c9eef6bde74': 'Attempt 1',
    '1ffda1af-d8aa-48e7-a573-0493ab042212': 'Attempt 2',
    '659159ac-34e8-46c2-a821-98389a0934aa': 'Attempt 3-5',
    'fc67a2e4-8099-4789-a092-96c717a0461e': 'Unresponsive',
    '234e7689-663f-4191-8c6a-7bf73da1045c': 'Cold Follow Up',
    '47f767a6-24af-48f2-9df2-5d664f031bb7': 'Warm Follow Up',
    '898845b3-7e76-42be-b8a7-cb8a85a0daa2': 'Hot Follow Up',
    '7b0273e4-2fc5-4fd6-9601-edc635598b49': 'Decision Pending',
    '174b6daa-ac30-4c73-9520-30570031e051': 'Contract Sent',
    'f9b5d64a-a482-44b7-a8f4-a28480ea70d8': 'Under Contract',
    '52cbce77-1d2e-44f3-876e-5728300f5424': 'Signed w/ Someone Else',
    'bc003c1e-8c6f-4951-900d-266be155fab0': 'Disposition',
    'e98e50a2-4a0b-4639-a322-e0bbd892a05b': 'Closed',
    '2a6c834c-4180-4833-b9e2-4d7e576e302f': 'Dead',
  };

  const ADDR_FIELD = 'SGJdYcttaxyiWDHydcc6';

  try {
    let allOpps = [];
    let page = 1;
    while (true) {
      const r = await fetch(
        `https://services.leadconnectorhq.com/opportunities/search?pipeline_id=${GHL_PIPELINE}&location_id=${GHL_LOCATION}&limit=100&page=${page}`,
        { headers: HDR }
      );
      const data = await r.json();
      const opps = data.opportunities || [];
      allOpps = allOpps.concat(opps);
      if (opps.length < 100) break;
      page++;
    }

    const stages = {};
    for (const opp of allOpps) {
      const stageName = STAGE_MAP[opp.pipelineStageId] || 'Unknown';
      if (!stages[stageName]) stages[stageName] = [];
      const contact   = opp.contact || {};
      const addrF     = (opp.customFields || []).find(f => f.id === ADDR_FIELD);
      const daysInStage = opp.lastStageChangeAt
        ? Math.floor((Date.now() - new Date(opp.lastStageChangeAt)) / 86400000) : null;
      stages[stageName].push({
        id: opp.id, contactId: contact.id || opp.contactId,
        name: contact.name || opp.name || 'Unknown',
        phone: contact.phone || '',
        address: addrF?.fieldValueString || contact.address1 || '',
        tags: contact.tags || [], stage: stageName,
        createdAt: opp.createdAt, updatedAt: opp.updatedAt,
        lastChange: opp.lastStageChangeAt, daysInStage,
        value: opp.monetaryValue || 0,
      });
    }

    res.json({
      stages, total: allOpps.length,
      stageOrder: ['Decision Pending','Contract Sent','Under Contract','Hot Follow Up',
        'Warm Follow Up','New Lead','Cold Follow Up','Attempt 1','Attempt 2',
        'Attempt 3-5','Unresponsive','Closed','Dead'],
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
