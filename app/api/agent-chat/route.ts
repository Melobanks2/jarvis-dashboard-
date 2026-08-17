import { NextRequest } from 'next/server';
import { DIALER_API } from '@/lib/config';

/**
 * Agent Chat backend — talks to the Ollama instance on THIS machine.
 *
 * Why a server route instead of calling Ollama from the browser: Ollama only
 * accepts cross-origin requests from hosts listed in OLLAMA_ORIGINS, so a direct
 * browser fetch is blocked by default. Proxying keeps the model URL server-side
 * and lets us inject live pipeline context the browser would otherwise have to
 * assemble and ship on every turn.
 *
 * This is inherently local: it reaches 127.0.0.1:11434. A deployed build on
 * Vercel cannot reach this machine, so the route reports a clear offline state
 * there rather than hanging. Expose Ollama through the tunnel and set
 * OLLAMA_URL to make it work remotely.
 */

const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3.6:27b';

// Ollama needs a generous ceiling for reasoning models — they spend tokens on
// the thinking block before emitting any answer.
const FETCH_TIMEOUT_MS = 180_000;

interface LeadLike {
  name?: string; stage?: string; temp?: string; source?: string;
  daysInCrm?: number | null; daysInStage?: number | null;
  purchasePrice?: number | null; daysUntilDeadline?: number | null;
  address?: string;
}

/** Compact, token-cheap snapshot of the business so answers cite real numbers. */
async function pipelineContext(): Promise<string> {
  try {
    const res = await fetch(`${DIALER_API}/dialer/leads`, {
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    if (!res.ok) return 'Live pipeline unavailable.';
    const data = await res.json();
    const leads: LeadLike[] = data?.leads ?? [];
    if (!leads.length) return 'Live pipeline returned no leads.';

    const byStage: Record<string, number> = {};
    const byTemp: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const l of leads) {
      if (l.stage) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
      if (l.temp) byTemp[l.temp] = (byTemp[l.temp] ?? 0) + 1;
      if (l.source) bySource[l.source] = (bySource[l.source] ?? 0) + 1;
    }

    const ispeed = leads.filter(l => l.source === 'ispeed');
    const spend = ispeed.reduce((a, l) => a + (l.purchasePrice || 0), 0);
    const EXCLUDE = new Set(['Refund Requested', 'Refund Approved', 'Under Contract', 'Contract Sent', 'Closed', 'Disposition']);
    const recoverable = ispeed.filter(l => l.daysUntilDeadline != null && l.daysUntilDeadline >= 0 && !EXCLUDE.has(l.stage ?? ''));
    const closingSoon = recoverable
      .filter(l => (l.daysUntilDeadline ?? 99) <= 7)
      .sort((a, b) => (a.daysUntilDeadline ?? 0) - (b.daysUntilDeadline ?? 0));

    const hotList = leads
      .filter(l => l.temp === 'hot')
      .sort((a, b) => (b.daysInCrm ?? 0) - (a.daysInCrm ?? 0))
      .slice(0, 12)
      .map(l => `${l.name} (${l.stage}, ${l.daysInCrm ?? '?'}d old)`);

    const inMotion = leads.filter(l => ['Under Contract', 'Contract Sent', 'Decision Pending'].includes(l.stage ?? ''));

    const money = (n: number) => '$' + Math.round(n).toLocaleString();
    const kv = (o: Record<string, number>) =>
      Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ');

    return [
      `LIVE PIPELINE (${leads.length} leads, read from this machine just now):`,
      `- by temperature: ${kv(byTemp)}`,
      `- by source: ${kv(bySource)}`,
      `- by stage: ${kv(byStage)}`,
      `- deals in motion (${inMotion.length}): ${inMotion.map(l => `${l.name} [${l.stage}]`).join('; ') || 'none'}`,
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
    '',
    'Rules:',
    '- Cite the real numbers from the live snapshot below. Never invent a figure.',
    '- If the snapshot does not contain what was asked, say so plainly instead of guessing.',
    '- Money that is under contract is NOT collected revenue. Do not call it revenue.',
    '- When he asks what to do, give a short ordered list of concrete actions naming specific leads.',
    '- Lead with the answer. Skip preamble.',
    '',
    ctx,
  ].join('\n');
}

export async function GET() {
  // Model list for the picker + a reachability probe for the UI.
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

export async function POST(req: NextRequest) {
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
