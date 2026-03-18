'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Flame, TrendingUp, Phone, Users, Activity, GitBranch, Mic, VolumeX, Clock, DollarSign } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { StatusDot } from '@/components/ui/StatusDot';
import { usePipeline } from '@/lib/hooks/usePipeline';
import { useCalls, callOutcome, CallRecord } from '@/lib/hooks/useCalls';
import { useAgents } from '@/lib/hooks/useAgents';
import { useFeed } from '@/lib/hooks/useFeed';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

const JarvisOrb = dynamic(() => import('@/components/three/JarvisOrb').then(m => ({ default: m.JarvisOrb })), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-dimtext text-[11px]">Initializing AI core...</div>,
});

const TYPE_COLOR: Record<string, string> = {
  success: '#00ff88', error: '#ff3366', warning: '#ff8800', info: '#00aaff', call: '#00e5ff',
};

const STAGE_COLOR: Record<string, string> = {
  'Hot Follow Up':    '#ff3366',
  'Warm Follow Up':   '#ff8800',
  'Decision Pending': '#aa44ff',
  'Contract Sent':    '#00ff88',
  'Under Contract':   '#00cc66',
  'New Lead':         '#00aaff',
};

const OUTCOME_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  hot:      { label: 'HOT',      color: '#ff3366', bg: '#ff336620' },
  warm:     { label: 'WARM',     color: '#ff8800', bg: '#ff880020' },
  cold:     { label: 'COLD',     color: '#00aaff', bg: '#00aaff20' },
  voicemail:{ label: 'VM',       color: '#5a5a80', bg: '#5a5a8020' },
};

const FADE_UP = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

function fmtDuration(s: number) {
  if (!s) return '0s';
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtCost(n: number) {
  return `$${(n * 0.11).toFixed(2)}`;
}

export function CommandCenter() {
  const { refreshKey, refresh } = useApp();
  const { data, loading: pLoading } = usePipeline(refreshKey);
  const { calls, recentCalls, weekData, pendingApprovals, loading } = useCalls(refreshKey);
  const { agents } = useAgents(refreshKey);
  const { items: feed } = useFeed(refreshKey, 10);

  // Auto-refresh every 30 seconds
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLastRefresh(Date.now());
    setElapsed(0);
  }, [refreshKey]);

  useEffect(() => {
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - lastRefresh) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastRefresh]);

  useEffect(() => {
    timerRef.current = setInterval(() => refresh(), 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refresh]);

  // KPI derivations
  const hot           = data?.stages['Hot Follow Up']?.length ?? 0;
  const warm          = data?.stages['Warm Follow Up']?.length ?? 0;
  const total         = data?.total ?? 0;
  const online        = agents.filter(a => a.status === 'active').length;
  const pulse         = calls.length > 0 ? 1 : 0;

  const convToday     = calls.filter(c => (c.call_duration || 0) > 30).length;
  const hotToday      = calls.filter(c => callOutcome(c) === 'hot').length;
  const vmToday       = calls.filter(c => callOutcome(c) === 'voicemail').length;

  // Weekly chart max
  const weekMax = Math.max(...weekData.map(d => d.count), 1);

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">

      {/* Last updated indicator */}
      <div className="flex justify-end items-center gap-2 text-[9px] text-dimtext">
        <Clock size={10} />
        <span>Last updated {elapsed < 5 ? 'just now' : `${elapsed}s ago`}</span>
        <button
          onClick={refresh}
          className="ml-1 px-2 py-0.5 rounded-sm border border-border hover:border-ngreen/40 hover:text-ngreen transition-colors font-orbitron tracking-[1px]"
        >
          REFRESH
        </button>
      </div>

      {/* 6 KPI boxes */}
      <motion.div variants={FADE_UP} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiBox label="Calls Today"       value={calls.length} color="#00e5ff" icon={<Phone size={14} />} />
        <KpiBox label="Conversations"     value={convToday}    color="#00ff88" icon={<Mic size={14} />} />
        <KpiBox label="Hot Leads Today"   value={hotToday}     color="#ff3366" icon={<Flame size={14} />} />
        <KpiBox label="Voicemails"        value={vmToday}      color="#5a5a80" icon={<VolumeX size={14} />} />
        <KpiBox label="Est. Cost Today"   value={calls.length} color="#ff8800" icon={<DollarSign size={14} />} format={fmtCost} />
        <KpiBox label="Deals Pending"     value={pendingApprovals} color="#aa44ff" icon={<GitBranch size={14} />} />
      </motion.div>

      {/* Hero row */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-5 gap-5 min-h-[360px]">

        {/* Left stats */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <BigStat label="Hot Leads"     value={hot}     color="#ff3366" icon={<Flame size={16} />} />
          <BigStat label="Warm Leads"    value={warm}    color="#ff8800" icon={<TrendingUp size={16} />} />
          <BigStat label="Pipeline"      value={total}   color="#00aaff" icon={<Users size={16} />} />
          <BigStat label="Agents Online" value={online}  color="#00ff88" icon={<Activity size={16} />} />
        </div>

        {/* Orb center */}
        <GlassCard accent="green" className="lg:col-span-3 flex flex-col items-center justify-center min-h-[320px] relative overflow-hidden" padding="">
          {[1, 2, 3].map(i => (
            <div key={i} className="absolute rounded-full border border-ngreen/10 animate-pulse-ring pointer-events-none"
              style={{ width: `${i * 28}%`, height: `${i * 28}%`, animationDelay: `${i * 0.5}s` }} />
          ))}
          <JarvisOrb pulse={pulse} className="w-full h-64 lg:h-80" />
          <div className="absolute bottom-4 left-0 right-0 text-center">
            <div className="font-orbitron text-[11px] text-ngreen glow-green tracking-[3px]">JARVIS AI</div>
            <div className="text-[9px] text-dimtext tracking-[2px] mt-1">CHIEF OF STAFF • AUTONOMOUS OPERATIONS</div>
          </div>
        </GlassCard>

        {/* Right stats */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <BigStat label="Calls Today"       value={calls.length}                              color="#00e5ff" icon={<Phone size={16} />} />
          <BigStat label="Decision Pending"  value={data?.stages['Decision Pending']?.length ?? 0} color="#aa44ff" icon={<GitBranch size={16} />} />
          <BigStat label="Contract Sent"     value={data?.stages['Contract Sent']?.length ?? 0}    color="#00ff88" icon={<Activity size={16} />} />
          <BigStat label="Under Contract"    value={data?.stages['Under Contract']?.length ?? 0}   color="#00cc66" icon={<TrendingUp size={16} />} />
        </div>
      </motion.div>

      {/* Pipeline quick view */}
      <motion.div variants={FADE_UP}>
        <GlassCard accent="purple" padding="p-4">
          <SectionTitle accent="purple" badge={`${total} Total`}>Pipeline Snapshot</SectionTitle>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {['Decision Pending','Contract Sent','Under Contract','Hot Follow Up','Warm Follow Up','New Lead','Cold Follow Up'].map(stage => {
              const count = data?.stages[stage]?.length ?? 0;
              const color = STAGE_COLOR[stage] || '#5a5a80';
              return (
                <div key={stage} className="flex-shrink-0 text-center p-3 rounded-sm border min-w-[90px]"
                  style={{ background: `${color}08`, borderColor: `${color}20` }}>
                  <div className="font-orbitron text-[22px] font-black" style={{ color }}>{count}</div>
                  <div className="text-[8px] text-dimtext mt-1 leading-tight">{stage}</div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </motion.div>

      {/* Weekly Chart */}
      <motion.div variants={FADE_UP}>
        <GlassCard accent="cyan" padding="p-4">
          <SectionTitle accent="cyan" badge="Last 7 Days">David's Call Activity</SectionTitle>
          <div className="flex items-end gap-2 h-28 mt-3">
            {weekData.map(d => {
              const pct = weekMax > 0 ? (d.count / weekMax) * 100 : 0;
              const convPct = d.count > 0 ? (d.conversations / d.count) * 100 : 0;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                    <div className="bg-surface border border-border rounded px-2 py-1 text-[9px] text-textb whitespace-nowrap">
                      <div className="font-orbitron text-ngreen">{d.count} calls</div>
                      <div className="text-dimtext">{d.conversations} convos</div>
                    </div>
                    <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-border" />
                  </div>
                  {/* Bar */}
                  <div className="w-full flex-1 flex flex-col justify-end gap-0.5 rounded-sm overflow-hidden" style={{ background: '#ffffff08' }}>
                    {d.count > 0 && (
                      <div
                        className="w-full rounded-sm transition-all duration-500"
                        style={{
                          height: `${pct}%`,
                          minHeight: 4,
                          background: `linear-gradient(to top, #00e5ff, #00aaff40)`,
                        }}
                      />
                    )}
                    {d.conversations > 0 && (
                      <div
                        className="w-full absolute bottom-0 rounded-sm opacity-70"
                        style={{
                          height: `${(d.conversations / weekMax) * 100}%`,
                          minHeight: 2,
                          background: `linear-gradient(to top, #00ff88, #00ff8840)`,
                        }}
                      />
                    )}
                  </div>
                  {/* Labels */}
                  <div className="text-[9px] font-orbitron text-dimtext">{d.day}</div>
                  <div className="text-[8px] text-nblue font-bold">{d.count}</div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5 text-[8px] text-dimtext">
              <div className="w-3 h-1.5 rounded-sm" style={{ background: '#00e5ff' }} />
              Total calls
            </div>
            <div className="flex items-center gap-1.5 text-[8px] text-dimtext">
              <div className="w-3 h-1.5 rounded-sm" style={{ background: '#00ff88' }} />
              Conversations (&gt;30s)
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Live Call Feed + David Status */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Live Call Feed */}
        <GlassCard accent="cyan" padding="p-4" className="lg:col-span-2">
          <SectionTitle accent="cyan" badge={`${recentCalls.length} recent`}>Live Call Feed</SectionTitle>
          <div className="flex flex-col gap-1 max-h-[340px] overflow-y-auto pr-1">
            {recentCalls.length === 0 && !loading && (
              <div className="text-[10px] text-dimtext italic py-6 text-center">No calls recorded yet</div>
            )}
            {recentCalls.map(c => <CallRow key={c.id} call={c} />)}
          </div>
        </GlassCard>

        {/* David Status */}
        <GlassCard accent="gold" padding="p-4">
          <SectionTitle accent="gold">David Status</SectionTitle>
          <DavidStats calls={calls} recentCalls={recentCalls} />
        </GlassCard>
      </motion.div>

      {/* Bottom row: agents + activity */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Agent status */}
        <GlassCard accent="gold" padding="p-4">
          <SectionTitle accent="gold">Agent Status</SectionTitle>
          <div className="flex flex-col gap-2">
            {agents.map(a => (
              <div key={a.key} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
                <StatusDot status={a.status === 'active' ? 'online' : a.status === 'idle' ? 'idle' : 'offline'} />
                <div className="flex-1">
                  <div className="text-[11px] text-textb">{a.name}</div>
                  <div className="text-[9px] text-dimtext">{a.schedule}</div>
                </div>
                <div className="text-right">
                  <div className="font-orbitron text-[12px] font-bold" style={{ color: a.color }}>{a.runCount}</div>
                  <div className="text-[8px] text-dimtext">runs</div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Activity feed */}
        <GlassCard accent="cyan" padding="p-4">
          <SectionTitle accent="cyan">Activity Feed</SectionTitle>
          <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto">
            {feed.map(item => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex gap-2.5 py-1.5 border-b border-border last:border-0"
                style={{ borderLeft: `2px solid ${TYPE_COLOR[item.type] || '#16162e'}`, paddingLeft: 8 }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {item.source && (
                      <span className="text-[8px] font-orbitron px-1.5 py-0.5 rounded-sm"
                        style={{ background: `${TYPE_COLOR[item.type]}15`, color: TYPE_COLOR[item.type] || '#5a5a80', border: `1px solid ${TYPE_COLOR[item.type]}25` }}>
                        {item.source}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-jtext line-clamp-2">{item.message}</div>
                  <div className="text-[8px] text-dimtext mt-0.5">{timeAgo(item.created_at)}</div>
                </div>
              </motion.div>
            ))}
            {feed.length === 0 && <div className="text-[10px] text-dimtext italic py-4 text-center">No recent activity</div>}
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiBox({ label, value, color, icon, format }: {
  label: string; value: number; color: string; icon: React.ReactNode; format?: (n: number) => string;
}) {
  return (
    <GlassCard accent="green" padding="p-3" hover={false}>
      <div className="flex items-center gap-1.5 mb-1" style={{ color, opacity: 0.75 }}>
        {icon}
        <span className="text-[7px] font-orbitron tracking-[1px] uppercase text-dimtext leading-tight">{label}</span>
      </div>
      {format
        ? <div className="font-orbitron text-[22px] font-black" style={{ color }}>{format(value)}</div>
        : <AnimatedCounter target={value} className="font-orbitron text-[22px] font-black" style={{ color } as React.CSSProperties} />
      }
    </GlassCard>
  );
}

function BigStat({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <GlassCard accent="green" padding="p-3" hover={false}>
      <div className="flex items-center gap-2 mb-1" style={{ color, opacity: 0.8 }}>
        {icon}
        <span className="text-[8px] font-orbitron tracking-[1px] uppercase text-dimtext">{label}</span>
      </div>
      <AnimatedCounter target={value} className="font-orbitron text-[26px] font-black" style={{ color } as React.CSSProperties} />
    </GlassCard>
  );
}

function CallRow({ call: c }: { call: CallRecord }) {
  const outcome = callOutcome(c);
  const style   = OUTCOME_STYLE[outcome];
  const hasAudio = !!(c.recording_url || c.twilio_call_sid);
  const [loadingAudio, setLoadingAudio] = useState(false);

  const playRecording = async () => {
    if (loadingAudio) return;
    // If we have a stored URL and it looks fresh (< 8 min old), use it directly
    const callAge = Date.now() - new Date(c.called_at).getTime();
    if (c.recording_url && callAge < 8 * 60 * 1000) {
      window.open(c.recording_url, '_blank');
      return;
    }
    // Otherwise fetch a fresh URL from Telnyx
    if (!c.twilio_call_sid) {
      if (c.recording_url) window.open(c.recording_url, '_blank');
      return;
    }
    setLoadingAudio(true);
    try {
      const res = await fetch(`/api/fresh-recording?cid=${encodeURIComponent(c.twilio_call_sid)}`);
      const json = await res.json();
      if (json.url) window.open(json.url, '_blank');
    } catch {}
    setLoadingAudio(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-2.5 py-2 border-b border-border last:border-0"
    >
      {/* Outcome badge */}
      <span className="flex-shrink-0 text-[8px] font-orbitron px-1.5 py-0.5 rounded-sm border"
        style={{ color: style.color, background: style.bg, borderColor: `${style.color}30` }}>
        {style.label}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-textb font-medium truncate">{c.contact_name || c.phone}</span>
          {c.stage_after && (
            <span className="text-[8px] text-dimtext truncate hidden sm:block">{c.stage_after}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[8px] text-dimtext">{fmtDuration(c.call_duration)}</span>
          <span className="text-[7px] text-dimtext/60">{timeAgo(c.called_at)}</span>
        </div>
      </div>

      {/* Play button */}
      {hasAudio && (
        <button
          onClick={playRecording}
          disabled={loadingAudio}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full border border-ngreen/30 hover:border-ngreen hover:bg-ngreen/10 transition-colors"
          title={loadingAudio ? 'Loading...' : 'Play recording'}
        >
          {loadingAudio
            ? <div className="w-2 h-2 border border-ngreen/60 border-t-ngreen rounded-full animate-spin" />
            : <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" className="text-ngreen ml-0.5"><path d="M0 0L8 5L0 10V0Z" /></svg>
          }
        </button>
      )}
    </motion.div>
  );
}

function DavidStats({ calls, recentCalls }: { calls: CallRecord[]; recentCalls: CallRecord[] }) {
  const totalToday   = calls.length;
  const hotWarmToday = calls.filter(c => ['hot','warm'].includes(callOutcome(c))).length;
  const convRate     = totalToday > 0 ? Math.round((hotWarmToday / totalToday) * 100) : 0;
  const avgDur       = totalToday > 0
    ? Math.round(calls.reduce((s, c) => s + (c.call_duration || 0), 0) / totalToday)
    : 0;
  const totalAllTime = recentCalls.length;
  const hasRecording = recentCalls.filter(c => c.recording_url || c.elevenlabs_recording_url).length;

  const stats = [
    { label: 'Calls Today',     value: totalToday,   color: '#00e5ff' },
    { label: 'Hot+Warm Today',  value: hotWarmToday, color: '#ff3366' },
    { label: 'Conversion Rate', value: convRate,     color: '#00ff88', suffix: '%' },
    { label: 'Avg Duration',    value: avgDur,       color: '#ff8800', suffix: 's' },
    { label: 'Recent 20 Calls', value: totalAllTime, color: '#00aaff' },
    { label: 'w/ Recordings',   value: hasRecording, color: '#aa44ff' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 mt-1">
      {stats.map(s => (
        <div key={s.label} className="p-2 rounded-sm border border-border bg-surface/50">
          <div className="text-[7px] text-dimtext font-orbitron tracking-[1px] mb-1">{s.label}</div>
          <div className="font-orbitron text-[18px] font-black" style={{ color: s.color }}>
            {s.value}{s.suffix ?? ''}
          </div>
        </div>
      ))}
    </div>
  );
}
