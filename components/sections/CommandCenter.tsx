'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import {
  Flame, TrendingUp, Users, Activity, Clock, Phone, CheckCircle, Circle,
  AlertTriangle, ArrowRight, ChevronDown, Hourglass, PhoneCall, Sparkles, DollarSign,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { StatusDot } from '@/components/ui/StatusDot';
import { usePipeline, Lead } from '@/lib/hooks/usePipeline';
import { useAgents } from '@/lib/hooks/useAgents';
import { useFeed } from '@/lib/hooks/useFeed';
import { useApp } from '@/lib/AppContext';
import { supabase, timeAgo } from '@/lib/supabase';

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const sumPP = (ls: Lead[]) => ls.reduce((a, l) => a + (l.purchasePrice || 0), 0);

// David's call schedule — mirrors jarvis-caller.js cron (reference material, collapsed by default)
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
  { stage: 'New Leads',     color: '#00aaff', rule: 'Every 3h · up to 4x/day · hit until they answer' },
  { stage: 'No Answer',     color: '#ff8800', rule: 'Every 3h · up to 4x/day · advance attempt ladder' },
  { stage: 'Hot Follow Up', color: '#ff3366', rule: 'Every 10h · 2x/day · morning qualify + evening close' },
  { stage: 'Warm Follow Up',color: '#ff8800', rule: 'Every 48h · 1x/day · one quality call every 2 days' },
  { stage: 'Cold Follow Up',color: '#5a5a80', rule: 'Every 72h · 1x/day · every 3 days only' },
];

const JarvisOrb = dynamic(() => import('@/components/three/JarvisOrb').then(m => ({ default: m.JarvisOrb })), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-dimtext text-[11px]">Initializing AI core...</div>,
});

const TYPE_COLOR: Record<string, string> = {
  success: '#00ff88', error: '#ff3366', warning: '#ff8800', info: '#00aaff', call: '#00e5ff',
};

const SOURCE_LABEL: Record<string, string> = { alpha: '♦️ Alpha (free)', ispeed: 'iSpeed (paid)', sarah: '🤖 Sarah' };

const FADE_UP = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };

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

const DEAL_EXCLUDE = new Set(['Refund Requested', 'Refund Approved', 'Under Contract', 'Contract Sent', 'Closed', 'Disposition']);

export function CommandCenter() {
  const { refreshKey, refresh, setActiveSection } = useApp();
  const { data, loading: pLoading, error: pError } = usePipeline(refreshKey);
  const { agents } = useAgents(refreshKey);
  const { items: feed } = useFeed(refreshKey, 12);
  const davidOps = useDavidOps(refreshKey);

  // Auto-refresh every 60 seconds
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setLastRefresh(Date.now()); setElapsed(0); }, [refreshKey]);
  useEffect(() => {
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - lastRefresh) / 1000)), 1000);
    return () => clearInterval(tick);
  }, [lastRefresh]);
  useEffect(() => {
    timerRef.current = setInterval(() => refresh(), 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refresh]);

  const goLeads = () => setActiveSection('leads');

  // ── Derived signal from the live pipeline ──────────────────────────────────
  const leads  = data?.leads ?? [];
  const stages = data?.stages ?? {};
  const total  = data?.total ?? 0;
  const byTemp = data?.byTemp ?? { hot: 0, warm: 0, cold: 0, dead: 0, new: 0 };
  const online = agents.filter(a => a.status === 'active').length;

  const stageCount = (s: string) => stages[s]?.length ?? 0;
  const dealsInMotion = stageCount('Decision Pending') + stageCount('Contract Sent') + stageCount('Under Contract');
  const closeList: Lead[] = [
    ...(stages['Under Contract'] || []),
    ...(stages['Contract Sent'] || []),
    ...(stages['Decision Pending'] || []),
  ];

  const freshNew = leads.filter(l => l.temp === 'new' && (l.daysInCrm ?? 99) <= 2).length;
  const staleNew = leads.filter(l => l.temp === 'new' && (l.daysInCrm ?? 0) > 2).length;

  // iSpeed refund economics (real money already spent)
  const ispeed = leads.filter(l => l.source === 'ispeed');
  const refundWindow = ispeed
    .filter(l => l.daysUntilDeadline != null && l.daysUntilDeadline >= 0 && l.daysUntilDeadline <= 7 && !DEAL_EXCLUDE.has(l.stage))
    .sort((a, b) => (a.daysUntilDeadline ?? 0) - (b.daysUntilDeadline ?? 0));
  const recoverable = ispeed.filter(l => l.daysUntilDeadline != null && l.daysUntilDeadline >= 0 && !DEAL_EXCLUDE.has(l.stage));
  const expiredLost = ispeed.filter(l => l.daysUntilDeadline != null && l.daysUntilDeadline < 0 && !DEAL_EXCLUDE.has(l.stage));
  const recoverableSum = sumPP(recoverable);
  const lostSum = sumPP(expiredLost);

  // Decaying hot/warm — real interest rotting from no follow-through
  const decaying = leads
    .filter(l => l.temp === 'hot' || l.temp === 'warm')
    .sort((a, b) => (b.daysInCrm ?? 0) - (a.daysInCrm ?? 0))
    .slice(0, 6);

  const pulse = total > 0 ? 1 : 0;

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">

      {/* Status line */}
      <div className="flex justify-end items-center gap-2 text-[9px] text-dimtext">
        <Clock size={10} />
        <span>
          {pError ? <span className="text-nred">pipeline offline — {pError}</span>
            : pLoading && !data ? 'loading live pipeline…'
            : `${total} leads live · updated ${elapsed < 5 ? 'just now' : `${elapsed}s ago`} · auto-refresh 60s`}
        </span>
        <button onClick={refresh}
          className="ml-1 px-2 py-0.5 rounded-sm border border-border hover:border-ngreen/40 hover:text-ngreen transition-colors font-orbitron tracking-[1px]">
          REFRESH
        </button>
      </div>

      {/* ① iSpeed Refund Window — only renders when money is recoverable this week */}
      {refundWindow.length > 0 && (
        <motion.div variants={FADE_UP}>
          <div className="rounded-sm border p-3" style={{ borderColor: '#ff336640', background: 'linear-gradient(90deg,#ff33661a,#ff33660a)' }}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-nred animate-pulse" />
              <span className="font-orbitron text-[11px] font-bold tracking-[2px] text-nred uppercase">iSpeed Refund Window — Act Now</span>
              <span className="ml-auto text-[9px] text-dimtext">{money(sumPP(refundWindow))} recoverable · {refundWindow.length} leads ≤7d</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {refundWindow.map(l => {
                const d = l.daysUntilDeadline ?? 0;
                const c = d <= 3 ? '#ff3366' : '#ff8800';
                return (
                  <button key={l.id} onClick={goLeads}
                    className="flex-shrink-0 text-left rounded-sm border px-3 py-2 min-w-[150px] hover:brightness-125 transition"
                    style={{ borderColor: `${c}33`, background: `${c}0d` }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-textb font-bold truncate">{l.name}</span>
                      <span className="font-orbitron text-[12px] font-black flex-shrink-0" style={{ color: c }}>{d}d</span>
                    </div>
                    <div className="text-[8px] text-dimtext truncate mt-0.5">{l.stage} · {money(l.purchasePrice || 0)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* ② Money-Lane hero — action tiles + orb + close-this-week worklist */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-5 gap-5 min-h-[340px]">

        {/* Left action tiles */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <BigStat label="Hot Leads" value={byTemp.hot} color="#ff3366" icon={<Flame size={15} />} sub="need a close call" onClick={goLeads} />
          <BigStat label="Deals in Motion" value={dealsInMotion} color="#00ff88" icon={<TrendingUp size={15} />} sub="decision · contract · UC" onClick={goLeads} />
          <BigStat label="Fresh New ≤2d" value={freshNew} color="#00aaff" icon={<Sparkles size={15} />} sub={`${staleNew} stale & untouched`} subWarn={staleNew > 0} onClick={goLeads} />
          <RefundTile recoverable={recoverableSum} lost={lostSum} onClick={goLeads} />
        </div>

        {/* Orb */}
        <GlassCard accent="green" className="lg:col-span-3 flex flex-col items-center justify-center min-h-[300px] relative overflow-hidden" padding="">
          {[1, 2, 3].map(i => (
            <div key={i} className="absolute rounded-full border border-ngreen/10 animate-pulse-ring pointer-events-none"
              style={{ width: `${i * 28}%`, height: `${i * 28}%`, animationDelay: `${i * 0.5}s` }} />
          ))}
          <JarvisOrb pulse={pulse} className="w-full h-60 lg:h-72" />
          <div className="absolute bottom-4 left-0 right-0 text-center">
            <div className="font-orbitron text-[11px] text-ngreen glow-green tracking-[3px]">JARVIS AI</div>
            <div className="text-[9px] text-dimtext tracking-[2px] mt-1">CHIEF OF STAFF · AUTONOMOUS OPERATIONS</div>
          </div>
        </GlassCard>

        {/* Close this week worklist */}
        <div className="lg:col-span-1">
          <GlassCard accent="green" padding="p-3" hover={false} className="h-full">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="font-orbitron text-[9px] font-bold tracking-[1px] text-ngreen uppercase">Close This Week</span>
              <span className="ml-auto font-orbitron text-[12px] font-black text-ngreen">{closeList.length}</span>
            </div>
            <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto">
              {closeList.slice(0, 8).map(l => (
                <button key={l.id} onClick={goLeads} className="text-left rounded-sm border border-border px-2 py-1.5 hover:border-ngreen/40 transition">
                  <div className="text-[10px] text-textb font-bold truncate">{l.name}</div>
                  <div className="flex items-center justify-between text-[8px] text-dimtext mt-0.5">
                    <span className="truncate">{l.stage}</span>
                    {l.daysInStage != null && <span className="flex-shrink-0 ml-1">{l.daysInStage}d</span>}
                  </div>
                </button>
              ))}
              {closeList.length === 0 && <div className="text-[9px] text-dimtext italic py-4 text-center">No deals in the closing lane yet</div>}
            </div>
          </GlassCard>
        </div>
      </motion.div>

      {/* ③ Decaying hot/warm + Today's production funnel */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Decaying hot/warm */}
        <GlassCard accent="orange" padding="p-4">
          <SectionTitle accent="orange" badge="oldest first">Decaying Hot / Warm</SectionTitle>
          <div className="flex flex-col gap-1.5">
            {decaying.map(l => {
              const age = l.daysInCrm ?? 0;
              const c = age > 60 ? '#ff3366' : age > 30 ? '#ff8800' : '#8888aa';
              const tc = l.temp === 'hot' ? '#ff3366' : '#ff8800';
              return (
                <button key={l.id} onClick={goLeads} className="flex items-center gap-2 py-1.5 border-b border-border last:border-0 text-left hover:bg-white/[0.02] transition">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tc, boxShadow: `0 0 6px ${tc}` }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-textb truncate">{l.name}</div>
                    <div className="text-[8px] text-dimtext truncate">{SOURCE_LABEL[l.source] || l.source} · {l.stage}</div>
                  </div>
                  <span className="font-orbitron text-[12px] font-bold flex-shrink-0" style={{ color: c }}>{age}d</span>
                </button>
              );
            })}
            {decaying.length === 0 && <div className="text-[10px] text-dimtext italic py-4 text-center">No hot/warm leads aging</div>}
          </div>
        </GlassCard>

        {/* Today's production funnel */}
        <ProductionFunnel ops={davidOps} />
      </motion.div>

      {/* ④ Source glance + cadence */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SourceStrip bySource={data?.bySource ?? {}} ispeedSpend={sumPP(ispeed)} ispeedLost={lostSum} onClick={goLeads} />
        <CadenceCard />
      </motion.div>

      {/* ⑤ Agent status + activity feed */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 md:grid-cols-2 gap-5">
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

        <GlassCard accent="cyan" padding="p-4">
          <SectionTitle accent="cyan">Activity Feed</SectionTitle>
          <div className="flex flex-col gap-1.5 max-h-[320px] overflow-y-auto">
            {feed.map(item => (
              <motion.div key={item.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                className="flex gap-2.5 py-1.5 border-b border-border last:border-0"
                style={{ borderLeft: `2px solid ${TYPE_COLOR[item.type] || '#16162e'}`, paddingLeft: 8 }}>
                <div className="flex-1 min-w-0">
                  {item.source && (
                    <span className="text-[8px] font-orbitron px-1.5 py-0.5 rounded-sm"
                      style={{ background: `${TYPE_COLOR[item.type]}15`, color: TYPE_COLOR[item.type] || '#5a5a80', border: `1px solid ${TYPE_COLOR[item.type]}25` }}>
                      {item.source}
                    </span>
                  )}
                  <div className="text-[10px] text-jtext line-clamp-2 mt-0.5">{item.message}</div>
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

function BigStat({ label, value, color, icon, sub, subWarn, onClick }: {
  label: string; value: number; color: string; icon: React.ReactNode; sub?: string; subWarn?: boolean; onClick?: () => void;
}) {
  return (
    <GlassCard accent="green" padding="p-3" hover={false}>
      <button onClick={onClick} className="w-full text-left" disabled={!onClick}>
        <div className="flex items-center gap-2 mb-1" style={{ color, opacity: 0.85 }}>
          {icon}
          <span className="text-[8px] font-orbitron tracking-[1px] uppercase text-dimtext">{label}</span>
        </div>
        <AnimatedCounter target={value} className="font-orbitron text-[26px] font-black" style={{ color } as React.CSSProperties} />
        {sub && <div className="text-[8px] mt-0.5" style={{ color: subWarn ? '#ff8800' : '#5a5a80' }}>{sub}</div>}
      </button>
    </GlassCard>
  );
}

function RefundTile({ recoverable, lost, onClick }: { recoverable: number; lost: number; onClick?: () => void }) {
  return (
    <GlassCard accent="red" padding="p-3" hover={false}>
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-center gap-2 mb-1" style={{ color: '#ff8800', opacity: 0.85 }}>
          <DollarSign size={15} />
          <span className="text-[8px] font-orbitron tracking-[1px] uppercase text-dimtext">Refund Recoverable</span>
        </div>
        <div className="font-orbitron text-[26px] font-black" style={{ color: '#ff8800' }}>{money(recoverable)}</div>
        <div className="text-[8px] mt-0.5 text-nred">{money(lost)} already lost · expired</div>
      </button>
    </GlassCard>
  );
}

function ProductionFunnel({ ops }: { ops: DavidStats }) {
  const { calls, conversations, hot, voicemails, lastCall } = ops;
  const convRate = calls > 0 ? Math.round((conversations / calls) * 100) : 0;
  const hotRate  = conversations > 0 ? Math.round((hot / conversations) * 100) : 0;
  const machinesOnly = calls > 0 && conversations === 0;
  const steps = [
    { label: 'Calls Made',    value: calls,         color: '#00aaff' },
    { label: 'Conversations', value: conversations,  color: '#00ff88', rate: `${convRate}% answered` },
    { label: 'Hot Found',     value: hot,            color: '#ff3366', rate: `${hotRate}% qualified` },
  ];
  const max = Math.max(calls, 1);
  return (
    <GlassCard accent="cyan" padding="p-4">
      <SectionTitle accent="cyan" badge="VA leads · today">Today&apos;s Production</SectionTitle>
      {machinesOnly && (
        <div className="flex items-center gap-1.5 mb-2 text-[9px] text-norange">
          <AlertTriangle size={10} /> {calls} dials, 0 conversations — likely all voicemail/AMD
        </div>
      )}
      <div className="flex flex-col gap-2">
        {steps.map(s => (
          <div key={s.label}>
            <div className="flex items-center justify-between text-[9px] mb-0.5">
              <span className="text-dimtext">{s.label}</span>
              <span className="font-orbitron font-bold" style={{ color: s.color }}>
                {s.value}{s.rate && <span className="text-dimtext font-normal ml-1.5">{s.rate}</span>}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-bg3 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, background: s.color }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border text-[8px] text-dimtext">
        <span><PhoneCall size={8} className="inline mr-1" />{voicemails} voicemails left</span>
        {lastCall && <span>last call {timeAgo(lastCall)}</span>}
      </div>
    </GlassCard>
  );
}

interface SourceStat { total: number; hot: number; warm: number; cold: number; dead: number; newLeads: number; }
function SourceStrip({ bySource, ispeedSpend, ispeedLost, onClick }: {
  bySource: Record<string, SourceStat>; ispeedSpend: number; ispeedLost: number; onClick?: () => void;
}) {
  const cards = (['alpha', 'ispeed'] as const).map(key => ({ key, s: bySource[key] }));
  return (
    <GlassCard accent="blue" padding="p-4">
      <SectionTitle accent="blue" badge="free vs paid">Source Performance</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {cards.map(({ key, s }) => {
          const qualified = (s?.hot ?? 0) + (s?.warm ?? 0);
          return (
            <button key={key} onClick={onClick} className="text-left rounded-sm border border-border p-3 hover:border-nblue/40 transition">
              <div className="text-[9px] font-orbitron text-textb tracking-[1px] mb-2">{SOURCE_LABEL[key]}</div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-orbitron text-[22px] font-black text-nblue">{s?.total ?? 0}</span>
                <span className="text-[8px] text-dimtext">leads</span>
              </div>
              <div className="text-[9px] mt-1" style={{ color: '#00ff88' }}>{qualified} hot+warm qualified</div>
              {key === 'ispeed' && (
                <div className="text-[8px] text-dimtext mt-1.5 leading-relaxed">
                  {money(ispeedSpend)} spent · <span className="text-nred">{money(ispeedLost)} past window</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </GlassCard>
  );
}

function CadenceCard() {
  const [open, setOpen] = useState(false);
  const nowEST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const estHour = nowEST.getHours();
  const next = DAVID_SCHEDULE.find(s => s.hour >= estHour);
  return (
    <GlassCard accent="purple" padding="p-4">
      <div className="flex items-center gap-2">
        <SectionTitle accent="purple">David Call Cadence</SectionTitle>
      </div>
      <div className="flex items-center gap-2 -mt-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-ngreen animate-pulse" />
        <span className="text-[10px] text-textb">
          {next ? <>Next window <span className="font-orbitron text-ngreen">{next.time}</span> — {next.stages}</> : 'Calling done for today'}
        </span>
        <button onClick={() => setOpen(o => !o)} className="ml-auto flex items-center gap-1 text-[8px] text-dimtext hover:text-jtext">
          {open ? 'hide' : 'full schedule'} <ChevronDown size={10} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '.2s' }} />
        </button>
      </div>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-border">
          <div className="flex flex-col gap-1">
            <div className="text-[8px] font-orbitron text-dimtext tracking-[1px] mb-1">SCHEDULE (EST)</div>
            {DAVID_SCHEDULE.map(slot => {
              const done = estHour > slot.hour, active = estHour === slot.hour;
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
          <div className="flex flex-col gap-1">
            <div className="text-[8px] font-orbitron text-dimtext tracking-[1px] mb-1">FREQUENCY RULES</div>
            {FREQ_RULES.map(r => (
              <div key={r.stage} className="py-0.5">
                <div className="text-[9px] font-medium" style={{ color: r.color }}>{r.stage}</div>
                <div className="text-[8px] text-dimtext leading-tight">{r.rule}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
