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

// ── local-service proxy ─────────────────────────────────────────────────────

/**
 * Both local data services are reachable only on this machine's loopback, so
 * the browser cannot call them directly once the dashboard is served through a
 * tunnel. These two paths relay to them server-side instead:
 *
 *     /api/jarvis/proxy/**  → dialer-server.js   (:3007)
 *     /api/jarvis/mkt/**    → marketing-intel.js (:3008)
 *
 * dialer-server.js waves through requests from 127.0.0.1 but requires
 * `x-dialer-secret` for anything remote — and it deliberately counts tunnelled
 * traffic as remote (cloudflared runs on the same host, so a socket-IP check
 * alone would treat the whole internet as local). The secret cannot live in a
 * NEXT_PUBLIC_* value because those are inlined into the client bundle, so it
 * is attached here instead.
 *
 * When the Next server runs on the SAME machine as the services (the local-first
 * setup), the defaults below already point at loopback and no secret is needed —
 * dialer-server sees a genuine localhost call. DIALER_ORIGIN/DIALER_SECRET only
 * matter when the dashboard is hosted elsewhere and has to reach in over a
 * tunnel. Enable either way by pointing the client at these routes:
 *     NEXT_PUBLIC_DIALER_API=/api/jarvis/proxy
 *     NEXT_PUBLIC_MKT_API=/api/jarvis/mkt/marketing-intel
 *     NEXT_PUBLIC_AUDIO_BASE=/api/jarvis/proxy
 */
const PROXY_ORIGIN = (process.env.DIALER_ORIGIN || 'http://127.0.0.1:3007').replace(/\/$/, '');
const PROXY_SECRET = process.env.DIALER_SECRET || '';
const MKT_ORIGIN = (process.env.MKT_ORIGIN || 'http://127.0.0.1:3008').replace(/\/$/, '');
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

// ── the allowlist ───────────────────────────────────────────────────────────

/**
 * WHY THIS EXISTS — measured on 2026-08-17, not theoretical.
 *
 * Stripping the x-forwarded and cf- headers above is what makes the relay work, and it is
 * also what makes it dangerous: dialer-server's isLocalRequest() then sees a
 * genuine loopback call and skips its x-dialer-secret gate entirely. Same
 * request through the dialer's own tunnel → 401, 24 bytes. Through this proxy
 * → 200, 145,157 bytes of every seller's name, phone and address. DIALER_SECRET
 * is not set here, so nothing is even attached; the dialer's auth is not
 * weakened, it is bypassed. That is a confused deputy — the proxy lending its
 * loopback trust to whoever gets past middleware.ts's basic auth.
 *
 * So the proxy forwards ONLY the paths the dashboard actually calls, and 404s
 * everything else. The lists below were derived by grepping DIALER_API /
 * MKT_API / AUDIO_BASE across app/, components/ and lib/ — not guessed.
 *
 * EXACT PATHS, never prefixes. A prefix rule like "anything under audio/" is
 * precisely the hole this closes: dialer-server.js:167 mounts the whole
 * ~/projects/sarah-dialer/audio tree, which holds audio/corpus/_misses.txt
 * (the corpus-miss log — verbatim seller speech dialer-david-brain.js failed to
 * match), audio/corpus/corpus.txt, and a full voice-clone backup tarball.
 *
 * Adding a call site? Add its path here too, or it 404s. That is the intended
 * failure mode: loud in dev, never a silent prod breakage. Rejections are
 * logged with the method and path so a missed entry names itself.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Exact paths on dialer-server.js (:3007), keyed by method. */
const DIALER_ALLOW: Record<Method, ReadonlySet<string>> = {
  GET: new Set([
    'dialer/leads',              // usePipeline, useLeads
    'dialer/agents-health',      // useAgents
    'dialer/sarah-live',         // useAgents, SarahBoard
    'dialer/sarah-transcript',   // SarahBoard
    'dialer/ispeed-refunds',     // useIspeedRefunds
    'dialer/novation',           // NovationTracker
    'dialer/contract/templates', // ContractCannon
    'dialer/contract/documents', // ContractCannon, NovationTracker
    'dialer/personal/state',     // Acquisitions
    'dialer/healthz',            // MultiDialer
    'dialer/scheduler',          // MultiDialer
    'dialer/status',             // MultiDialer
    'dialer/progress',           // MultiDialer
    'dialer/transcript',         // MultiDialer
    'dialer/session-summary',    // MultiDialer
    'dialer/lists',              // MultiDialer
    'dialer/refund-desk',        // RefundDesk — claims + vendor threads
    'dialer/workday',            // Workday — the day's blocks and their guards
  ]),
  POST: new Set([
    'dialer/lead-action',           // Leads, SarahBoard, SarahMoney
    'dialer/novation',              // NovationTracker (board save)
    'dialer/contract/fire',         // ContractCannon
    'dialer/personal/start',        // Acquisitions
    'dialer/personal/pause',        // Acquisitions
    'dialer/personal/resume',       // Acquisitions
    'dialer/personal/approve',      // Acquisitions
    'dialer/personal/start-list',   // AcqLists — not on the server yet; it
                                    // handles the 404 and offers a CSV instead
    'dialer/ingest-run',            // MultiDialer
    'dialer/call',                  // MultiDialer
    'dialer/stop',                  // MultiDialer
    'dialer/disposition',           // MultiDialer
    'dialer/list',                  // MultiDialer (create)
    'dialer/call-one',              // Contact Board — dial one paid lead, one line
    'dialer/refund-desk',           // RefundDesk — create / status / reply / delete
    'dialer/sms-send',              // Conversations composer — the browser must
                                    // not hold the Telnyx key, so the send goes
                                    // dashboard -> dialer -> Telnyx
  ]),
  PUT: new Set([]),                 // nothing in the dashboard PUTs
  DELETE: new Set([]),              // only the dialer/list/<id> pattern below
};

/** Exact paths on marketing-intel.js (:3008). */
const MKT_ALLOW: Record<Method, ReadonlySet<string>> = {
  GET: new Set([
    'marketing-intel/api/metrics', // app/marketing-intel/page.tsx
    'marketing-intel/api/leads',   // app/marketing-intel/page.tsx
  ]),
  POST: new Set([]),
  PUT: new Set([]),
  DELETE: new Set([]),
};

/**
 * The two shapes whose path genuinely varies, so a literal cannot express them.
 * Both are pinned to a fixed depth with a constrained final segment — a
 * <single segment> pattern, never a subtree.
 */

/** Session/list ids look like `list_1782411013334_f1wwol`. */
const LIST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Audio: only pre-rendered .wav clips, only from the two directories
 * ScriptTraining.tsx actually plays. Filenames vary (54 script-v4 clips), the
 * directories do not. Requiring a leading alphanumeric and a .wav suffix keeps
 * out _misses.txt, corpus.txt, RENDER_REPORT.json, dotfiles and the
 * approved-sarah-voice-backup.tar.gz sitting in APPROVED-FINAL.
 */
const AUDIO_DIRS = new Set(['audio/APPROVED-FINAL', 'audio/corpus/sarah/script-v4']);
const CLIP = /^[A-Za-z0-9][A-Za-z0-9._-]*\.wav$/;

function dialerPatternAllows(method: Method, segs: string[]): boolean {
  if (method === 'GET') {
    // audio/<dir…>/<clip>.wav
    if (segs[0] === 'audio' && segs.length >= 2) {
      return AUDIO_DIRS.has(segs.slice(0, -1).join('/')) && CLIP.test(segs[segs.length - 1]);
    }
    // dialer/list/<listId> and dialer/list/<listId>/queue
    if (segs[0] === 'dialer' && segs[1] === 'list' && LIST_ID.test(segs[2] ?? '')) {
      return segs.length === 3 || (segs.length === 4 && segs[3] === 'queue');
    }
  }
  // MultiDialer's list delete — dialer-server exposes app.delete('/dialer/list/:listId').
  // Until 2026-08-20 the dashboard sent this and got Next's 405: no DELETE export.
  if (method === 'DELETE') {
    return segs[0] === 'dialer' && segs[1] === 'list' &&
           LIST_ID.test(segs[2] ?? '') && segs.length === 3;
  }
  return false;
}

/**
 * True when this exact path may be forwarded. Segments arrive already
 * URL-decoded by Next, so `%2e%2e` has become `..` by the time it is checked.
 */
function isAllowed(kind: 'proxy' | 'mkt', method: Method, segs: string[]): boolean {
  if (!segs.length) return false;
  // No traversal, no empty segments, no segment that could re-open the URL.
  for (const s of segs) {
    if (!s || s === '.' || s === '..' || s.includes('..') || /[?#/\\]/.test(s)) return false;
  }
  const path = segs.join('/');
  if (kind === 'mkt') return MKT_ALLOW[method].has(path);
  return DIALER_ALLOW[method].has(path) || dialerPatternAllows(method, segs);
}

/**
 * Rejections are a bug report, not a security event to swallow quietly: the
 * only way this fires in normal use is a call site nobody added to the list.
 * Logged server-side (visible in `pm2 logs jarvis-dashboard`); the client gets
 * the same 404 shape every unknown /api/jarvis/* route already returns.
 */
function rejected(kind: 'proxy' | 'mkt', method: Method, segs: string[]) {
  const path = segs.join('/');
  console.warn(
    `[jarvis-proxy] BLOCKED ${method} /api/jarvis/${kind}/${path} — not in the allowlist. ` +
    `If the dashboard needs this, add it to ${kind === 'mkt' ? 'MKT_ALLOW' : 'DIALER_ALLOW'} ` +
    `in app/api/jarvis/[...path]/route.ts.`,
  );
  return Response.json(
    { error: `Not a permitted Jarvis proxy path: ${method} /${path}` },
    { status: 404 },
  );
}

async function handleProxy(
  req: NextRequest,
  rest: string[],
  method: Method,
  kind: 'proxy' | 'mkt' = 'proxy',
) {
  if (!isAllowed(kind, method, rest)) return rejected(kind, method, rest);

  const origin = kind === 'mkt' ? MKT_ORIGIN : PROXY_ORIGIN;
  const secret = kind === 'mkt' ? '' : PROXY_SECRET;
  const target = `${origin}/${rest.join('/')}${req.nextUrl.search || ''}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!STRIP.has(k.toLowerCase())) headers.set(k, v); });
  if (secret) headers.set('x-dialer-secret', secret);

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
      ? `Timed out reaching ${origin}. Is that service running (and the tunnel up, if remote)?`
      : `Could not reach ${origin}: ${msg}`;
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
  if (path[0] === 'mkt') return handleProxy(req, path.slice(1), 'GET', 'mkt');
  return notFound(path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] === 'chat') return handleChat(req);
  if (path[0] === 'briefing') return handleBriefing();
  if (path[0] === 'proxy') return handleProxy(req, path.slice(1), 'POST');
  if (path[0] === 'mkt') return handleProxy(req, path.slice(1), 'POST', 'mkt');
  return notFound(path);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] === 'proxy') return handleProxy(req, path.slice(1), 'PUT');
  if (path[0] === 'mkt') return handleProxy(req, path.slice(1), 'PUT', 'mkt');
  return notFound(path);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] === 'proxy') return handleProxy(req, path.slice(1), 'DELETE');
  return notFound(path);
}
