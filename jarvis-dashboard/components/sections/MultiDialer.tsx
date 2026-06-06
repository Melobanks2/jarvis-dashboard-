'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, PhoneOff, Upload, Play, Pause, Square,
  Flame, Snowflake, AlertCircle, RotateCcw,
  MapPin, FileText, Clock, TrendingUp,
  Bot, Radio, Target, X, CheckCircle, Settings,
  BarChart3, GitBranch,
} from 'lucide-react';
import { getApiKey } from '@/components/sections/IntelligenceChat';
import { PerformanceAnalytics } from '@/components/sections/dialer/PerformanceAnalytics';
import { ScriptTraining } from '@/components/sections/dialer/ScriptTraining';

// ── Config ────────────────────────────────────────────────────────────────────

const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DIALER_API) ||
  'https://api.jarviscommandcenter.space';
const LANE_COUNT = 5;
const DAILY_GOAL = 200;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Lead { name: string; phone: string; address: string; notes: string }

type Disposition = 'hot' | 'warm' | 'cold' | 'no_answer' | 'wrong_number' | 'refund';
type DialerState = 'idle' | 'dialing' | 'connecting' | 'connected' | 'disposition' | 'paused';
type LaneState = 'idle' | 'ringing' | 'connected' | 'voicemail' | 'no_answer' | 'ended';
type DavidStatus = 'idle' | 'on_call' | 'qualifying';

interface Lane {
  idx: number;
  state: LaneState;
  lead: Lead | null;
  call_control_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  amd_result: string | null;
  attempt_count?: number;
  max_attempts?: number;
}

interface Progress {
  cursor: number;
  total_leads: number;
  completed: number;
  remaining: number;
  batch_index?: number;
  lanes_done?: number;
}

interface Stats { callsMade: number; contacted: number; hot: number; totalSeconds: number }

interface TranscriptLine {
  speaker: 'david' | 'lead' | 'system';
  text: string;
  timestamp: string;
}

type DialerTab = 'live' | 'analytics' | 'script';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCSV(text: string): Lead[] {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const col = (h: string[], ...names: string[]) => {
    for (const n of names) { const i = h.indexOf(n); if (i !== -1) return i; }
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

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const genSessionId = () => `dialer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ── Lane visual config ────────────────────────────────────────────────────────

const LANE_COLOR: Record<LaneState, string> = {
  idle:      '#52526e',
  ringing:   '#fbbf24',
  connected: '#4ade80',
  voicemail: '#ff3366',
  no_answer: '#52526e',
  ended:     '#3a3a52',
};

const LANE_LABEL: Record<LaneState, string> = {
  idle:      'Idle',
  ringing:   'Ringing',
  connected: 'Human · Sarah active',
  voicemail: 'Voicemail — skipped',
  no_answer: 'No answer',
  ended:     'Ended',
};

const DISPOSITIONS: { id: Disposition; label: string; color: string; icon: React.ElementType }[] = [
  { id: 'hot',          label: 'Hot',          color: '#ff3366', icon: Flame       },
  { id: 'warm',         label: 'Warm',         color: '#ff8800', icon: TrendingUp  },
  { id: 'cold',         label: 'Cold',         color: '#60a5fa', icon: Snowflake   },
  { id: 'no_answer',    label: 'No Answer',    color: '#52526e', icon: PhoneOff    },
  { id: 'wrong_number', label: 'Wrong Number', color: '#fbbf24', icon: AlertCircle },
  { id: 'refund',       label: 'Refund',       color: '#a78bfa', icon: RotateCcw   },
];

const DIALER_TABS: { id: DialerTab; label: string; icon: React.ElementType }[] = [
  { id: 'live',     label: 'Live Dialer',       icon: Phone },
  { id: 'analytics', label: 'Performance Analytics', icon: BarChart3 },
  { id: 'script',   label: 'Script & Training', icon: GitBranch },
];

// ── Atom components ───────────────────────────────────────────────────────────

function StatCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className="rounded-xl p-3 flex flex-col gap-1"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[8px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>{label}</div>
      <div className="text-[22px] font-orbitron font-black" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px]" style={{ color: '#52526e' }}>{sub}</div>}
    </div>
  );
}

function LaneCard({ lane, now, isWinner }: { lane: Lane; now: number; isWinner: boolean }) {
  const color = LANE_COLOR[lane.state];
  const liveTimer = lane.started_at && (lane.state === 'connected' || lane.state === 'ringing')
    ? Math.max(0, Math.floor((now - new Date(lane.started_at).getTime()) / 1000))
    : 0;
  const pulsing = lane.state === 'ringing' || lane.state === 'connected';

  const retryInfo = lane.state === 'no_answer' && lane.attempt_count && lane.max_attempts
    ? `${lane.attempt_count}/${lane.max_attempts}`
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 flex flex-col gap-3 relative overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${color}${lane.state === 'idle' ? '22' : '55'}`,
        boxShadow: isWinner ? `0 0 24px ${color}44` : 'none',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              background: color,
              boxShadow: pulsing ? `0 0 8px ${color}` : 'none',
              animation: pulsing ? 'pulse 1.2s infinite' : 'none',
            }}
          />
          <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color }}>
            Line {lane.idx + 1}
          </span>
          {retryInfo && (
            <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: `${color}22`, color }}>
              {retryInfo}
            </span>
          )}
        </div>
        <span className="text-[9px] font-orbitron tracking-[1px] uppercase" style={{ color: '#8888aa' }}>
          {LANE_LABEL[lane.state]}
        </span>
      </div>

      {lane.lead ? (
        <>
          <div className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold"
              style={{ background: `${color}22`, color }}
            >
              {lane.lead.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-bold truncate" style={{ color: '#e8e8f0' }}>
                {lane.lead.name || 'Unknown'}
              </div>
              <div className="text-[10px] truncate" style={{ color: '#8888aa' }}>{lane.lead.phone}</div>
            </div>
          </div>
          {lane.lead.address && (
            <div className="flex items-start gap-1.5">
              <MapPin size={10} style={{ color: '#52526e', marginTop: 2, flexShrink: 0 }} />
              <span className="text-[10px] truncate" style={{ color: '#8888aa' }}>{lane.lead.address}</span>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center py-4">
          <span className="text-[10px]" style={{ color: '#3a3a52' }}>—</span>
        </div>
      )}

      {lane.state === 'connected' && (
        <div className="flex items-center justify-between pt-1 mt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-1.5" style={{ color }}>
            <Clock size={10} />
            <span className="text-[10px] font-orbitron">{fmt(liveTimer)}</span>
          </div>
          {isWinner && (
            <span className="text-[8px] font-orbitron tracking-[1px] uppercase" style={{ color: '#4ade80' }}>
              ● Winner
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

function DavidCard({ status, lane }: { status: DavidStatus; lane: number | null }) {
  const config = {
    idle:       { color: '#52526e', label: 'IDLE',        sub: 'standing by' },
    qualifying: { color: '#fbbf24', label: 'QUALIFYING',  sub: 'spinning up Sarah…' },
    on_call:    { color: '#4ade80', label: `ON CALL · LINE ${lane != null ? lane + 1 : '?'}`, sub: 'Sarah active' },
  }[status];

  const pulsing = status !== 'idle';

  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-4"
      style={{
        background: `linear-gradient(135deg, ${config.color}0c 0%, rgba(255,255,255,0.02) 100%)`,
        border: `1px solid ${config.color}44`,
      }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center relative"
        style={{
          background: `${config.color}22`,
          boxShadow: pulsing ? `0 0 16px ${config.color}66` : 'none',
        }}
      >
        <Bot size={22} style={{ color: config.color }} />
        {pulsing && (
          <div
            className="absolute inset-0 rounded-full"
            style={{ border: `2px solid ${config.color}`, animation: 'pulse 1.4s infinite' }}
          />
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-orbitron tracking-[2px] uppercase" style={{ color: '#52526e' }}>
            Sarah AI Agent
          </span>
        </div>
        <div className="font-orbitron text-[15px] font-black tracking-[1.5px]" style={{ color: config.color }}>
          {config.label}
        </div>
        <div className="text-[10px]" style={{ color: '#8888aa' }}>{config.sub}</div>
      </div>
    </div>
  );
}

function TranscriptPanel({ active, transcript, speakingLead }: {
  active: boolean;
  transcript: TranscriptLine[];
  speakingLead: 'david' | 'lead' | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript]);
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={12} style={{ color: '#52526e' }} />
          <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>
            Live Transcript
          </span>
        </div>
        <span
          className="text-[8px] font-orbitron tracking-[1px] uppercase"
          style={{ color: speakingLead === 'david' ? '#00e5ff' : speakingLead === 'lead' ? '#00ff88' : '#3a3a52' }}
        >
          {speakingLead === 'david' ? '● Sarah speaking' : speakingLead === 'lead' ? '● Lead speaking' : 'Silent'}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="rounded-lg p-3 min-h-[120px] max-h-[200px] overflow-y-auto flex flex-col gap-1"
        style={{ background: 'rgba(0,0,0,0.25)', border: '1px dashed rgba(255,255,255,0.04)' }}
      >
        {transcript.length === 0 ? (
          <span className="text-[10px] italic" style={{ color: active ? '#52526e' : '#3a3a52' }}>
            {active ? 'Waiting for transcript...' : 'No active call.'}
          </span>
        ) : transcript.map((line, i) => (
          <div key={i} className="text-[10px] leading-relaxed" style={{ color: line.speaker === 'david' ? '#00e5ff' : line.speaker === 'lead' ? '#00ff88' : '#52526e' }}>
            <span className="font-bold uppercase text-[8px] tracking-wider" style={{ color: line.speaker === 'david' ? '#00e5ff' : line.speaker === 'lead' ? '#00ff88' : '#3a3a52' }}>
              {line.speaker === 'david' ? 'Sarah' : line.speaker === 'lead' ? 'Lead' : 'Sys'}:
            </span>{' '}
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function GoalBar({ value, target }: { value: number; target: number }) {
  const pct = Math.min(100, (value / target) * 100);
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={12} style={{ color: '#a78bfa' }} />
          <span className="text-[10px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#c4c4d6' }}>
            Daily Goal
          </span>
        </div>
        <span className="font-orbitron text-[11px]" style={{ color: '#e8e8f0' }}>
          {value} / {target}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'linear-gradient(90deg, #a78bfa, #00e5ff)' }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}

function DialerProgress({ progress }: { progress: Progress }) {
  const { total_leads, completed } = progress;
  const pct = total_leads > 0 ? (completed / total_leads) * 100 : 0;

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle size={12} style={{ color: '#00e5ff' }} />
          <span className="text-[10px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#c4c4d6' }}>
            Progress
          </span>
        </div>
        <span className="font-orbitron text-[11px]" style={{ color: '#e8e8f0' }}>
          {completed} / {total_leads} completed
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'linear-gradient(90deg, #00e5ff, #00f0ff)' }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <div className="flex items-center justify-between text-[9px]" style={{ color: '#52526e' }}>
        <span>{progress.remaining} remaining</span>
        <span>Batch {Math.floor(progress.cursor / LANE_COUNT) + 1}</span>
      </div>
    </div>
  );
}

function SummaryModal({
  open, onClose, summary,
}: { open: boolean; onClose: () => void; summary: { calls: number; contacted: number; hot: number; talk: number; session: number } | null }) {
  if (!open || !summary) return null;
  const conv = summary.calls > 0 ? ((summary.contacted / summary.calls) * 100).toFixed(0) : '0';
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)' }}
    >
      <motion.div
        initial={{ y: 20, scale: 0.97 }} animate={{ y: 0, scale: 1 }}
        className="rounded-2xl p-6 max-w-md w-full"
        style={{ background: '#15151f', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="font-orbitron text-[14px] tracking-[2px] uppercase font-bold" style={{ color: '#e8e8f0' }}>
            Session Complete
          </div>
          <button onClick={onClose} style={{ color: '#52526e' }}>
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <StatCard label="Calls Made"  value={summary.calls}     color="#00e5ff" />
          <StatCard label="Contacted"   value={summary.contacted} color="#4ade80" sub={`${conv}% conv`} />
          <StatCard label="Hot Leads"   value={summary.hot}       color="#ff3366" />
          <StatCard label="Talk Time"   value={fmt(summary.talk)} color="#a78bfa" sub={`${fmt(summary.session)} session`} />
        </div>
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl font-orbitron text-[10px] tracking-[1.5px] uppercase"
          style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
        >
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}

// ── Live Dialer Tab ───────────────────────────────────────────────────────────

function LiveDialerTab() {
  const [leads,  setLeads]  = useState<Lead[]>([]);
  const [cursor, setCursor] = useState(0);
  const [dialerState, setDialerState] = useState<DialerState>('idle');
  const [sessionId,   setSessionId]   = useState<string>('');
  const [lanes,       setLanes]       = useState<Lane[]>(
    Array.from({ length: LANE_COUNT }, (_, i) => ({
      idx: i, state: 'idle', lead: null, call_control_id: null,
      started_at: null, ended_at: null, amd_result: null,
    }))
  );
  const [davidStatus, setDavidStatus] = useState<DavidStatus>('idle');
  const [davidLane,   setDavidLane]   = useState<number | null>(null);
  const [winnerLane,  setWinnerLane]  = useState<number | null>(null);
  const [activeLead,  setActiveLead]  = useState<Lead | null>(null);
  const [progress, setProgress] = useState<Progress>({ cursor: 0, total_leads: 0, completed: 0, remaining: 0 });
  const [now, setNow] = useState(Date.now());
  const [stats, setStats] = useState<Stats>({ callsMade: 0, contacted: 0, hot: 0, totalSeconds: 0 });
  const [summary, setSummary] = useState<{ calls: number; contacted: number; hot: number; talk: number; session: number } | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [speakingLead, setSpeakingLead] = useState<'david' | 'lead' | null>(null);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [showDialerSettings, setShowDialerSettings] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('jarvis_dialer_settings');
      return raw ? JSON.parse(raw) : { sttProvider: 'gemini', greetingMode: 'auto', scriptMode: 'auto' };
    } catch { return { sttProvider: 'gemini', greetingMode: 'auto', scriptMode: 'auto' }; }
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cursorRef = useRef(0);
  const dialNextBatchRef = useRef<(fromCursor: number) => void>(() => {});

  useEffect(() => {
    clockRef.current = setInterval(() => setNow(Date.now()), 500);
    return () => { if (clockRef.current) clearInterval(clockRef.current); };
  }, []);

  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const startPolling = useCallback((sid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/dialer/status?sessionId=${sid}`);
        if (!r.ok) return;
        const data = await r.json();

        if (Array.isArray(data.lanes) && data.lanes.length === LANE_COUNT) setLanes(data.lanes);
        if (data.david) { setDavidStatus(data.david.state); setDavidLane(data.david.lane ?? null); }
        setWinnerLane(data.winner_lane ?? null);
        if (data.progress) setProgress(data.progress);
        if (Array.isArray(data.transcript)) setTranscript(data.transcript);
        if (data.speaking_lead) setSpeakingLead(data.speaking_lead);
        if (data.audio_url) setCurrentAudioUrl(data.audio_url);

        if (data.status === 'connecting' && data.answered_lead) {
          setActiveLead(data.answered_lead);
          setDialerState('connecting');
        }
        if (data.status === 'connected') {
          setDialerState('connected');
          if (data.answered_lead) setActiveLead(data.answered_lead);
        }
        if (data.status === 'ended') {
          clearInterval(pollRef.current!); pollRef.current = null;
          if (data.answered_lead) {
            setDialerState('disposition');
            setStats(s => ({
              ...s,
              contacted: data.totals?.contacted_count ?? s.contacted,
            }));
          } else {
            const nextCursor = cursorRef.current + LANE_COUNT;
            setCursor(nextCursor);
            setActiveLead(null);
            setTimeout(() => dialNextBatchRef.current(nextCursor), 600);
          }
        }
      } catch { /* swallow */ }
    }, 1500);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    if (sessionId) {
      fetch(`${API_BASE}/dialer/progress?sessionId=${sessionId}`)
        .then(r => r.json())
        .then(data => {
          if (data.cursor != null) {
            setProgress({
              cursor: data.cursor,
              total_leads: data.total_leads || 0,
              completed: data.completed || 0,
              remaining: data.remaining || 0,
            });
          }
        })
        .catch(() => {});
    }
  }, [sessionId]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const newLeads = parseCSV(ev.target?.result as string);
      setLeads(newLeads);
      setCursor(0);
      setProgress({
        cursor: 0,
        total_leads: newLeads.length,
        completed: 0,
        remaining: newLeads.length,
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const dialNextBatch = useCallback(async (fromCursor: number) => {
    if (fromCursor >= leads.length) {
      setDialerState('idle');
      return;
    }
    const batch = leads.slice(fromCursor, fromCursor + LANE_COUNT);
    const sid = genSessionId();
    setSessionId(sid);
    setActiveLead(null);
    setWinnerLane(null);
    setDavidStatus('idle');
    setDavidLane(null);
    setDialerState('dialing');
    setStats(s => ({ ...s, callsMade: s.callsMade + batch.length }));

    setProgress({
      cursor: fromCursor,
      total_leads: leads.length,
      completed: fromCursor,
      remaining: leads.length - fromCursor,
      batch_index: Math.floor(fromCursor / LANE_COUNT),
    });

    try {
      const r = await fetch(`${API_BASE}/dialer/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          leads: batch,
          cursor: fromCursor,
          totalLeads: leads.length,
          geminiApiKey: getApiKey('gemini'),
          voiceSettings,
        }),
      });
      if (!r.ok) {
        console.error('dial failed', await r.text());
        setDialerState('idle');
        return;
      }
      startPolling(sid);
    } catch (err) {
      console.error('Dial error:', err);
      setDialerState('idle');
    }
  }, [leads, startPolling]);

  useEffect(() => { dialNextBatchRef.current = dialNextBatch; }, [dialNextBatch]);

  const handleStart = useCallback(() => {
    if (dialerState === 'paused' || dialerState === 'idle') {
      if (leads.length > 0) dialNextBatch(cursor);
    }
  }, [dialerState, leads, cursor, dialNextBatch]);

  const handlePause = useCallback(() => {
    stopPolling();
    setDialerState('paused');
  }, [stopPolling]);

  const handleStop = useCallback(async () => {
    stopPolling();
    setDialerState('idle');

    if (sessionId) {
      try {
        const r = await fetch(`${API_BASE}/dialer/session-summary?sessionId=${sessionId}`);
        if (r.ok) {
          const s = await r.json();
          setSummary({
            calls:     s.calls_made,
            contacted: s.contacted,
            hot:       s.hot_leads,
            talk:      s.talk_seconds,
            session:   s.session_seconds,
          });
          setShowSummary(true);
        }
      } catch { /* ignore */ }
    } else {
      setSummary({
        calls: stats.callsMade, contacted: stats.contacted, hot: stats.hot,
        talk: stats.totalSeconds, session: stats.totalSeconds,
      });
      setShowSummary(true);
    }

    setCursor(0);
    setActiveLead(null);
    setProgress({ cursor: 0, total_leads: 0, completed: 0, remaining: 0 });
  }, [stopPolling, sessionId, stats]);

  const handleDisposition = useCallback(async (disp: Disposition) => {
    const lead = activeLead;
    if (!lead) return;

    const winnerStarted = winnerLane != null ? lanes[winnerLane]?.started_at : null;
    const callDuration = winnerStarted
      ? Math.max(0, Math.floor((Date.now() - new Date(winnerStarted).getTime()) / 1000))
      : 0;
    const isHot = disp === 'hot';

    setStats(s => ({
      ...s,
      hot: s.hot + (isHot ? 1 : 0),
      totalSeconds: s.totalSeconds + callDuration,
    }));

    fetch(`${API_BASE}/dialer/disposition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition: disp, lead, callDuration, sessionId }),
    }).catch(console.error);

    try {
      const summaryPayload = {
        lead,
        disposition: disp,
        callDuration,
        transcript: transcript.map(t => `${t.speaker}: ${t.text}`).join('\n'),
        sessionId,
        timestamp: new Date().toISOString(),
        source: 'multi-dialer',
      };
      const handoffKey = 'jarvis_chat_handoff';
      const existing = JSON.parse(localStorage.getItem(handoffKey) || '[]');
      existing.push(summaryPayload);
      localStorage.setItem(handoffKey, JSON.stringify(existing));
    } catch { /* swallow — handoff is best-effort */ }

    setTranscript([]);
    setSpeakingLead(null);
    setCurrentAudioUrl(null);

    const nextCursor = cursor + LANE_COUNT;
    setCursor(nextCursor);
    setActiveLead(null);

    setProgress({
      cursor: nextCursor,
      total_leads: leads.length,
      completed: nextCursor,
      remaining: leads.length - nextCursor,
      batch_index: Math.floor(nextCursor / LANE_COUNT),
    });

    if (nextCursor < leads.length) {
      setTimeout(() => dialNextBatch(nextCursor), 400);
    } else {
      setDialerState('idle');
    }
  }, [activeLead, winnerLane, lanes, sessionId, cursor, leads.length, dialNextBatch, transcript]);

  useEffect(() => () => { stopPolling(); }, [stopPolling]);

  const remaining = Math.max(leads.length - cursor, 0);
  const conv = stats.callsMade > 0 ? ((stats.contacted / stats.callsMade) * 100).toFixed(0) : '0';

  return (
    <div className="flex flex-col gap-5">

      {/* Status indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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

      <DavidCard status={davidStatus} lane={davidLane} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Calls Made" value={stats.callsMade} color="#00e5ff" />
        <StatCard label="Contacted"  value={stats.contacted} color="#4ade80" />
        <StatCard label="Hot Leads"  value={stats.hot}       color="#ff3366" />
        <StatCard label="Conv. Rate" value={`${conv}%`}      color="#a78bfa"
          sub={stats.totalSeconds > 0 ? `${fmt(stats.totalSeconds)} talk` : undefined} />
      </div>

      {progress.total_leads > 0 && (
        <DialerProgress progress={progress} />
      )}

      <GoalBar value={stats.callsMade} target={DAILY_GOAL} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {lanes.map(lane => (
          <LaneCard key={lane.idx} lane={lane} now={now} isWinner={winnerLane === lane.idx} />
        ))}
      </div>

      <TranscriptPanel active={dialerState === 'connected'} transcript={transcript} speakingLead={speakingLead} />

      {/* CSV upload */}
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
                Batch {Math.floor(cursor / LANE_COUNT) + 1} of {Math.ceil(leads.length / LANE_COUNT)}
                {leads[cursor] ? ` · Next: ${leads[cursor].name}` : ''}
              </div>
            )}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium"
            style={{ background: 'rgba(74,222,128,0.08)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}
          >
            <Upload size={11} />
            {leads.length > 0 ? 'Replace CSV' : 'Upload CSV'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
        </div>
        {leads.length === 0 && (
          <div className="text-[9px]" style={{ color: '#3a3a52' }}>
            CSV columns: name, phone, address, notes (header row required)
          </div>
        )}
      </div>

      {/* Disposition */}
      <AnimatePresence>
        {dialerState === 'disposition' && activeLead && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.2)' }}
          >
            <div className="text-[10px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#a78bfa' }}>
              Disposition · {activeLead.name}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {DISPOSITIONS.map(d => {
                const Icon = d.icon;
                return (
                  <button
                    key={d.id}
                    onClick={() => handleDisposition(d.id)}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all"
                    style={{ background: `${d.color}0c`, border: `1px solid ${d.color}33` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${d.color}1a`; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${d.color}0c`; }}
                  >
                    <Icon size={16} style={{ color: d.color }} />
                    <span className="text-[10px] font-medium" style={{ color: d.color }}>{d.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <div className="flex items-center gap-3">
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

        {(dialerState === 'dialing' || dialerState === 'connecting' || dialerState === 'connected') && (
          <button
            onClick={handlePause}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-orbitron text-[11px] tracking-[1.5px] uppercase"
            style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
          >
            <Pause size={14} />
            Pause
          </button>
        )}

        {dialerState !== 'idle' && (
          <button
            onClick={handleStop}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-orbitron text-[11px] tracking-[1.5px] uppercase"
            style={{ background: 'rgba(255,51,102,0.08)', color: '#ff3366', border: '1px solid rgba(255,51,102,0.2)' }}
          >
            <Square size={14} />
            Stop Dialing
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
            Queue — {progress.remaining} remaining
          </div>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {leads.slice(cursor, cursor + 20).map((lead, i) => {
              const absIdx = cursor + i;
              const isCurrentBatch = dialerState !== 'idle' && i < LANE_COUNT;
              const isCompleted = absIdx < progress.completed;
              return (
                <div
                  key={absIdx}
                  className="flex items-center gap-3 py-1.5 px-2 rounded-lg"
                  style={{
                    background: isCurrentBatch ? 'rgba(251,191,36,0.05)' : 'transparent',
                    borderLeft: isCurrentBatch ? '2px solid rgba(251,191,36,0.4)' : isCompleted ? '2px solid rgba(74,222,128,0.2)' : '2px solid transparent',
                  }}
                >
                  <div className="text-[9px] w-4" style={{ color: isCompleted ? '#4ade80' : '#3a3a52' }}>{absIdx + 1}</div>
                  <div className="flex-1 text-[10px] truncate" style={{ color: isCurrentBatch ? '#c4c4d6' : '#52526e' }}>
                    {lead.name}
                  </div>
                  <div className="text-[9px]" style={{ color: '#3a3a52' }}>{lead.phone}</div>
                </div>
              );
            })}
            {progress.remaining > 20 && (
              <div className="text-[9px] text-center pt-1" style={{ color: '#3a3a52' }}>
                +{progress.remaining - 20} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary modal */}
      <AnimatePresence>
        {showSummary && (
          <SummaryModal open={showSummary} onClose={() => setShowSummary(false)} summary={summary} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main MultiDialer Component ────────────────────────────────────────────────

export function MultiDialer() {
  const [activeTab, setActiveTab] = useState<DialerTab>('live');

  return (
    <div className="flex flex-col gap-5 max-w-5xl mx-auto pb-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-orbitron text-[14px] font-bold tracking-[2px] uppercase" style={{ color: '#e8e8f0' }}>
            Multi-Line Dialer
          </h2>
          <p className="text-[10px] mt-0.5" style={{ color: '#52526e' }}>
            5 simultaneous calls → first to answer connects to you
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {DIALER_TABS.map(tab => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <motion.button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-sm flex-shrink-0 text-[10px] font-medium transition-colors"
              style={{
                background: active ? 'rgba(0,229,255,0.10)' : 'transparent',
                border: active ? '1px solid rgba(0,229,255,0.25)' : '1px solid transparent',
                color: active ? '#00e5ff' : '#52526e',
              }}
              whileHover={!active ? { color: '#c4c4d6' } : {}}
            >
              <Icon size={13} />
              {tab.label}
            </motion.button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {activeTab === 'live'     && <LiveDialerTab />}
          {activeTab === 'analytics' && <PerformanceAnalytics />}
          {activeTab === 'script'   && <ScriptTraining />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}