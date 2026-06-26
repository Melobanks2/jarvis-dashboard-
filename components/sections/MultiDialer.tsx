'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, PhoneOff, Upload, Play, Pause, Square,
  Flame, Snowflake, AlertCircle, RotateCcw,
  MapPin, FileText, Clock, TrendingUp,
  Bot, Radio, Target, X, CheckCircle, BookOpen,
  BarChart3, List, RefreshCw, Trash2, Database,
  ChevronDown, ChevronUp, Headphones, Loader2, MessageSquare,
  Zap, Search, AlertTriangle, Calendar, Power, Plus,
} from 'lucide-react';
import ScriptTraining from './ScriptTraining';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '../../lib/supabase';

// ── Config ────────────────────────────────────────────────────────────────────

const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DIALER_API) ||
  'https://api.jarviscommandcenter.space';
const LANE_COUNT = 5;
const DAILY_GOAL = 200;

// Internal test line excluded from Call Review / analytics (Chris's cell).
const EXCLUDED_PHONE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DIALER_EXCLUDE_PHONE) ||
  '+13479704969';

const blankLanes = (): Lane[] =>
  Array.from({ length: LANE_COUNT }, (_, i) => ({
    idx: i, state: 'idle', lead: null, call_control_id: null,
    started_at: null, ended_at: null, amd_result: null,
  }));

// ── Types ─────────────────────────────────────────────────────────────────────

interface Lead { name: string; phone: string; address: string; notes: string }

type Disposition = 'hot' | 'warm' | 'cold' | 'no_answer' | 'wrong_number' | 'refund' | 'callback';
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

interface ListMeta {
  name: string;
  total: number;
  called: number;
  remaining: number;
  pass: number;
  isDialing: boolean;
}

// Summary row for the multi-list picker (GET /dialer/lists).
interface ListSummary {
  listId: string;
  name: string;
  total: number;
  called: number;
  remaining: number;
  contacted: number;
  hot: number;
  pass: number;
  createdAt: string;
}

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
  { id: 'callback',     label: 'Callback',     color: '#22d3ee', icon: Calendar    },
];

// ── Utility helpers for call review ────────────────────────────────────────────

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000)   return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000)return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function fmtDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'America/New_York',
  });
}

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

function LaneCard({ lane, now, isWinner, isSelected, onSelect }: {
  lane: Lane; now: number; isWinner: boolean; isSelected: boolean; onSelect: () => void;
}) {
  const color = LANE_COLOR[lane.state];
  const liveTimer = lane.started_at && (lane.state === 'connected' || lane.state === 'ringing')
    ? Math.max(0, Math.floor((now - new Date(lane.started_at).getTime()) / 1000))
    : 0;
  const pulsing = lane.state === 'ringing' || lane.state === 'connected';

  // Attempt counter — useful on any non-idle state, not just no-answer.
  const retryInfo = lane.attempt_count && lane.max_attempts
    ? `${lane.attempt_count}/${lane.max_attempts}`
    : null;

  // Answering-machine detection result (Telnyx AMD) once known.
  const amd = (lane.amd_result || '').toLowerCase();
  const amdLabel = amd.includes('machine') ? 'Machine'
    : amd === 'human' ? 'Human'
    : amd && amd !== 'not_sure' ? amd
    : null;
  const amdColor = amd.includes('machine') ? '#ff3366' : amd === 'human' ? '#4ade80' : '#8888aa';

  const showTimer = lane.state === 'connected' || lane.state === 'ringing';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onSelect}
      className="rounded-2xl p-4 flex flex-col gap-3 relative overflow-hidden cursor-pointer"
      title="Show this line's live transcript"
      style={{
        background: isSelected ? 'rgba(0,229,255,0.05)' : 'rgba(255,255,255,0.03)',
        border: isSelected ? '1px solid rgba(0,229,255,0.5)' : `1px solid ${color}${lane.state === 'idle' ? '22' : '55'}`,
        boxShadow: isSelected ? '0 0 16px rgba(0,229,255,0.25)' : isWinner ? `0 0 24px ${color}44` : 'none',
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
        <div className="flex items-center gap-1.5">
          {amdLabel && (
            <span className="text-[8px] px-1.5 py-0.5 rounded font-orbitron tracking-[0.5px] uppercase"
              style={{ background: `${amdColor}22`, color: amdColor }}>
              {amdLabel}
            </span>
          )}
          <span className="text-[9px] font-orbitron tracking-[1px] uppercase" style={{ color: '#8888aa' }}>
            {LANE_LABEL[lane.state]}
          </span>
        </div>
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
                {lane.lead.name || lane.lead.phone || 'Unknown'}
              </div>
              {lane.lead.name && (
                <div className="text-[10px] truncate" style={{ color: '#8888aa' }}>{lane.lead.phone}</div>
              )}
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

      {/* timer — runs while ringing and while connected */}
      {showTimer && (
        <div className="flex items-center justify-between pt-1 mt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-1.5" style={{ color }}>
            <Clock size={10} />
            <span className="text-[10px] font-orbitron">{fmt(liveTimer)}</span>
            {lane.state === 'ringing' && (
              <span className="text-[8px] font-orbitron tracking-[1px] uppercase" style={{ color: '#8888aa' }}>ringing</span>
            )}
          </div>
          {isWinner && lane.state === 'connected' && (
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
    qualifying: { color: '#fbbf24', label: 'QUALIFYING',  sub: 'Sarah qualifying lead…' },
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

interface TranscriptTurn { role: string; text: string; ts: number }

function TranscriptPanel({ lane, pinned }: { lane: Lane | null; pinned: boolean }) {
  const callId = lane?.call_control_id || null;
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [callActive, setCallActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll the live transcript for the shown lane's call. On call end the
  // backend reports active:false with no turns — keep the last conversation
  // on screen until the lane rotates to a new call id.
  useEffect(() => {
    setTurns([]);
    setCallActive(false);
    if (!callId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const r = await fetch(`${API_BASE}/dialer/transcript?callId=${encodeURIComponent(callId)}`);
        if (!r.ok || stopped) return;
        const d = await r.json();
        if (stopped) return;
        if (Array.isArray(d.turns) && d.turns.length) setTurns(d.turns);
        setCallActive(!!d.active);
      } catch { /* transient — keep last state */ }
    };
    poll();
    const iv = setInterval(poll, 1500);
    return () => { stopped = true; clearInterval(iv); };
  }, [callId]);

  // Stick to the newest line as the conversation streams in.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns.length]);

  const placeholder = !callId
    ? 'No active call.'
    : turns.length === 0
      ? (lane?.state === 'connected' ? 'Live call — waiting for first words…' : 'Ringing — transcript starts when a human answers.')
      : null;

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={12} style={{ color: callActive ? '#4ade80' : '#52526e' }} />
          <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>
            Live Transcript
          </span>
          {lane && (
            <span className="text-[8px] px-1.5 py-0.5 rounded font-orbitron"
              style={{ background: 'rgba(0,229,255,0.1)', color: '#00e5ff', border: '1px solid rgba(0,229,255,0.2)' }}>
              Line {lane.idx + 1}{lane.lead?.name ? ` · ${lane.lead.name}` : ''}{pinned ? '' : ' · auto'}
            </span>
          )}
        </div>
        <span className="text-[8px] font-orbitron tracking-[1px] uppercase"
          style={{ color: callActive ? '#4ade80' : '#3a3a52' }}>
          {callActive ? 'Deepgram · live' : 'Deepgram'}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="rounded-lg p-3 min-h-[220px] max-h-[460px] overflow-y-auto flex flex-col gap-2"
        style={{ background: 'rgba(0,0,0,0.25)', border: '1px dashed rgba(255,255,255,0.04)' }}
      >
        {placeholder ? (
          <div className="flex-1 flex items-center justify-center min-h-[96px]">
            <span className="text-[10px] italic" style={{ color: '#3a3a52' }}>{placeholder}</span>
          </div>
        ) : (
          turns.map((t, i) => {
            const isSarah = t.role === 'david';
            return (
              <div key={i} className={`flex ${isSarah ? 'justify-start' : 'justify-end'}`}>
                <div
                  className="max-w-[82%] rounded-xl px-2.5 py-1.5"
                  style={{
                    background: isSarah ? 'rgba(74,222,128,0.10)' : 'rgba(0,229,255,0.10)',
                    border: `1px solid ${isSarah ? 'rgba(74,222,128,0.28)' : 'rgba(0,229,255,0.28)'}`,
                  }}
                >
                  <div className="text-[8px] font-orbitron tracking-[1px] uppercase mb-0.5"
                    style={{ color: isSarah ? '#4ade80' : '#00e5ff' }}>
                    {isSarah ? '● Sarah' : '● Seller'}
                  </div>
                  <div className="text-[11px] leading-relaxed" style={{ color: isSarah ? '#d6f5e2' : '#cfeffb' }}>{t.text}</div>
                </div>
              </div>
            );
          })
        )}
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

// ── Call Review Component ─────────────────────────────────────────────────────

interface CallReviewRecord {
  id: string;
  contact_name: string;
  phone: string;
  address: string;
  call_duration: number;
  outcome: string;
  transcript_text: string;
  recording_url: string;
  called_at: string;
}

const OUTCOME_COLORS: Record<string, string> = {
  hot:           '#ff3366',
  warm:          '#ff8800',
  cold:          '#60a5fa',
  voicemail:     '#52526e',
  no_answer:     '#52526e',
  wrong_number:  '#fbbf24',
  refund:        '#a78bfa',
  callback:      '#22d3ee',
};

function callOutcomeFromRecord(c: { stage_after?: string | null; call_duration?: number | null }): string {
  const stage = c.stage_after || '';
  if (stage === 'Hot Follow Up') return 'hot';
  if (stage === 'Warm Follow Up') return 'warm';
  if (stage.includes('No Contact') || stage.includes('Unresponsive') || (c.call_duration ?? 0) < 25) return 'voicemail';
  return 'cold';
}

type ReviewRange = 'today' | '7days' | '30days' | 'all';

function CallReview() {
  const [calls, setCalls] = useState<CallReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Filters
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<ReviewRange>('30days');

  // Fetch call records from Supabase (date window is server-side; outcome +
  // search are derived/client-side over the loaded window).
  const fetchCalls = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('jarvis_calls')
        .select('id, contact_name, phone, address, call_duration, stage_after, transcript_text, recording_url, called_at')
        .neq('phone', EXCLUDED_PHONE)
        .order('called_at', { ascending: false })
        .limit(500);

      if (dateRange !== 'all') {
        const days = dateRange === 'today' ? 1 : dateRange === '7days' ? 7 : 30;
        const since = new Date(); since.setHours(0, 0, 0, 0);
        since.setDate(since.getDate() - (days - 1));
        q = q.gte('called_at', since.toISOString());
      }

      const { data, error } = await q;

      if (error) throw error;

      const mapped: CallReviewRecord[] = (data || []).map(r => ({
        id: r.id,
        contact_name: r.contact_name || 'Unknown',
        phone: r.phone || '',
        address: r.address || '',
        call_duration: r.call_duration ?? 0,
        outcome: callOutcomeFromRecord(r),
        transcript_text: r.transcript_text || '',
        recording_url: r.recording_url || '',
        called_at: r.called_at,
      }));

      setCalls(mapped);
    } catch (err) {
      console.error('Failed to fetch call reviews:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  // Apply outcome + search filters client-side.
  const filteredCalls = calls.filter(c => {
    if (outcomeFilter !== 'all' && c.outcome !== outcomeFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!c.contact_name.toLowerCase().includes(q) && !c.phone.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Audio playback
  const handlePlayPause = useCallback((id: string, url: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); }
    const audio = new Audio(url);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    audio.play().catch(() => setPlayingId(null));
    audioRef.current = audio;
    setPlayingId(id);
  }, [playingId]);

  const toggleTranscript = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-orbitron text-[12px] font-bold tracking-[2px] uppercase" style={{ color: '#e8e8f0' }}>
          <List size={14} style={{ color: '#a78bfa', display: 'inline', marginRight: 6 }} />
          CALL REVIEW
        </h3>
        <button
          onClick={fetchCalls}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-orbitron tracking-[1px] uppercase"
          style={{
            background: 'rgba(167,139,250,0.08)',
            color: '#a78bfa',
            border: '1px solid rgba(167,139,250,0.2)',
          }}
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filters: search + date range + outcome chips */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[180px] rounded-lg px-3 py-2"
            style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Search size={12} style={{ color: '#52526e' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or phone…"
              className="flex-1 bg-transparent outline-none text-[11px]"
              style={{ color: '#e8e8f0' }}
            />
            {search && <button onClick={() => setSearch('')} style={{ color: '#52526e' }}><X size={12} /></button>}
          </div>
          <div className="flex gap-1">
            {(['today', '7days', '30days', 'all'] as const).map(r => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className="px-2.5 py-1.5 rounded-lg text-[9px] font-orbitron tracking-[1px] uppercase"
                style={{
                  background: dateRange === r ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.03)',
                  color: dateRange === r ? '#00e5ff' : '#52526e',
                  border: `1px solid ${dateRange === r ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.05)'}`,
                }}
              >
                {r === 'today' ? 'Today' : r === '7days' ? '7D' : r === '30days' ? '30D' : 'All'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', 'hot', 'warm', 'cold', 'voicemail'] as const).map(o => {
            const active = outcomeFilter === o;
            const color = o === 'all' ? '#a78bfa' : (OUTCOME_COLORS[o] || '#52526e');
            const count = o === 'all' ? calls.length : calls.filter(c => c.outcome === o).length;
            return (
              <button
                key={o}
                onClick={() => setOutcomeFilter(o)}
                className="px-2.5 py-1 rounded-full text-[9px] font-medium capitalize transition-all"
                style={{
                  background: active ? `${color}22` : 'rgba(255,255,255,0.03)',
                  color: active ? color : '#52526e',
                  border: `1px solid ${active ? `${color}55` : 'rgba(255,255,255,0.05)'}`,
                }}
              >
                {o === 'voicemail' ? 'VM' : o} {count > 0 && <span style={{ opacity: 0.7 }}>· {count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading state */}
      {loading && calls.length === 0 && (
        <div
          className="rounded-2xl p-8 flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" style={{ color: '#a78bfa' }} />
            <span className="text-[10px]" style={{ color: '#52526e' }}>Loading call records…</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && calls.length === 0 && (
        <div
          className="rounded-2xl p-8 flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="text-center">
            <Headphones size={24} style={{ color: '#52526e', margin: '0 auto 8px' }} />
            <div className="text-[11px]" style={{ color: '#52526e' }}>No calls recorded yet</div>
          </div>
        </div>
      )}

      {/* Filtered-empty state */}
      {!loading && calls.length > 0 && filteredCalls.length === 0 && (
        <div className="rounded-2xl p-6 flex items-center justify-center text-center"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <span className="text-[10px]" style={{ color: '#52526e' }}>No calls match the current filters.</span>
        </div>
      )}

      {/* Call list */}
      <div className="flex flex-col gap-2">
        {filteredCalls.map(call => {
          const outcomeColor = OUTCOME_COLORS[call.outcome] || '#52526e';
          const isExpanded = expandedId === call.id;
          const isPlaying = playingId === call.id;
          const hasRecording = !!call.recording_url;
          const hasTranscript = !!call.transcript_text;

          return (
            <motion.div
              key={call.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${isExpanded ? `${outcomeColor}44` : 'rgba(255,255,255,0.05)'}`,
              }}
            >
              {/* Main row */}
              <div
                className="p-3 flex items-center gap-3 cursor-pointer"
                onClick={() => toggleTranscript(call.id)}
              >
                {/* Avatar */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ background: `${outcomeColor}22`, color: outcomeColor }}
                >
                  {call.contact_name?.[0]?.toUpperCase() || '?'}
                </div>

                {/* Info cols */}
                <div className="flex-1 min-w-0 grid grid-cols-4 gap-2 items-center">
                  {/* Name + phone + address */}
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium truncate" style={{ color: '#e8e8f0' }}>
                      {call.contact_name}
                    </div>
                    <div className="text-[9px] truncate" style={{ color: '#52526e' }}>
                      {call.phone}
                      {call.address && ` · ${call.address}`}
                    </div>
                  </div>

                  {/* Outcome badge */}
                  <div className="flex justify-center">
                    <span
                      className="text-[9px] font-medium px-2 py-0.5 rounded-full capitalize"
                      style={{ background: `${outcomeColor}18`, color: outcomeColor, border: `1px solid ${outcomeColor}33` }}
                    >
                      {call.outcome === 'voicemail' ? 'VM' : call.outcome}
                    </span>
                  </div>

                  {/* Duration */}
                  <div className="text-[10px] font-orbitron text-center" style={{ color: '#8888aa' }}>
                    {call.call_duration > 0 ? `${Math.floor(call.call_duration / 60)}:${String(call.call_duration % 60).padStart(2, '0')}` : '—'}
                  </div>

                  {/* Date */}
                  <div className="text-[9px] text-right" style={{ color: '#52526e' }}>
                    <div>{fmtDate(call.called_at)}</div>
                    <div>{timeAgo(call.called_at)}</div>
                  </div>
                </div>

                {/* Play button */}
                {hasRecording && (
                  <button
                    onClick={e => { e.stopPropagation(); handlePlayPause(call.id, call.recording_url); }}
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all"
                    style={{
                      background: isPlaying ? 'rgba(255,51,102,0.15)' : 'rgba(167,139,250,0.1)',
                      border: `1px solid ${isPlaying ? 'rgba(255,51,102,0.3)' : 'rgba(167,139,250,0.2)'}`,
                    }}
                    title={isPlaying ? 'Stop' : 'Play recording'}
                  >
                    {isPlaying
                      ? <Square size={10} style={{ color: '#ff3366' }} />
                      : <Play size={10} style={{ color: '#a78bfa' }} />
                    }
                  </button>
                )}

                {/* Expand chevron */}
                <div style={{ color: '#52526e' }}>
                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </div>
              </div>

              {/* Transcript panel (expanded) */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-0" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      {/* Transcript header */}
                      <div className="flex items-center gap-2 py-2">
                        <MessageSquare size={10} style={{ color: '#52526e' }} />
                        <span className="text-[8px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>
                          Full Transcript
                        </span>
                        {hasRecording && (
                          <span className="text-[8px] flex items-center gap-1 ml-auto" style={{ color: '#a78bfa' }}>
                            <Headphones size={8} />
                            Recording available
                          </span>
                        )}
                      </div>

                      {/* Transcript content */}
                      {hasTranscript ? (
                        <div
                          className="rounded-xl p-3 max-h-64 overflow-y-auto"
                          style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)' }}
                        >
                          {call.transcript_text.split('\n').map((line, i) => {
                            // Color-code speaker lines (Sarah vs Seller)
                            const lower = line.toLowerCase().trim();
                            let speakerColor = '#52526e';
                            let labelColor = '#00e5ff';
                            if (lower.startsWith('sarah:') || lower.startsWith('david:') || lower.startsWith('agent:')) {
                              speakerColor = '#4ade80'; labelColor = '#4ade80';
                            } else if (lower.startsWith('seller:') || lower.startsWith('lead:') || lower.startsWith('contact:')) {
                              speakerColor = '#fbbf24'; labelColor = '#fbbf24';
                            } else if (lower.startsWith('system:') || lower.startsWith('note:')) {
                              speakerColor = '#52526e'; labelColor = '#52526e';
                            }

                            return (
                              <div key={i} className="flex gap-2 py-1 text-[11px] leading-relaxed">
                                {line.includes(':') ? (
                                  <>
                                    <span className="font-bold shrink-0" style={{ color: labelColor }}>
                                      {line.split(':')[0]}:
                                    </span>
                                    <span style={{ color: '#c4c4d6' }}>
                                      {line.split(':').slice(1).join(':')}
                                    </span>
                                  </>
                                ) : (
                                  <span style={{ color: '#52526e' }}>{line}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div
                          className="rounded-xl p-4 flex items-center justify-center"
                          style={{ background: 'rgba(0,0,0,0.2)', border: '1px dashed rgba(255,255,255,0.04)' }}
                        >
                          <span className="text-[10px] italic" style={{ color: '#3a3a52' }}>
                            No transcript available for this call.
                          </span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Summary footer */}
      {!loading && calls.length > 0 && (
        <div className="flex items-center justify-between text-[9px] px-1" style={{ color: '#52526e' }}>
          <span>Showing {filteredCalls.length} of {calls.length} calls</span>
          <span>
            {filteredCalls.filter(c => c.outcome === 'hot').length} hot
            {' · '}
            {filteredCalls.filter(c => c.outcome === 'warm').length} warm
            {' · '}
            {filteredCalls.filter(c => c.recording_url).length} recordings
          </span>
        </div>
      )}
    </div>
  );
}

// ── Performance Analytics Component ───────────────────────────────────────────

interface AnalyticsRow { called_at: string; stage_after: string | null; call_duration: number | null }

function PerformanceAnalytics() {
  const [timeRange, setTimeRange] = useState<'today' | '7days' | '30days' | 'all'>('30days');
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Pull real call records from Supabase for the selected window ──────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let q = supabase
          .from('jarvis_calls')
          .select('called_at, stage_after, call_duration')
          .neq('phone', EXCLUDED_PHONE)
          .order('called_at', { ascending: true })
          .limit(5000);

        if (timeRange !== 'all') {
          const days = timeRange === 'today' ? 1 : timeRange === '7days' ? 7 : 30;
          const since = new Date();
          since.setHours(0, 0, 0, 0);
          since.setDate(since.getDate() - (days - 1));
          q = q.gte('called_at', since.toISOString());
        }

        const { data, error } = await q;
        if (error) throw error;
        if (!cancelled) setRows((data || []) as AnalyticsRow[]);
      } catch (err) {
        console.error('Analytics fetch failed:', err);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [timeRange]);

  // Connected = a real conversation (hot/warm/cold); voicemail/no-answer are not.
  const isConnected = (o: string) => o === 'hot' || o === 'warm' || o === 'cold';
  const dayKey = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });

  // ── Volume line chart: continuous day axis, real counts per day ───────────────
  const volumeData = (() => {
    const days = timeRange === 'today' ? 1 : timeRange === '7days' ? 7 : timeRange === '30days' ? 30 : 0;
    const buckets = new Map<string, { date: string; totalCalls: number; connected: number }>();
    if (days > 0) {
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const k = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
        buckets.set(k, { date: k, totalCalls: 0, connected: 0 });
      }
    }
    for (const r of rows) {
      const k = dayKey(r.called_at);
      let b = buckets.get(k);
      if (!b) { b = { date: k, totalCalls: 0, connected: 0 }; buckets.set(k, b); }
      b.totalCalls++;
      if (isConnected(callOutcomeFromRecord(r))) b.connected++;
    }
    return Array.from(buckets.values());
  })();

  // ── Disposition breakdown: real outcome counts ────────────────────────────────
  const outcomeCounts = rows.reduce<Record<string, number>>((acc, r) => {
    const o = callOutcomeFromRecord(r);
    acc[o] = (acc[o] || 0) + 1;
    return acc;
  }, {});
  const dispositionData = [
    { name: 'Hot',       count: outcomeCounts.hot       || 0, fill: '#ff3366' },
    { name: 'Warm',      count: outcomeCounts.warm      || 0, fill: '#ffb020' },
    { name: 'Cold',      count: outcomeCounts.cold      || 0, fill: '#3ba1ff' },
    { name: 'Voicemail', count: outcomeCounts.voicemail || 0, fill: '#52526e' },
  ];

  const totalCalls    = rows.length;
  const connectedRows = rows.filter(r => isConnected(callOutcomeFromRecord(r)));
  const connected     = connectedRows.length;
  const hotCount      = outcomeCounts.hot || 0;
  const talkSeconds   = connectedRows.reduce((s, r) => s + (r.call_duration || 0), 0);
  const avgDuration   = connected > 0 ? Math.floor(talkSeconds / connected) : 0;
  const conversionRate = totalCalls > 0 ? (connected / totalCalls) * 100 : 0;
  const handoffRate    = connected  > 0 ? (hotCount / connected) * 100 : 0;
  const stats = { callsMade: totalCalls, contacted: connected, hot: hotCount };

  return (
    <div className="flex flex-col gap-5">
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <h3 className="font-orbitron text-[12px] font-bold tracking-[2px] uppercase flex items-center gap-2" style={{ color: '#e8e8f0' }}>
          📊 PERFORMANCE ANALYTICS
          {loading && <Loader2 size={12} className="animate-spin" style={{ color: '#52526e' }} />}
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

      {/* Top KPI Cards — full outcome breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Phone,      label: 'Total Calls',   value: stats.callsMade,              color: '#00e5ff' },
          { icon: TrendingUp, label: 'Conversations', value: stats.contacted, sub: `${conversionRate.toFixed(0)}% of logged calls`, color: '#4ade80' },
          { icon: Flame,      label: 'Hot',           value: outcomeCounts.hot  || 0,      color: '#ff3366' },
          { icon: Flame,      label: 'Warm',          value: outcomeCounts.warm || 0,      color: '#ffb020' },
          { icon: Snowflake,  label: 'Cold',          value: outcomeCounts.cold || 0,      color: '#3ba1ff' },
          { icon: PhoneOff,   label: 'Voicemails',    value: outcomeCounts.voicemail || 0, color: '#8888aa' },
          { icon: Clock,      label: 'Talk Time',     value: fmt(talkSeconds), sub: `avg ${fmt(avgDuration)} / conv`, color: '#a78bfa' },
          { icon: Database,   label: 'Est. Telnyx Cost', value: `$${(stats.contacted * 0.018).toFixed(2)}`, sub: '~1.8¢ per connected call', color: '#fbbf24' },
        ].map((k, i) => (
          <div key={i} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-2">
              <k.icon size={14} style={{ color: k.color }} />
              <span className="text-[9px] font-orbitron tracking-[1px] uppercase" style={{ color: '#52526e' }}>{k.label}</span>
            </div>
            <div className="text-[26px] font-orbitron font-black" style={{ color: k.color }}>{k.value}</div>
            {k.sub && <div className="text-[8px] mt-1" style={{ color: '#52526e' }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Call Volume & Connections Chart */}
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={14} style={{ color: '#00e5ff' }} />
          <span className="text-[10px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#c4c4d6' }}>
            Call Volume & Connections
          </span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
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
          <ResponsiveContainer width="100%" height={300}>
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
                  <Cell key={`cell-${index}`} fill={entry.fill} />
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

// ── Autopilot / scheduler card ────────────────────────────────────────────────

interface SchedulerStatus {
  enabled: boolean;
  autostartHour: number;
  doneToday: { date: string; ingest: boolean; summary: boolean; audit: boolean; cleanup: boolean };
  lastAutoStartAt: string | null;
  accountBlocked: boolean;
  breaker?: { open?: boolean; [k: string]: unknown };
}

function AutopilotCard({ onToast }: { onToast: (text: string, kind?: ToastKind) => void }) {
  const [sched, setSched] = useState<SchedulerStatus | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/dialer/scheduler`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) setSched(await r.json());
    } catch { /* health dot already covers reachability */ }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  const runIngest = useCallback(async () => {
    setRunning(true);
    try {
      const r = await fetch(`${API_BASE}/dialer/ingest-run`, { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        onToast(`Ingest complete — ${d.pulled ?? 0} pulled, ${d.added ?? 0} added, ${d.injected ?? 0} dialing${d.dncExcluded ? `, ${d.dncExcluded} DNC` : ''}.`, 'success');
      } else {
        onToast(`Ingest skipped: ${d.reason || d.error || 'unknown'}`, 'info');
      }
      load();
    } catch {
      onToast('Could not run ingest — service unreachable.');
    } finally {
      setRunning(false);
    }
  }, [onToast, load]);

  const enabled  = sched?.enabled ?? false;
  const blocked  = sched?.accountBlocked ?? false;
  const breakerOpen = !!sched?.breaker?.open;
  const accent   = blocked || breakerOpen ? '#ff3366' : enabled ? '#4ade80' : '#52526e';

  const flags = sched?.doneToday;
  const fmtHour = (h: number) => {
    const hr = Math.floor(h); const m = Math.round((h - hr) * 60);
    const ampm = hr >= 12 ? 'PM' : 'AM'; const h12 = hr % 12 === 0 ? 12 : hr % 12;
    return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${ampm}`;
  };

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: `linear-gradient(135deg, ${accent}0c 0%, rgba(255,255,255,0.02) 100%)`, border: `1px solid ${accent}33` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={13} style={{ color: accent }} />
          <span className="text-[11px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#c4c4d6' }}>
            Autopilot
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded font-orbitron tracking-[1px] uppercase"
            style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}33` }}>
            {blocked ? 'Account blocked' : breakerOpen ? 'Breaker open' : enabled ? 'Armed' : 'Disabled'}
          </span>
        </div>
        <button
          onClick={runIngest}
          disabled={running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-orbitron tracking-[1px] uppercase disabled:opacity-40"
          style={{ background: 'rgba(0,229,255,0.08)', color: '#00e5ff', border: '1px solid rgba(0,229,255,0.2)' }}
        >
          {running ? <RefreshCw size={11} className="animate-spin" /> : <Power size={11} />}
          {running ? 'Running…' : 'Run ingest now'}
        </button>
      </div>

      {sched ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px]" style={{ color: '#8888aa' }}>
          <span>Auto-start <span style={{ color: '#c4c4d6' }}>{fmtHour(sched.autostartHour)}</span></span>
          {flags && (
            <span className="flex items-center gap-2">
              {(['ingest', 'summary', 'audit', 'cleanup'] as const).map(k => (
                <span key={k} className="flex items-center gap-1" title={`${k} ${flags[k] ? 'done' : 'pending'} today`}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: flags[k] ? '#4ade80' : '#3a3a52' }} />
                  {k}
                </span>
              ))}
            </span>
          )}
          {sched.lastAutoStartAt && (
            <span>last auto-start <span style={{ color: '#c4c4d6' }}>{timeAgo(sched.lastAutoStartAt)}</span></span>
          )}
        </div>
      ) : (
        <div className="text-[10px] italic" style={{ color: '#3a3a52' }}>Scheduler status unavailable.</div>
      )}
    </div>
  );
}

// ── Toast (transient error / info banner) ─────────────────────────────────────

type ToastKind = 'error' | 'success' | 'info';
interface ToastMsg { id: number; kind: ToastKind; text: string }

const TOAST_STYLE: Record<ToastKind, { color: string; icon: React.ElementType }> = {
  error:   { color: '#ff3366', icon: AlertTriangle },
  success: { color: '#4ade80', icon: CheckCircle   },
  info:    { color: '#00e5ff', icon: AlertCircle   },
};

function ToastStack({ toasts, onDismiss }: { toasts: ToastMsg[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {toasts.map(t => {
          const cfg = TOAST_STYLE[t.kind];
          const Icon = cfg.icon;
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
              className="rounded-xl px-4 py-3 flex items-start gap-2.5 shadow-lg cursor-pointer"
              style={{ background: '#15151f', border: `1px solid ${cfg.color}55`, boxShadow: `0 0 20px ${cfg.color}22` }}
              onClick={() => onDismiss(t.id)}
            >
              <Icon size={14} style={{ color: cfg.color, marginTop: 1, flexShrink: 0 }} />
              <span className="text-[12px] leading-snug" style={{ color: '#e8e8f0' }}>{t.text}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type DialerTab = 'live' | 'script' | 'analytics' | 'reviews';
type ServiceHealth = 'up' | 'down' | 'unknown';

const DIALER_TABS: { id: DialerTab; label: string; icon: React.ElementType }[] = [
  { id: 'live',     label: 'Live Dialer',           icon: Phone     },
  { id: 'script',   label: 'Script & Training',     icon: BookOpen  },
  { id: 'analytics',label: 'Performance Analytics', icon: BarChart3 },
  { id: 'reviews',  label: 'Call Review',           icon: List      },
];

export function MultiDialer() {
  // Tab
  const [tab, setTab] = useState<DialerTab>('live');

  // Toasts + service health
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [health, setHealth] = useState<ServiceHealth>('unknown');
  const toastSeq = useRef(0);
  const dismissToast = useCallback((id: number) => setToasts(ts => ts.filter(t => t.id !== id)), []);
  const showToast = useCallback((text: string, kind: ToastKind = 'error') => {
    const id = ++toastSeq.current;
    setToasts(ts => [...ts, { id, kind, text }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 6000);
  }, []);

  // Data
  const [leads,  setLeads]  = useState<Lead[]>([]);
  const [cursor, setCursor] = useState(0);

  // Session state (driven by backend status poll)
  const [dialerState, setDialerState] = useState<DialerState>('idle');
  const [sessionId,   setSessionId]   = useState<string>('');
  const [lanes,       setLanes]       = useState<Lane[]>(blankLanes());
  const [davidStatus, setDavidStatus] = useState<DavidStatus>('idle');
  const [davidLane,   setDavidLane]   = useState<number | null>(null);
  const [winnerLane,  setWinnerLane]  = useState<number | null>(null);
  const [activeLead,  setActiveLead]  = useState<Lead | null>(null);

  // Progress tracking from backend
  const [progress, setProgress] = useState<Progress>({ cursor: 0, total_leads: 0, completed: 0, remaining: 0 });

  // Clock (drives lane timers without re-polling)
  const [now, setNow] = useState(Date.now());

  // Live-transcript lane selection (null = auto-follow the connected lane)
  const [selectedLane, setSelectedLane] = useState<number | null>(null);

  // Stats
  const [stats, setStats] = useState<Stats>({ callsMade: 0, contacted: 0, hot: 0, totalSeconds: 0 });

  // Persistent list state
  const [listId, setListId]     = useState<string>('');
  const [listMeta, setListMeta] = useState<ListMeta | null>(null);
  const [uploading, setUploading] = useState(false);

  // Multi-list picker + live queue preview
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [queuePreview, setQueuePreview] = useState<Lead[]>([]);

  // Disposition extras: free-text note + pending callback time
  const [dispoNote, setDispoNote] = useState('');
  const [awaitingCallback, setAwaitingCallback] = useState(false);
  const [callbackTime, setCallbackTime] = useState('');

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

  // ── Service health poll — distinguishes "VPS down" from "idle" ──────────────
  useEffect(() => {
    let stopped = false;
    const ping = async () => {
      try {
        const r = await fetch(`${API_BASE}/dialer/healthz`, { signal: AbortSignal.timeout(5000) });
        if (!stopped) setHealth(r.ok ? 'up' : 'down');
      } catch { if (!stopped) setHealth('down'); }
    };
    ping();
    const iv = setInterval(ping, 20000);
    return () => { stopped = true; clearInterval(iv); };
  }, []);

  // ── Restore listId from localStorage on mount ──────────────────────────────
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('dialerListId') : '';
    if (saved) setListId(saved);
  }, []);

  // ── Seed today's stats from Supabase on mount ───────────────────────────────
  // The live poll only fills stats while dialing; without this, a page refresh
  // shows an empty day (0 calls, empty goal bar) even after a full morning.
  useEffect(() => {
    (async () => {
      try {
        const since = new Date(); since.setHours(0, 0, 0, 0);
        const { data, error } = await supabase
          .from('jarvis_calls')
          .select('stage_after, call_duration')
          .neq('phone', EXCLUDED_PHONE)
          .gte('called_at', since.toISOString())
          .limit(5000);
        if (error || !data) return;
        let calls = 0, contacted = 0, hot = 0, secs = 0;
        for (const r of data) {
          calls++;
          const o = callOutcomeFromRecord(r);
          if (o === 'hot' || o === 'warm' || o === 'cold') { contacted++; secs += r.call_duration || 0; }
          if (o === 'hot') hot++;
        }
        // Only seed if the live poll hasn't already produced higher numbers.
        setStats(s => ({
          callsMade:    Math.max(s.callsMade, calls),
          contacted:    Math.max(s.contacted, contacted),
          hot:          Math.max(s.hot, hot),
          totalSeconds: Math.max(s.totalSeconds, secs),
        }));
      } catch { /* offline — leave stats at zero */ }
    })();
  }, []);

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
          // Session TRULY ended — stop polling, go idle, blank the lanes.
          clearInterval(pollRef.current!); pollRef.current = null;
          setDialerState('idle');
          setActiveLead(null);
          setLanes(blankLanes());
          setWinnerLane(null);
          setDavidStatus('idle');
          setDavidLane(null);
        }
        // 'list' = a pass finished but the session is still alive (auto-recycle /
        // about to resume / momentarily reset). NEVER stop polling here — doing so
        // froze the whole dashboard mid-run. Keep polling so lanes stay live; just
        // refresh the list meta counts.
        if (data.status === 'list' && sid.startsWith('list_')) {
          fetch(`${API_BASE}/dialer/list/${sid}`)
            .then(r2 => r2.json())
            .then(d => {
              if (d.listId) setListMeta({ name: d.name, total: d.total, called: d.called, remaining: d.remaining, pass: d.pass, isDialing: !!d.isDialing });
            })
            .catch(() => {});
        }
        
        // Update stats from backend totals
        // Backend keys: total_calls, contacted_count, hot_count, duration_seconds
        if (data.totals) {
          setStats(s => ({
            callsMade:    data.totals.total_calls      ?? s.callsMade,
            contacted:    data.totals.contacted_count  ?? s.contacted,
            hot:          data.totals.hot_count        ?? s.hot,
            totalSeconds: data.totals.duration_seconds ?? s.totalSeconds,
          }));
        }
      } catch { /* swallow */ }
    }, 1500);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── Load list meta when listId changes (after startPolling is available) ───
  useEffect(() => {
    if (!listId) return;
    fetch(`${API_BASE}/dialer/list/${listId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          localStorage.removeItem('dialerListId');
          setListId('');
          return;
        }
        setListMeta({ name: data.name, total: data.total, called: data.called, remaining: data.remaining, pass: data.pass, isDialing: data.isDialing });
        setProgress({ cursor: data.called, total_leads: data.total, completed: data.called, remaining: data.remaining });
        if (data.isDialing) {
          setDialerState('dialing');
          setSessionId(listId);
          startPolling(listId);
        }
      })
      .catch(() => {});
  }, [listId, startPolling]);

  // ── Multi-list picker: load all lists from the backend ─────────────────────
  const loadLists = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/dialer/lists`);
      if (!r.ok) return;
      const d = await r.json();
      if (Array.isArray(d.lists)) setLists(d.lists);
    } catch { /* health dot covers reachability */ }
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  // Switch the active list (persists the selection for next page load).
  const switchList = useCallback((id: string) => {
    if (id === listId) { setShowPicker(false); return; }
    stopPolling();
    setDialerState('idle');
    setLanes(blankLanes());
    setWinnerLane(null);
    setDavidStatus('idle');
    setDavidLane(null);
    setActiveLead(null);
    setListId(id);
    setQueuePreview([]);
    if (typeof window !== 'undefined') localStorage.setItem('dialerListId', id);
    setShowPicker(false);
  }, [listId, stopPolling]);

  // Delete a list server-side, then refresh the picker.
  const deleteListById = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/dialer/list/${id}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    if (id === listId) {
      setListId('');
      setListMeta(null);
      setQueuePreview([]);
      if (typeof window !== 'undefined') localStorage.removeItem('dialerListId');
    }
    loadLists();
  }, [listId, loadLists]);

  // ── Live queue preview for the active list (next-up leads) ──────────────────
  useEffect(() => {
    if (!listId) { setQueuePreview([]); return; }
    let stopped = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/dialer/list/${listId}/queue?limit=20`);
        if (!r.ok || stopped) return;
        const d = await r.json();
        if (!stopped && Array.isArray(d.leads)) setQueuePreview(d.leads);
      } catch { /* transient */ }
    };
    load();
    // Refresh while dialing so the preview tracks the advancing queue.
    const iv = setInterval(load, 4000);
    return () => { stopped = true; clearInterval(iv); };
  }, [listId, dialerState]);

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

  // ── CSV upload — saves to Supabase for persistence ─────────────────────────
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const newLeads = parseCSV(ev.target?.result as string);
      if (!newLeads.length) {
        e.target.value = '';
        showToast('No valid leads found in that CSV — check the phone column.', 'error');
        return;
      }

      setUploading(true);
      try {
        const r = await fetch(`${API_BASE}/dialer/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leads: newLeads, name: file.name }),
        });
        const data = await r.json();
        if (data.ok && data.listId) {
          localStorage.setItem('dialerListId', data.listId);
          setListId(data.listId);
          setListMeta({ name: data.name, total: data.total, called: 0, remaining: data.total, pass: 1, isDialing: false });
          setLeads(newLeads);
          setCursor(0);
          setProgress({ cursor: 0, total_leads: data.total, completed: 0, remaining: data.total });
          showToast(`Uploaded "${data.name}" — ${data.total} leads ready${data.excluded ? `, ${data.excluded} DNC-excluded` : ''}.`, 'success');
          loadLists();
        } else {
          showToast(`Upload rejected: ${data.error || 'unknown error'}`);
        }
      } catch (err) {
        console.error('List upload failed — falling back to local mode:', err);
        showToast('Backend unreachable — leads loaded locally (will not survive refresh).', 'info');
        // Fallback: keep leads locally if backend unreachable
        setLeads(newLeads);
        setCursor(0);
        setProgress({ cursor: 0, total_leads: newLeads.length, completed: 0, remaining: newLeads.length });
      } finally {
        setUploading(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [showToast, loadLists]);

  // ── Start dialing session ─────────────────────────────────────────────────
  const dialNextBatch = useCallback(async (fromCursor: number) => {
    // ── LIST MODE: sessionId = listId, no leads in body ───────────────────
    if (listId) {
      const sid = listId;
      setSessionId(sid);
      setActiveLead(null);
      setWinnerLane(null);
      setDavidStatus('idle');
      setDavidLane(null);
      setDialerState('dialing');

      try {
        const r = await fetch(`${API_BASE}/dialer/call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid }),
        });
        const data = await r.json();
        if (!r.ok || !data.ok) {
          if (data.error === 'list_exhausted') {
            setDialerState('idle');
            // All leads dialed and nothing left to recycle
            setListMeta(m => m ? { ...m, remaining: 0 } : null);
            return;
          }
          console.error('dial failed', data);
          showToast(`Dial failed: ${data.error || 'backend rejected the request'}`);
          setDialerState('idle');
          return;
        }
        startPolling(sid);
      } catch (err) {
        console.error('Dial error:', err);
        showToast('Could not reach the dialer service — is the VPS up?');
        setDialerState('idle');
      }
      return;
    }

    // ── LEGACY MODE: no listId, send leads directly in body ───────────────
    if (fromCursor >= leads.length) { setDialerState('idle'); return; }

    const remainingLeads = leads.slice(fromCursor);
    const sid = genSessionId();
    setSessionId(sid);
    setActiveLead(null);
    setWinnerLane(null);
    setDavidStatus('idle');
    setDavidLane(null);
    setDialerState('dialing');
    setProgress({ cursor: fromCursor, total_leads: leads.length, completed: fromCursor, remaining: leads.length - fromCursor });

    try {
      const r = await fetch(`${API_BASE}/dialer/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, leads: remainingLeads, cursor: fromCursor, totalLeads: leads.length }),
      });
      if (!r.ok) { console.error('dial failed', await r.text()); showToast('Dial failed — backend rejected the request'); setDialerState('idle'); return; }
      startPolling(sid);
    } catch (err) {
      console.error('Dial error:', err);
      showToast('Could not reach the dialer service — is the VPS up?');
      setDialerState('idle');
    }
  }, [listId, leads, startPolling, showToast]);

  // Keep the ref pointed at the latest dialNextBatch for the status poll.
  useEffect(() => { dialNextBatchRef.current = dialNextBatch; }, [dialNextBatch]);

  // ── Controls ───────────────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    if (dialerState === 'paused' || dialerState === 'idle') {
      if (listId) {
        dialNextBatch(0); // list mode — position tracked by backend
      } else if (leads.length > 0) {
        dialNextBatch(cursor);
      }
    }
  }, [dialerState, listId, leads, cursor, dialNextBatch]);

  // Clear all live-call visuals. Without this, frozen lane state keeps the
  // "ACTIVE" badge and a client-side timer climbing forever (the timer is
  // computed from lane.started_at against a ticking clock).
  const clearLiveLanes = useCallback(() => {
    setLanes(blankLanes());
    setWinnerLane(null);
    setDavidStatus('idle');
    setDavidLane(null);
    setActiveLead(null);
  }, []);

  const handlePause = useCallback(() => {
    stopPolling();
    setDialerState('paused');
    clearLiveLanes();
    // Pause must stop the SERVER too — rotation keeps dialing on its own
    // otherwise. For list sessions 'list' status is exactly "paused"
    // (resumable); the stop endpoint also force-resolves dead hung lanes.
    const sid = sessionId || listId;
    if (sid) {
      fetch(`${API_BASE}/dialer/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      }).catch(console.error);
    }
  }, [stopPolling, clearLiveLanes, sessionId, listId]);

  const handleStop = useCallback(async () => {
    stopPolling();
    setDialerState('idle');
    clearLiveLanes();

    // Stop the session SERVER-SIDE too — without this the VPS keeps dialing
    // autonomously (webhook-driven rotation) until the queue is exhausted.
    // list_* sessions go back to status 'list' (resumable); in-flight calls
    // finish naturally.
    const sid = sessionId || listId;
    if (sid) {
      fetch(`${API_BASE}/dialer/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      }).catch(console.error);
    }

    if (listId) {
      // List mode: the list persists, don't reset progress — refresh meta so
      // called/remaining counts reflect the stopped pass, and surface a session
      // summary (the legacy-only modal never fired in the path actually used).
      setListMeta(m => (m ? { ...m, isDialing: false } : m));
      try {
        const r = await fetch(`${API_BASE}/dialer/list/${listId}`);
        const d = await r.json();
        if (d.listId) {
          setListMeta({ name: d.name, total: d.total, called: d.called, remaining: d.remaining, pass: d.pass, isDialing: false });
          setSummary({ calls: d.called, contacted: d.contacted, hot: d.hot, talk: stats.totalSeconds, session: stats.totalSeconds });
          setShowSummary(true);
        }
      } catch { /* ignore */ }
      loadLists();
      return;
    }

    // Legacy mode: pull session summary, then reset
    if (sessionId) {
      try {
        const r = await fetch(`${API_BASE}/dialer/session-summary?sessionId=${sessionId}`);
        if (r.ok) {
          const s = await r.json();
          setSummary({ calls: s.calls_made, contacted: s.contacted, hot: s.hot_leads, talk: s.talk_seconds, session: s.session_seconds });
          setShowSummary(true);
        }
      } catch { /* ignore */ }
    } else {
      setSummary({ calls: stats.callsMade, contacted: stats.contacted, hot: stats.hot, talk: stats.totalSeconds, session: stats.totalSeconds });
      setShowSummary(true);
    }

    setCursor(0);
    setProgress({ cursor: 0, total_leads: 0, completed: 0, remaining: 0 });
  }, [stopPolling, clearLiveLanes, listId, sessionId, stats, loadLists]);

  // ── Disposition ────────────────────────────────────────────────────────────
  const handleDisposition = useCallback(async (disp: Disposition, callbackAt?: string) => {
    const lead = activeLead;
    if (!lead) return;

    // Callback needs a time — first click reveals the picker, second confirms.
    if (disp === 'callback' && !callbackAt) { setAwaitingCallback(true); return; }

    const winnerStarted = winnerLane != null ? lanes[winnerLane]?.started_at : null;
    const callDuration = winnerStarted
      ? Math.max(0, Math.floor((Date.now() - new Date(winnerStarted).getTime()) / 1000))
      : 0;
    const isHot = disp === 'hot';
    const note = dispoNote.trim() || undefined;

    setStats(s => ({
      ...s,
      hot: s.hot + (isHot ? 1 : 0),
      totalSeconds: s.totalSeconds + callDuration,
    }));

    fetch(`${API_BASE}/dialer/disposition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition: disp, lead, callDuration, sessionId, note, callbackAt }),
    }).catch(err => { console.error(err); showToast('Failed to save disposition to the CRM.'); });

    // Reset the modal extras and let the backend's auto-rotation continue.
    setDispoNote('');
    setAwaitingCallback(false);
    setCallbackTime('');
    setActiveLead(null);
    setDialerState('dialing');

    // Resume polling to track backend's auto-rotation progress
    if (sessionId) {
      startPolling(sessionId);
    }
  }, [activeLead, winnerLane, lanes, sessionId, startPolling, showToast, dispoNote]);

  // Keyboard shortcuts 1–7 for fast disposition (ignored while typing the note).
  useEffect(() => {
    if (dialerState !== 'disposition' || !activeLead) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= DISPOSITIONS.length) {
        e.preventDefault();
        handleDisposition(DISPOSITIONS[n - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialerState, activeLead, handleDisposition]);

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
        <div className="flex items-center gap-4">
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
          {/* Service-health dot — distinguishes "VPS down" from "idle" */}
          <div className="flex items-center gap-1.5" title={`Dialer service: ${health}`}>
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: health === 'up' ? '#4ade80' : health === 'down' ? '#ff3366' : '#52526e',
                boxShadow: health === 'up' ? '0 0 8px #4ade80' : health === 'down' ? '0 0 8px #ff3366' : 'none',
              }}
            />
            <span className="text-[10px] font-orbitron" style={{ color: '#8888aa' }}>
              {health === 'up' ? 'ONLINE' : health === 'down' ? 'OFFLINE' : '···'}
            </span>
          </div>
        </div>
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

          {/* Autopilot / scheduler */}
          <AutopilotCard onToast={showToast} />

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

          {/* Paused banner — session context is kept; Resume to continue */}
          {dialerState === 'paused' && (
            <div className="rounded-xl px-4 py-2.5 flex items-center gap-2"
              style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}>
              <Pause size={13} style={{ color: '#fbbf24' }} />
              <span className="text-[10px] font-orbitron tracking-[1px] uppercase" style={{ color: '#fbbf24' }}>
                Paused
              </span>
              <span className="text-[10px]" style={{ color: '#8888aa' }}>
                — list and progress kept. Press Resume to keep dialing, or Stop to end the session.
              </span>
            </div>
          )}

          {/* 5 lane grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {lanes.map(lane => (
              <LaneCard key={lane.idx} lane={lane} now={now} isWinner={winnerLane === lane.idx}
                isSelected={selectedLane === lane.idx}
                onSelect={() => setSelectedLane(s => (s === lane.idx ? null : lane.idx))} />
            ))}
          </div>

          {/* Live transcript — clicked lane, else auto-follow the live one */}
          <TranscriptPanel
            pinned={selectedLane != null}
            lane={
              (selectedLane != null ? lanes[selectedLane] : null) ||
              lanes.find(l => l.state === 'connected' && winnerLane === l.idx) ||
              lanes.find(l => l.state === 'connected') ||
              null
            }
          />

          {/* Lead-list manager — picker + active list / upload */}
          <div className="flex flex-col gap-3">
            {/* Toolbar: switch lists + upload a new one */}
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => { setShowPicker(p => !p); loadLists(); }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-orbitron tracking-[1px] uppercase"
                style={{ background: 'rgba(255,255,255,0.03)', color: '#8888aa', border: '1px solid rgba(255,255,255,0.06)' }}
                title="Switch between saved lists"
              >
                <List size={12} />
                {lists.length} {lists.length === 1 ? 'List' : 'Lists'}
                {showPicker ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium disabled:opacity-50"
                style={{ background: 'rgba(74,222,128,0.08)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}
              >
                {uploading ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={12} />}
                {uploading ? 'Uploading…' : 'New list (CSV)'}
              </button>
            </div>

            {/* Picker dropdown */}
            <AnimatePresence>
              {showPicker && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden rounded-2xl"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="p-2 flex flex-col gap-1 max-h-64 overflow-y-auto">
                    {lists.length === 0 ? (
                      <div className="text-[10px] italic text-center py-4" style={{ color: '#3a3a52' }}>
                        No saved lists — upload a CSV to create one.
                      </div>
                    ) : lists.map(l => {
                      const active = l.listId === listId;
                      const pct = l.total > 0 ? Math.min(100, (l.called / l.total) * 100) : 0;
                      return (
                        <div
                          key={l.listId}
                          onClick={() => switchList(l.listId)}
                          className="flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-all"
                          style={{
                            background: active ? 'rgba(0,229,255,0.06)' : 'transparent',
                            border: `1px solid ${active ? 'rgba(0,229,255,0.3)' : 'transparent'}`,
                          }}
                        >
                          <Database size={13} style={{ color: active ? '#00e5ff' : '#52526e', flexShrink: 0 }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium truncate" style={{ color: active ? '#e8e8f0' : '#c4c4d6' }}>
                              {l.name}
                              {l.pass > 1 && <span className="ml-1.5 text-[8px]" style={{ color: '#a78bfa' }}>·P{l.pass}</span>}
                            </div>
                            <div className="text-[9px] mt-0.5" style={{ color: '#52526e' }}>
                              {l.called.toLocaleString()}/{l.total.toLocaleString()} called · {l.remaining.toLocaleString()} left · {l.hot} hot
                            </div>
                            <div className="h-1 mt-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #00e5ff, #4ade80)' }} />
                            </div>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); deleteListById(l.listId); }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: 'rgba(255,51,102,0.06)', border: '1px solid rgba(255,51,102,0.15)' }}
                            title="Delete this list permanently"
                          >
                            <Trash2 size={11} style={{ color: '#ff3366' }} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Active list card OR empty prompt */}
            {listMeta ? (
              <div
                className="rounded-2xl p-4 flex flex-col gap-3"
                style={{ background: 'rgba(0,229,255,0.03)', border: '1px solid rgba(0,229,255,0.12)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database size={14} style={{ color: '#00e5ff' }} />
                    <span className="text-[10px] font-orbitron tracking-[1px] uppercase" style={{ color: '#00e5ff' }}>
                      Active List
                    </span>
                    {listMeta.pass > 1 && (
                      <span className="text-[8px] px-1.5 py-0.5 rounded font-orbitron"
                        style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.3)' }}>
                        Pass {listMeta.pass}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => deleteListById(listId)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px]"
                    style={{ background: 'rgba(255,51,102,0.06)', color: '#ff3366', border: '1px solid rgba(255,51,102,0.15)' }}
                    title="Delete this list permanently"
                  >
                    <Trash2 size={10} />
                    Delete
                  </button>
                </div>

                <div>
                  <div className="text-[13px] font-medium truncate" style={{ color: '#e8e8f0' }}>
                    {listMeta.name}
                  </div>
                  <div className="text-[10px] mt-1" style={{ color: '#8888aa' }}>
                    <span style={{ color: '#00e5ff' }}>{listMeta.called.toLocaleString()}</span>
                    {' / '}
                    {listMeta.total.toLocaleString()} called
                    {' · '}
                    <span style={{ color: listMeta.remaining > 0 ? '#fbbf24' : '#4ade80' }}>
                      {listMeta.remaining.toLocaleString()} remaining
                    </span>
                  </div>
                </div>

                {listMeta.total > 0 && (
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (listMeta.called / listMeta.total) * 100)}%`,
                        background: 'linear-gradient(90deg, #00e5ff, #4ade80)',
                      }}
                    />
                  </div>
                )}

                {listMeta.remaining === 0 && (
                  <div className="flex items-center gap-1.5 text-[10px]" style={{ color: '#4ade80' }}>
                    <CheckCircle size={11} />
                    All leads dialed — upload a new CSV to start a fresh list
                  </div>
                )}
              </div>
            ) : (
              <div
                className="rounded-2xl p-4 flex items-center justify-between"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div>
                  <div className="text-[11px] font-medium" style={{ color: '#c4c4d6' }}>
                    {uploading ? 'Uploading…' : 'No active list — upload a CSV or pick one above'}
                  </div>
                  <div className="text-[9px] mt-0.5" style={{ color: '#3a3a52' }}>
                    Leads saved to cloud — survive refresh, crash, and restart
                  </div>
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium disabled:opacity-50"
                  style={{ background: 'rgba(74,222,128,0.08)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}
                >
                  {uploading ? <RefreshCw size={11} className="animate-spin" /> : <Upload size={11} />}
                  {uploading ? 'Uploading…' : 'Upload CSV'}
                </button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />

          {/* Disposition (after a call ends) */}
          <AnimatePresence>
            {dialerState === 'disposition' && activeLead && (
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="rounded-2xl p-4 flex flex-col gap-3"
                style={{ background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.2)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#a78bfa' }}>
                    Disposition · {activeLead.name}
                  </div>
                  <span className="text-[8px]" style={{ color: '#52526e' }}>press 1–{DISPOSITIONS.length}</span>
                </div>

                {/* Optional note → flows into the GHL contact note */}
                <input
                  value={dispoNote}
                  onChange={e => setDispoNote(e.target.value)}
                  placeholder="Optional note (saved to CRM)…"
                  className="w-full rounded-lg px-3 py-2 text-[11px] outline-none"
                  style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}
                />

                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {DISPOSITIONS.map((d, i) => {
                    const Icon = d.icon;
                    return (
                      <button
                        key={d.id}
                        onClick={() => handleDisposition(d.id)}
                        className="relative flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all"
                        style={{ background: `${d.color}0c`, border: `1px solid ${d.color}33` }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${d.color}1a`; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${d.color}0c`; }}
                      >
                        <span className="absolute top-1 left-1.5 text-[8px] font-orbitron" style={{ color: `${d.color}99` }}>{i + 1}</span>
                        <Icon size={16} style={{ color: d.color }} />
                        <span className="text-[10px] font-medium" style={{ color: d.color }}>{d.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Callback time picker — appears when Callback is chosen */}
                <AnimatePresence>
                  {awaitingCallback && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2 overflow-hidden"
                    >
                      <Calendar size={14} style={{ color: '#22d3ee', flexShrink: 0 }} />
                      <input
                        type="datetime-local"
                        value={callbackTime}
                        onChange={e => setCallbackTime(e.target.value)}
                        className="flex-1 rounded-lg px-3 py-2 text-[11px] outline-none"
                        style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(34,211,238,0.3)', color: '#e8e8f0' }}
                      />
                      <button
                        onClick={() => callbackTime && handleDisposition('callback', new Date(callbackTime).toLocaleString('en-US', { timeZone: 'America/New_York' }))}
                        disabled={!callbackTime}
                        className="px-3 py-2 rounded-lg text-[10px] font-orbitron tracking-[1px] uppercase disabled:opacity-40"
                        style={{ background: 'rgba(34,211,238,0.12)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)' }}
                      >
                        Confirm
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {(dialerState === 'idle' || dialerState === 'paused') && (
              <button
                onClick={handleStart}
                disabled={!listId && (leads.length === 0 || remaining === 0)}
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

          {/* Lead queue preview — backend queue in list mode, local slice in legacy */}
          {(listId ? queuePreview.length > 0 : leads.length > 0) && (() => {
            const rows = listId ? queuePreview : leads.slice(cursor, cursor + 20);
            return (
              <div
                className="rounded-2xl p-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div className="text-[9px] font-orbitron tracking-[1.5px] uppercase mb-3" style={{ color: '#52526e' }}>
                  Queue — {progress.remaining} remaining
                </div>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {rows.map((lead, i) => {
                    const absIdx = listId ? i : cursor + i;
                    const isCurrentBatch = dialerState !== 'idle' && i < LANE_COUNT;
                    // In list mode the preview is purely upcoming leads (backend
                    // pops as it dials), so there's no "completed" marker here.
                    const isCompleted = !listId && absIdx < progress.completed;
                    return (
                      <div
                        key={`${absIdx}-${lead.phone}`}
                        className="flex items-center gap-3 py-1.5 px-2 rounded-lg"
                        style={{
                          background: isCurrentBatch ? 'rgba(251,191,36,0.05)' : 'transparent',
                          borderLeft: isCurrentBatch ? '2px solid rgba(251,191,36,0.4)' : isCompleted ? '2px solid rgba(74,222,128,0.2)' : '2px solid transparent',
                        }}
                      >
                        <div className="text-[9px] w-4" style={{ color: isCompleted ? '#4ade80' : '#3a3a52' }}>{absIdx + 1}</div>
                        <div className="flex-1 text-[10px] truncate" style={{ color: isCurrentBatch ? '#c4c4d6' : '#52526e' }}>
                          {lead.name || '—'}
                        </div>
                        <div className="text-[9px]" style={{ color: '#3a3a52' }}>{lead.phone}</div>
                      </div>
                    );
                  })}
                  {progress.remaining > rows.length && (
                    <div className="text-[9px] text-center pt-1" style={{ color: '#3a3a52' }}>
                      +{progress.remaining - rows.length} more
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {tab === 'script' && (
        <ScriptTraining />
      )}

      {tab === 'analytics' && <PerformanceAnalytics />}

      {tab === 'reviews' && <CallReview />}

      {/* Summary modal */}
      <AnimatePresence>
        {showSummary && (
          <SummaryModal open={showSummary} onClose={() => setShowSummary(false)} summary={summary} />
        )}
      </AnimatePresence>

      {/* Transient error / info toasts */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}