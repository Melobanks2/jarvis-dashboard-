'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import {
  ArrowUp, Brain, ChevronDown, ChevronRight, Cpu, Square, Trash2, AlertTriangle, Sparkles,
  PhoneCall, Receipt, FileSignature, Clock, ListChecks, RefreshCw, Check, MapPin,
  BarChart3, DollarSign, Activity, Megaphone, Target, Users, Loader2,
} from 'lucide-react';
import { GlassCard, GlassPill } from '@/components/ui/GlassCard';
import { BarList, Donut, Tiles } from '@/components/ui/Viz';
import { buildViz, joinPeople, summarize, type ChatPerson } from '@/lib/chatViz';
import { usePipeline, type Lead } from '@/lib/hooks/usePipeline';
import { useApp } from '@/lib/AppContext';

// Talks only to the Ollama instance on this MacBook, via /api/jarvis/*.
// Charts are drawn from the SAME live pipeline the rest of the dashboard reads —
// the model names a dataset, it never supplies the numbers.

const C = { blue: '#0a84ff', pos: '#30d158', urg: '#ff453a', warn: '#ff9f0a', purple: '#bf5af2', cyan: '#64d2ff', dim: 'rgba(235,235,245,0.35)' };
const SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const;
const TAP = { scale: 0.97 };
const NUM = 'font-orbitron font-semibold';

const CHAT_KEY = 'jarvis_agentchat_v1';
const PULSE_KEY = 'jarvis_pulse_open';
const doneKey = () => `jarvis_briefing_done_${new Date().toISOString().slice(0, 10)}`;

const URGENCY: Record<string, { label: string; color: string }> = {
  now:   { label: 'Right now', color: C.urg },
  today: { label: 'Today',     color: C.warn },
  week:  { label: 'This week', color: C.blue },
};
const KIND: Record<string, { icon: typeof PhoneCall; label: string }> = {
  call:     { icon: PhoneCall,     label: 'Call' },
  refund:   { icon: Receipt,       label: 'Refund' },
  contract: { icon: FileSignature, label: 'Contract' },
  followup: { icon: Clock,         label: 'Follow up' },
  admin:    { icon: ListChecks,    label: 'Admin' },
};

interface Person extends ChatPerson { note?: string }
interface Action { title: string; kind: string; urgency: string; why: string; people: Person[]; }
interface Briefing {
  headline: string; actions: Action[]; generatedAt: string; model: string;
  stats: { leads: number; refundSoon: number; refundSoonValue: number; inMotion: number; staleHot: number; freshNew: number };
}
interface Msg { role: 'user' | 'assistant'; content: string; thinking?: string; }

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`;

export function AgentChat() {
  const { refreshKey } = useApp();
  const { data: pipe } = usePipeline(refreshKey);
  const leads = useMemo(() => pipe?.leads ?? [], [pipe]);

  const [mode, setMode] = useState<'today' | 'chat'>('today');
  const [models, setModels] = useState<{ name: string; size: string }[]>([]);
  const [model, setModel] = useState('');
  const [online, setOnline] = useState<boolean | null>(null);
  const [host, setHost] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/jarvis/models').then(r => r.json()).then(d => {
      if (!live) return;
      setOnline(!!d.online); setModels(d.models ?? []); setHost(d.host ?? '');
      setModel(prev => prev || d.defaultModel || d.models?.[0]?.name || '');
    }).catch(() => live && setOnline(false));
    return () => { live = false; };
  }, []);

  const seg = (k: 'today' | 'chat', label: string) => (
    <button onClick={() => setMode(k)}
      className={`tap rounded-lg px-4 py-1.5 text-[13px] transition-colors ${mode === k ? 'text-textb bg-white/[0.13]' : 'text-jtext hover:text-textb'}`}
      style={mode === k ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 3px rgba(0,0,0,0.3)' } : undefined}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        <h1 className="text-[21px] font-semibold tracking-[-0.022em] text-textb">Jarvis</h1>
        <div className="inline-flex gap-0.5 rounded-xl border border-border p-1 bg-white/[0.06]">
          {seg('today', 'Today')}{seg('chat', 'Chat')}
        </div>
        <GlassPill color={online === null ? C.warn : online ? C.pos : C.urg} className="ml-auto">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: online === null ? C.warn : online ? C.pos : C.urg }} />
          {online === null ? 'checking…' : online ? `${model || 'local'} · on this Mac` : 'local model offline'}
        </GlassPill>
      </div>

      {online === false && (
        <GlassCard padding="p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={15} style={{ color: C.urg }} className="mt-0.5 flex-shrink-0" />
            <div className="text-[13px] text-jtext leading-relaxed">
              <span className="text-textb font-medium">No local model at {host || '127.0.0.1:11434'}.</span>{' '}
              Start it with <code className="px-1.5 py-0.5 rounded bg-white/10 text-[12px]">ollama serve</code>. This runs only on your machine.
            </div>
          </div>
        </GlassCard>
      )}

      {mode === 'today'
        ? <TodayBriefing online={online} leads={leads} />
        : <ChatView online={online} models={models} model={model} setModel={setModel} leads={leads} />}
    </div>
  );
}

// ── Pipeline pulse: always-on visuals, no model required ────────────────────

function PulseStrip({ leads }: { leads: Lead[] }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try { setOpen(localStorage.getItem(PULSE_KEY) !== '0'); } catch { /* ignore */ }
  }, []);
  const toggle = () => setOpen(o => {
    try { localStorage.setItem(PULSE_KEY, o ? '0' : '1'); } catch { /* ignore */ }
    return !o;
  });

  const temp = useMemo(() => buildViz('temperature', leads), [leads]);
  const stages = useMemo(() => buildViz('stages', leads), [leads]);
  const cash = useMemo(() => buildViz('money', leads), [leads]);

  if (!leads.length) return null;

  return (
    <GlassCard className="mb-4" padding="p-4" hover={false}>
      <button onClick={toggle} className="tap flex items-center gap-2 w-full text-left">
        <Activity size={14} style={{ color: C.blue }} />
        <span className="text-[13px] font-medium text-textb">Pipeline pulse</span>
        <span className="text-[11px] text-dimtext">live from this Mac</span>
        <ChevronDown size={14} className="ml-auto text-dimtext transition-transform"
          style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="pt-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              {temp && <div><Donut slices={temp.slices ?? []} centerValue={temp.centerValue ?? '0'} centerLabel={temp.centerLabel ?? ''} size={116} /></div>}
              {stages && (
                <div>
                  <div className="text-[11px] text-dimtext mb-2">{stages.title}</div>
                  <BarList slices={(stages.slices ?? []).slice(0, 6)} unit="count" labelWidth={104} />
                </div>
              )}
            </div>
            {cash?.tiles && <div className="mt-4"><Tiles tiles={cash.tiles} /></div>}
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

// ── Today: the visual action board ──────────────────────────────────────────

function TodayBriefing({ online, leads }: { online: boolean | null; leads: Lead[] }) {
  const [data, setData] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(doneKey()) || '{}')); } catch { /* ignore */ }
  }, []);
  const toggle = (id: string) => setDone(prev => {
    const next = { ...prev, [id]: !prev[id] };
    try { localStorage.setItem(doneKey(), JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/jarvis/briefing', { method: 'POST' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (online) load(); }, [online, load]);

  const total = data?.actions.length ?? 0;
  const completed = useMemo(
    () => (data?.actions ?? []).filter((a, i) => done[`${i}:${a.title}`]).length,
    [data, done],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <PulseStrip leads={leads} />

      {/* Headline + progress */}
      {data && (
        <GlassCard className="mb-4">
          <div className="flex items-start gap-5 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <div className="text-[12px] text-dimtext mb-1.5">
                {new Date(data.generatedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <div className="text-[19px] font-semibold text-textb tracking-[-0.02em] leading-snug">{data.headline}</div>
              <div className="flex gap-2 mt-3 flex-wrap">
                {data.stats.refundSoon > 0 && (
                  <GlassPill color={C.urg}>{money(data.stats.refundSoonValue)} expiring · {data.stats.refundSoon} leads</GlassPill>
                )}
                <GlassPill color={C.pos}>{data.stats.inMotion} in motion</GlassPill>
                <GlassPill color={C.warn}>{data.stats.staleHot} hot going stale</GlassPill>
                <GlassPill>{data.stats.leads} leads live</GlassPill>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Ring done={completed} total={total} />
              <motion.button whileTap={TAP} transition={SPRING} onClick={load} disabled={loading}
                className="press inline-flex items-center gap-2 rounded-full border border-border bg-white/[0.06] px-3.5 py-1.5 text-[12px] text-jtext hover:text-textb disabled:opacity-50">
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Rebuild
              </motion.button>
            </div>
          </div>
        </GlassCard>
      )}

      {loading && !data && <BuildSteps leads={leads} />}

      {err && (
        <GlassCard>
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={15} style={{ color: C.urg }} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] text-textb">{err}</div>
              <button onClick={load} className="tap mt-2 text-[12px]" style={{ color: C.blue }}>Try again</button>
            </div>
          </div>
        </GlassCard>
      )}

      <div className="flex flex-col gap-3.5">
        {(data?.actions ?? []).map((a, i) => (
          <ActionCard key={`${i}:${a.title}`} action={a} index={i}
            done={!!done[`${i}:${a.title}`]} onToggle={() => toggle(`${i}:${a.title}`)} />
        ))}
      </div>

      {data && total > 0 && completed === total && (
        <GlassCard className="mt-4">
          <div className="flex items-center gap-3 justify-center py-3">
            <Check size={17} style={{ color: C.pos }} />
            <span className="text-[14px] text-textb">Everything on today&apos;s list is done.</span>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

/**
 * The plan takes 30–90s on a local 27B model, so the wait shows the work.
 * Steps 1 and 2 carry REAL figures — the browser reads the same pipeline the
 * server does, so those counts are already known. Steps 3 and 4 advance on a
 * timer: the server does them in that order but reports no progress, and the
 * last step keeps spinning until the answer actually lands.
 */
function BuildSteps({ leads }: { leads: Lead[] }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const a = setTimeout(() => setT(1), 1600);
    const b = setTimeout(() => setT(2), 3800);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  const s = useMemo(() => summarize(leads), [leads]);
  const have = leads.length > 0;

  const steps = [
    { label: 'Reading your pipeline', detail: have ? `${s.total} leads` : '', done: have },
    { label: 'Checking refund windows', detail: have ? `${s.openRefunds} open · ${money(s.openRefundValue)}` : '', done: have && t >= 1 },
    { label: 'Ranking by money at risk', detail: have ? `${s.motion} deals in motion` : '', done: t >= 2 },
    { label: 'Writing today’s plan', detail: '', done: false },
  ];
  const active = steps.findIndex(x => !x.done);

  return (
    <GlassCard className="mb-4">
      <div className="flex flex-col gap-3">
        {steps.map((step, i) => {
          const isActive = i === active;
          const color = step.done ? C.pos : isActive ? C.blue : 'rgba(255,255,255,0.18)';
          return (
            <motion.div key={step.label} className="flex items-center gap-3"
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: step.done || isActive ? 1 : 0.45, x: 0 }}
              transition={{ ...SPRING, delay: i * 0.06 }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border"
                style={{ borderColor: color, background: step.done ? `${C.pos}22` : 'transparent' }}>
                {step.done
                  ? <Check size={11} style={{ color: C.pos }} strokeWidth={3} />
                  : isActive
                    ? <Loader2 size={11} className="animate-spin" style={{ color: C.blue }} />
                    : <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.22)' }} />}
              </span>
              <span className="text-[13px]" style={{ color: step.done || isActive ? '#f5f5f7' : 'rgba(235,235,245,0.35)' }}>
                {step.label}
              </span>
              {step.detail && (
                <span className="text-[11px] rounded-full px-2 py-0.5 ml-auto"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(235,235,245,0.62)' }}>
                  {step.detail}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const size = 54, stroke = 5, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={pct === 1 ? C.pos : C.blue}
          strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ}
          animate={{ strokeDashoffset: circ * (1 - pct) }} transition={SPRING} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`${NUM} text-[13px] text-textb`}>{done}/{total}</span>
      </div>
    </div>
  );
}

function ActionCard({ action, index, done, onToggle }: { action: Action; index: number; done: boolean; onToggle: () => void }) {
  const u = URGENCY[action.urgency] ?? URGENCY.week;
  const k = KIND[action.kind] ?? KIND.admin;
  const Icon = k.icon;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: done ? 0.5 : 1, y: 0 }} transition={{ ...SPRING, delay: index * 0.04 }}>
      <div className="glass rounded-[22px] overflow-hidden relative">
        {/* urgency edge */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: u.color }} />
        <div className="p-5 pl-6">
          <div className="flex items-start gap-3">
            <motion.button whileTap={{ scale: 0.9 }} transition={SPRING} onClick={onToggle}
              className="tap flex-shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center border"
              style={done
                ? { background: C.pos, borderColor: C.pos }
                : { borderColor: 'rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.04)' }}
              title={done ? 'Mark not done' : 'Mark done'}>
              {done && <Check size={13} color="#fff" strokeWidth={3} />}
            </motion.button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: `${u.color}1f`, color: u.color }}>
                  <Icon size={11} /> {u.label}
                </span>
                <span className="text-[11px] text-dimtext">{k.label}</span>
              </div>
              <div className={`text-[16px] font-semibold tracking-[-0.02em] text-textb ${done ? 'line-through' : ''}`}>
                {action.title}
              </div>
              <div className="text-[13px] text-jtext mt-1 leading-relaxed">{action.why}</div>

              {action.people.length > 0 && (
                <div className="flex flex-col gap-2 mt-3.5">
                  {action.people.map((p, i) => <PersonRow key={`${p.name}-${i}`} p={p} />)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function PersonRow({ p }: { p: Person }) {
  const deadline = p.deadlineDays;
  const dColor = deadline == null ? C.dim : deadline <= 2 ? C.urg : deadline <= 7 ? C.warn : C.blue;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-white/[0.05] px-3.5 py-2.5"
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-medium text-textb truncate">{p.name}</span>
          {!p.matched && (
            <span className="text-[10px] rounded px-1.5 py-0.5" style={{ background: `${C.warn}1f`, color: C.warn }}
              title="This name was not found in your pipeline — verify before acting">
              unverified
            </span>
          )}
          {p.stage && <span className="text-[11px] text-dimtext truncate">{p.stage}</span>}
        </div>
        <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
          {p.note && <span className="text-[12px] text-jtext">{p.note}</span>}
          {p.address && (
            <span className="text-[11px] text-dimtext inline-flex items-center gap-1 truncate max-w-[260px]">
              <MapPin size={10} />{p.address}
            </span>
          )}
          {p.daysInCrm != null && <span className="text-[11px] text-dimtext">{p.daysInCrm}d old</span>}
        </div>
      </div>

      {p.amount != null && p.amount > 0 && (
        <span className={`${NUM} text-[13px] flex-shrink-0`} style={{ color: C.warn }}>{money(p.amount)}</span>
      )}
      {deadline != null && (
        deadline >= 0
          ? <span className={`${NUM} text-[14px] flex-shrink-0`} style={{ color: dColor }}>{deadline}d</span>
          : <span className="text-[11px] flex-shrink-0" style={{ color: C.dim }}>window closed</span>
      )}
      {p.phone ? (
        <motion.a whileTap={TAP} transition={SPRING} href={telHref(p.phone)}
          className="press flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium"
          style={{ background: `${C.pos}1f`, color: C.pos, border: `1px solid ${C.pos}3d` }}
          title={p.phone}>
          <PhoneCall size={12} /> Call
        </motion.a>
      ) : (
        <span className="text-[11px] text-dimtext flex-shrink-0">no number</span>
      )}
    </div>
  );
}

// ── Chat: markdown with real charts spliced in ──────────────────────────────

type Part =
  | { type: 'md'; text: string }
  | { type: 'viz' | 'people'; text: string; closed: boolean };

/**
 * Split the answer on ```viz / ```people fences.
 *
 * Done by hand rather than through a remark plugin because this runs on a
 * half-streamed string: an unterminated fence has to render as "still drawing"
 * instead of collapsing the rest of the message into a code block.
 */
function splitBlocks(src: string): Part[] {
  const parts: Part[] = [];
  const open = /```(viz|people)[^\n]*\n/g;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(src))) {
    if (m.index > idx) parts.push({ type: 'md', text: src.slice(idx, m.index) });
    const bodyStart = m.index + m[0].length;
    const close = src.indexOf('```', bodyStart);
    parts.push({
      type: m[1] as 'viz' | 'people',
      text: close === -1 ? src.slice(bodyStart) : src.slice(bodyStart, close),
      closed: close !== -1,
    });
    idx = close === -1 ? src.length : close + 3;
    open.lastIndex = idx;
  }
  if (idx < src.length) {
    // A fence arrives one token at a time, so the tail of a streaming answer
    // is often a bare ``` or ```vi — markdown would render that as a stray
    // code chip that vanishes a moment later. Drop it until it completes.
    parts.push({ type: 'md', text: src.slice(idx).replace(/\n?`{1,3}[a-z]*$/i, '') });
  }
  return parts;
}

const parseBlock = (raw: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(raw.trim());
    return v && typeof v === 'object' ? v as Record<string, unknown> : null;
  } catch { return null; }
};

function Drawing({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-border px-4 py-3 flex items-center gap-2.5"
      style={{ background: 'rgba(255,255,255,0.03)' }}>
      <motion.span className="w-1.5 h-1.5 rounded-full" style={{ background: C.blue }}
        animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity }} />
      <span className="text-[12px] text-dimtext">{label}</span>
    </div>
  );
}

function VizBlock({ raw, closed, leads }: { raw: string; closed: boolean; leads: Lead[] }) {
  const spec = useMemo(() => parseBlock(raw), [raw]);
  const name = typeof spec?.dataset === 'string' ? spec.dataset : '';
  const v = useMemo(() => (name && leads.length ? buildViz(name, leads) : null), [name, leads]);

  if (!closed && !v) return <Drawing label="drawing chart…" />;
  if (!leads.length) return <Drawing label="reading your pipeline…" />;
  if (!v) return <div className="text-[11px] text-dimtext px-1">chart unavailable{name ? ` (${name})` : ''}</div>;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
      className="rounded-2xl border border-border p-4"
      style={{ background: 'rgba(255,255,255,0.045)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-2 mb-3.5">
        <BarChart3 size={13} style={{ color: C.blue }} />
        <span className="text-[13px] font-medium text-textb">{v.title}</span>
      </div>

      {v.empty
        ? <div className="text-[13px] text-jtext">{v.empty}</div>
        : v.kind === 'donut'
          ? <Donut slices={v.slices ?? []} centerValue={v.centerValue ?? ''} centerLabel={v.centerLabel ?? ''} />
          : v.kind === 'tiles'
            ? <Tiles tiles={v.tiles ?? []} />
            : <BarList slices={v.slices ?? []} unit={v.unit} />}

      {v.subtitle && !v.empty && <div className="text-[11px] text-dimtext mt-3.5">{v.subtitle}</div>}
    </motion.div>
  );
}

function PeopleBlock({ raw, closed, leads }: { raw: string; closed: boolean; leads: Lead[] }) {
  const spec = useMemo(() => parseBlock(raw), [raw]);
  const names = useMemo(
    () => (Array.isArray(spec?.names) ? (spec.names as unknown[]).filter((n): n is string => typeof n === 'string') : []),
    [spec],
  );
  const people = useMemo(() => joinPeople(names, leads), [names, leads]);

  if (!closed && !people.length) return <Drawing label="pulling contacts…" />;
  if (!people.length) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
      className="rounded-2xl border border-border p-4"
      style={{ background: 'rgba(255,255,255,0.045)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Users size={13} style={{ color: C.pos }} />
        <span className="text-[13px] font-medium text-textb">
          {typeof spec?.title === 'string' && spec.title ? spec.title : 'People'}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {people.map((p, i) => <PersonRow key={`${p.name}-${i}`} p={p} />)}
      </div>
    </motion.div>
  );
}

function RichAnswer({ content, leads }: { content: string; leads: Lead[] }) {
  const parts = useMemo(() => splitBlocks(content), [content]);
  return (
    <div className="flex flex-col gap-2.5">
      {parts.map((p, i) => {
        if (p.type === 'md') {
          if (!p.text.trim()) return null;
          return (
            <div key={i} className="rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(235,235,245,0.88)' }}>
              <div className="jarvis-content">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{p.text.trim()}</ReactMarkdown>
              </div>
            </div>
          );
        }
        if (p.type === 'viz') return <VizBlock key={i} raw={p.text} closed={p.closed} leads={leads} />;
        return <PeopleBlock key={i} raw={p.text} closed={p.closed} leads={leads} />;
      })}
    </div>
  );
}

// ── The idea gallery: what to ask, with live numbers on the cards ───────────

interface Topic {
  title: string; icon: typeof PhoneCall; color: string;
  badge?: (s: ReturnType<typeof summarize>) => string;
  prompts: string[];
}

const TOPICS: Topic[] = [
  {
    title: 'Money on the table', icon: DollarSign, color: C.pos,
    badge: s => `${money(s.openRefundValue)} recoverable`,
    prompts: [
      'Where is my money actually sitting right now?',
      'Which refund windows close first, and what is each one worth?',
      'How much have I spent on iSpeed versus what I can still claw back?',
    ],
  },
  {
    title: 'Who to call today', icon: PhoneCall, color: C.blue,
    badge: s => `${s.hot} hot leads`,
    prompts: [
      'Who should I call first today, and why them?',
      'Give me a ten-call list ranked by who is closest to saying yes.',
      'Which hot leads have been waiting on me the longest?',
    ],
  },
  {
    title: 'Deals in motion', icon: FileSignature, color: C.warn,
    badge: s => `${s.motion} live`,
    prompts: [
      'Walk me through every deal in motion and where each one is stuck.',
      'Which of these is about to fall out if I do nothing?',
      'What has to happen this week for me to close one of them?',
    ],
  },
  {
    title: 'Pipeline health', icon: Activity, color: C.purple,
    badge: s => `${s.total} leads`,
    prompts: [
      'Show me the shape of my pipeline — where do leads get stuck?',
      'How old is my pipeline, and what is quietly going cold?',
      'Which stage is leaking the most leads?',
    ],
  },
  {
    title: 'Marketing spend', icon: Megaphone, color: C.cyan,
    badge: s => `${money(s.ispeedSpend)} spent`,
    prompts: [
      'Which lead source is actually producing deals?',
      'Is iSpeed worth what I am paying for it?',
      'Where should my next thousand dollars of marketing go?',
    ],
  },
  {
    title: 'The hard questions', icon: Target, color: C.urg,
    prompts: [
      'What am I ignoring that is going to cost me money?',
      'If I could only do three things today, what would they be?',
      'What is standing between me and $100K a month?',
    ],
  },
];

/**
 * Three things worth asking next, shown under the latest answer.
 *
 * One per topic rather than the first three in the list, so the suggestions
 * open different doors instead of three angles on the same one; the starting
 * topic rotates with the length of the conversation. Anything already asked
 * drops out, so the list keeps moving.
 */
function FollowUps({ asked, onPick, disabled }: { asked: Set<string>; onPick: (q: string) => void; disabled?: boolean }) {
  const picks = useMemo(() => {
    const out: { prompt: string; color: string; icon: Topic['icon'] }[] = [];
    const start = asked.size % TOPICS.length;
    for (let i = 0; i < TOPICS.length && out.length < 3; i++) {
      const t = TOPICS[(start + i) % TOPICS.length];
      const prompt = t.prompts.find(p => !asked.has(p));
      if (prompt) out.push({ prompt, color: t.color, icon: t.icon });
    }
    return out;
  }, [asked]);
  if (!picks.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <span className="text-[11px] text-dimtext self-center mr-0.5">Ask next</span>
      {picks.map(p => {
        const Icon = p.icon;
        return (
          <motion.button key={p.prompt} whileTap={TAP} transition={SPRING} disabled={disabled}
            onClick={() => onPick(p.prompt)}
            className="press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] text-jtext hover:text-textb disabled:opacity-40 max-w-full"
            style={{ borderColor: `${p.color}33`, background: `${p.color}12` }}>
            <Icon size={11} style={{ color: p.color }} className="flex-shrink-0" />
            <span className="truncate">{p.prompt}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

function IdeaGallery({ leads, onPick, disabled }: { leads: Lead[]; onPick: (q: string) => void; disabled?: boolean }) {
  const s = useMemo(() => summarize(leads), [leads]);
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(268px, 1fr))' }}>
      {TOPICS.map((t, ti) => {
        const Icon = t.icon;
        return (
          <motion.div key={t.title}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: ti * 0.04 }}
            className="rounded-[18px] border border-border p-3.5"
            style={{ background: 'rgba(255,255,255,0.04)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${t.color}1f`, border: `1px solid ${t.color}33` }}>
                <Icon size={14} style={{ color: t.color }} />
              </span>
              <span className="text-[13px] font-medium text-textb">{t.title}</span>
              {t.badge && leads.length > 0 && (
                <span className="ml-auto text-[10px] rounded-full px-2 py-0.5 whitespace-nowrap"
                  style={{ background: `${t.color}18`, color: t.color }}>{t.badge(s)}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {t.prompts.map(p => (
                <motion.button key={p} whileTap={TAP} transition={SPRING} disabled={disabled}
                  onClick={() => onPick(p)}
                  className="press group text-left rounded-xl px-2.5 py-2 text-[12.5px] text-jtext hover:bg-white/[0.07] hover:text-textb leading-snug flex items-start gap-1.5 disabled:opacity-40">
                  <ChevronRight size={13} className="mt-0.5 flex-shrink-0 opacity-40 group-hover:opacity-100"
                    style={{ color: t.color }} />
                  <span>{p}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function ChatView({ online, models, model, setModel, leads }: {
  online: boolean | null; models: { name: string; size: string }[]; model: string;
  setModel: (m: string) => void; leads: Lead[];
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [think, setThink] = useState(false);
  const [openThink, setOpenThink] = useState<Record<number, boolean>>({});
  const [showIdeas, setShowIdeas] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // `hydrated` is state, not a ref: the restore and the flag land in the same
  // commit, so the persist effect below never fires with the empty initial
  // array and wipe the saved conversation on mount.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(CHAT_KEY); if (raw) setMessages(JSON.parse(raw)); } catch { /* ignore */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40))); } catch { /* ignore */ }
  }, [messages, hydrated]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  const stop = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); }, []);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setErr(''); setInput(''); setShowIdeas(false);
    const outgoing: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages([...outgoing, { role: 'assistant', content: '' }]);
    setBusy(true);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const res = await fetch('/api/jarvis/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: outgoing.map(m => ({ role: m.role, content: m.content })), model, think }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = '', content = '', thinking = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          const s = line.trim(); if (!s) continue;
          let j: { message?: { content?: string; thinking?: string }; error?: string };
          try { j = JSON.parse(s); } catch { continue; }
          if (j.error) throw new Error(j.error);
          content += j.message?.content ?? '';
          thinking += j.message?.thinking ?? '';
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { role: 'assistant', content, thinking: thinking || undefined };
            return next;
          });
        }
      }
      if (!content.trim() && !thinking.trim()) throw new Error('The model returned nothing. Try again or pick another model.');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setMessages(prev => prev.filter(m => m.content.trim() || m.thinking?.trim()));
      } else { setErr((e as Error).message); setMessages(prev => prev.slice(0, -1)); }
    } finally { setBusy(false); abortRef.current = null; }
  }, [busy, messages, model, think]);

  const clear = () => { setMessages([]); setErr(''); try { localStorage.removeItem(CHAT_KEY); } catch {} };

  const asked = useMemo(
    () => new Set(messages.filter(m => m.role === 'user').map(m => m.content.trim())),
    [messages],
  );

  return (
    <GlassCard padding="" className="flex-1 min-h-0 flex flex-col" hover={false}>
      {/* controls */}
      <div className="flex items-center gap-2 px-5 pt-4 flex-wrap flex-shrink-0">
        {models.length > 1 && (
          <div className="relative">
            <select value={model} onChange={e => setModel(e.target.value)} disabled={busy}
              className="appearance-none rounded-full border border-border bg-white/[0.06] pl-3 pr-8 py-1.5 text-[12px] text-jtext hover:text-textb outline-none cursor-pointer disabled:opacity-50">
              {models.map(m => <option key={m.name} value={m.name}>{m.name}{m.size ? ` · ${m.size}` : ''}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-dimtext" />
          </div>
        )}
        <motion.button whileTap={TAP} transition={SPRING} onClick={() => setThink(t => !t)} disabled={busy}
          className="press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] disabled:opacity-50"
          style={think ? { borderColor: `${C.purple}55`, background: `${C.purple}1a`, color: C.purple }
                       : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.06)', color: 'rgba(235,235,245,0.62)' }}>
          <Brain size={12} /> Reasoning {think ? 'on' : 'off'}
        </motion.button>

        {messages.length > 0 && (
          <>
            <motion.button whileTap={TAP} transition={SPRING} onClick={() => setShowIdeas(v => !v)}
              className="press ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px]"
              style={showIdeas ? { borderColor: `${C.blue}55`, background: `${C.blue}1a`, color: C.blue }
                               : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.06)', color: 'rgba(235,235,245,0.62)' }}>
              <Sparkles size={12} /> Ideas
            </motion.button>
            <motion.button whileTap={TAP} transition={SPRING} onClick={clear}
              className="press inline-flex items-center gap-1.5 rounded-full border border-border bg-white/[0.06] px-3 py-1.5 text-[12px] text-jtext hover:text-textb">
              <Trash2 size={12} /> Clear
            </motion.button>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-5 py-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: `${C.blue}1a`, border: `1px solid ${C.blue}33` }}>
              <Cpu size={24} style={{ color: C.blue }} />
            </div>
            <div className="text-center">
              <div className="text-[17px] font-semibold text-textb tracking-[-0.02em]">Ask about your business</div>
              <div className="text-[13px] text-dimtext mt-1.5 max-w-md">
                Answers come back with real charts drawn from your live pipeline. Your hardware, your data, nothing leaves this Mac.
              </div>
            </div>
            <div className="w-full">
              <IdeaGallery leads={leads} onPick={send} disabled={online === false} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <AnimatePresence initial={false}>
              {showIdeas && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden">
                  <IdeaGallery leads={leads} onPick={send} disabled={online === false || busy} />
                </motion.div>
              )}
            </AnimatePresence>

            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={m.role === 'user' ? 'max-w-[80%]' : 'max-w-[95%] w-full'}>
                  {m.role === 'assistant' && m.thinking && (
                    <button onClick={() => setOpenThink(o => ({ ...o, [i]: !o[i] }))}
                      className="tap mb-2 inline-flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1"
                      style={{ background: `${C.purple}14`, color: C.purple }}>
                      <Brain size={11} />{openThink[i] ? 'Hide reasoning' : 'Show reasoning'}
                      <ChevronDown size={11} style={{ transform: openThink[i] ? 'rotate(180deg)' : 'none', transition: '.2s' }} />
                    </button>
                  )}
                  <AnimatePresence initial={false}>
                    {m.role === 'assistant' && m.thinking && openThink[i] && (
                      <motion.pre initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="mb-2 overflow-hidden whitespace-pre-wrap text-[12px] leading-relaxed rounded-xl p-3 text-dimtext"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', fontFamily: 'inherit' }}>
                        {m.thinking.trim()}
                      </motion.pre>
                    )}
                  </AnimatePresence>

                  {m.role === 'user' ? (
                    <div className="rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
                      style={{ background: `${C.blue}22`, border: `1px solid ${C.blue}3d`, color: '#f5f5f7' }}>
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    </div>
                  ) : m.content ? (
                    <div className="flex flex-col gap-2.5">
                      <RichAnswer content={m.content} leads={leads} />
                      {!busy && i === messages.length - 1 && (
                        <FollowUps asked={asked} onPick={send} disabled={online === false} />
                      )}
                    </div>
                  ) : null}

                  {busy && i === messages.length - 1 && m.role === 'assistant' && !m.content && (
                    <div className="flex items-center gap-2 text-[12px] text-dimtext mt-1.5 px-1">
                      <motion.span className="w-1.5 h-1.5 rounded-full" style={{ background: C.blue }}
                        animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity }} />
                      {think ? 'reasoning…' : 'reading your pipeline…'}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {err && (
        <div className="mx-5 mb-3 rounded-xl px-3.5 py-2.5 text-[12px] flex-shrink-0"
          style={{ background: `${C.urg}14`, border: `1px solid ${C.urg}33`, color: '#ff8a80' }}>{err}</div>
      )}

      <div className="border-t border-border p-4 flex-shrink-0">
        <div className="flex items-end gap-2.5">
          <textarea rows={1} value={input} disabled={online === false}
            placeholder={online === false ? 'Start Ollama to chat…' : 'Ask about your pipeline, deals, or what to do next…'}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 168) + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            className="flex-1 resize-none bg-transparent text-[14px] text-textb placeholder:text-dimtext outline-none max-h-[168px] leading-relaxed disabled:opacity-50" />
          {busy ? (
            <motion.button whileTap={TAP} transition={SPRING} onClick={stop}
              className="press flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: `${C.urg}22`, border: `1px solid ${C.urg}44`, color: C.urg }}><Square size={13} /></motion.button>
          ) : (
            <motion.button whileTap={TAP} transition={SPRING} onClick={() => send(input)} disabled={!input.trim() || online === false}
              className="press flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-30"
              style={{ background: input.trim() ? C.blue : 'rgba(255,255,255,0.08)', color: input.trim() ? '#fff' : 'rgba(235,235,245,0.4)' }}><ArrowUp size={15} /></motion.button>
          )}
        </div>
        <div className="text-[11px] text-dimtext mt-2">Enter to send · Shift+Enter for a new line · runs locally</div>
      </div>
    </GlassCard>
  );
}
