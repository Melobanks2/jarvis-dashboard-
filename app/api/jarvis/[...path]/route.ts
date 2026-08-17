import { NextRequest } from 'next/server';
import { DIALER_API } from '@/lib/config';
import { stageOf, REFUND_EXCLUDE, IN_MOTION } from '@/lib/stages';

/**
 * Every Jarvis server endpoint, behind ONE catch-all.
 *
 *   GET  /api/jarvis/models      → local model list + reachability probe
 *   POST /api/jarvis/chat        → streaming chat (NDJSON straight from Ollama)
 *   POST /api/jarvis/briefing    → today's plan as structured JSON
 *   ANY  /api/jarvis/proxy/**    → dialer-server proxy, secret attached server-side
 *
 * Why one file instead of four tidy routes: Vercel's Hobby plan allows 12
 * Serverless Functions per deployment, and the repo already ships 11 legacy
 * ones in the root /api directory. Three separate App Router routes put the
 * deployment at 14 and every push failed to deploy. A catch-all counts as one
 * function. If the account moves to Pro, or the unused root functions are
 * retired, this can be split back into separate routes.
 *
 * Chat and briefing both reach Ollama on 127.0.0.1, so they only work when the
 * dashboard runs on this Mac. A deployed build reports a clear offline state
 * rather than hanging. Set OLLAMA_URL to a tunnelled address to change that.
 */

const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3.6:27b';

// Hobby caps a function at 60s and REJECTS THE BUILD if this asks for more.
// The local model needs far longer than 60s, which is fine: on this Mac the
// dev server has no such ceiling, and a deployed build cannot reach Ollama
// anyway.
export const maxDuration = 60;

// Ollama needs a generous client-side ceiling for reasoning models — they spend
// tokens on the thinking block before emitting any answer.
const FETCH_TIMEOUT_MS = 180_000;

interface LeadLike {
  name?: string; phone?: string; stage?: string; stageName?: string; temp?: string; source?: string;
  daysInCrm?: number | null; daysInStage?: number | null;
  purchasePrice?: number | null; daysUntilDeadline?: number | null;
  address?: string;
}

const money = (n: number) => '$' + Math.round(n).toLocaleString();

async function readLeads(): Promise<LeadLike[]> {
  const res = await fetch(`${DIALER_API}/dialer/leads`, {
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`dialer ${res.status}`);
  return (await res.json())?.leads ?? [];
}

// ── models ──────────────────────────────────────────────────────────────────

async function handleModels() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const models = (data?.models ?? []).map((m: { name: string; details?: { parameter_size?: string } }) => ({
      name: m.name,
      size: m.details?.parameter_size ?? '',
    }));
    return Response.json({ online: true, models, defaultModel: DEFAULT_MODEL, host: OLLAMA });
  } catch (e) {
    return Response.json(
      { online: false, models: [], defaultModel: DEFAULT_MODEL, host: OLLAMA, error: (e as Error).message },
      { status: 200 },
    );
  }
}

// ── chat ────────────────────────────────────────────────────────────────────

/**
 * The model draws charts by NAME, never by value. It picks which dataset
 * answers the question; the dashboard computes the numbers from the same live
 * pipeline the rest of the UI reads. That makes a hallucinated chart
 * impossible — the worst case is an unhelpful choice of chart.
 */
const VISUAL_BLOCKS = [
  'VISUALS — you can draw real charts. Emit a fenced block on its own lines:',
  '```viz',
  '{"dataset":"refund_risk"}',
  '```',
  'Available datasets — pick the one that actually answers the question:',
  '- stages: how many leads sit in each pipeline stage',
  '- temperature: hot / warm / cold / new / dead mix',
  '- sources: which source each lead came from',
  '- refund_risk: recoverable money bucketed by how many days are left to file',
  '- money: spend, still recoverable, already filed, deals in motion',
  '- in_motion: live deals and how long each has sat in its stage',
  '- hot_stale: hot leads ordered oldest first',
  '- aging: how old the pipeline is, in day buckets',
  '',
  'To show people with working call buttons, emit:',
  '```people',
  '{"names":["Full Name","Another Name"],"title":"Call these first"}',
  '```',
  'Names must be copied exactly from the snapshot below. Never invent one.',
  '',
  'Visual rules:',
  '- Put at least one viz block in every answer, right after the sentence it supports.',
  '- Never write numbers inside a viz or people block. The dashboard fills them in.',
  '- Do not describe the chart in prose afterwards; he can see it.',
].join('\n');

/** Compact, token-cheap snapshot of the business so answers cite real numbers. */
async function pipelineContext(): Promise<string> {
  try {
    const leads = await readLeads();
    if (!leads.length) return 'Live pipeline returned no leads.';

    const byStage: Record<string, number> = {};
    const byTemp: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const l of leads) {
      const st = stageOf(l); if (st) byStage[st] = (byStage[st] ?? 0) + 1;
      if (l.temp) byTemp[l.temp] = (byTemp[l.temp] ?? 0) + 1;
      if (l.source) bySource[l.source] = (bySource[l.source] ?? 0) + 1;
    }

    const ispeed = leads.filter(l => l.source === 'ispeed');
    const spend = ispeed.reduce((a, l) => a + (l.purchasePrice || 0), 0);
    const recoverable = ispeed.filter(l => l.daysUntilDeadline != null && l.daysUntilDeadline >= 0 && !REFUND_EXCLUDE.has(stageOf(l)));
    const closingSoon = recoverable
      .filter(l => (l.daysUntilDeadline ?? 99) <= 7)
      .sort((a, b) => (a.daysUntilDeadline ?? 0) - (b.daysUntilDeadline ?? 0));

    const hotList = leads
      .filter(l => l.temp === 'hot')
      .sort((a, b) => (b.daysInCrm ?? 0) - (a.daysInCrm ?? 0))
      .slice(0, 12)
      .map(l => `${l.name} (${stageOf(l)}, ${l.daysInCrm ?? '?'}d old)`);

    const inMotion = leads.filter(l => IN_MOTION.includes(stageOf(l)));

    const kv = (o: Record<string, number>) =>
      Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ');

    return [
      `LIVE PIPELINE (${leads.length} leads, read from this machine just now):`,
      `- by temperature: ${kv(byTemp)}`,
      `- by source: ${kv(bySource)}`,
      `- by stage: ${kv(byStage)}`,
      `- deals in motion (${inMotion.length}): ${inMotion.map(l => `${l.name} [${stageOf(l)}]`).join('; ') || 'none'}`,
      `- iSpeed paid spend: ${money(spend)}; still refundable: ${money(recoverable.reduce((a, l) => a + (l.purchasePrice || 0), 0))} across ${recoverable.length} leads`,
      `- refund window closing within 7 days (${closingSoon.length}): ${closingSoon.map(l => `${l.name} in ${l.daysUntilDeadline}d`).join('; ') || 'none'}`,
      `- oldest hot leads: ${hotList.join('; ') || 'none'}`,
    ].join('\n');
  } catch {
    return 'Live pipeline unavailable (local dialer server may be down).';
  }
}

function systemPrompt(ctx: string) {
  return [
    'You are Jarvis, chief of staff for Chris Lovera, a wholesale real estate investor in Orlando FL.',
    'You run entirely on his own machine — no data leaves it. Be direct and concise; he is operating, not reading a report.',
    'He is a visual thinker: he reads charts, not paragraphs. Keep prose short and let the visuals carry the weight.',
    '',
    'Rules:',
    '- Cite the real numbers from the live snapshot below. Never invent a figure.',
    '- If the snapshot does not contain what was asked, say so plainly instead of guessing.',
    '- Money that is under contract is NOT collected revenue. Do not call it revenue.',
    '- When he asks what to do, give a short ordered list of concrete actions naming specific leads.',
    '- Lead with the answer. Skip preamble.',
    '',
    VISUAL_BLOCKS,
    '',
    ctx,
  ].join('\n');
}

async function handleChat(req: NextRequest) {
  let body: { messages?: { role: string; content: string }[]; model?: string; think?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 });
  }

  const history = (body.messages ?? []).filter(m => m?.content?.trim());
  if (!history.length) return Response.json({ error: 'No messages supplied' }, { status: 400 });

  const model = body.model || DEFAULT_MODEL;
  const think = body.think ?? false;

  // Only the newest turn needs fresh context; re-injecting per turn would waste
  // tokens, so it rides on the system message which Ollama keeps at the front.
  const ctx = await pipelineContext();

  let upstream: Response;
  try {
    upstream = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        think,
        stream: true,
        messages: [{ role: 'system', content: systemPrompt(ctx) }, ...history],
        options: { num_predict: think ? 2048 : 1024, temperature: 0.6 },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    return Response.json(
      { error: `Local model unreachable at ${OLLAMA}. Is Ollama running? (${(e as Error).message})` },
      { status: 503 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return Response.json({ error: `Ollama ${upstream.status}: ${detail.slice(0, 300)}` }, { status: 502 });
  }

  // Pass Ollama's NDJSON straight through — the client parses it line by line.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ── briefing ────────────────────────────────────────────────────────────────

/**
 * Today's action plan as STRUCTURED data, so the UI can render real cards
 * instead of a wall of prose. Ollama accepts a JSON Schema in `format` and
 * qwen3.6 honours it reliably.
 *
 * Design rule: the model never emits a phone number, dollar amount, or day
 * count. It returns lead NAMES and reasoning only; every hard fact is joined
 * back on from the live pipeline afterwards. A hallucinated phone number is
 * worse than no phone number — Chris would dial a stranger.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['call', 'refund', 'contract', 'followup', 'admin'] },
          urgency: { type: 'string', enum: ['now', 'today', 'week'] },
          why: { type: 'string' },
          people: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, note: { type: 'string' } },
              required: ['name'],
            },
          },
        },
        required: ['title', 'kind', 'urgency', 'why', 'people'],
      },
    },
  },
  required: ['headline', 'actions'],
};

/** Normalised key for joining model-returned names back onto real leads. */
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

async function handleBriefing() {
  let leads: LeadLike[] = [];
  try {
    leads = await readLeads();
  } catch (e) {
    return Response.json({ error: `Could not read the pipeline: ${(e as Error).message}` }, { status: 502 });
  }
  if (!leads.length) return Response.json({ error: 'The pipeline returned no leads.' }, { status: 502 });

  const ispeed = leads.filter(l => l.source === 'ispeed');
  const refundSoon = ispeed
    .filter(l => l.daysUntilDeadline != null && l.daysUntilDeadline >= 0 && l.daysUntilDeadline <= 7 && !REFUND_EXCLUDE.has(stageOf(l)))
    .sort((a, b) => (a.daysUntilDeadline ?? 0) - (b.daysUntilDeadline ?? 0));
  const inMotion = leads.filter(l => IN_MOTION.includes(stageOf(l)));
  const staleHot = leads
    .filter(l => l.temp === 'hot')
    .sort((a, b) => (b.daysInCrm ?? 0) - (a.daysInCrm ?? 0))
    .slice(0, 10);
  const freshNew = leads.filter(l => l.temp === 'new' && (l.daysInCrm ?? 99) <= 3);

  const ctx = [
    `PIPELINE RIGHT NOW — ${leads.length} leads.`,
    ``,
    `REFUND WINDOW CLOSING (${refundSoon.length}) — money already spent, lost if not filed:`,
    ...refundSoon.map(l => `  - ${l.name} — ${l.daysUntilDeadline}d left, ${money(l.purchasePrice || 0)}, stage ${stageOf(l)}`),
    ``,
    `DEALS IN MOTION (${inMotion.length}) — closest to cash:`,
    ...inMotion.map(l => `  - ${l.name} — ${stageOf(l)}, ${l.daysInStage ?? '?'}d in stage`),
    ``,
    `HOT LEADS GOING STALE (${staleHot.length}) — real interest, no follow-through:`,
    ...staleHot.map(l => `  - ${l.name} — ${l.daysInCrm ?? '?'}d old, stage ${stageOf(l)}`),
    ``,
    `FRESH LEADS (${freshNew.length}) under 3 days old, best answer rates.`,
  ].join('\n');

  const system = [
    'You are Jarvis, chief of staff to a wholesale real estate investor.',
    'Produce his action plan for today from the pipeline below.',
    '',
    'Rules:',
    '- 3 to 5 actions, ordered by what protects or makes money soonest.',
    '- Expiring refunds outrank everything: that is already-spent cash with a deadline.',
    '- Every action must name specific people from the data. Never invent a name.',
    '- Do NOT write phone numbers, dollar amounts, or day counts. They get attached automatically.',
    '- `why` is one short sentence of consequence, not a restatement of the title.',
    '- `urgency`: "now" = will be lost today, "today" = must happen today, "week" = this week.',
    '- headline: one line on where the day stands. Under 90 characters.',
    '',
    ctx,
  ].join('\n');

  let raw = '';
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        think: false,
        stream: false,
        format: SCHEMA,
        options: { num_predict: 1600, temperature: 0.2 },
        messages: [{ role: 'system', content: system }, { role: 'user', content: 'What must I do today?' }],
      }),
      signal: AbortSignal.timeout(280_000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    raw = (await res.json())?.message?.content ?? '';
  } catch (e) {
    return Response.json({ error: `Local model unavailable: ${(e as Error).message}` }, { status: 503 });
  }

  let parsed: { headline?: string; actions?: { title: string; kind: string; urgency: string; why: string; people?: { name: string; note?: string }[] }[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'The model returned malformed JSON. Try again.', raw: raw.slice(0, 400) }, { status: 502 });
  }

  // Join every named person back onto the real lead record. Facts come from the
  // pipeline, never from the model.
  const index = new Map<string, LeadLike>();
  for (const l of leads) if (l.name) index.set(nameKey(l.name), l);

  const actions = (parsed.actions ?? []).map(a => ({
    title: a.title,
    kind: a.kind,
    urgency: a.urgency,
    why: a.why,
    people: (a.people ?? []).map(p => {
      const hit = index.get(nameKey(p.name));
      return {
        name: hit?.name ?? p.name,          // prefer the real casing
        note: p.note ?? '',
        matched: !!hit,                      // false ⇒ model invented a name; UI flags it
        phone: hit?.phone ?? null,
        stage: hit ? stageOf(hit) : null,
        address: hit?.address ?? null,
        daysInCrm: hit?.daysInCrm ?? null,
        deadlineDays: hit?.daysUntilDeadline ?? null,
        amount: hit?.purchasePrice ?? null,
      };
    }),
  }));

  return Response.json({
    headline: parsed.headline ?? '',
    actions,
    generatedAt: new Date().toISOString(),
    model: DEFAULT_MODEL,
    stats: {
      leads: leads.length,
      refundSoon: refundSoon.length,
      refundSoonValue: refundSoon.reduce((s, l) => s + (l.purchasePrice || 0), 0),
      inMotion: inMotion.length,
      staleHot: staleHot.length,
      freshNew: freshNew.length,
    },
  });
}

// ── dialer proxy ────────────────────────────────────────────────────────────

/**
 * dialer-server.js waves through requests from 127.0.0.1 but requires
 * `x-dialer-secret` for anything remote — and it deliberately counts tunnelled
 * traffic as remote (cloudflared runs on the same host, so a socket-IP check
 * alone would treat the whole internet as local). Once the Mac is exposed
 * through a tunnel, every call needs the secret, and the secret cannot live in
 * a NEXT_PUBLIC_* value because those are inlined into the client bundle.
 *
 * Enable by pointing the client at this route:
 *     NEXT_PUBLIC_DIALER_API=/api/jarvis/proxy
 * and configuring the real upstream server-side:
 *     DIALER_ORIGIN=https://<tunnel>.trycloudflare.com
 *     DIALER_SECRET=<value from sarah-dialer/.env>
 */
const PROXY_ORIGIN = (process.env.DIALER_ORIGIN || 'http://127.0.0.1:3007').replace(/\/$/, '');
const PROXY_SECRET = process.env.DIALER_SECRET || '';
const PROXY_TIMEOUT_MS = 45_000;

// Hop-by-hop and identity headers that must not be forwarded upstream.
// The x-forwarded-* / cf-* set matters especially: dialer-server treats any
// request carrying them as remote, so relaying the browser's copies would make
// a local server-to-server call fail its localhost check.
const STRIP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'cookie', 'authorization',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port',
  'forwarded', 'cf-connecting-ip', 'cf-ray', 'cf-ipcountry', 'x-real-ip', 'x-vercel-id',
]);

async function handleProxy(req: NextRequest, rest: string[], method: 'GET' | 'POST' | 'PUT') {
  const target = `${PROXY_ORIGIN}/${rest.join('/')}${req.nextUrl.search || ''}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!STRIP.has(k.toLowerCase())) headers.set(k, v); });
  if (PROXY_SECRET) headers.set('x-dialer-secret', PROXY_SECRET);

  let body: string | undefined;
  if (method !== 'GET') {
    body = await req.text();
    if (body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  }

  try {
    const upstream = await fetch(target, {
      method, headers, body,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'follow',
    });

    // Pass the body through untouched so streaming endpoints keep streaming.
    const out = new Headers();
    const ct = upstream.headers.get('content-type');
    if (ct) out.set('content-type', ct);
    out.set('cache-control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    const msg = (e as Error).message;
    const hint = /timeout|abort/i.test(msg)
      ? `Timed out reaching ${PROXY_ORIGIN}. Is the dialer server running (and the tunnel up, if remote)?`
      : `Could not reach ${PROXY_ORIGIN}: ${msg}`;
    return Response.json({ error: hint }, { status: 502 });
  }
}

// ── dispatch ────────────────────────────────────────────────────────────────

const notFound = (path: string[]) =>
  Response.json({ error: `Unknown Jarvis endpoint: /api/jarvis/${path.join('/')}` }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] === 'models') return handleModels();
  if (path[0] === 'proxy') return handleProxy(req, path.slice(1), 'GET');
  return notFound(path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] === 'chat') return handleChat(req);
  if (path[0] === 'briefing') return handleBriefing();
  if (path[0] === 'proxy') return handleProxy(req, path.slice(1), 'POST');
  return notFound(path);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] === 'proxy') return handleProxy(req, path.slice(1), 'PUT');
  return notFound(path);
}
