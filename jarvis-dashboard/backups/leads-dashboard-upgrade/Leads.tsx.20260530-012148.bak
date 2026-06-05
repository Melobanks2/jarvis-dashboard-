'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, Clock, MapPin, FileText, Check, X, Send, Loader2, Radio, DollarSign,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead, Temp, LEADS_API } from '@/lib/hooks/useLeads';
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

function fmtDuration(sec?: number | null) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const FADE_UP = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };

type Filter = 'all' | 'hot' | 'warm' | 'cold';

export function Leads() {
  const { refreshKey, refresh } = useApp();
  const { leads, stats, live, loading, error } = useLeads(refreshKey);
  const [filter, setFilter] = useState<Filter>('all');

  const answerRate = useMemo(() => {
    const withCall = leads.filter(l => l.callDuration != null);
    if (!withCall.length) return 0;
    const answered = withCall.filter(l => (l.callDuration || 0) > 15).length;
    return Math.round((answered / withCall.length) * 100);
  }, [leads]);

  const filtered = useMemo(
    () => (filter === 'all' ? leads : leads.filter(l => l.temp === filter)),
    [leads, filter]
  );

  const TABS: { key: Filter; label: string; count: number }[] = [
    { key: 'all',  label: 'All',  count: stats.total },
    { key: 'hot',  label: 'HOT',  count: stats.hot },
    { key: 'warm', label: 'WARM', count: stats.warm },
    { key: 'cold', label: 'COLD', count: stats.cold },
  ];

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">

      {/* ── Stats bar ── */}
      <motion.div variants={FADE_UP} className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: 'Total Leads',  value: stats.total, color: '#00e5ff' },
          { label: 'Answer Rate',  value: answerRate,  color: '#4ade80', suffix: '%' },
          { label: 'Hot',          value: stats.hot,   color: TEMP_COLOR.hot },
          { label: 'Warm',         value: stats.warm,  color: TEMP_COLOR.warm },
          { label: 'Cold',         value: stats.cold,  color: TEMP_COLOR.cold },
          { label: 'Dead',         value: stats.dead,  color: TEMP_COLOR.dead },
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

      {/* ── Filter tabs ── */}
      <motion.div variants={FADE_UP}>
        <div className="flex items-center gap-0 mb-3 border-b border-border2">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className="px-4 py-2 text-[10px] font-orbitron tracking-[1px] uppercase border-b-2 transition-all -mb-px"
              style={{
                color: filter === t.key ? (t.key === 'all' ? '#00e5ff' : TEMP_COLOR[t.key as Temp]) : '#5a5a80',
                borderColor: filter === t.key ? (t.key === 'all' ? '#00e5ff' : TEMP_COLOR[t.key as Temp]) : 'transparent',
              }}
            >
              {t.label} <span className="opacity-60">{t.count}</span>
            </button>
          ))}
          <button onClick={refresh} className="ml-auto text-[9px] text-dimtext hover:text-ncyan transition-colors px-2">↻ Refresh</button>
        </div>

        {error && (
          <div className="text-nred text-[10px] italic py-3">Failed to load leads from GHL: {error}</div>
        )}
        {loading && leads.length === 0 && (
          <div className="flex items-center gap-2 text-dimtext text-[11px] py-8 justify-center">
            <Loader2 size={14} className="animate-spin" /> Loading leads from GHL…
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div className="text-dimtext text-[11px] italic py-8 text-center">No leads in this view.</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(lead => <LeadCard key={lead.id} lead={lead} />)}
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, value, color }: { label: string; value: string | null; color?: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col">
      <span className="text-[7px] text-dimtext font-orbitron tracking-[1px] uppercase">{label}</span>
      <span className="text-[10px] text-textb truncate" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const c = TEMP_COLOR[lead.temp];
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [cbState, setCbState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [showTx, setShowTx] = useState(false);

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
        body: JSON.stringify({ contactId: lead.contactId, name: lead.name, address: lead.address, note: note.trim() || undefined }),
      });
      if (!r.ok) throw new Error();
      setCbState('done');
    } catch { setCbState('error'); }
  }

  return (
    <GlassCard accent={lead.temp === 'hot' ? 'red' : lead.temp === 'warm' ? 'orange' : 'blue'} padding="p-4">
      {/* header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="font-orbitron text-[12px] font-bold text-textb truncate">{lead.name}</div>
          {lead.address && (
            <div className="text-[9px] text-dimtext flex items-center gap-1 mt-0.5 truncate">
              <MapPin size={8} className="flex-shrink-0" /> {lead.address}
            </div>
          )}
        </div>
        <span
          className="text-[8px] font-orbitron font-bold tracking-[1px] px-2 py-1 rounded-sm flex-shrink-0"
          style={{ background: `${c}1a`, color: c, border: `1px solid ${c}40` }}
        >
          {TEMP_LABEL[lead.temp]}
        </span>
      </div>

      {/* stage + call meta */}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mb-3 text-[9px] text-dimtext">
        <span className="px-1.5 py-0.5 rounded-sm" style={{ background: `${c}12`, color: c }}>{lead.stageName}</span>
        {lead.phone && <span className="flex items-center gap-1"><Phone size={8} /> {lead.phone}</span>}
        {lead.callDuration != null && <span className="flex items-center gap-1"><Clock size={8} /> {fmtDuration(lead.callDuration)}</span>}
        {lead.calledAt && <span>{fmtDate(lead.calledAt)} {fmtTime(lead.calledAt)}</span>}
      </div>

      {/* fields grid */}
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

      {/* note box */}
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

      {/* actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowTx(true)}
          disabled={!lead.transcript && !lead.summary}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[9px] font-orbitron tracking-wider border border-border2 text-jtext hover:text-textb hover:border-white/20 transition-colors disabled:opacity-30"
        >
          <FileText size={10} /> Transcript
        </button>
        <button
          onClick={approveCallback}
          disabled={!lead.contactId || cbState === 'saving' || cbState === 'done'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[9px] font-orbitron tracking-wider border transition-colors disabled:opacity-50 ml-auto"
          style={{ color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.08)' }}
        >
          {cbState === 'saving' ? <Loader2 size={10} className="animate-spin" /> :
           cbState === 'done'   ? <Check size={10} /> :
           cbState === 'error'  ? <X size={10} /> : <Phone size={10} />}
          {cbState === 'done' ? 'Scheduled' : cbState === 'error' ? 'Failed' : 'Approve Callback'}
        </button>
      </div>

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
