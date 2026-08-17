import { DIALER_API } from '@/lib/config';
import { stageOf, REFUND_EXCLUDE, IN_MOTION } from '@/lib/stages';

/**
 * Today's action briefing as STRUCTURED data, so the UI can render real cards
 * instead of a wall of prose.
 *
 * Ollama accepts a JSON Schema in `format` and qwen3.6 honours it reliably.
 *
 * Design rule: the model never emits a phone number, dollar amount, or day
 * count. It returns lead NAMES and reasoning only; every hard fact is joined
 * back on from the live pipeline afterwards. A hallucinated phone number is
 * worse than no phone number — Chris would dial a stranger.
 */

const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'qwen3.6:27b';

export const maxDuration = 300;

interface Lead {
  name?: string; phone?: string; stage?: string; stageName?: string; temp?: string; source?: string;
  address?: string; daysInCrm?: number | null; daysInStage?: number | null;
  purchasePrice?: number | null; daysUntilDeadline?: number | null;
}

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

const money = (n: number) => '$' + Math.round(n).toLocaleString();

/** Normalised key for joining model-returned names back onto real leads. */
const key = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

export async function POST() {
  let leads: Lead[] = [];
  try {
    const r = await fetch(`${DIALER_API}/dialer/leads`, { cache: 'no-store', signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`dialer ${r.status}`);
    leads = (await r.json())?.leads ?? [];
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
        model: MODEL,
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
  const index = new Map<string, Lead>();
  for (const l of leads) if (l.name) index.set(key(l.name), l);

  const actions = (parsed.actions ?? []).map(a => ({
    title: a.title,
    kind: a.kind,
    urgency: a.urgency,
    why: a.why,
    people: (a.people ?? []).map(p => {
      const hit = index.get(key(p.name));
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
    model: MODEL,
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
