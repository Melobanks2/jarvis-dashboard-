'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Flame, TrendingUp, Users, Activity, GitBranch, Clock, Phone, Calendar, CheckCircle, Circle } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { StatusDot } from '@/components/ui/StatusDot';
import { usePipeline } from '@/lib/hooks/usePipeline';
import { useAgents } from '@/lib/hooks/useAgents';
import { useFeed } from '@/lib/hooks/useFeed';
import { useApp } from '@/lib/AppContext';
import { supabase, timeAgo } from '@/lib/supabase';

// David's call schedule — mirrors jarvis-caller.js cron
const DAVID_SCHEDULE = [
  { time: '9:00 AM',  label: '9am',   stages: 'Hot · Warm · New Leads · Cold',          hour: 9  },
  { time: '11:00 AM', label: '11am',  stages: 'New Leads · Attempt 1 · Attempt 2',       hour: 11 },
  { time: '1:00 PM',  label: '1pm',   stages: 'New Leads · Attempt 1–5',                 hour: 13 },
  { time: '3:00 PM',  label: '3pm',   stages: 'New Leads · Attempt 1–5',                 hour: 15 },
  { time: '5:00 PM',  label: '5pm',   stages: 'Warm · New Leads · Attempt 1',            hour: 17 },
  { time: '6:00 PM',  label: '6pm',   stages: 'Hot (close) · New Leads · Attempt 1–2',   hour: 18 },
  { time: '7:00 PM',  label: '7pm',   stages: 'Hot (final) · New Leads · Attempt 1–5',   hour: 19 },
];

const FREQ_RULES = [
  { stage: 'New Leads',    color: '#00aaff', rule: 'Every 3h · up to 4x/day · hit until they answer' },
  { stage: 'No Answer',    color: '#ff8800', rule: 'Every 3h · up to 4x/day · advance attempt ladder' },
  { stage: 'Hot Follow Up',color: '#ff3366', rule: 'Every 10h · 2x/day · morning qualify + evening close' },
  { stage: 'Warm Follow Up',color: '#ff8800',rule: 'Every 48h · 1x/day · one quality call every 2 days' },
  { stage: 'Cold Follow Up',color: '#5a5a80',rule: 'Every 72h · 1x/day · every 3 days only' },
];

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

const FADE_UP = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

interface DavidStats { calls: number; conversations: number; hot: number; voicemails: number; lastCall: string | null; }

function useDavidOps(refreshKey: number) {
  const [stats, setStats] = useState<DavidStats>({ calls: 0, conversations: 0, hot: 0, voicemails: 0, lastCall: null });
  useEffect(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    supabase.from('jarvis_calls').select('call_duration,stage_after,tags_applied,called_at,contact_name')
      .gte('called_at', today.toISOString())
      .neq('phone', '+13479704969')
      .order('called_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        const calls = data.length;
        const conversations = data.filter(c => (c.call_duration || 0) > 30).length;
        const hot = data.filter(c => c.stage_after === 'Hot Follow Up').length;
        const voicemails = data.filter(c => (c.tags_applied || []).includes('Voicemail Left')).length;
        const lastCall = data[0]?.called_at || null;
        setStats({ calls, conversations, hot, voicemails, lastCall });
      });
  }, [refreshKey]);
  return stats;
}

export function CommandCenter() {
  const { refreshKey, refresh } = useApp();
  const { data, loading: pLoading } = usePipeline(refreshKey);
  const { agents } = useAgents(refreshKey);
  const { items: feed } = useFeed(refreshKey, 12);
  const davidOps = useDavidOps(refreshKey);

  // Auto-refresh every 60 seconds
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
    timerRef.current = setInterval(() => refresh(), 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refresh]);

  const hot    = data?.stages['Hot Follow Up']?.length ?? 0;
  const warm   = data?.stages['Warm Follow Up']?.length ?? 0;
  const total  = data?.total ?? 0;
  const online = agents.filter(a => a.status === 'active').length;
  const pulse  = total > 0 ? 1 : 0;

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">

      {/* Last updated */}
      <div className="flex justify-end items-center gap-2 text-[9px] text-dimtext">
        <Clock size={10} />
        <span>Last updated {elapsed < 5 ? 'just now' : `${elapsed}s ago`} · auto-refresh 60s</span>
        <button
          onClick={refresh}
          className="ml-1 px-2 py-0.5 rounded-sm border border-border hover:border-ngreen/40 hover:text-ngreen transition-colors font-orbitron tracking-[1px]"
        >
          REFRESH
        </button>
      </div>

      {/* Hero row — Orb + pipeline stats */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-5 gap-5 min-h-[360px]">

        {/* Left pipeline stats */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <BigStat label="Hot Leads"     value={hot}    color="#ff3366" icon={<Flame size={16} />} />
          <BigStat label="Warm Leads"    value={warm}   color="#ff8800" icon={<TrendingUp size={16} />} />
          <BigStat label="Pipeline"      value={total}  color="#00aaff" icon={<Users size={16} />} />
          <BigStat label="Agents Online" value={online} color="#00ff88" icon={<Activity size={16} />} />
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
            <div className="text-[9px] text-dimtext tracking-[2px] mt-1">CHIEF OF STAFF · AUTONOMOUS OPERATIONS</div>
          </div>
        </GlassCard>

        {/* Right pipeline stats */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <BigStat label="Decision Pending" value={data?.stages['Decision Pending']?.length ?? 0} color="#aa44ff" icon={<GitBranch size={16} />} />
          <BigStat label="Contract Sent"    value={data?.stages['Contract Sent']?.length ?? 0}    color="#00ff88" icon={<Activity size={16} />} />
          <BigStat label="Under Contract"   value={data?.stages['Under Contract']?.length ?? 0}   color="#00cc66" icon={<TrendingUp size={16} />} />
          <BigStat label="Cold Follow Up"   value={data?.stages['Cold Follow Up']?.length ?? 0}   color="#5a5a80" icon={<Users size={16} />} />
        </div>
      </motion.div>

      {/* Pipeline snapshot */}
      <motion.div variants={FADE_UP}>
        <GlassCard accent="purple" padding="p-4">
          <SectionTitle accent="purple" badge={`${total} Total`}>Pipeline Snapshot</SectionTitle>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {['Decision Pending','Contract Sent','Under Contract','Hot Follow Up','Warm Follow Up','Cold Follow Up','New Lead'].map(stage => {
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

      {/* David Operations Panel */}
      <motion.div variants={FADE_UP}>
        <GlassCard accent="cyan" padding="p-4">
          <SectionTitle accent="cyan" badge="VA Leads Only">David Operations</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Today's stats */}
            <div className="flex flex-col gap-2">
              <div className="text-[9px] font-orbitron text-dimtext tracking-[1px] mb-1">TODAY&apos;S ACTIVITY</div>
              {[
                { label: 'Calls Made',     value: davidOps.calls,         color: '#00aaff' },
                { label: 'Conversations',  value: davidOps.conversations,  color: '#00ff88' },
                { label: 'Hot Leads Found',value: davidOps.hot,            color: '#ff3366' },
                { label: 'Voicemails Left',value: davidOps.voicemails,     color: '#ff8800' },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                  <span className="text-[10px] text-dimtext">{s.label}</span>
                  <span className="font-orbitron text-[13px] font-bold" style={{ color: s.color }}>{s.value}</span>
                </div>
              ))}
              {davidOps.lastCall && (
                <div className="text-[8px] text-dimtext mt-1">Last call: {timeAgo(davidOps.lastCall)}</div>
              )}
            </div>

            {/* Call schedule */}
            <div className="flex flex-col gap-1.5">
              <div className="text-[9px] font-orbitron text-dimtext tracking-[1px] mb-1">CALL SCHEDULE (EST)</div>
              {DAVID_SCHEDULE.map(slot => {
                const nowEST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
                const estHour = nowEST.getHours();
                const done = estHour > slot.hour;
                const active = estHour === slot.hour;
                return (
                  <div key={slot.time} className="flex items-start gap-2">
                    <div className="mt-0.5 flex-shrink-0">
                      {active ? <div className="w-2 h-2 rounded-full bg-ngreen animate-pulse" /> : done ? <CheckCircle size={8} className="text-dimtext opacity-40" /> : <Circle size={8} className="text-dimtext opacity-20" />}
                    </div>
                    <div>
                      <span className="font-orbitron text-[9px]" style={{ color: active ? '#00ff88' : done ? '#5a5a80' : '#8888aa' }}>{slot.time}</span>
                      <span className="text-[8px] text-dimtext ml-1.5">{slot.stages}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Frequency rules */}
            <div className="flex flex-col gap-1.5">
              <div className="text-[9px] font-orbitron text-dimtext tracking-[1px] mb-1">CALL FREQUENCY RULES</div>
              {FREQ_RULES.map(r => (
                <div key={r.stage} className="py-1 border-b border-border last:border-0">
                  <div className="text-[9px] font-medium" style={{ color: r.color }}>{r.stage}</div>
                  <div className="text-[8px] text-dimtext leading-tight mt-0.5">{r.rule}</div>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Bottom row — agent status + activity feed */}
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
          <div className="flex flex-col gap-1.5 max-h-[320px] overflow-y-auto">
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
