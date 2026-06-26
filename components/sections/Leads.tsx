'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, Clock, MapPin, FileText, Check, X, Send, Loader2, Radio,
  LayoutGrid, List as ListIcon, Play, Pause, ChevronDown, Activity,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead, Temp, Source, PipelineMeta, LEADS_API } from '@/lib/hooks/useLeads';
import { timeAgo } from '@/lib/supabase';

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
  alpha:  { label: '♦️ Alpha Leads', color: '#00d4ff' },
  sarah:  { label: '🤖 Sarah',       color: '#aa44ff' },
  ispeed: { label: 'iSpeed',         color: '#ffd700' },
};

function fmtDuration(sec?: number | null) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Normalize a stage label (strip emoji / spacing / case) for matching across
// pipelines whose attempt/follow-up stages share identical names.
const normStage = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const FADE_UP = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };

type SourceFilter = 'all' | Source;
type View = 'board' | 'list';

export function Leads() {
  const { refreshKey, refresh } = useApp();
  const { leads, stats, statsBySource, pipelines, live, callsToday, loading, error } = useLeads(refreshKey);

  const [source, setSource] = useState<SourceFilter>('all');
  const [view, setView]     = useState<View>('board');

  // Local mirror so board drag-drop can update stage optimistically.
  const [localLeads, setLocalLeads] = useState<Lead[]>([]);
  useEffect(() => { setLocalLeads(leads); }, [leads]);

  const activeStats = source === 'all' ? stats : statsBySource[source];

  const bySource = useMemo(
    () => (source === 'all' ? localLeads : localLeads.filter(l => l.source === source)),
    [localLeads, source]
  );

  const answerRate = useMemo(() => {
    // Answer rate = answered / DIALED, not answered/answered. The old denominator
    // only counted leads that already had a call duration, so it always read ~100%.
    const dialed = bySource.filter(l => (l.attempts || 0) > 0);
    if (!dialed.length) return 0;
    const answered = dialed.filter(l => (l.callDuration || 0) > 15).length;
    return Math.round((answered / dialed.length) * 100);
  }, [bySource]);

  // Which pipeline(s) feed the board columns for the active source filter.
  const activePipelines = useMemo<PipelineMeta[]>(() => {
    if (source === 'ispeed') return pipelines.filter(p => p.source === 'ispeed');
    if (source === 'alpha' || source === 'sarah') return pipelines.filter(p => p.source === 'va');
    return pipelines; // 'all'
  }, [pipelines, source]);

  // Recent activity = most recently updated leads in scope (leads arrive
  // already sorted by updatedAt desc from the backend).
  const recent = useMemo(
    () => [...bySource].filter(l => l.updatedAt).slice(0, 10),
    [bySource]
  );

  // Move a lead to a different GHL stage (board drag-drop) — optimistic + write.
  async function moveStage(lead: Lead, stageName: string) {
    if (normStage(lead.stageName) === normStage(stageName) || !lead.contactId) return;
    setLocalLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, stageName } : l)));
    try {
      await fetch(`${LEADS_API}/lead-action?action=setstage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: lead.contactId, pipelineId: lead.pipelineId, stageName,
          name: lead.name, address: lead.address,
        }),
      });
    } catch { /* next 30s refresh reconciles */ }
  }

  const SOURCE_TABS: { key: SourceFilter; label: string; count: number; color: string }[] = [
    { key: 'all',    label: 'All',            count: stats.total,                color: '#00e5ff' },
    { key: 'alpha',  label: '♦️ Alpha Leads', count: statsBySource.alpha.total,  color: SOURCE_META.alpha.color },
    { key: 'sarah',  label: '🤖 Sarah',       count: statsBySource.sarah.total,  color: SOURCE_META.sarah.color },
    { key: 'ispeed', label: 'iSpeed',         count: statsBySource.ispeed.total, color: SOURCE_META.ispeed.color },
  ];

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="leads-clean flex flex-col gap-5">

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
            <div className="text-[9px] text-dimtext font-orbitron tracking-[0.5px] uppercase mb-1">{m.label}</div>
            <div className="flex items-baseline">
              <AnimatedCounter target={m.value} className="font-orbitron text-[26px] font-bold block" style={{ color: m.color } as React.CSSProperties} />
              {m.suffix && <span className="font-orbitron text-[14px] font-bold" style={{ color: m.color }}>{m.suffix}</span>}
            </div>
          </GlassCard>
        ))}
      </motion.div>

      {/* ── Source filter + view toggle ── */}
      <motion.div variants={FADE_UP} className="flex items-center flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {SOURCE_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setSource(t.key)}
              className="px-3 py-1.5 rounded-md text-[11px] font-medium transition-all border"
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
          <button onClick={refresh} className="text-[10px] text-dimtext hover:text-ncyan transition-colors px-2">↻ Refresh</button>
          <div className="flex items-center rounded-md border border-border2 overflow-hidden">
            {([['board', LayoutGrid], ['list', ListIcon]] as const).map(([v, Icon]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium capitalize transition-colors"
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

      {/* ── Recent activity + live call feed ── */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <SectionTitle accent="cyan" badge={`${recent.length}`}><span className="inline-flex items-center gap-1"><Activity size={11} /> Recent Activity</span></SectionTitle>
          {recent.length === 0 ? (
            <div className="text-dimtext text-[11px] italic py-3 px-1">No recent lead movement.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {recent.map(l => {
                const c = TEMP_COLOR[l.temp];
                return (
                  <div key={l.id} className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border2" style={{ background: 'rgba(255,255,255,0.015)' }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
                    <span className="text-[11px] text-textb font-medium truncate flex-1 min-w-0">{l.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-sm truncate max-w-[160px]" style={{ background: `${c}14`, color: c }}>{l.stageName}</span>
                    <span className="text-[9px] text-dimtext flex-shrink-0 w-14 text-right">{l.updatedAt ? timeAgo(l.updatedAt) : ''}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <SectionTitle accent="red" badge={`${live.filter(l => l.isLive).length} live`}>Live Call Feed</SectionTitle>
          {live.length === 0 ? (
            <div className="text-dimtext text-[11px] italic py-3 px-1">No calls yet today.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {live.map(c => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-1.5 rounded-md border"
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
                    <div className="text-[9px] text-dimtext truncate max-w-[120px]">{c.phase}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {error && (
        <div className="text-nred text-[11px] italic py-3">Failed to load leads from GHL: {error}</div>
      )}
      {loading && localLeads.length === 0 && (
        <div className="flex items-center gap-2 text-dimtext text-[11px] py-8 justify-center">
          <Loader2 size={14} className="animate-spin" /> Loading leads from GHL…
        </div>
      )}

      {/* ── Board view (mirrors GHL pipeline stages) ── */}
      {view === 'board' && !loading && (
        <motion.div variants={FADE_UP}>
          <StageBoard leads={bySource} pipelines={activePipelines} onMove={moveStage} />
        </motion.div>
      )}

      {/* ── List view ── */}
      {view === 'list' && !loading && (
        <motion.div variants={FADE_UP}>
          {bySource.length === 0 && !error ? (
            <div className="text-dimtext text-[11px] italic py-8 text-center">No leads in this view.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {bySource.map(lead => <LeadCard key={lead.id} lead={lead} startExpanded />)}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

/* ───────────────────────── Stage board (mirrors GHL) ───────────────────────── */

function StageBoard({ leads, pipelines, onMove }: { leads: Lead[]; pipelines: PipelineMeta[]; onMove: (l: Lead, stageName: string) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // Columns = union of the active pipelines' stages, deduped by normalized
  // name, preserving GHL order. Single-source views mirror one pipeline 1:1.
  const columns = useMemo(() => {
    const seen = new Set<string>();
    const cols: { key: string; name: string }[] = [];
    for (const p of pipelines) {
      for (const s of p.stages) {
        const k = normStage(s.name);
        if (!seen.has(k)) { seen.add(k); cols.push({ key: k, name: s.name }); }
      }
    }
    return cols;
  }, [pipelines]);

  const leadsByCol = useMemo(() => {
    const map: Record<string, Lead[]> = {};
    for (const l of leads) {
      const k = normStage(l.stageName);
      (map[k] = map[k] || []).push(l);
    }
    return map;
  }, [leads]);

  if (!columns.length) {
    return <div className="text-dimtext text-[11px] italic py-8 text-center">Pipeline stages loading…</div>;
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
      {columns.map(col => {
        const items = leadsByCol[col.key] || [];
        const isOver = overKey === col.key;
        return (
          <div
            key={col.key}
            onDragOver={e => { e.preventDefault(); setOverKey(col.key); }}
            onDragLeave={() => setOverKey(o => (o === col.key ? null : o))}
            onDrop={() => {
              const lead = leads.find(l => l.id === dragId);
              if (lead) onMove(lead, col.name);
              setDragId(null); setOverKey(null);
            }}
            className="flex flex-col rounded-lg border transition-colors flex-shrink-0 w-[260px]"
            style={{
              borderColor: isOver ? '#00e5ff' : 'var(--border2, rgba(255,255,255,0.06))',
              background: isOver ? 'rgba(0,229,255,0.05)' : 'rgba(255,255,255,0.015)',
            }}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border2">
              <span className="text-[12px] font-semibold text-textb leading-tight flex-1 min-w-0">{col.name}</span>
              <span className="text-[10px] text-dimtext font-orbitron flex-shrink-0 px-1.5 py-0.5 rounded-sm bg-bg3">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-2 flex-1 min-h-[120px] max-h-[70vh] overflow-y-auto">
              {items.length === 0 && (
                <div className="text-dimtext text-[10px] italic text-center py-6">Drop here</div>
              )}
              <AnimatePresence initial={false}>
                {items.map(lead => (
                  <motion.div
                    key={lead.id}
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: dragId === lead.id ? 0.4 : 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    draggable
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => { setDragId(null); setOverKey(null); }}
                  >
                    <LeadCard lead={lead} compact />
                  </motion.div>
                ))}
              </AnimatePresence>
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
      <span className="text-[8px] text-dimtext font-orbitron tracking-[0.5px] uppercase">{label}</span>
      <span className="text-[11px] text-textb truncate" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function SourceBadge({ source }: { source: Source }) {
  const m = SOURCE_META[source];
  return (
    <span
      className="text-[8px] font-semibold px-1.5 py-0.5 rounded-sm whitespace-nowrap"
      style={{ background: `${m.color}1a`, color: m.color, border: `1px solid ${m.color}40` }}
    >
      {m.label}
    </span>
  );
}

function LeadCard({ lead, compact = false, startExpanded = false }: { lead: Lead; compact?: boolean; startExpanded?: boolean }) {
  const c = TEMP_COLOR[lead.temp];
  const [expanded, setExpanded] = useState(startExpanded);
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
    <GlassCard accent={lead.temp === 'hot' ? 'red' : lead.temp === 'warm' ? 'orange' : 'blue'} padding="p-3" hover={false}>
      {/* header — click to expand/collapse */}
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-start justify-between gap-2 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <ChevronDown size={12} className="text-dimtext flex-shrink-0 transition-transform" style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            <span className="text-[13px] font-semibold text-textb truncate">{lead.name}</span>
          </div>
          {lead.address && (
            <div className="text-[10px] text-dimtext flex items-center gap-1 mt-0.5 truncate pl-[18px]">
              <MapPin size={9} className="flex-shrink-0" /> {lead.address}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <SourceBadge source={lead.source} />
          <span
            className="text-[8px] font-semibold px-2 py-0.5 rounded-sm"
            style={{ background: `${c}1a`, color: c, border: `1px solid ${c}40` }}
          >
            {TEMP_LABEL[lead.temp]}
          </span>
        </div>
      </button>

      {/* always-visible meta row */}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-dimtext">
        {lead.attempts != null && (
          <span className="px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(255,255,255,0.05)' }}>
            {lead.attempts === 0 ? 'New' : `${lead.attempts} ${lead.attempts === 1 ? 'attempt' : 'attempts'}`}
          </span>
        )}
        {lead.phone && <span className="flex items-center gap-1"><Phone size={9} /> {lead.phone}</span>}
        {lead.askingPrice && <span style={{ color: '#4ade80' }}>{lead.askingPrice}</span>}
        {lead.callDuration != null && <span className="flex items-center gap-1"><Clock size={9} /> {fmtDuration(lead.callDuration)}</span>}
      </div>

      {/* expandable detail */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 pt-3 border-t border-border2">
              <Field label="Motivation" value={lead.pain} />
              <Field label="Timeline"   value={lead.timeline} />
              <Field label="Asking"     value={lead.askingPrice} color="#4ade80" />
              <Field label="Condition"  value={lead.condition} />
              <Field label="ARV"        value={lead.arv} />
              <Field label="Rehab"      value={lead.rehabCost} />
              <Field label="Mkt Value"  value={lead.marketValue} />
              <Field label="Occupancy"  value={lead.occupancy} />
              <Field label="Mortgage"   value={lead.mortgage} />
              <Field label="Deal Type"  value={lead.dealType} />
              <Field label="Rating"     value={lead.rating} />
              <Field label="Pipeline $" value={lead.value ? `$${lead.value.toLocaleString()}` : null} />
            </div>

            {/* note box */}
            <div className="flex gap-2 mt-3">
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveNote(); }}
                placeholder="Add a note for David…"
                className="flex-1 bg-bg3 border border-border2 rounded-md px-2 py-1.5 text-[11px] text-textb placeholder:text-dimtext focus:outline-none focus:border-ncyan/50"
              />
              <button
                onClick={saveNote}
                disabled={!note.trim() || !lead.contactId || noteState === 'saving'}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium border transition-colors disabled:opacity-40"
                style={{ color: '#00e5ff', borderColor: 'rgba(0,229,255,0.3)', background: 'rgba(0,229,255,0.06)' }}
              >
                {noteState === 'saving' ? <Loader2 size={11} className="animate-spin" /> :
                 noteState === 'saved'  ? <Check size={11} /> : <Send size={11} />}
                {noteState === 'saved' ? 'Saved' : 'Note'}
              </button>
            </div>

            {/* actions */}
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <button
                onClick={() => setShowTx(true)}
                disabled={!hasTranscript}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium border border-border2 text-jtext hover:text-textb hover:border-white/20 transition-colors disabled:opacity-30"
              >
                <FileText size={11} /> Transcript
              </button>
              <button
                onClick={togglePlay}
                disabled={!hasRecording}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium border transition-colors disabled:opacity-30"
                style={{ color: '#aa44ff', borderColor: 'rgba(170,68,255,0.35)', background: 'rgba(170,68,255,0.08)' }}
              >
                {playing ? <Pause size={11} /> : <Play size={11} />} {playing ? 'Pause' : 'Recording'}
              </button>
              <button
                onClick={approveCallback}
                disabled={!lead.contactId || cbState === 'saving' || cbState === 'done'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium border transition-colors disabled:opacity-50 ml-auto"
                style={{ color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.08)' }}
              >
                {cbState === 'saving' ? <Loader2 size={11} className="animate-spin" /> :
                 cbState === 'done'   ? <Check size={11} /> :
                 cbState === 'error'  ? <X size={11} /> : <Phone size={11} />}
                {cbState === 'done' ? 'Scheduled' : cbState === 'error' ? 'Failed' : 'Callback'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

      <AnimatePresence>
        {showTx && <TranscriptModal lead={lead} onClose={() => setShowTx(false)} />}
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
        className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-lg border border-border2 p-5"
        style={{ background: 'rgba(12,12,24,0.98)' }}
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-dimtext hover:text-textb"><X size={16} /></button>
        <div className="text-[14px] font-semibold text-textb mb-1">{lead.name}</div>
        {lead.address && <div className="text-[11px] text-dimtext mb-3">{lead.address}</div>}

        {lead.recordingUrl && (
          <div className="mb-4">
            <SectionTitle accent="purple">Recording</SectionTitle>
            <audio src={lead.recordingUrl} controls className="w-full h-9" />
          </div>
        )}

        {lead.summary && (
          <div className="mb-4">
            <SectionTitle accent="cyan">Summary</SectionTitle>
            <p className="text-[12px] text-jtext leading-relaxed whitespace-pre-wrap">{lead.summary}</p>
          </div>
        )}

        <SectionTitle accent="green">Full Transcript</SectionTitle>
        {lead.transcript ? (
          <pre className="text-[11px] text-jtext leading-relaxed whitespace-pre-wrap font-sans">{lead.transcript}</pre>
        ) : (
          <p className="text-[11px] text-dimtext italic">No transcript recorded for this lead.</p>
        )}
      </motion.div>
    </motion.div>
  );
}
