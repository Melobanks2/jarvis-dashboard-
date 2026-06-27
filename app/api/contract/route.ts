/**
 * Contract Cannon backend — Next.js App Router route handler.
 *
 * Lives inside the Next.js function bundle (NOT a separate /api/*.js Vercel
 * function) because the dashboard is at the Hobby 12-function cap.
 *
 * GHL Documents & Contracts ("proposals") — live-verified endpoints:
 *   GET  /proposals/templates?locationId&limit=20   list templates (limit>20 returns [])
 *   GET  /proposals/document?locationId&limit=20      list documents (status/links)
 *   POST /proposals/templates/send                    create+send from a template
 *        body: { locationId, templateId, contactId, userId, opportunityId?, sendDocument? }
 *
 * Token scope reality (tested 2026-06-27): list + sendlink scopes present;
 * document CREATE and single-template READ are 401. So per-deal numbers must
 * reach the contract via the template's merge fields (a GHL-side setup).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GHL_TOKEN    = process.env.GHL_TOKEN    || 'pit-dada4af8-bbe3-4334-906b-361b9f03bffa';
const GHL_LOCATION = process.env.GHL_LOCATION || 'AymErWPrH9U1ddRouslC';
const GHL_USER_ID  = process.env.GHL_USER_ID  || 'BTQSnuKjg45tMAupH3Ly';
const GHL_API      = 'https://services.leadconnectorhq.com';
const GHL_HEADERS  = {
  Authorization:  `Bearer ${GHL_TOKEN}`,
  Version:        '2021-07-28',
  'Content-Type': 'application/json',
  Accept:         'application/json',
};

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8779808673:AAFdlbN_AKqREGaJDEYk4vqlVKNLNMnTkSs';
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID   || '8105811341';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

async function tg(text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch { /* non-fatal */ }
}

function templateKind(name = ''): 'psa' | 'rbp' | 'other' {
  const n = name.toLowerCase();
  if (n.includes('rbp') || n.includes('retail') || n.includes('novat')) return 'rbp';
  if (n.includes('psa') || n.includes('purchase')) return 'psa';
  return 'other';
}

async function listTemplates() {
  const r = await fetch(`${GHL_API}/proposals/templates?locationId=${GHL_LOCATION}&limit=20`, { headers: GHL_HEADERS });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.message || `templates ${r.status}`), { status: r.status });
  return (d.data || []).map((t: any) => ({ id: t.id || t._id, name: t.name, kind: templateKind(t.name) }));
}

async function listDocuments(limit = 20) {
  const r = await fetch(`${GHL_API}/proposals/document?locationId=${GHL_LOCATION}&limit=${Math.min(limit, 20)}`, { headers: GHL_HEADERS });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.message || `documents ${r.status}`), { status: r.status });
  return (d.data || d.documents || []).map((doc: any) => ({
    id:         doc.documentId || doc.id || doc._id,
    name:       doc.name,
    status:     doc.status,
    createdAt:  doc.createdAt,
    recipients: (doc.recipients || []).map((x: any) => x.contactName || x.email).filter(Boolean),
  }));
}

async function sendTemplate(p: { templateId: string; contactId: string; opportunityId?: string; sendDocument?: boolean }) {
  const body: Record<string, unknown> = {
    locationId: GHL_LOCATION,
    templateId: p.templateId,
    contactId:  p.contactId,
    userId:     GHL_USER_ID,
    sendDocument: p.sendDocument ?? true,
  };
  if (p.opportunityId) body.opportunityId = p.opportunityId;

  const r = await fetch(`${GHL_API}/proposals/templates/send`, { method: 'POST', headers: GHL_HEADERS, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = Array.isArray(d.message) ? d.message.join('; ') : (d.message || `send ${r.status}`);
    throw Object.assign(new Error(msg), { status: r.status, detail: d });
  }
  return d;
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'templates';
    if (action === 'templates') return json({ ok: true, templates: await listTemplates() });
    if (action === 'documents') return json({ ok: true, documents: await listDocuments(Number(url.searchParams.get('limit')) || 20) });
    return json({ error: `unknown GET action: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e.message || 'failed', detail: e.detail }, e.status || 500);
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const { action, templateId, contactId, opportunityId, meta } = b || {};
    if (action !== 'fire' && action !== 'draft') return json({ error: "action must be 'fire' or 'draft'" }, 400);
    if (!templateId || !contactId) return json({ error: 'templateId and contactId are required' }, 400);

    const sendDocument = action === 'fire';
    const result = await sendTemplate({ templateId, contactId, opportunityId, sendDocument });

    await tg(
      `${sendDocument ? '🚀 <b>CONTRACT FIRED</b>' : '📄 <b>Draft created</b>'}\n\n` +
      `📄 ${meta?.templateName || 'contract'}\n👤 ${meta?.seller || contactId}\n` +
      `${meta?.address ? '📍 ' + meta.address + '\n' : ''}` +
      `\n${sendDocument ? 'Sent for signature via GHL.' : 'Draft only — not sent.'}`
    );

    return json({ ok: true, sent: sendDocument, result });
  } catch (e: any) {
    return json({ error: e.message || 'contract action failed', detail: e.detail }, e.status || 500);
  }
}
