'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, ChevronDown, ChevronUp, Phone, Clock, ArrowRight, Mic } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { useCalls, CallRecord } from '@/lib/hooks/useCalls';
import { useApp } from '@/lib/AppContext';
import { fmtTime, fmtDate } from '@/lib/supabase';

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const STAGE_COLORS: Record<string, string> = {
  'Hot Follow Up': '#ff3366', 'Warm Follow Up': '#ff8800', 'Decision Pending': '#aa44ff',
  'Contract Sent': '#00ff88', 'Under Contract': '#00cc66', 'New Lead': '#00aaff', 'Cold Follow Up': '#5a5a88',
};
function stageColor(s: string) { return STAGE_COLORS[s] || '#5a5a80'; }

const FADE_UP = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };

export function CallCenter() {
  const { refreshKey } = useApp();
  const { calls, recordings, loading } = useCalls(refreshKey);
  const [tab, setTab] = useState<'today' | 'recordings'>('today');

  const answered    = calls.filter(c => c.call_duration > 10).length;
  const voicemails  = calls.filter(c => c.call_duration > 0 && c.call_duration <= 10).length;
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
        <span className="font-orbitron text-[11px] text-ncyan flex items-center gap-1">
          <Clock size={9} /> {fmtDuration(call.call_duration)}
        </span>
      </div>

      {/* Stage flow */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: `${bc}15`, color: bc, border: `1px solid ${bc}25` }}>{call.stage_before || '—'}</span>
        <ArrowRight size={10} className="text-dimtext flex-shrink-0" />
        <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: `${ac}15`, color: ac, border: `1px solid ${ac}25` }}>{call.stage_after || '—'}</span>
      </div>

      {/* Tags */}
      {call.tags_applied?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {call.tags_applied.slice(0, 4).map(t => (
            <span key={t} className="text-[8px] px-1.5 py-0.5 rounded-sm bg-bg3 text-dimtext border border-border2">{t}</span>
          ))}
        </div>
      )}

      {call.summary && (
        <div className="text-[9px] text-dimtext italic line-clamp-2">{call.summary}</div>
      )}

      <div className="text-[8px] text-dimtext mt-2">{fmtTime(call.called_at)}</div>
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
          <div className="font-orbitron text-[11px] font-bold text-textb mb-0.5">{rec.contact_name || 'Unknown'}</div>
          <div className="flex items-center gap-3 text-[9px] text-dimtext">
            <span>{fmtDate(rec.called_at)} {fmtTime(rec.called_at)}</span>
            {rec.recording_duration && <span className="flex items-center gap-1"><Clock size={8} /> {fmtDuration(rec.recording_duration)}</span>}
          </div>
        </div>

        {hasAudio && (
          <a
            href={rec.elevenlabs_recording_url ? `/api/el-recording?id=${rec.elevenlabs_recording_url}` : rec.recording_url}
            target="_blank"
            className="flex items-center gap-1.5 px-2 py-1 border border-ncyan/30 rounded-sm text-ncyan text-[9px] hover:bg-ncyan/10 transition-colors"
          >
            <Play size={10} /> Play
          </a>
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: `${bc}15`, color: bc, border: `1px solid ${bc}25` }}>{rec.stage_before || '—'}</span>
        <ArrowRight size={9} className="text-dimtext" />
        <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: `${ac}15`, color: ac, border: `1px solid ${ac}25` }}>{rec.stage_after || '—'}</span>
      </div>

      {rec.summary && <div className="text-[9px] text-dimtext italic mb-2 line-clamp-2">{rec.summary}</div>}

      {rec.transcript_full && (
        <button
          onClick={() => setShowTx(!showTx)}
          className="flex items-center gap-1 text-[9px] text-dimtext hover:text-ncyan transition-colors"
        >
          <Mic size={9} /> Transcript {showTx ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
        </button>
      )}

      {showTx && rec.transcript_full && (
        <div className="mt-2 max-h-[220px] overflow-y-auto text-[9px] font-mono bg-bg3 border border-border2 rounded-sm p-2 leading-relaxed">
          {rec.transcript_full.split('\n').map((line, i) => {
            const isJarvis = line.toLowerCase().startsWith('jarvis') || line.toLowerCase().startsWith('agent');
            const isSeller = line.toLowerCase().startsWith('seller') || line.toLowerCase().startsWith('contact');
            return (
              <div key={i} style={{ color: isJarvis ? '#00e5ff' : isSeller ? '#00ff88' : '#5a5a80' }}>{line}</div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
