/**
 * /api/contract  — Contract Cannon backend (single consolidated Vercel function;
 * the dashboard is at the Vercel Hobby 12-function cap, so all contract actions
 * live here behind ?action=).
 *
 * GHL Documents & Contracts (a.k.a. "proposals") live-verified endpoints:
 *   GET  /proposals/templates?locationId=..&limit=20   -> list saved templates
 *   GET  /proposals/document?locationId=..&limit=20     -> list documents (status/links)
 *   POST /proposals/templates/send                       -> create+send from template
 *        body: { locationId, templateId, contactId, userId, opportunityId?, sendDocument? }
 *   POST /proposals/document/send  { documentId, .. }    -> send an existing document
 *
 * Scope reality on the current PIT token (tested 2026-06-27):
 *   - templates/list.readonly  ✓     documents/list.readonly ✓
 *   - templates/sendlink.write ✓     documents/sendlink.write ✓
 *   - document CREATE (POST /proposals/document) -> 401 (no write scope)
 *   - reading a single template's body -> 401 (no read scope)
 * => We send via templates/send. Per-deal numbers must reach the contract through
 *    the TEMPLATE's merge fields (fed from opportunity custom fields), which is a
 *    GHL-side setup. Auto-fill writing is gated behind FILL_OPP_FIELDS until ready.
 *
 * Actions:
 *   GET  ?action=templates                    -> [{id,name,kind}]
 *   GET  ?action=documents&limit=20           -> [{id,name,status,createdAt,recipients}]
 *   POST {action:'fire', templateId, contactId, opportunityId?, sendDocument?, meta?}
 *   POST {action:'draft', ...}                -> same as fire but sendDocument:false
 */

const GHL_TOKEN    = process.env.GHL_TOKEN    || 'pit-dada4af8-bbe3-4334-906b-361b9f03bffa';
const GHL_LOCATION = process.env.GHL_LOCATION || 'AymErWPrH9U1ddRouslC';
const GHL_USER_ID  = process.env.GHL_USER_ID  || 'BTQSnuKjg45tMAupH3Ly'; // christopher lovera
const GHL_API      = 'https://services.leadconnectorhq.com';
const GHL_HEADERS  = {
  Authorization:  `Bearer ${GHL_TOKEN}`,
  Version:        '2021-07-28',
  'Content-Type': 'application/json',
  Accept:         'application/json',
};

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8779808673:AAFdlbN_AKqREGaJDEYk4vqlVKNLNMnTkSs';
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID   || '8105811341';

async function tg(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (_) { /* non-fatal */ }
}

// Classify a template by name so the UI can group PSA vs RBP/novation.
function templateKind(name = '') {
  const n = name.toLowerCase();
  if (n.includes('rbp') || n.includes('retail') || n.includes('novat')) return 'rbp';
  if (n.includes('psa') || n.includes('purchase')) return 'psa';
  return 'other';
}

async function listTemplates() {
  // limit > 20 returns an empty array on this endpoint, so cap at 20.
  const r = await fetch(`${GHL_API}/proposals/templates?locationId=${GHL_LOCATION}&limit=20`, { headers: GHL_HEADERS });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || `templates ${r.status}`);
  return (d.data || []).map(t => ({ id: t.id || t._id, name: t.name, kind: templateKind(t.name), updatedAt: t.updatedAt }));
}

async function listDocuments(limit = 20) {
  const r = await fetch(`${GHL_API}/proposals/document?locationId=${GHL_LOCATION}&limit=${Math.min(limit, 20)}`, { headers: GHL_HEADERS });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || `documents ${r.status}`);
  return (d.data || d.documents || []).map(doc => ({
    id:         doc.documentId || doc.id || doc._id,
    name:       doc.name,
    status:     doc.status,                       // draft | sent | viewed | completed
    createdAt:  doc.createdAt,
    updatedAt:  doc.updatedAt,
    recipients: (doc.recipients || []).map(x => x.contactName || x.email).filter(Boolean),
    links:      doc.links || [],
  }));
}

// Fire a saved template to a contact for signature.
async function sendTemplate({ templateId, contactId, opportunityId, sendDocument = true }) {
  const body = {
    locationId: GHL_LOCATION,
    templateId,
    contactId,
    userId: GHL_USER_ID,
    sendDocument,
  };
  if (opportunityId) body.opportunityId = opportunityId;

  const r = await fetch(`${GHL_API}/proposals/templates/send`, {
    method:  'POST',
    headers: GHL_HEADERS,
    body:    JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = Array.isArray(d.message) ? d.message.join('; ') : (d.message || `send ${r.status}`);
    const err = new Error(msg);
    err.status = r.status;
    err.detail = d;
    throw err;
  }
  return d; // { success, links:[{documentId, recipientId, ...}] }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const action = (req.query.action || 'templates').toString();
      if (action === 'templates') return res.status(200).json({ ok: true, templates: await listTemplates() });
      if (action === 'documents') return res.status(200).json({ ok: true, documents: await listDocuments(Number(req.query.limit) || 20) });
      return res.status(400).json({ error: `unknown GET action: ${action}` });
    }

    if (req.method === 'POST') {
      const { action, templateId, contactId, opportunityId, meta } = req.body || {};
      if (action !== 'fire' && action !== 'draft') {
        return res.status(400).json({ error: "action must be 'fire' or 'draft'" });
      }
      if (!templateId || !contactId) {
        return res.status(400).json({ error: 'templateId and contactId are required' });
      }

      const sendDocument = action === 'fire';
      const result = await sendTemplate({ templateId, contactId, opportunityId, sendDocument });

      const who   = meta?.seller || contactId;
      const addr  = meta?.address || '';
      const tname = meta?.templateName || 'contract';
      await tg(
        `${sendDocument ? '🚀 <b>CONTRACT FIRED</b>' : '📄 <b>Draft created</b>'}\n\n` +
        `📄 ${tname}\n👤 ${who}\n${addr ? '📍 ' + addr + '\n' : ''}` +
        `\n${sendDocument ? 'Sent for signature via GHL.' : 'Draft only — not sent.'}`
      );

      return res.status(200).json({ ok: true, sent: sendDocument, result });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'contract action failed', detail: e.detail });
  }
};
