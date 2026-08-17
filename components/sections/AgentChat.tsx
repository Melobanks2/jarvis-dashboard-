'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import {
  ArrowUp, Brain, ChevronDown, Cpu, Square, Trash2, AlertTriangle, Sparkles,
  PhoneCall, Receipt, FileSignature, Clock, ListChecks, RefreshCw, Check, MapPin,
} from 'lucide-react';
import { GlassCard, GlassPill } from '@/components/ui/GlassCard';

// Talks only to the Ollama instance on this MacBook, via /api/agent-chat.

const C = { blue: '#0a84ff', pos: '#30d158', urg: '#ff453a', warn: '#ff9f0a', purple: '#bf5af2', dim: 'rgba(235,235,245,0.35)' };
const SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const;
const TAP = { scale: 0.97 };
const NUM = 'font-orbitron font-semibold';

const CHAT_KEY = 'jarvis_agentchat_v1';
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

interface Person {
  name: string; note?: string; matched: boolean;
  phone: string | null; stage: string | null; address: string | null;
  daysInCrm: number | null; deadlineDays: number | null; amount: number | null;
}
interface Action { title: string; kind: string; urgency: string; why: string; people: Person[]; }
interface Briefing {
  headline: string; actions: Action[]; generatedAt: string; model: string;
  stats: { leads: number; refundSoon: number; refundSoonValue: number; inMotion: number; staleHot: number; freshNew: number };
}
interface Msg { role: 'user' | 'assistant'; content: string; thinking?: string; }

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`;

export function AgentChat() {
  const [mode, setMode] = useState<'today' | 'chat'>('today');
  const [models, setModels] = useState<{ name: string; size: string }[]>([]);
  const [model, setModel] = useState('');
  const [online, setOnline] = useState<boolean | null>(null);
  const [host, setHost] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/agent-chat').then(r => r.json()).then(d => {
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
        ? <TodayBriefing online={online} />
        : <ChatView online={online} models={models} model={model} setModel={setModel} />}
    </div>
  );
}

// ── Today: the visual action board ──────────────────────────────────────────

function TodayBriefing({ online }: { online: boolean | null }) {
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
      const res = await fetch('/api/agent-chat/briefing', { method: 'POST' });
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

      {loading && !data && (
        <GlassCard>
          <div className="flex items-center gap-3 py-6 justify-center">
            <motion.span className="w-2 h-2 rounded-full" style={{ background: C.blue }}
              animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity }} />
            <span className="text-[13px] text-jtext">Reading your pipeline and building today&apos;s plan…</span>
          </div>
        </GlassCard>
      )}

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

// ── Chat: same conversation, now rendered as markdown ───────────────────────

const SUGGESTIONS = [
  'Which refunds are about to expire?',
  'Summarize my hot leads and what is stalling them',
  'Where is my money actually sitting right now?',
];

function ChatView({ online, models, model, setModel }: {
  online: boolean | null; models: { name: string; size: string }[]; model: string; setModel: (m: string) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [think, setThink] = useState(false);
  const [openThink, setOpenThink] = useState<Record<number, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { const raw = localStorage.getItem(CHAT_KEY); if (raw) setMessages(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40))); } catch { /* ignore */ }
  }, [messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  const stop = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); }, []);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setErr(''); setInput('');
    const outgoing: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages([...outgoing, { role: 'assistant', content: '' }]);
    setBusy(true);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const res = await fetch('/api/agent-chat', {
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

  return (
    <GlassCard padding="" className="flex-1 min-h-0 flex flex-col">
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
          <motion.button whileTap={TAP} transition={SPRING} onClick={clear}
            className="press ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-white/[0.06] px-3 py-1.5 text-[12px] text-jtext hover:text-textb">
            <Trash2 size={12} /> Clear
          </motion.button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-5 py-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: `${C.blue}1a`, border: `1px solid ${C.blue}33` }}>
              <Cpu size={24} style={{ color: C.blue }} />
            </div>
            <div>
              <div className="text-[17px] font-semibold text-textb tracking-[-0.02em]">Ask anything</div>
              <div className="text-[13px] text-dimtext mt-1.5 max-w-sm">
                Your own hardware, your live pipeline as context. Nothing leaves this machine.
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-md">
              {SUGGESTIONS.map(s => (
                <motion.button key={s} whileTap={TAP} transition={SPRING} onClick={() => send(s)} disabled={online === false}
                  className="press text-left rounded-xl border border-border bg-white/[0.05] px-4 py-2.5 text-[13px] text-jtext hover:bg-white/10 hover:text-textb disabled:opacity-40">
                  <Sparkles size={12} className="inline mr-2 -mt-px" style={{ color: C.blue }} />{s}
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={m.role === 'user' ? 'max-w-[80%]' : 'max-w-[90%] w-full'}>
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

                  {(m.content || m.role === 'user') && (
                    <div className="rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
                      style={m.role === 'user'
                        ? { background: `${C.blue}22`, border: `1px solid ${C.blue}3d`, color: '#f5f5f7' }
                        : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(235,235,245,0.88)' }}>
                      {m.role === 'assistant'
                        ? <div className="jarvis-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{m.content}</ReactMarkdown>
                          </div>
                        : <span className="whitespace-pre-wrap">{m.content}</span>}
                    </div>
                  )}

                  {busy && i === messages.length - 1 && m.role === 'assistant' && !m.content && (
                    <div className="flex items-center gap-2 text-[12px] text-dimtext mt-1.5 px-1">
                      <motion.span className="w-1.5 h-1.5 rounded-full" style={{ background: C.blue }}
                        animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity }} />
                      {think ? 'reasoning…' : 'thinking…'}
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
