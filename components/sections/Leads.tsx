'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, Clock, MapPin, FileText, Check, X, Send, Loader2, Radio,
  LayoutGrid, List as ListIcon, Play, Pause, GripVertical,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead, Temp, Source, LEADS_API } from '@/lib/hooks/useLeads';
import { fmtTime, fmtDate } from '@/lib/supabase';

const TEMP_COLOR: Record<Temp, string> = {
  hot:  '#ff3366',
  warm: '#ff8800',
  cold: '#00aaff',
  dead: '#5a5a80',
  new:  '#67e8f9',
};
const TEMP_LABEL: Record<Temp, string> = {
  hot: 'HOT', warm: 'WARM', cold: 'COLD', dead: 'DEAD', new: 'NEW',
};

const SOURCE_META: Record<Source, { label: string; color: string }> = {
  cold:   { label: 'Cold Outbound', color: '#00aaff' },
  ispeed: { label: 'iSpeed',        color: '#ffd700' },
};

function fmtDuration(sec?: number | null) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const FADE_UP = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };

type StatusFilter = 'all' | 'hot' | 'warm' | 'cold' | 'dead';
type SourceFilter = 'all' | Source;
type View = 'list' | 'board';

const BOARD_COLUMNS: { temp: Exclude<Temp, 'new'>; label: string }[] = [
  { temp: 'hot',  label: 'HOT' },
  { temp: 'warm', label: 'WARM' },
  { temp: 'cold', label: 'COLD' },
  { temp: 'dead', label: 'DEAD' },
];

export function Leads() {
  const { refreshKey, refresh } = useApp();
  const { leads, stats, statsBySource, live, callsToday, loading, error } = useLeads(refreshKey);

  const [source, setSource] = useState<SourceFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [view, setView]     = useState<View>('list');

  // Local mirror so board drag-drop can update temperature optimistically.
  const [localLeads, setLocalLeads] = useState<Lead[]>([]);
  useEffect(() => { setLocalLeads(leads); }, [leads]);

  // stats reflect the active source filter
  const activeStats = source === 'all' ? stats : statsBySource[source];

  const answerRate = useMemo(() => {
    const scoped = localLeads.filter(l => source === 'all' || l.source === source);
    const withCall = scoped.filter(l => l.callDuration != null);
    if (!withCall.length) return 0;
    const answered = withCall.filter(l => (l.callDuration || 0) > 15).length;
    return Math.round((answered / withCall.length) * 100);
  }, [localLeads, source]);

  const bySource = useMemo(
    () => (source === 'all' ? localLeads : localLeads.filter(l => l.source === source)),
    [localLeads, source]
  );

  const filtered = useMemo(
    () => (status === 'all' ? bySource : bySource.filter(l => l.temp === status)),
    [bySource, status]
  );

  // Move a lead to a new temperature (board drag-drop) — optimistic + GHL write.
  async function moveTemp(lead: Lead, temp: Exclude<Temp, 'new'>) {
    if (lead.temp === temp || !lead.contactId) return;
    setLocalLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, temp } : l)));
    try {
      await fetch(`${LEADS_API}/lead-action?action=settemp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: lead.contactId, temp, pipelineId: lead.pipelineId,
          name: lead.name, address: lead.address,
        }),
      });
    } catch { /* next 30s refresh reconciles */ }
  }

  const SOURCE_TABS: { key: SourceFilter; label: string; count: number; color: string }[] = [
    { key: 'all',    label: 'All',           count: stats.total,            color: '#00e5ff' },
    { key: 'cold',   label: 'Cold Outbound', count: statsBySource.cold.total,   color: SOURCE_META.cold.color },
    { key: 'ispeed', label: 'iSpeed',        count: statsBySource.ispeed.total, color: SOURCE_META.ispeed.color },
  ];

  const STATUS_TABS: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all',  label: 'All',  count: activeStats.total },
    { key: 'hot',  label: 'HOT',  count: activeStats.hot },
    { key: 'warm', label: 'WARM', count: activeStats.warm },
    { key: 'cold', label: 'COLD', count: activeStats.cold },
    { key: 'dead', label: 'DEAD', count: activeStats.dead },
  ];

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">

      {/* ── Stats bar ── */}
      <motion.div variants={FADE_UP} className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: 'Total Leads', value: activeStats.total, color: '#00e5ff' },
          { label: 'Hot',         value: activeStats.hot,   color: TEMP_COLOR.hot },
          { label: 'Warm',        value: activeStats.warm,  color: TEMP_COLOR.warm },
          { label: 'Cold',        value: activeStats.cold,  color: TEMP_COLOR.cold },
          { label: 'Answer Rate', value: answerRate,        color: '#4ade80', suffix: '%' },
          { label: 'Calls Today', value: callsToday,        color: '#aa44ff' },
        ].map(m => (
          <GlassCard key={m.label} accent="cyan" padding="p-3" hover={false}>
            <div className="text-[8px] text-dimtext font-orbitron tracking-[1px] uppercase mb-1">{m.label}</div>
            <div className="flex items-baseline">
              <AnimatedCounter target={m.value} className="font-orbitron text-[26px] font-black block" style={{ color: m.color } as React.CSSProperties} />
              {m.suffix && <span className="font-orbitron text-[14px] font-black" style={{ color: m.color }}>{m.suffix}</span>}
            </div>
          </GlassCard>
        ))}
      </motion.div>

      {/* ── Source filter + view toggle ── */}
      <motion.div variants={FADE_UP} className="flex items-center flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {SOURCE_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setSource(t.key)}
              className="px-3 py-1.5 rounded-sm text-[10px] font-orbitron tracking-[1px] uppercase border transition-all"
              style={{
                color: source === t.key ? '#0c0d14' : t.color,
                background: source === t.key ? t.color : `${t.color}10`,
                borderColor: `${t.color}55`,
              }}
            >
              {t.label} <span className="opacity-70">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={refresh} className="text-[9px] text-dimtext hover:text-ncyan transition-colors px-2">↻ Refresh</button>
          <div className="flex items-center rounded-sm border border-border2 overflow-hidden">
            {([['list', ListIcon], ['board', LayoutGrid]] as const).map(([v, Icon]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-orbitron tracking-wider uppercase transition-colors"
                style={{
                  color: view === v ? '#0c0d14' : '#7a7a9a',
                  background: view === v ? '#00e5ff' : 'transparent',
                }}
              >
                <Icon size={11} /> {v}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Live / recent call feed ── */}
      <motion.div variants={FADE_UP}>
        <SectionTitle accent="red" badge={`${live.filter(l => l.isLive).length} live`}>Live Call Feed</SectionTitle>
        {live.length === 0 ? (
          <div className="text-dimtext text-[11px] italic py-4 px-1">No calls yet today.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {live.map(c => (
              <div
                key={c.id}
                className="flex items-center gap-3 px-3 py-2 rounded-sm border"
                style={{
                  background: c.isLive ? 'rgba(255,51,102,0.06)' : 'rgba(255,255,255,0.02)',
                  borderColor: c.isLive ? 'rgba(255,51,102,0.3)' : 'var(--border2, rgba(255,255,255,0.06))',
                }}
              >
                <Radio size={13} style={{ color: c.isLive ? '#ff3366' : '#52526e' }} className={c.isLive ? 'animate-pulse' : ''} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-textb truncate">{c.name}</div>
                  {c.address && <div className="text-[9px] text-dimtext truncate">{c.address}</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[10px] font-orbitron text-ncyan flex items-center gap-1 justify-end"><Clock size={8} /> {fmtDuration(c.duration)}</div>
                  <div className="text-[8px] text-dimtext truncate max-w-[120px]">{c.phase}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* ── Status tabs (list view only) ── */}
      {view === 'list' && (
        <motion.div variants={FADE_UP}>
          <div className="flex items-center gap-0 mb-3 border-b border-border2">
            {STATUS_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setStatus(t.key)}
                className="px-4 py-2 text-[10px] font-orbitron tracking-[1px] uppercase border-b-2 transition-all -mb-px"
                style={{
                  color: status === t.key ? (t.key === 'all' ? '#00e5ff' : TEMP_COLOR[t.key as Temp]) : '#5a5a80',
                  borderColor: status === t.key ? (t.key === 'all' ? '#00e5ff' : TEMP_COLOR[t.key as Temp]) : 'transparent',
                }}
              >
                {t.label} <span className="opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {error && (
        <div className="text-nred text-[10px] italic py-3">Failed to load leads from GHL: {error}</div>
      )}
      {loading && localLeads.length === 0 && (
        <div className="flex items-center gap-2 text-dimtext text-[11px] py-8 justify-center">
          <Loader2 size={14} className="animate-spin" /> Loading leads from GHL…
        </div>
      )}

      {/* ── List view ── */}
      {view === 'list' && !loading && (
        <motion.div variants={FADE_UP}>
          {filtered.length === 0 && !error ? (
            <div className="text-dimtext text-[11px] italic py-8 text-center">No leads in this view.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filtered.map(lead => <LeadCard key={lead.id} lead={lead} />)}
            </div>
          )}
        </motion.div>
      )}

      {/* ── Board view (Kanban + drag-drop) ── */}
      {view === 'board' && !loading && (
        <motion.div variants={FADE_UP}>
          <BoardView leads={bySource} onMove={moveTemp} />
        </motion.div>
      )}
    </motion.div>
  );
}

/* ───────────────────────── Board view ───────────────────────── */

function BoardView({ leads, onMove }: { leads: Lead[]; onMove: (l: Lead, t: Exclude<Temp, 'new'>) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Temp | null>(null);

  // 'new' leads live in COLD column so nothing is hidden on the board.
  const colTemp = (t: Temp): Exclude<Temp, 'new'> => (t === 'new' ? 'cold' : t);
  const byCol = (temp: Exclude<Temp, 'new'>) => leads.filter(l => colTemp(l.temp) === temp);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {BOARD_COLUMNS.map(col => {
        const c = TEMP_COLOR[col.temp];
        const items = byCol(col.temp);
        const isOver = overCol === col.temp;
        return (
          <div
            key={col.temp}
            onDragOver={e => { e.preventDefault(); setOverCol(col.temp); }}
            onDragLeave={() => setOverCol(o => (o === col.temp ? null : o))}
            onDrop={() => {
              const lead = leads.find(l => l.id === dragId);
              if (lead) onMove(lead, col.temp);
              setDragId(null); setOverCol(null);
            }}
            className="flex flex-col rounded-sm border transition-colors min-h-[200px]"
            style={{
              borderColor: isOver ? c : 'var(--border2, rgba(255,255,255,0.06))',
              background: isOver ? `${c}0c` : 'rgba(255,255,255,0.015)',
            }}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: `${c}30` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
              <span className="font-orbitron text-[10px] font-bold tracking-[2px]" style={{ color: c }}>{col.label}</span>
              <span className="ml-auto text-[9px] text-dimtext font-orbitron">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-2 flex-1">
              {items.length === 0 && (
                <div className="text-dimtext text-[9px] italic text-center py-6">Drop here</div>
              )}
              {items.map(lead => (
                <div
                  key={lead.id}
                  draggable
                  onDragStart={() => setDragId(lead.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  style={{ opacity: dragId === lead.id ? 0.4 : 1 }}
                >
                  <LeadCard lead={lead} compact />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Lead card ───────────────────────── */

function Field({ label, value, color }: { label: string; value: string | null; color?: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col">
      <span className="text-[7px] text-dimtext font-orbitron tracking-[1px] uppercase">{label}</span>
      <span className="text-[10px] text-textb truncate" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function SourceBadge({ source }: { source: Source }) {
  const m = SOURCE_META[source];
  return (
    <span
      className="text-[7px] font-orbitron font-bold tracking-[1px] px-1.5 py-0.5 rounded-sm whitespace-nowrap"
      style={{ background: `${m.color}1a`, color: m.color, border: `1px solid ${m.color}40` }}
    >
      {m.label.toUpperCase()}
    </span>
  );
}

function LeadCard({ lead, compact = false }: { lead: Lead; compact?: boolean }) {
  const c = TEMP_COLOR[lead.temp];
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [cbState, setCbState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [showTx, setShowTx] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function saveNote() {
    if (!note.trim() || !lead.contactId) return;
    setNoteState('saving');
    try {
      const r = await fetch(`${LEADS_API}/lead-action?action=note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: lead.contactId, note, name: lead.name, address: lead.address }),
      });
      if (!r.ok) throw new Error();
      setNoteState('saved'); setNote('');
      setTimeout(() => setNoteState('idle'), 2500);
    } catch { setNoteState('error'); }
  }

  async function approveCallback() {
    if (!lead.contactId) return;
    setCbState('saving');
    try {
      const r = await fetch(`${LEADS_API}/lead-action?action=callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: lead.contactId, name: lead.name, address: lead.address, pipelineId: lead.pipelineId, note: note.trim() || undefined }),
      });
      if (!r.ok) throw new Error();
      setCbState('done');
    } catch { setCbState('error'); }
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); } else { el.play().catch(() => {}); }
  }

  const hasRecording = !!lead.recordingUrl;
  const hasTranscript = !!(lead.transcript || lead.summary);

  return (
    <GlassCard accent={lead.temp === 'hot' ? 'red' : lead.temp === 'warm' ? 'orange' : 'blue'} padding={compact ? 'p-3' : 'p-4'} hover={!compact}>
      {/* header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex items-center gap-2">
          {compact && <GripVertical size={11} className="text-dimtext flex-shrink-0 cursor-grab" />}
          <div className="min-w-0">
            <div className="font-orbitron text-[12px] font-bold text-textb truncate">{lead.name}</div>
            {lead.address && (
              <div className="text-[9px] text-dimtext flex items-center gap-1 mt-0.5 truncate">
                <MapPin size={8} className="flex-shrink-0" /> {lead.address}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <SourceBadge source={lead.source} />
          <span
            className="text-[8px] font-orbitron font-bold tracking-[1px] px-2 py-0.5 rounded-sm"
            style={{ background: `${c}1a`, color: c, border: `1px solid ${c}40` }}
          >
            {TEMP_LABEL[lead.temp]}
          </span>
        </div>
      </div>

      {/* stage + call meta */}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mb-3 text-[9px] text-dimtext">
        <span className="px-1.5 py-0.5 rounded-sm" style={{ background: `${c}12`, color: c }}>{lead.stageName}</span>
        {lead.phone && <span className="flex items-center gap-1"><Phone size={8} /> {lead.phone}</span>}
        {lead.callDuration != null && <span className="flex items-center gap-1"><Clock size={8} /> {fmtDuration(lead.callDuration)}</span>}
        {lead.calledAt && <span>{fmtDate(lead.calledAt)} {fmtTime(lead.calledAt)}</span>}
      </div>

      {/* fields grid */}
      {!compact && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 pb-3 border-b border-border2">
          <Field label="Pain"     value={lead.pain} />
          <Field label="Timeline" value={lead.timeline} />
          <Field label="Asking"   value={lead.askingPrice} color="#4ade80" />
          <Field label="Condition" value={lead.condition} />
          <Field label="ARV"      value={lead.arv} />
          <Field label="Mkt Value" value={lead.marketValue} />
          <Field label="Occupancy" value={lead.occupancy} />
          <Field label="Pipeline $" value={lead.value ? `$${lead.value.toLocaleString()}` : null} />
        </div>
      )}
      {compact && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Field label="Asking"   value={lead.askingPrice} color="#4ade80" />
          <Field label="Timeline" value={lead.timeline} />
        </div>
      )}

      {/* note box (list view only) */}
      {!compact && (
        <div className="flex gap-2 mb-2">
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveNote(); }}
            placeholder="Add a note for David…"
            className="flex-1 bg-bg3 border border-border2 rounded-sm px-2 py-1.5 text-[10px] text-textb placeholder:text-dimtext focus:outline-none focus:border-ncyan/50"
          />
          <button
            onClick={saveNote}
            disabled={!note.trim() || !lead.contactId || noteState === 'saving'}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-sm text-[9px] font-orbitron tracking-wider border transition-colors disabled:opacity-40"
            style={{ color: '#00e5ff', borderColor: 'rgba(0,229,255,0.3)', background: 'rgba(0,229,255,0.06)' }}
          >
            {noteState === 'saving' ? <Loader2 size={10} className="animate-spin" /> :
             noteState === 'saved'  ? <Check size={10} /> : <Send size={10} />}
            {noteState === 'saved' ? 'Saved' : 'Note'}
          </button>
        </div>
      )}

      {/* actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setShowTx(true)}
          disabled={!hasTranscript}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[9px] font-orbitron tracking-wider border border-border2 text-jtext hover:text-textb hover:border-white/20 transition-colors disabled:opacity-30"
        >
          <FileText size={10} /> Transcript
        </button>
        <button
          onClick={togglePlay}
          disabled={!hasRecording}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[9px] font-orbitron tracking-wider border transition-colors disabled:opacity-30"
          style={{ color: '#aa44ff', borderColor: 'rgba(170,68,255,0.35)', background: 'rgba(170,68,255,0.08)' }}
        >
          {playing ? <Pause size={10} /> : <Play size={10} />} {playing ? 'Pause' : 'Recording'}
        </button>
        <button
          onClick={approveCallback}
          disabled={!lead.contactId || cbState === 'saving' || cbState === 'done'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[9px] font-orbitron tracking-wider border transition-colors disabled:opacity-50 ml-auto"
          style={{ color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.08)' }}
        >
          {cbState === 'saving' ? <Loader2 size={10} className="animate-spin" /> :
           cbState === 'done'   ? <Check size={10} /> :
           cbState === 'error'  ? <X size={10} /> : <Phone size={10} />}
          {cbState === 'done' ? 'Scheduled' : cbState === 'error' ? 'Failed' : 'Callback'}
        </button>
      </div>

      {hasRecording && (
        <audio
          ref={audioRef}
          src={lead.recordingUrl || undefined}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      )}

      {/* transcript modal */}
      <AnimatePresence>
        {showTx && (
          <TranscriptModal lead={lead} onClose={() => setShowTx(false)} />
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

function TranscriptModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-sm border border-border2 p-5"
        style={{ background: 'rgba(12,12,24,0.98)' }}
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-dimtext hover:text-textb"><X size={16} /></button>
        <div className="font-orbitron text-[13px] font-bold text-textb mb-1">{lead.name}</div>
        {lead.address && <div className="text-[10px] text-dimtext mb-3">{lead.address}</div>}

        {lead.recordingUrl && (
          <div className="mb-4">
            <SectionTitle accent="purple">Recording</SectionTitle>
            <audio src={lead.recordingUrl} controls className="w-full h-9" />
          </div>
        )}

        {lead.summary && (
          <div className="mb-4">
            <SectionTitle accent="cyan">Summary</SectionTitle>
            <p className="text-[11px] text-jtext leading-relaxed whitespace-pre-wrap">{lead.summary}</p>
          </div>
        )}

        <SectionTitle accent="green">Full Transcript</SectionTitle>
        {lead.transcript ? (
          <pre className="text-[10px] text-jtext leading-relaxed whitespace-pre-wrap font-sans">{lead.transcript}</pre>
        ) : (
          <p className="text-[10px] text-dimtext italic">No transcript recorded for this lead.</p>
        )}
      </motion.div>
    </motion.div>
  );
}
