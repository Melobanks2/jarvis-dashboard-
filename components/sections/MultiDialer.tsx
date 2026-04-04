'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, PhoneOff, Upload, Play, Pause, Square,
  CheckCircle, Flame, Snowflake, AlertCircle, RotateCcw,
  User, MapPin, FileText, Clock, TrendingUp, Zap,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Lead {
  name: string;
  phone: string;
  address: string;
  notes: string;
}

type Disposition = 'hot' | 'warm' | 'cold' | 'no_answer' | 'wrong_number' | 'refund';
type DialerState = 'idle' | 'dialing' | 'connecting' | 'connected' | 'disposition' | 'paused';

interface Stats {
  callsMade: number;
  contacted: number;
  hot: number;
  totalSeconds: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseCSV(text: string): Lead[] {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const col = (h: string[], ...names: string[]) => {
    for (const n of names) {
      const i = h.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const nameIdx    = col(header, 'name', 'full name', 'contact');
  const phoneIdx   = col(header, 'phone', 'phone number', 'mobile', 'cell');
  const addressIdx = col(header, 'address', 'property address', 'street');
  const notesIdx   = col(header, 'notes', 'note', 'comments');

  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return {
      name:    nameIdx    !== -1 ? cells[nameIdx]    || '' : cells[0] || '',
      phone:   phoneIdx   !== -1 ? cells[phoneIdx]   || '' : cells[1] || '',
      address: addressIdx !== -1 ? cells[addressIdx] || '' : cells[2] || '',
      notes:   notesIdx   !== -1 ? cells[notesIdx]   || '' : cells[3] || '',
    };
  }).filter(l => l.phone);
}

function fmtDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function genSessionId() {
  return `dialer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Disposition config ─────────────────────────────────────────────────────────

const DISPOSITIONS: { id: Disposition; label: string; color: string; icon: React.ElementType }[] = [
  { id: 'hot',          label: 'Hot',          color: '#ff3366', icon: Flame       },
  { id: 'warm',         label: 'Warm',         color: '#ff8800', icon: TrendingUp  },
  { id: 'cold',         label: 'Cold',         color: '#60a5fa', icon: Snowflake   },
  { id: 'no_answer',    label: 'No Answer',    color: '#52526e', icon: PhoneOff    },
  { id: 'wrong_number', label: 'Wrong Number', color: '#fbbf24', icon: AlertCircle },
  { id: 'refund',       label: 'Refund',       color: '#a78bfa', icon: RotateCcw   },
];

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-1"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="text-[8px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>{label}</div>
      <div className="text-[22px] font-orbitron font-black" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px]" style={{ color: '#52526e' }}>{sub}</div>}
    </div>
  );
}

// ── Lead card (shown during call) ─────────────────────────────────────────────

function LeadCard({ lead, timer, state }: { lead: Lead; timer: number; state: DialerState }) {
  const stateColors: Record<DialerState, string> = {
    idle: '#52526e', dialing: '#fbbf24', connecting: '#ff8800',
    connected: '#4ade80', disposition: '#a78bfa', paused: '#52526e',
  };
  const stateLabels: Record<DialerState, string> = {
    idle: 'Idle', dialing: 'Dialing…', connecting: 'Connecting to you…',
    connected: 'Live', disposition: 'Call Ended', paused: 'Paused',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5"
      style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${stateColors[state]}33` }}
    >
      {/* Status bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: stateColors[state],
              boxShadow: state === 'connected' ? `0 0 8px ${stateColors[state]}` : 'none',
              animation: state === 'dialing' ? 'pulse 1s infinite' : 'none',
            }}
          />
          <span className="text-[10px] font-orbitron tracking-[1px] uppercase" style={{ color: stateColors[state] }}>
            {stateLabels[state]}
          </span>
        </div>
        {(state === 'connected' || state === 'disposition') && (
          <div className="flex items-center gap-1.5" style={{ color: '#c4c4d6' }}>
            <Clock size={11} />
            <span className="text-[11px] font-orbitron">{fmtDuration(timer)}</span>
          </div>
        )}
      </div>

      {/* Lead info */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold"
            style={{ background: `${stateColors[state]}22`, color: stateColors[state] }}>
            {lead.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <div className="text-[15px] font-bold" style={{ color: '#e8e8f0' }}>{lead.name || 'Unknown'}</div>
            <div className="text-[11px]" style={{ color: '#8888aa' }}>{lead.phone}</div>
          </div>
        </div>

        {lead.address && (
          <div className="flex items-start gap-2">
            <MapPin size={12} style={{ color: '#52526e', marginTop: 2, flexShrink: 0 }} />
            <span className="text-[11px]" style={{ color: '#8888aa' }}>{lead.address}</span>
          </div>
        )}

        {lead.notes && (
          <div className="flex items-start gap-2 rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <FileText size={11} style={{ color: '#52526e', marginTop: 1, flexShrink: 0 }} />
            <span className="text-[11px]" style={{ color: '#8888aa' }}>{lead.notes}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function MultiDialer() {
  // Data
  const [leads, setLeads]           = useState<Lead[]>([]);
  const [cursor, setCursor]         = useState(0); // index of next lead to dial

  // State
  const [dialerState, setDialerState] = useState<DialerState>('idle');
  const [currentBatch, setCurrentBatch] = useState<Lead[]>([]);
  const [activeLead, setActiveLead]   = useState<Lead | null>(null);
  const [sessionId, setSessionId]     = useState<string>('');

  // Timer
  const [timer, setTimer]           = useState(0);
  const timerRef                    = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartRef                = useRef<number>(0);

  // Stats
  const [stats, setStats]           = useState<Stats>({ callsMade: 0, contacted: 0, hot: 0, totalSeconds: 0 });

  // Polling
  const pollRef                     = useRef<ReturnType<typeof setInterval> | null>(null);

  // CSV file input
  const fileRef                     = useRef<HTMLInputElement>(null);

  const webhookBase = typeof window !== 'undefined' ? window.location.origin : '';

  // ── Timer ──────────────────────────────────────────────────────────────────

  const startTimer = useCallback(() => {
    callStartRef.current = Date.now();
    setTimer(0);
    timerRef.current = setInterval(() => {
      setTimer(Math.floor((Date.now() - callStartRef.current) / 1000));
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // ── Polling session state ──────────────────────────────────────────────────

  const startPolling = useCallback((sid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/dialer-status?sessionId=${sid}`);
        if (!r.ok) return;
        const data = await r.json();

        if (data.status === 'connecting' && data.answered_lead) {
          setActiveLead(data.answered_lead);
          setDialerState('connecting');
        }

        if (data.status === 'connected') {
          setDialerState('connected');
          if (!timerRef.current) startTimer();
        }

        if (data.status === 'ended') {
          stopTimer();
          setDialerState('disposition');
          clearInterval(pollRef.current!);
          pollRef.current = null;
          // Update contacted stat
          setStats(s => ({ ...s, contacted: s.contacted + 1 }));
        }
      } catch { /* ignore */ }
    }, 2000);
  }, [startTimer, stopTimer]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── CSV Upload ─────────────────────────────────────────────────────────────

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseCSV(ev.target?.result as string);
      setLeads(parsed);
      setCursor(0);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // ── Dial next batch ────────────────────────────────────────────────────────

  const dialNextBatch = useCallback(async (fromCursor: number) => {
    if (fromCursor >= leads.length) {
      setDialerState('idle');
      return;
    }

    const batch = leads.slice(fromCursor, fromCursor + 3);
    const sid   = genSessionId();

    setCurrentBatch(batch);
    setSessionId(sid);
    setActiveLead(null);
    setTimer(0);
    setDialerState('dialing');

    setStats(s => ({ ...s, callsMade: s.callsMade + batch.length }));

    try {
      await fetch('/api/dialer-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, leads: batch, webhookBase }),
      });
      startPolling(sid);
    } catch (err) {
      console.error('Dial error:', err);
      setDialerState('idle');
    }
  }, [leads, webhookBase, startPolling]);

  // ── Start / Pause / Stop ───────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    if (dialerState === 'paused') {
      setDialerState('dialing');
      dialNextBatch(cursor);
    } else if (dialerState === 'idle' && leads.length > 0) {
      dialNextBatch(cursor);
    }
  }, [dialerState, leads, cursor, dialNextBatch]);

  const handlePause = useCallback(() => {
    stopPolling();
    stopTimer();
    setDialerState('paused');
  }, [stopPolling, stopTimer]);

  const handleStop = useCallback(() => {
    stopPolling();
    stopTimer();
    setDialerState('idle');
    setCursor(0);
    setActiveLead(null);
  }, [stopPolling, stopTimer]);

  // ── Disposition ────────────────────────────────────────────────────────────

  const handleDisposition = useCallback(async (disp: Disposition) => {
    const lead = activeLead || currentBatch[0];
    if (!lead) return;

    const callDuration = timer;
    const isHot = disp === 'hot';

    setStats(s => ({
      ...s,
      hot: s.hot + (isHot ? 1 : 0),
      totalSeconds: s.totalSeconds + callDuration,
    }));

    // Save to GHL + Supabase
    fetch('/api/dialer-disposition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition: disp, lead, callDuration, sessionId }),
    }).catch(console.error);

    // Advance cursor and auto-dial next batch
    const nextCursor = cursor + 3;
    setCursor(nextCursor);
    setActiveLead(null);
    setTimer(0);

    if (nextCursor < leads.length) {
      // Brief pause then auto-dial
      setTimeout(() => dialNextBatch(nextCursor), 500);
    } else {
      setDialerState('idle');
    }
  }, [activeLead, currentBatch, timer, sessionId, cursor, leads.length, dialNextBatch]);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => { stopPolling(); stopTimer(); };
  }, [stopPolling, stopTimer]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const progress = leads.length > 0 ? Math.min((cursor / leads.length) * 100, 100) : 0;
  const remaining = Math.max(leads.length - cursor, 0);
  const convRate = stats.callsMade > 0
    ? ((stats.contacted / stats.callsMade) * 100).toFixed(0)
    : '0';

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto pb-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-orbitron text-[13px] font-bold tracking-[2px] uppercase" style={{ color: '#e8e8f0' }}>
            Multi-Line Dialer
          </h2>
          <p className="text-[10px] mt-0.5" style={{ color: '#52526e' }}>
            3 simultaneous calls → first to answer connects to you
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: dialerState === 'connected' ? '#4ade80'
                : dialerState === 'dialing' ? '#fbbf24'
                : '#52526e',
              boxShadow: dialerState === 'connected' ? '0 0 8px #4ade80' : 'none',
            }}
          />
          <span className="text-[10px] font-orbitron" style={{ color: '#8888aa' }}>
            {dialerState === 'connected' ? 'LIVE' : dialerState.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Calls Made"    value={stats.callsMade}   color="#00e5ff" />
        <StatCard label="Contacted"     value={stats.contacted}   color="#4ade80" />
        <StatCard label="Hot Leads"     value={stats.hot}         color="#ff3366" />
        <StatCard label="Conv. Rate"    value={`${convRate}%`}    color="#a78bfa"
          sub={stats.totalSeconds > 0 ? `${fmtDuration(stats.totalSeconds)} total` : undefined} />
      </div>

      {/* CSV Upload + Progress */}
      <div
        className="rounded-2xl p-4 flex flex-col gap-3"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-medium" style={{ color: '#c4c4d6' }}>
              {leads.length > 0
                ? `${leads.length} leads loaded — ${remaining} remaining`
                : 'Upload CSV to get started'}
            </div>
            {leads.length > 0 && (
              <div className="text-[9px] mt-0.5" style={{ color: '#52526e' }}>
                Batch {Math.ceil(cursor / 3) + (dialerState !== 'idle' ? 0 : 0)}{' '}
                of {Math.ceil(leads.length / 3)} · Next: {currentBatch[0]?.name || leads[cursor]?.name || '—'}
              </div>
            )}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all"
            style={{ background: 'rgba(74,222,128,0.08)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}
          >
            <Upload size={11} />
            {leads.length > 0 ? 'Replace CSV' : 'Upload CSV'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
        </div>

        {/* Progress bar */}
        {leads.length > 0 && (
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #4ade80, #00e5ff)' }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        )}

        {/* CSV format hint */}
        {leads.length === 0 && (
          <div className="text-[9px]" style={{ color: '#3a3a52' }}>
            CSV columns: name, phone, address, notes (header row required)
          </div>
        )}
      </div>

      {/* Active lead card */}
      <AnimatePresence mode="wait">
        {(dialerState !== 'idle' && dialerState !== 'paused') && (
          <motion.div
            key={sessionId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {/* Show batch being dialed */}
            {(dialerState === 'dialing') && (
              <div className="rounded-2xl p-4" style={{ background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.15)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#fbbf24' }} />
                  <span className="text-[10px] font-orbitron tracking-[1px] uppercase" style={{ color: '#fbbf24' }}>
                    Dialing {currentBatch.length} simultaneously…
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {currentBatch.map((l, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#fbbf24', animationDelay: `${i * 0.3}s` }} />
                      <span className="text-[11px]" style={{ color: '#c4c4d6' }}>{l.name}</span>
                      <span className="text-[10px]" style={{ color: '#52526e' }}>{l.phone}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connecting / connected */}
            {(dialerState === 'connecting' || dialerState === 'connected') && activeLead && (
              <LeadCard lead={activeLead} timer={timer} state={dialerState} />
            )}

            {/* Disposition */}
            {dialerState === 'disposition' && (activeLead || currentBatch[0]) && (
              <div className="flex flex-col gap-4">
                <LeadCard lead={activeLead || currentBatch[0]} timer={timer} state={dialerState} />
                <div>
                  <div className="text-[9px] font-orbitron tracking-[1.5px] uppercase mb-2" style={{ color: '#52526e' }}>
                    Select disposition
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {DISPOSITIONS.map(d => {
                      const Icon = d.icon;
                      return (
                        <button
                          key={d.id}
                          onClick={() => handleDisposition(d.id)}
                          className="flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all"
                          style={{
                            background: `${d.color}0c`,
                            border: `1px solid ${d.color}33`,
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${d.color}1a`; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${d.color}0c`; }}
                        >
                          <Icon size={16} style={{ color: d.color }} />
                          <span className="text-[10px] font-medium" style={{ color: d.color }}>{d.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Start */}
        {(dialerState === 'idle' || dialerState === 'paused') && (
          <button
            onClick={handleStart}
            disabled={leads.length === 0 || remaining === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-orbitron text-[11px] tracking-[1.5px] uppercase transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
          >
            <Play size={14} />
            {dialerState === 'paused' ? 'Resume' : 'Start Dialing'}
          </button>
        )}

        {/* Pause */}
        {(dialerState === 'dialing' || dialerState === 'connecting' || dialerState === 'connected') && (
          <button
            onClick={handlePause}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-orbitron text-[11px] tracking-[1.5px] uppercase transition-all"
            style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
          >
            <Pause size={14} />
            Pause
          </button>
        )}

        {/* Stop */}
        {dialerState !== 'idle' && (
          <button
            onClick={handleStop}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-orbitron text-[11px] tracking-[1.5px] uppercase transition-all"
            style={{ background: 'rgba(255,51,102,0.08)', color: '#ff3366', border: '1px solid rgba(255,51,102,0.2)' }}
          >
            <Square size={14} />
            Stop
          </button>
        )}
      </div>

      {/* Lead queue preview */}
      {leads.length > 0 && (
        <div
          className="rounded-2xl p-4"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="text-[9px] font-orbitron tracking-[1.5px] uppercase mb-3" style={{ color: '#52526e' }}>
            Queue — {remaining} remaining
          </div>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {leads.slice(cursor, cursor + 12).map((lead, i) => {
              const absIdx = cursor + i;
              const batch  = Math.floor(i / 3);
              const isCurrentBatch = dialerState !== 'idle' && i < 3;
              return (
                <div
                  key={absIdx}
                  className="flex items-center gap-3 py-1.5 px-2 rounded-lg"
                  style={{
                    background: isCurrentBatch ? 'rgba(251,191,36,0.05)' : 'transparent',
                    borderLeft: isCurrentBatch ? '2px solid rgba(251,191,36,0.4)' : '2px solid transparent',
                  }}
                >
                  <div className="text-[9px] w-4" style={{ color: '#3a3a52' }}>{absIdx + 1}</div>
                  <div className="flex-1 text-[10px]" style={{ color: isCurrentBatch ? '#c4c4d6' : '#52526e' }}>
                    {lead.name}
                  </div>
                  <div className="text-[9px]" style={{ color: '#3a3a52' }}>{lead.phone}</div>
                  {i % 3 === 2 && i < 11 && (
                    <div className="w-px h-3 ml-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  )}
                </div>
              );
            })}
            {remaining > 12 && (
              <div className="text-[9px] text-center pt-1" style={{ color: '#3a3a52' }}>
                +{remaining - 12} more
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
