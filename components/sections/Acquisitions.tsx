'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, PhoneCall, ThumbsUp, Pencil, Flame, Zap, Snowflake,
  CalendarClock, XCircle, MapPin, DollarSign, Home, Clock, FileText, Trophy, RotateCcw,
  ScrollText, ListChecks,
} from 'lucide-react';
import { ScriptGuide } from './ScriptGuide';
import { AcqLists } from './AcqLists';
import { DIALER_API } from '@/lib/config';

// Personal power-dialer backend (served by the VPS, like the Leads board).
const ACQ_API = `${DIALER_API}/dialer/personal`;
const STORE_KEY = 'acq_session_id';

type Outcome = 'hot' | 'warm' | 'cold' | 'callback' | 'not_interested';

interface Tier { key: string; label: string; total: number; done: number }
interface Card {
  name?: string; phone?: string; address?: string; tier?: string; pipeline?: string;
  motivation?: string; askingPrice?: string; occupancy?: string; ownership?: string;
  mortgage?: string; timeline?: string; enriching?: boolean;
  notes?: { body: string; at?: string }[];
  attempts?: { body: string; at?: string }[];
}
interface Proposal { outcome: Outcome | null; note: string; manual?: boolean; transcript?: string; lead?: any; at?: string }
interface State {
  sessionId: string;
  status: 'idle' | 'dialing' | 'connected' | 'review' | 'paused' | 'ended' | 'unknown';
  tiers: Tier[];
  currentTier: string | null;
  totalDone: number;
  total: number;
  remaining: number;
  card: Card | null;
  proposal: Proposal | null;
  summary: Record<string, number>;
}

const PIPELINES = [
  { key: 'all', label: 'All' },
  { key: 'ispeed', label: 'iSpeed' },
  { key: 'va_leads', label: 'VA Leads' },
];
const TIER_OPTIONS = [
  { key: 'callbacks', label: 'Callbacks Due' },
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cold', label: 'Cold' },
];

const OUTCOMES: { key: Outcome; label: string; color: string; Icon: React.ElementType }[] = [
  { key: 'hot',            label: 'Hot',            color: '#ff453a', Icon: Flame },
  { key: 'warm',           label: 'Warm',           color: '#ff9f0a', Icon: Zap },
  { key: 'cold',           label: 'Cold',           color: '#0a84ff', Icon: Snowflake },
  { key: 'callback',       label: 'Callback',       color: '#bf5af2', Icon: CalendarClock },
  { key: 'not_interested', label: 'Not Interested', color: '#71717a', Icon: XCircle },
];

function Bar({ done, total, color, height = 8 }: { done: number; total: number; color: string; height?: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)', height }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 22 }}
      />
    </div>
  );
}

export function Acquisitions() {
  const [view, setView] = useState<'dialer' | 'lists' | 'script'>('dialer');
  const [pipeline, setPipeline] = useState('all');
  const [tiers, setTiers] = useState<string[]>(['callbacks', 'hot', 'warm']);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // outcome-review editing
  const [editOutcome, setEditOutcome] = useState<Outcome | null>(null);
  const [editNote, setEditNote] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // restore an in-progress session across refreshes
  useEffect(() => {
    const sid = typeof window !== 'undefined' ? window.localStorage.getItem(STORE_KEY) : null;
    if (sid) setSessionId(sid);
  }, []);

  const poll = useCallback(async (sid: string) => {
    try {
      const r = await fetch(`${ACQ_API}/state?sessionId=${encodeURIComponent(sid)}`);
      if (r.status === 404) { setState(null); setSessionId(null); window.localStorage.removeItem(STORE_KEY); return; }
      const j = await r.json();
      setState(j);
    } catch { /* transient — keep last state */ }
  }, []);

  // poll loop while a session is live
  useEffect(() => {
    if (!sessionId) return;
    poll(sessionId);
    pollRef.current = setInterval(() => poll(sessionId), 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sessionId, poll]);

  // seed the edit fields whenever a fresh proposal lands
  useEffect(() => {
    if (state?.proposal) {
      setEditOutcome(state.proposal.outcome ?? null);
      setEditNote(state.proposal.note ?? '');
    }
  }, [state?.proposal?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTier = (k: string) =>
    setTiers(t => (t.includes(k) ? t.filter(x => x !== k) : [...t, k]));

  async function start() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${ACQ_API}/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline, tiers }),
      });
      const j = await r.json();
      if (!j.ok) { setMsg(j.message || j.error || 'Could not start'); return; }
      window.localStorage.setItem(STORE_KEY, j.sessionId);
      setSessionId(j.sessionId);
    } catch (e: any) { setMsg(e?.message || 'Network error'); }
    finally { setBusy(false); }
  }

  async function pause() {
    if (!sessionId) return;
    setBusy(true);
    await fetch(`${ACQ_API}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).catch(() => {});
    await poll(sessionId); setBusy(false);
  }
  async function resume() {
    if (!sessionId) return;
    setBusy(true);
    const r = await fetch(`${ACQ_API}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).then(r => r.json()).catch(() => ({}));
    if (r && r.ok === false) setMsg(r.message || r.error || 'Could not resume');
    await poll(sessionId); setBusy(false);
  }

  async function approve() {
    if (!sessionId) return;
    setBusy(true);
    await fetch(`${ACQ_API}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, disposition: editOutcome || 'cold', note: editNote }),
    }).catch(() => {});
    await poll(sessionId); setBusy(false);
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    window.localStorage.removeItem(STORE_KEY);
    setSessionId(null); setState(null); setMsg(null);
  }

  // A dial list was loaded from the Lists tab → take over the Live Dialer.
  function handleListSession(sid: string) {
    window.localStorage.setItem(STORE_KEY, sid);
    setSessionId(sid);
    setView('dialer');
  }

  const status = state?.status ?? (sessionId ? 'unknown' : 'idle');

  return (
    <div className="leads-clean flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-bold text-textb flex items-center gap-2">
            <PhoneOutgoingDot /> Acquisitions
          </h2>
          <p className="text-[11px] text-dimtext">Press play and work your leads — Sarah qualifies, you close.</p>
        </div>
        {view === 'dialer' && state && status !== 'idle' && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-dimtext">Session progress</div>
            <div className="text-[18px] font-bold text-ngreen">{state.totalDone}<span className="text-dimtext text-[12px]">/{state.total}</span></div>
          </div>
        )}
      </div>

      {/* View tabs */}
      <div className="flex gap-2">
        {([
          { key: 'dialer', label: 'Live Dialer', Icon: PhoneCall },
          { key: 'lists',  label: 'Lists',       Icon: ListChecks },
          { key: 'script', label: 'My Script',   Icon: ScrollText },
        ] as const).map(t => {
          const on = view === t.key;
          const { Icon } = t;
          return (
            <button key={t.key} onClick={() => setView(t.key)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12px] font-semibold transition-all"
              style={on
                ? { background: 'rgba(48,209,88,0.15)', color: '#30d158', border: '1px solid rgba(48,209,88,0.4)' }
                : { background: 'rgba(255,255,255,0.03)', color: '#71717a', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {view === 'script' && <ScriptGuide />}

      {view === 'lists' && <AcqLists onSessionStarted={handleListSession} />}

      {view === 'dialer' && msg && <div className="text-[11px] px-3 py-2 rounded-sm" style={{ background: 'rgba(255,69,58,0.08)', color: '#ff453a', border: '1px solid rgba(255,69,58,0.2)' }}>{msg}</div>}

      {/* ── IDLE: pick filters + Play ── */}
      {view === 'dialer' && status === 'idle' && (
        <SetupCard
          pipeline={pipeline} setPipeline={setPipeline}
          tiers={tiers} toggleTier={toggleTier}
          busy={busy} onStart={start}
        />
      )}

      {/* ── ACTIVE SESSION ── */}
      {view === 'dialer' && state && status !== 'idle' && (
        <>
          <ProgressPanel state={state} status={status} onPause={pause} onResume={resume} busy={busy} />

          <AnimatePresence mode="wait">
            {status === 'connected' && state.card && (
              <motion.div key="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <LeadCard card={state.card} />
              </motion.div>
            )}

            {status === 'review' && state.proposal && (
              <motion.div key="review" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <ReviewCard
                  proposal={state.proposal}
                  editOutcome={editOutcome} setEditOutcome={setEditOutcome}
                  editNote={editNote} setEditNote={setEditNote}
                  busy={busy} onApprove={approve}
                />
              </motion.div>
            )}

            {status === 'ended' && (
              <motion.div key="end" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <SummaryCard state={state} onReset={reset} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

function PhoneOutgoingDot() {
  return (
    <span className="inline-flex w-6 h-6 rounded-md items-center justify-center" style={{ background: 'rgba(48,209,88,0.14)', border: '1px solid rgba(48,209,88,0.3)' }}>
      <PhoneCall size={13} style={{ color: '#30d158' }} />
    </span>
  );
}

function SetupCard({ pipeline, setPipeline, tiers, toggleTier, busy, onStart }: {
  pipeline: string; setPipeline: (s: string) => void;
  tiers: string[]; toggleTier: (k: string) => void;
  busy: boolean; onStart: () => void;
}) {
  return (
    <div className="rounded-lg p-6 flex flex-col gap-5" style={{ background: 'rgba(12,12,24,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div>
        <div className="text-[11px] uppercase tracking-wider text-dimtext mb-2">Pipeline</div>
        <div className="flex gap-2">
          {PIPELINES.map(p => (
            <button key={p.key} onClick={() => setPipeline(p.key)}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
              style={pipeline === p.key
                ? { background: 'rgba(48,209,88,0.15)', color: '#30d158', border: '1px solid rgba(48,209,88,0.4)' }
                : { background: 'rgba(255,255,255,0.03)', color: '#c4c4d6', border: '1px solid rgba(255,255,255,0.08)' }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wider text-dimtext mb-2">Tiers to work (in order)</div>
        <div className="flex gap-2 flex-wrap">
          {TIER_OPTIONS.map(t => {
            const on = tiers.includes(t.key);
            return (
              <button key={t.key} onClick={() => toggleTier(t.key)}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
                style={on
                  ? { background: 'rgba(10,132,255,0.14)', color: '#0a84ff', border: '1px solid rgba(10,132,255,0.4)' }
                  : { background: 'rgba(255,255,255,0.03)', color: '#71717a', border: '1px solid rgba(255,255,255,0.08)' }}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <button
        onClick={onStart}
        disabled={busy || tiers.length === 0}
        className="self-start flex items-center gap-2 px-6 py-3 rounded-lg text-[14px] font-bold transition-all disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg,#30d158,#30d158)', color: '#06140b', boxShadow: '0 6px 24px rgba(48,209,88,0.3)' }}>
        <Play size={16} fill="#06140b" /> {busy ? 'Pulling leads…' : 'Play'}
      </button>
    </div>
  );
}

function ProgressPanel({ state, status, onPause, onResume, busy }: {
  state: State; status: string; onPause: () => void; onResume: () => void; busy: boolean;
}) {
  const statusLabel: Record<string, string> = {
    dialing: 'Dialing — working the queue', connected: 'On a live call', review: 'Review the call outcome',
    paused: 'Paused', ended: 'Session complete', unknown: 'Loading…',
  };
  const statusColor: Record<string, string> = {
    dialing: '#30d158', connected: '#ff9f0a', review: '#bf5af2', paused: '#71717a', ended: '#30d158', unknown: '#71717a',
  };
  return (
    <div className="rounded-lg p-5 flex flex-col gap-4" style={{ background: 'rgba(12,12,24,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: statusColor[status], boxShadow: `0 0 8px ${statusColor[status]}` }} />
          <span className="text-[12px] font-semibold" style={{ color: statusColor[status] }}>{statusLabel[status] || status}</span>
        </div>
        {(status === 'dialing' || status === 'connected') && (
          <button onClick={onPause} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#c4c4d6', border: '1px solid rgba(255,255,255,0.1)' }}>
            <Pause size={12} /> Pause
          </button>
        )}
        {status === 'paused' && (
          <button onClick={onResume} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold disabled:opacity-50"
            style={{ background: 'rgba(48,209,88,0.15)', color: '#30d158', border: '1px solid rgba(48,209,88,0.4)' }}>
            <Play size={12} fill="#30d158" /> Resume
          </button>
        )}
      </div>

      {/* Total bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[10px] text-dimtext"><span>Total</span><span>{state.totalDone}/{state.total}</span></div>
        <Bar done={state.totalDone} total={state.total} color="#30d158" height={10} />
      </div>

      {/* Per-tier bars */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {state.tiers.map(t => {
          const active = state.currentTier === t.key;
          return (
            <div key={t.key} className="flex flex-col gap-1.5 rounded-md p-2.5"
              style={{ background: active ? 'rgba(10,132,255,0.06)' : 'transparent', border: active ? '1px solid rgba(10,132,255,0.25)' : '1px solid transparent' }}>
              <div className="flex justify-between text-[11px]">
                <span style={{ color: active ? '#0a84ff' : '#c4c4d6', fontWeight: active ? 700 : 500 }}>
                  {t.label}{active && ' ←'}
                </span>
                <span className="text-dimtext">{t.done}/{t.total}</span>
              </div>
              <Bar done={t.done} total={t.total} color={active ? '#0a84ff' : '#52526e'} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeadCard({ card }: { card: Card }) {
  const Field = ({ Icon, label, value }: { Icon: React.ElementType; label: string; value?: string }) =>
    value ? (
      <div className="flex items-start gap-2">
        <Icon size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#30d158' }} />
        <div>
          <div className="text-[9px] uppercase tracking-wider text-dimtext">{label}</div>
          <div className="text-[12px] text-textb">{value}</div>
        </div>
      </div>
    ) : null;

  return (
    <div className="rounded-lg p-5 flex flex-col gap-4" style={{ background: 'rgba(20,16,8,0.7)', border: '1px solid rgba(255,159,10,0.3)' }}>
      <div className="flex items-center gap-2">
        <PhoneCall size={15} style={{ color: '#ff9f0a' }} className="animate-pulse" />
        <span className="text-[10px] uppercase tracking-wider" style={{ color: '#ff9f0a' }}>Live call — talk now</span>
      </div>
      <div>
        <div className="text-[20px] font-bold text-textb">{card.name || 'Unknown caller'}</div>
        <div className="text-[12px] text-dimtext">{card.phone}{card.tier ? ` · ${card.tier}` : ''}{card.pipeline ? ` · ${card.pipeline}` : ''}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field Icon={MapPin} label="Address" value={card.address} />
        <Field Icon={DollarSign} label="Asking" value={card.askingPrice} />
        <Field Icon={Flame} label="Motivation" value={card.motivation} />
        <Field Icon={Home} label="Occupancy" value={card.occupancy} />
        <Field Icon={Clock} label="Timeline" value={card.timeline} />
        <Field Icon={FileText} label="Mortgage" value={card.mortgage} />
      </div>
      {card.enriching && <div className="text-[10px] text-dimtext italic">Loading CRM details…</div>}
      {card.attempts && card.attempts.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-dimtext mb-1">Attempt history</div>
          <div className="flex flex-col gap-1">
            {card.attempts.slice(0, 4).map((n, i) => (
              <div key={i} className="text-[11px] text-jtext truncate">• {n.body}</div>
            ))}
          </div>
        </div>
      )}
      {card.notes && card.notes.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-dimtext mb-1">Recent notes</div>
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
            {card.notes.slice(0, 4).map((n, i) => (
              <div key={i} className="text-[11px] text-jtext">{n.body}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ proposal, editOutcome, setEditOutcome, editNote, setEditNote, busy, onApprove }: {
  proposal: Proposal;
  editOutcome: Outcome | null; setEditOutcome: (o: Outcome) => void;
  editNote: string; setEditNote: (s: string) => void;
  busy: boolean; onApprove: () => void;
}) {
  return (
    <div className="rounded-lg p-5 flex flex-col gap-4" style={{ background: 'rgba(16,12,24,0.75)', border: '1px solid rgba(191,90,242,0.3)' }}>
      <div className="flex items-center gap-2">
        <Pencil size={14} style={{ color: '#bf5af2' }} />
        <span className="text-[10px] uppercase tracking-wider" style={{ color: '#bf5af2' }}>
          {proposal.manual ? 'Log the outcome' : 'AI suggested — approve or edit'}
        </span>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-dimtext mb-2">Outcome</div>
        <div className="flex gap-2 flex-wrap">
          {OUTCOMES.map(o => {
            const on = editOutcome === o.key;
            const { Icon } = o;
            return (
              <button key={o.key} onClick={() => setEditOutcome(o.key)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-medium transition-all"
                style={on
                  ? { background: `${o.color}22`, color: o.color, border: `1px solid ${o.color}` }
                  : { background: 'rgba(255,255,255,0.03)', color: '#71717a', border: '1px solid rgba(255,255,255,0.08)' }}>
                <Icon size={13} /> {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-dimtext mb-2">CRM note</div>
        <textarea
          value={editNote} onChange={e => setEditNote(e.target.value)}
          rows={4} placeholder="What happened on the call…"
          className="w-full rounded-md p-3 text-[12px] text-textb resize-y"
          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }}
        />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onApprove} disabled={busy || !editOutcome}
          className="flex items-center gap-2 px-5 py-2.5 rounded-md text-[13px] font-bold disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#30d158,#30d158)', color: '#06140b' }}>
          <ThumbsUp size={14} /> {busy ? 'Saving…' : 'Approve & continue'}
        </button>
        <span className="text-[10px] text-dimtext">Logs the note + moves the lead in GHL, then dials the next.</span>
      </div>
    </div>
  );
}

function SummaryCard({ state, onReset }: { state: State; onReset: () => void }) {
  const s = state.summary || {};
  const cells = [
    { key: 'hot', label: 'Hot', color: '#ff453a' },
    { key: 'warm', label: 'Warm', color: '#ff9f0a' },
    { key: 'cold', label: 'Cold', color: '#0a84ff' },
    { key: 'callback', label: 'Callbacks', color: '#bf5af2' },
    { key: 'not_interested', label: 'Not Int.', color: '#71717a' },
    { key: 'contacted', label: 'Total talked', color: '#30d158' },
  ];
  return (
    <div className="rounded-lg p-6 flex flex-col gap-5" style={{ background: 'rgba(8,16,11,0.8)', border: '1px solid rgba(48,209,88,0.3)' }}>
      <div className="flex items-center gap-2">
        <Trophy size={18} style={{ color: '#30d158' }} />
        <span className="text-[14px] font-bold text-textb">Session complete — nice work</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {cells.map(c => (
          <div key={c.key} className="rounded-md p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${c.color}33` }}>
            <div className="text-[22px] font-bold" style={{ color: c.color }}>{s[c.key] || 0}</div>
            <div className="text-[9px] uppercase tracking-wider text-dimtext">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-dimtext">Cleared {state.totalDone} of {state.total} leads across {state.tiers.length} tiers.</div>
      <button onClick={onReset} className="self-start flex items-center gap-2 px-4 py-2 rounded-md text-[12px] font-medium"
        style={{ background: 'rgba(48,209,88,0.12)', color: '#30d158', border: '1px solid rgba(48,209,88,0.35)' }}>
        <RotateCcw size={13} /> Start a new session
      </button>
    </div>
  );
}
