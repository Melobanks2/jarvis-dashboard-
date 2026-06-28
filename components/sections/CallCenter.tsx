'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, ChevronDown, ChevronUp, Phone, Clock, ArrowRight, Mic, Voicemail, PhoneOff, MessageSquare, VolumeX } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { useCalls, CallRecord, callType, recordingUrl } from '@/lib/hooks/useCalls';
import { useApp } from '@/lib/AppContext';
import { fmtTime, fmtDate } from '@/lib/supabase';

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// tags_applied can arrive as a real array OR a Postgres array string ("{a,b}").
// Normalize so .map never blows up.
function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string' && v.trim()) {
    return v.replace(/^\{|\}$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }
  return [];
}

// Conversation / voicemail / no-answer badge styling.
const TYPE_META = {
  conversation: { label: 'Conversation', color: '#00ff88', Icon: MessageSquare },
  voicemail:    { label: 'Voicemail',    color: '#ffd700', Icon: Voicemail },
  'no-answer':  { label: 'No answer',     color: '#5a5a80', Icon: PhoneOff },
} as const;

function CallTypeBadge({ call }: { call: CallRecord }) {
  const { label, color, Icon } = TYPE_META[callType(call)];
  return (
    <span className="text-[8px] font-orbitron tracking-[0.5px] uppercase px-1.5 py-0.5 rounded-sm flex items-center gap-1"
      style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
      <Icon size={9} /> {label}
    </span>
  );
}

// Inline audio: click Play → an <audio> element appears and plays in-place.
// No recording (e.g. the follow-up caller currently saves none) → muted hint.
function InlineAudio({ call }: { call: CallRecord }) {
  const [open, setOpen] = useState(false);
  const url = recordingUrl(call);
  if (!url) {
    return (
      <span className="flex items-center gap-1 text-[9px] text-dimtext/70" title="This call was not recorded">
        <VolumeX size={10} /> No recording
      </span>
    );
  }
  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 border border-ncyan/30 rounded-sm text-ncyan text-[9px] hover:bg-ncyan/10 transition-colors"
      >
        <Play size={10} /> {open ? 'Hide player' : 'Play'}
      </button>
      {open && (
        <audio src={url} controls autoPlay preload="none" className="w-full mt-2 h-8" />
      )}
    </div>
  );
}

const STAGE_COLORS: Record<string, string> = {
  'Hot Follow Up': '#ff3366', 'Warm Follow Up': '#ff8800', 'Decision Pending': '#aa44ff',
  'Contract Sent': '#00ff88', 'Under Contract': '#00cc66', 'New Lead': '#00aaff', 'Cold Follow Up': '#5a5a88',
};
function stageColor(s: string) { return STAGE_COLORS[s] || '#5a5a80'; }

// Friendly names for the brain's internal qualification steps.
const STEP_LABELS: Record<string, string> = {
  greet: 'Greeting', pitch: 'Pitch', fact_find: 'Fact-Find',
  timeline_thinking: 'Timeline', timeline_followup: 'Timeline', ownership_length: 'Ownership',
  decision_makers: 'Decision-Makers', occupancy: 'Occupancy', occupancy_detail: 'Occupancy',
  price: 'Price', price_best: 'Best Price', ballpark: 'Ballpark',
  condition_overall: 'Condition', condition_systems: 'Systems', bad_time: 'Bad Time',
  pain_followup: 'Motivation', close: 'Close',
};
function stepLabel(s: string) { return STEP_LABELS[s] || s.replace(/_/g, ' '); }

// Pull the ordered qualification path out of a step-labelled transcript
// (lines like "Sarah [pitch]: ..."). Collapses repeated consecutive steps.
function parsePath(transcript?: string | null): string[] {
  if (!transcript) return [];
  const steps: string[] = [];
  for (const line of transcript.split('\n')) {
    const m = line.match(/^\s*Sarah\s*\[([^\]]+)\]/i);
    if (m) { const s = m[1].trim(); if (steps[steps.length - 1] !== s) steps.push(s); }
  }
  return steps;
}

function PathTimeline({ steps }: { steps: string[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="text-[8px] text-dimtext font-orbitron tracking-[1px] uppercase mb-1">🧠 Decision Path</div>
      <div className="flex flex-wrap items-center gap-1">
        {steps.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: '#00e5ff15', color: '#00e5ff', border: '1px solid #00e5ff25' }}>{stepLabel(s)}</span>
            {i < steps.length - 1 && <ArrowRight size={8} className="text-dimtext" />}
          </span>
        ))}
      </div>
    </div>
  );
}

const FADE_UP = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };

export function CallCenter() {
  const { refreshKey } = useApp();
  const { calls, recordings, loading } = useCalls(refreshKey);
  const [tab, setTab] = useState<'today' | 'recordings'>('today');

  const answered    = calls.filter(c => callType(c) === 'conversation').length;
  const voicemails  = calls.filter(c => callType(c) === 'voicemail').length;
  const hotDiscovered = calls.filter(c => c.stage_after === 'Hot Follow Up' && c.stage_before !== 'Hot Follow Up').length;

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">
      {/* Metrics row */}
      <motion.div variants={FADE_UP} className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Calls Made',         value: calls.length,    color: '#00e5ff' },
          { label: 'Conversations',       value: answered,        color: '#00ff88' },
          { label: 'Voicemails',          value: voicemails,      color: '#ffd700' },
          { label: 'Hot Leads Found',     value: hotDiscovered,   color: '#ff3366' },
          { label: 'Recordings Saved',    value: recordings.length, color: '#aa44ff' },
        ].map(m => (
          <GlassCard key={m.label} accent="cyan" padding="p-3" hover={false}>
            <div className="text-[8px] text-dimtext font-orbitron tracking-[1px] uppercase mb-1">{m.label}</div>
            <AnimatedCounter target={m.value} className="font-orbitron text-[28px] font-black block" style={{ color: m.color } as React.CSSProperties} />
          </GlassCard>
        ))}
      </motion.div>

      {/* Tabs */}
      <motion.div variants={FADE_UP}>
        <div className="flex gap-0 mb-4">
          {(['today', 'recordings'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 text-[10px] font-orbitron tracking-[1px] uppercase border-b-2 transition-all"
              style={{
                color: tab === t ? '#00e5ff' : '#5a5a80',
                borderColor: tab === t ? '#00e5ff' : 'transparent',
              }}
            >
              {t === 'today' ? "Today's Calls" : 'Recordings'}
            </button>
          ))}
        </div>

        {tab === 'today' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {calls.length === 0 && !loading && (
              <div className="col-span-full text-dimtext text-[11px] italic py-8 text-center">No calls yet today</div>
            )}
            {calls.map(call => <CallCard key={call.id} call={call} />)}
          </div>
        )}

        {tab === 'recordings' && (
          <div className="flex flex-col gap-3">
            {recordings.length === 0 && !loading && (
              <div className="text-dimtext text-[11px] italic py-8 text-center">No recordings found</div>
            )}
            {recordings.map(rec => <RecordingCard key={rec.id} rec={rec} />)}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function CallCard({ call }: { call: CallRecord }) {
  const bc = stageColor(call.stage_before);
  const ac = stageColor(call.stage_after);
  return (
    <GlassCard accent="green" padding="p-3">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-orbitron text-[11px] font-bold text-textb">{call.contact_name || 'Unknown'}</div>
          {call.address && <div className="text-[9px] text-dimtext mt-0.5 truncate max-w-[200px]">{call.address}</div>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-orbitron text-[11px] text-ncyan flex items-center gap-1">
            <Clock size={9} /> {fmtDuration(call.call_duration)}
          </span>
          <CallTypeBadge call={call} />
        </div>
      </div>

      {/* Stage flow */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: `${bc}15`, color: bc, border: `1px solid ${bc}25` }}>{call.stage_before || '—'}</span>
        <ArrowRight size={10} className="text-dimtext flex-shrink-0" />
        <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: `${ac}15`, color: ac, border: `1px solid ${ac}25` }}>{call.stage_after || '—'}</span>
      </div>

      {/* Decision path */}
      <PathTimeline steps={parsePath(call.transcript_full)} />

      {/* Tags */}
      {(() => { const tags = parseTags(call.tags_applied); return tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.slice(0, 4).map(t => (
            <span key={t} className="text-[8px] px-1.5 py-0.5 rounded-sm bg-bg3 text-dimtext border border-border2">{t}</span>
          ))}
        </div>
      ); })()}

      {call.summary && (
        <div className="text-[9px] text-dimtext italic line-clamp-2">{call.summary}</div>
      )}

      {/* Inline playback — listen to the call right here */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[8px] text-dimtext">{fmtTime(call.called_at)}</span>
        <InlineAudio call={call} />
      </div>
    </GlassCard>
  );
}

function RecordingCard({ rec }: { rec: CallRecord }) {
  const [showTx, setShowTx] = useState(false);
  const hasAudio = rec.recording_url || rec.elevenlabs_recording_url;
  const bc = stageColor(rec.stage_before);
  const ac = stageColor(rec.stage_after);

  return (
    <GlassCard accent="cyan" padding="p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="font-orbitron text-[11px] font-bold text-textb">{rec.contact_name || 'Unknown'}</div>
            <CallTypeBadge call={rec} />
          </div>
          <div className="flex items-center gap-3 text-[9px] text-dimtext">
            <span>{fmtDate(rec.called_at)} {fmtTime(rec.called_at)}</span>
            {rec.recording_duration && <span className="flex items-center gap-1"><Clock size={8} /> {fmtDuration(rec.recording_duration)}</span>}
          </div>
        </div>

        <InlineAudio call={rec} />
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: `${bc}15`, color: bc, border: `1px solid ${bc}25` }}>{rec.stage_before || '—'}</span>
        <ArrowRight size={9} className="text-dimtext" />
        <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: `${ac}15`, color: ac, border: `1px solid ${ac}25` }}>{rec.stage_after || '—'}</span>
      </div>

      {rec.summary && <div className="text-[9px] text-dimtext italic mb-2 line-clamp-2">{rec.summary}</div>}

      {/* Decision path — the route Sarah took through qualification */}
      <PathTimeline steps={parsePath(rec.transcript_full)} />

      {rec.transcript_full && (
        <button
          onClick={() => setShowTx(!showTx)}
          className="flex items-center gap-1 text-[9px] text-dimtext hover:text-ncyan transition-colors"
        >
          <Mic size={9} /> Transcript {showTx ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
        </button>
      )}

      {showTx && rec.transcript_full && (
        <div className="mt-2 max-h-[260px] overflow-y-auto text-[9px] font-mono bg-bg3 border border-border2 rounded-sm p-2 leading-relaxed">
          {rec.transcript_full.split('\n').map((line, i) => {
            const low = line.toLowerCase();
            const isSarah  = low.startsWith('sarah') || low.startsWith('jarvis') || low.startsWith('agent');
            const isSeller = low.startsWith('seller') || low.startsWith('contact');
            const stepM = line.match(/^\s*Sarah\s*\[([^\]]+)\]:\s*/i);
            const text  = stepM ? line.replace(/^(\s*Sarah)\s*\[[^\]]+\]:/i, '$1:') : line;
            return (
              <div key={i} className="mb-0.5" style={{ color: isSarah ? '#00e5ff' : isSeller ? '#00ff88' : '#5a5a80' }}>
                {stepM && (
                  <span className="text-[7px] px-1 py-0.5 mr-1 rounded-sm align-middle" style={{ background: '#00e5ff15', color: '#00e5ff' }}>{stepLabel(stepM[1])}</span>
                )}
                {text}
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
