'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, PhoneOff, Upload, Play, Pause, Square,
  Flame, Snowflake, AlertCircle, RotateCcw,
  MapPin, FileText, Clock, TrendingUp,
  Bot, Radio, Target, X, CheckCircle, BookOpen,
  BarChart3, List,
} from 'lucide-react';
import ScriptTraining from './ScriptTraining';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

// Quote-aware CSV line splitter (handles "Smith, John" style cells).
function splitCSVLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

// Valid NANP phone: 10 digits (or 11 with leading 1), not starting with 0/1.
function looksLikePhone(v: string): boolean {
  const d = (v || '').replace(/\D/g, '');
  if (d.length === 10) return d[0] !== '0' && d[0] !== '1';
  if (d.length === 11) return d[0] === '1' && d[1] !== '0' && d[1] !== '1';
  return false;
}

const HEADER_TOKENS = new Set([
  'name', 'full name', 'contact', 'first name', 'last name', 'owner', 'owner name',
  'phone', 'phone number', 'phone 1', 'mobile', 'cell', 'cell phone', 'mobile phone',
  'address', 'property address', 'street', 'street address', 'city', 'state', 'zip',
  'notes', 'note', 'comments', 'email',
]);

function parseCSV(text: string): Lead[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const rows = lines.map(splitCSVLine);

  const firstRow = rows[0].map(h => h.toLowerCase().trim());
  const hasHeader = firstRow.some(h => HEADER_TOKENS.has(h));

  if (hasHeader) {
    const col = (...names: string[]) => {
      for (const n of names) { const i = firstRow.indexOf(n); if (i !== -1) return i; }
      return -1;
    };
    const nameIdx    = col('name', 'full name', 'contact', 'owner name', 'owner');
    const firstIdx   = col('first name');
    const lastIdx    = col('last name');
    const phoneIdx   = col('phone', 'phone number', 'phone 1', 'mobile', 'cell', 'cell phone', 'mobile phone');
    const addressIdx = col('address', 'property address', 'street address', 'street');
    const notesIdx   = col('notes', 'note', 'comments');

    return rows.slice(1).map(cells => {
      let name = nameIdx !== -1 ? cells[nameIdx] || '' : '';
      if (!name && (firstIdx !== -1 || lastIdx !== -1)) {
        name = [firstIdx !== -1 ? cells[firstIdx] : '', lastIdx !== -1 ? cells[lastIdx] : '']
          .filter(Boolean).join(' ');
      }
      return {
        name,
        phone:   phoneIdx   !== -1 ? cells[phoneIdx]   || '' : '',
        address: addressIdx !== -1 ? cells[addressIdx] || '' : '',
        notes:   notesIdx   !== -1 ? cells[notesIdx]   || '' : '',
      };
    }).filter(l => looksLikePhone(l.phone));
  }

  // ── Headerless CSV: infer columns from content across ALL rows ────────────
  // (e.g. "Single Family,98300,JEFFERSON,Johnnie,Bell,515 14th St,Bessemer,AL,35020,2058303144,...")
  const width = Math.max(...rows.map(r => r.length));
  const frac = (test: (v: string) => boolean) => {
    const out: number[] = [];
    for (let c = 0; c < width; c++) {
      let hit = 0, n = 0;
      for (const r of rows) { const v = r[c]; if (v) { n++; if (test(v)) hit++; } }
      out.push(n ? hit / n : 0);
    }
    return out;
  };

  // Phone column: highest fraction of valid NANP numbers (rejects prices/zips).
  const phoneFrac = frac(looksLikePhone);
  let phoneIdx = -1, best = 0.5;
  phoneFrac.forEach((f, i) => { if (f > best) { best = f; phoneIdx = i; } });

  // Street-address column: "515 14th St" — leading number + a word with letters.
  const addrFrac = frac(v => /^\d+\s+\S*[a-zA-Z]/.test(v));
  let addressIdx = -1; best = 0.5;
  addrFrac.forEach((f, i) => { if (i !== phoneIdx && f > best) { best = f; addressIdx = i; } });

  // Name: the alphabetic column(s) immediately before the street address
  // (typical export layout: ..., first, last, street, city, state, zip, phone).
  const alphaFrac = frac(v => /^[a-zA-Z][a-zA-Z .'-]*$/.test(v));
  let firstIdx = -1, lastIdx = -1;
  if (addressIdx > 0 && alphaFrac[addressIdx - 1] > 0.7) {
    lastIdx = addressIdx - 1;
    if (addressIdx > 1 && alphaFrac[addressIdx - 2] > 0.7) firstIdx = addressIdx - 2;
  }

  // City/state/zip usually follow the street column — fold into the address.
  const cityIdx  = addressIdx !== -1 && alphaFrac[addressIdx + 1] > 0.7 ? addressIdx + 1 : -1;
  const stateFrac = frac(v => /^[A-Za-z]{2}$/.test(v));
  const stateIdx = cityIdx !== -1 && stateFrac[cityIdx + 1] > 0.7 ? cityIdx + 1 : -1;
  const zipFrac  = frac(v => /^\d{5}(-\d{4})?$/.test(v));
  const zipIdx   = stateIdx !== -1 && zipFrac[stateIdx + 1] > 0.7 ? stateIdx + 1 : -1;

  return rows.map(cells => {
    const name = [firstIdx !== -1 ? cells[firstIdx] : '', lastIdx !== -1 ? cells[lastIdx] : '']
      .filter(Boolean).join(' ');
    const address = [
      addressIdx !== -1 ? cells[addressIdx] : '',
      cityIdx    !== -1 ? cells[cityIdx]    : '',
      stateIdx   !== -1 ? cells[stateIdx]   : '',
      zipIdx     !== -1 ? cells[zipIdx]     : '',
    ].filter(Boolean).join(', ');
    return {
      name,
      phone: phoneIdx !== -1 ? cells[phoneIdx] || '' : '',
      address,
      notes: '',
    };
  }).filter(l => looksLikePhone(l.phone));
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
  connected: 'Human · David active',
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

  // Show retry indicator if applicable
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
      {/* status light */}
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

      {/* lead body */}
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

      {/* timer */}
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
    qualifying: { color: '#fbbf24', label: 'QUALIFYING',  sub: 'spinning up Thunder…' },
    on_call:    { color: '#4ade80', label: `ON CALL · LINE ${lane != null ? lane + 1 : '?'}`, sub: 'David active' },
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
            David AI Agent
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

function TranscriptPanel({ active }: { active: boolean }) {
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
        <span className="text-[8px] font-orbitron tracking-[1px] uppercase" style={{ color: '#3a3a52' }}>
          Whisper · stub
        </span>
      </div>
      <div
        className="rounded-lg p-3 min-h-[120px] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.25)', border: '1px dashed rgba(255,255,255,0.04)' }}
      >
        <span className="text-[10px] italic" style={{ color: active ? '#52526e' : '#3a3a52' }}>
          {active ? 'Whisper pipeline pending — transcript will stream here.' : 'No active call.'}
        </span>
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

// Progress bar for dialer progress
function DialerProgress({ progress }: { progress: Progress }) {
  const { cursor, total_leads, completed, remaining } = progress;
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
        <span>{remaining} remaining</span>
        <span>Lead {completed + 1} of {total_leads}</span>
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

// ── Performance Analytics Component ───────────────────────────────────────────

function PerformanceAnalytics({ stats }: { stats: Stats }) {
  const [timeRange, setTimeRange] = useState<'today' | '7days' | '30days' | 'all'>('30days');

  // Generate mock time series data for charts (in production, this would come from API)
  const generateTimeSeriesData = () => {
    const days = timeRange === 'today' ? 1 : timeRange === '7days' ? 7 : timeRange === '30days' ? 30 : 60;
    return Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      return {
        date: date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }),
        totalCalls: Math.floor(Math.random() * 8) + 1,
        connected: Math.floor(Math.random() * 4) + 1,
      };
    });
  };

  // Generate disposition breakdown data (with colors)
  const dispositionData = [
    { name: 'Hot', count: stats.hot, fill: '#ff3366' },
    { name: 'Warm', count: Math.floor(stats.contacted * 0.3), fill: '#ffb020' },
    { name: 'Cold', count: Math.floor(stats.contacted * 0.2), fill: '#3ba1ff' },
    { name: 'No Answer', count: stats.callsMade - stats.contacted, fill: '#52526e' },
    { name: 'Wrong #', count: Math.floor(stats.callsMade * 0.05), fill: '#fbbf24' },
    { name: 'Refund', count: Math.floor(stats.callsMade * 0.02), fill: '#a78bfa' },
  ];

  const volumeData = generateTimeSeriesData();
  const avgDuration = stats.contacted > 0 ? Math.floor(stats.totalSeconds / stats.contacted) : 0;
  const conversionRate = stats.callsMade > 0 ? (stats.contacted / stats.callsMade) * 100 : 0;
  const handoffRate = stats.contacted > 0 ? (stats.hot / stats.contacted) * 100 : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <h3 className="font-orbitron text-[12px] font-bold tracking-[2px] uppercase" style={{ color: '#e8e8f0' }}>
          📊 PERFORMANCE ANALYTICS
        </h3>
        <div className="flex gap-2">
          {(['today', '7days', '30days', 'all'] as const).map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className="px-3 py-1.5 rounded-lg text-[9px] font-orbitron tracking-[1px] uppercase transition-all"
              style={{
                background: timeRange === range ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.03)',
                color: timeRange === range ? '#00e5ff' : '#52526e',
                border: `1px solid ${timeRange === range ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.05)'}`,
              }}
            >
              {range === 'today' ? 'Today' : range === '7days' ? '7 Days' : range === '30days' ? '30 Days' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Phone size={14} style={{ color: '#00e5ff' }} />
            <span className="text-[9px] font-orbitron tracking-[1px] uppercase" style={{ color: '#52526e' }}>Total Calls</span>
          </div>
          <div className="text-[28px] font-orbitron font-black" style={{ color: '#00e5ff' }}>{stats.callsMade}</div>
        </div>

        <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={14} style={{ color: '#4ade80' }} />
            <span className="text-[9px] font-orbitron tracking-[1px] uppercase" style={{ color: '#52526e' }}>Connected</span>
          </div>
          <div className="text-[28px] font-orbitron font-black" style={{ color: '#4ade80' }}>{stats.contacted}</div>
          <div className="text-[9px] mt-1" style={{ color: '#52526e' }}>
            {conversionRate.toFixed(0)}%
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Flame size={14} style={{ color: '#ff3366' }} />
            <span className="text-[9px] font-orbitron tracking-[1px] uppercase" style={{ color: '#52526e' }}>Hot Leads</span>
          </div>
          <div className="text-[28px] font-orbitron font-black" style={{ color: '#ff3366' }}>{stats.hot}</div>
        </div>

        <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} style={{ color: '#a78bfa' }} />
            <span className="text-[9px] font-orbitron tracking-[1px] uppercase" style={{ color: '#52526e' }}>Avg Duration</span>
          </div>
          <div className="text-[28px] font-orbitron font-black" style={{ color: '#a78bfa' }}>{fmt(avgDuration)}</div>
        </div>
      </div>

      {/* Call Volume & Connections Chart */}
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={14} style={{ color: '#00e5ff' }} />
          <span className="text-[10px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#c4c4d6' }}>
            Call Volume & Connections
          </span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={volumeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1d2942" />
            <XAxis dataKey="date" stroke="#7c8db5" fontSize={10} />
            <YAxis stroke="#7c8db5" fontSize={10} />
            <Tooltip
              contentStyle={{ background: '#111826', border: '1px solid #1d2942', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: '#c4c4d6' }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="totalCalls" name="Total Calls" stroke="#00e5ff" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="connected" name="Connected" stroke="#4ade80" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom Grid: Disposition Breakdown + Rates */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Disposition Breakdown Bar Chart */}
        <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={14} style={{ color: '#a78bfa' }} />
            <span className="text-[10px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#c4c4d6' }}>
              Disposition Breakdown
            </span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dispositionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1d2942" />
              <XAxis dataKey="name" stroke="#7c8db5" fontSize={10} />
              <YAxis stroke="#7c8db5" fontSize={10} />
              <Tooltip
                contentStyle={{ background: '#111826', border: '1px solid #1d2942', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#c4c4d6' }}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {dispositionData.map((entry, index) => (
                  <Bar key={`bar-${index}`} dataKey="count" fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Conversion & Handoff Rates */}
        <div className="flex flex-col gap-3">
          <div className="rounded-xl p-4 flex-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="text-[9px] font-orbitron tracking-[1px] uppercase mb-2" style={{ color: '#52526e' }}>
              Conversion Rate
            </div>
            <div className="text-[36px] font-orbitron font-black" style={{ color: '#4ade80' }}>
              {conversionRate.toFixed(1)}%
            </div>
            <div className="text-[9px] mt-1" style={{ color: '#8888aa' }}>connected / dialed</div>
            <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, conversionRate)}%`,
                  background: 'linear-gradient(90deg, #4ade80, #28d17c)',
                }}
              />
            </div>
          </div>

          <div className="rounded-xl p-4 flex-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="text-[9px] font-orbitron tracking-[1px] uppercase mb-2" style={{ color: '#52526e' }}>
              Handoff Rate
            </div>
            <div className="text-[36px] font-orbitron font-black" style={{ color: '#ffb020' }}>
              {handoffRate.toFixed(1)}%
            </div>
            <div className="text-[9px] mt-1" style={{ color: '#8888aa' }}>of connected → Jarvis</div>
            <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, handoffRate)}%`,
                  background: 'linear-gradient(90deg, #ffb020, #ff8800)',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type DialerTab = 'live' | 'script' | 'analytics' | 'reviews';

const DIALER_TABS: { id: DialerTab; label: string; icon: React.ElementType }[] = [
  { id: 'live',     label: 'Live Dialer',           icon: Phone     },
  { id: 'script',   label: 'Script & Training',     icon: BookOpen  },
  { id: 'analytics',label: 'Performance Analytics', icon: BarChart3 },
  { id: 'reviews',  label: 'Call Review',           icon: List      },
];

export function MultiDialer() {
  // Tab
  const [tab, setTab] = useState<DialerTab>('live');

  // Data
  const [leads,  setLeads]  = useState<Lead[]>([]);
  const [cursor, setCursor] = useState(0);

  // Session state (driven by backend status poll)
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

  // Progress tracking from backend
  const [progress, setProgress] = useState<Progress>({ cursor: 0, total_leads: 0, completed: 0, remaining: 0 });

  // Clock (drives lane timers without re-polling)
  const [now, setNow] = useState(Date.now());

  // Stats
  const [stats, setStats] = useState<Stats>({ callsMade: 0, contacted: 0, hot: 0, totalSeconds: 0 });

  // Summary modal
  const [summary, setSummary] = useState<{ calls: number; contacted: number; hot: number; talk: number; session: number } | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // Refs
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Mirrors of cursor + dialNextBatch so the memoized status poll (deps: [])
  // can advance batches with fresh values instead of stale-closure ones.
  const cursorRef = useRef(0);
  const dialNextBatchRef = useRef<(fromCursor: number) => void>(() => {});

  // ── Wall clock for live timers ──────────────────────────────────────────────
  useEffect(() => {
    clockRef.current = setInterval(() => setNow(Date.now()), 500);
    return () => { if (clockRef.current) clearInterval(clockRef.current); };
  }, []);

  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  // ── Poll backend status ────────────────────────────────────────────────────
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

        if (data.status === 'connecting' && data.answered_lead) {
          setActiveLead(data.answered_lead);
          setDialerState('connecting');
        }
        if (data.status === 'connected') {
          setDialerState('connected');
          if (data.answered_lead) setActiveLead(data.answered_lead);
        }
        if (data.status === 'ended') {
          // All leads exhausted — session fully complete.
          // Autonomous AI handles all dispositions; no manual input needed.
          clearInterval(pollRef.current!); pollRef.current = null;
          setDialerState('idle');
          setActiveLead(null);
        }
        
        // Update stats from backend totals
        if (data.totals) {
          setStats(s => ({
            callsMade: data.totals.calls_made ?? s.callsMade,
            contacted: data.totals.contacted_count ?? s.contacted,
            hot: s.hot, // hot leads tracked locally via disposition
            totalSeconds: s.totalSeconds,
          }));
        }
      } catch { /* swallow */ }
    }, 1500);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── Load progress from last session on mount ───────────────────────────────
  useEffect(() => {
    // Try to restore progress from any active session
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

  // ── CSV upload ─────────────────────────────────────────────────────────────
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

  // ── Start dialing session with queue-based auto-rotation ──────────────────
  const dialNextBatch = useCallback(async (fromCursor: number) => {
    if (fromCursor >= leads.length) {
      setDialerState('idle');
      return;
    }
    
    // Send ALL remaining leads to backend - queue-based auto-rotation handles the rest
    const remainingLeads = leads.slice(fromCursor);
    const sid = genSessionId();
    setSessionId(sid);
    setActiveLead(null);
    setWinnerLane(null);
    setDavidStatus('idle');
    setDavidLane(null);
    setDialerState('dialing');

    // Update progress state for session start
    setProgress({
      cursor: fromCursor,
      total_leads: leads.length,
      completed: fromCursor,
      remaining: leads.length - fromCursor,
    });

    try {
      const r = await fetch(`${API_BASE}/dialer/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionId: sid, 
          leads: remainingLeads, 
          cursor: fromCursor, 
          totalLeads: leads.length 
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

  // Keep the ref pointed at the latest dialNextBatch for the status poll.
  useEffect(() => { dialNextBatchRef.current = dialNextBatch; }, [dialNextBatch]);

  // ── Controls ───────────────────────────────────────────────────────────────
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

    // Pull session summary before resetting
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
      // No session ever started — show local stats
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

  // ── Disposition ────────────────────────────────────────────────────────────
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

    // Clear disposition modal - backend's queue-based auto-rotation continues automatically
    setActiveLead(null);
    setDialerState('dialing');
    
    // Resume polling to track backend's auto-rotation progress
    if (sessionId) {
      startPolling(sessionId);
    }
  }, [activeLead, winnerLane, lanes, sessionId, startPolling]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => { stopPolling(); }, [stopPolling]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const remaining = Math.max(leads.length - cursor, 0);
  const conv = stats.callsMade > 0 ? ((stats.contacted / stats.callsMade) * 100).toFixed(0) : '0';

  // ── Render ─────────────────────────────────────────────────────────────────
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
        {tab === 'live' && (
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
        )}
      </div>

      {/* Tab bar */}
      <div
        className="rounded-xl p-1 flex gap-1"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        {DIALER_TABS.map(t => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[10px] font-orbitron tracking-[1.5px] uppercase transition-all"
              style={{
                background: isActive ? 'rgba(74,222,128,0.1)' : 'transparent',
                color: isActive ? '#4ade80' : '#52526e',
                border: isActive ? '1px solid rgba(74,222,128,0.2)' : '1px solid transparent',
              }}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'live' && (
        <>
          {/* David agent card */}
          <DavidCard status={davidStatus} lane={davidLane} />

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Calls Made" value={stats.callsMade} color="#00e5ff" />
            <StatCard label="Contacted"  value={stats.contacted} color="#4ade80" />
            <StatCard label="Hot Leads"  value={stats.hot}       color="#ff3366" />
            <StatCard label="Conv. Rate" value={`${conv}%`}      color="#a78bfa"
              sub={stats.totalSeconds > 0 ? `${fmt(stats.totalSeconds)} talk` : undefined} />
          </div>

          {/* Dialer progress bar */}
          {progress.total_leads > 0 && (
            <DialerProgress progress={progress} />
          )}

          {/* Goal bar */}
          <GoalBar value={stats.callsMade} target={DAILY_GOAL} />

          {/* 5 lane grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {lanes.map(lane => (
              <LaneCard key={lane.idx} lane={lane} now={now} isWinner={winnerLane === lane.idx} />
            ))}
          </div>

          {/* Transcript stub */}
          <TranscriptPanel active={dialerState === 'connected'} />

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

          {/* Disposition (after a call ends) */}
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
                      <div className="flex-1 text-[10px] truncate" style={{ color: isCurrentBatch ? '#c4c4d6' : isCompleted ? '#52526e' : '#52526e' }}>
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
        </>
      )}

      {tab === 'script' && (
        <ScriptTraining />
      )}

      {tab === 'analytics' && <PerformanceAnalytics stats={stats} />}

      {tab === 'reviews' && (
        <div
          className="flex-1 rounded-2xl p-6 flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="text-center">
            <List size={24} style={{ color: '#52526e', margin: '0 auto 8px' }} />
            <div className="text-[12px] font-medium" style={{ color: '#c4c4d6' }}>Call Review</div>
            <div className="text-[9px] mt-1" style={{ color: '#52526e' }}>Coming soon — recording playback, transcript replay, coaching notes</div>
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
