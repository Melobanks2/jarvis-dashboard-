'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import {
  Flame, TrendingUp, CheckCircle, Circle,
  AlertTriangle, ChevronDown, PhoneCall, Sparkles, DollarSign, RefreshCw,
} from 'lucide-react';
import { GlassCard, SectionTitle, GlassPill } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { StatusDot } from '@/components/ui/StatusDot';
import { usePipeline, Lead } from '@/lib/hooks/usePipeline';
import { useAgents } from '@/lib/hooks/useAgents';
import { useFeed } from '@/lib/hooks/useFeed';
import { useApp } from '@/lib/AppContext';
import { supabase, timeAgo } from '@/lib/supabase';

// ── Palette — Apple system colors, blue-first ───────────────────────────────
// blue = identity + neutral info · green = positive/money · red = urgent
// · orange = warning/aging. If something is tinted, it needs attention.
const C = {
  blue:  '#0a84ff',
  pos:   '#30d158',
  urg:   '#ff453a',
  warn:  '#ff9f0a',
  dim:   'rgba(235,235,245,0.35)',
};

// iOS spring for taps and hovers — quick, settles clean.
const SPRING = { type: 'spring', stiffness: 420, damping: 30 } as const;
const TAP = { scale: 0.97 };

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
  { stage: 'New Leads',     color: C.blue, rule: 'Every 3h · up to 4x/day · hit until they answer' },
  { stage: 'No Answer',     color: C.warn, rule: 'Every 3h · up to 4x/day · advance attempt ladder' },
  { stage: 'Hot Follow Up', color: C.urg,  rule: 'Every 10h · 2x/day · morning qualify + evening close' },
  { stage: 'Warm Follow Up',color: C.warn, rule: 'Every 48h · 1x/day · one quality call every 2 days' },
  { stage: 'Cold Follow Up',color: C.dim,  rule: 'Every 72h · 1x/day · every 3 days only' },
];

const JarvisOrb = dynamic(() => import('@/components/three/JarvisOrb').then(m => ({ default: m.JarvisOrb })), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-dimtext text-[13px]">Starting up…</div>,
});

const TYPE_COLOR: Record<string, string> = {
  success: C.pos, error: C.urg, warning: C.warn, info: C.blue, call: C.blue,
};

const SOURCE_LABEL: Record<string, string> = { alpha: 'Alpha · free', ispeed: 'iSpeed · paid', sarah: 'Sarah' };

const FADE_UP = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };

// Big numbers: SF with tabular numerals (via .font-orbitron remap), tight tracking.
const NUM = 'font-orbitron font-semibold';

// Computed in an effect so the statically-prerendered HTML (built at an
// arbitrary hour) never mismatches the client's clock on hydration.
const greetingFor = (h: number) =>
  h < 5 ? 'Working late, Chris' : h < 12 ? 'Good morning, Chris' : h < 17 ? 'Good afternoon, Chris' : 'Good evening, Chris';

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

  const [greeting, setGreeting] = useState('Command Center');
  useEffect(() => { setGreeting(greetingFor(new Date().getHours())); }, []);

  // ── Derived signal from the live pipeline ──────────────────────────────────
  const leads  = data?.leads ?? [];
  const stages = data?.stages ?? {};
  const total  = data?.total ?? 0;
  const byTemp = data?.byTemp ?? { hot: 0, warm: 0, cold: 0, dead: 0, new: 0 };

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
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-6">

      {/* Header — greeting + live status */}
      <motion.div variants={FADE_UP} className="flex items-center gap-4 flex-wrap">
        <h1 className="text-[28px] font-semibold tracking-[-0.028em] text-textb">{greeting}</h1>
        <GlassPill>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: pError ? C.urg : C.pos }} />
          {pError ? 'pipeline offline'
            : pLoading && !data ? 'loading…'
            : `${total} leads live · ${elapsed < 5 ? 'just now' : `${elapsed}s ago`}`}
        </GlassPill>
        <motion.button whileTap={TAP} transition={SPRING} onClick={refresh}
          className="press ml-auto inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-[13px] text-jtext bg-white/[0.06] hover:bg-white/10 hover:text-textb"
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)' }}>
          <RefreshCw size={13} /> Refresh
        </motion.button>
      </motion.div>

      {/* ① iSpeed Refund Window — only renders when money is recoverable this week */}
      {refundWindow.length > 0 && (
        <motion.div variants={FADE_UP}>
          <div className="glass rounded-[22px] p-5" style={{ borderColor: 'rgba(255,69,58,0.25)', background: 'rgba(255,69,58,0.06)' }}>
            <div className="flex items-baseline gap-3 mb-4 flex-wrap">
              <span className="text-[16px] font-semibold tracking-[-0.02em]" style={{ color: C.urg }}>Refund window closing</span>
              <span className="text-[13px] text-dimtext">{money(sumPP(refundWindow))} recoverable across {refundWindow.length} leads</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {refundWindow.map(l => {
                const d = l.daysUntilDeadline ?? 0;
                const c = d <= 3 ? C.urg : C.warn;
                return (
                  <motion.button key={l.id} whileTap={TAP} transition={SPRING} onClick={goLeads}
                    className="press flex-shrink-0 text-left rounded-2xl border border-border bg-bg2 px-4 py-3 min-w-[172px] hover:bg-white/10 transition-colors"
                    style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] text-textb font-medium truncate">{l.name}</span>
                      <span className={`${NUM} text-[18px] flex-shrink-0`} style={{ color: c }}>{d}d</span>
                    </div>
                    <div className="text-[12px] text-dimtext truncate mt-0.5">{l.stage} · {money(l.purchasePrice || 0)}</div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* ② Stat tiles */}
      <motion.div variants={FADE_UP} className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <BigStat label="Hot leads" value={byTemp.hot} color={C.urg} icon={<Flame size={14} />} sub="Need a close call" onClick={goLeads} />
        <BigStat label="Deals in motion" value={dealsInMotion} color={C.pos} icon={<TrendingUp size={14} />} sub="Decision · contract · UC" onClick={goLeads} />
        <BigStat label="Fresh leads" value={freshNew} color={C.blue} icon={<Sparkles size={14} />} sub={`${staleNew} stale & untouched`} subWarn={staleNew > 0} onClick={goLeads} />
        <RefundTile recoverable={recoverableSum} lost={lostSum} onClick={goLeads} />
      </motion.div>

      {/* ③ Orb + close-this-week worklist */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-3 gap-5 min-h-[340px]">
        <GlassCard className="lg:col-span-2 flex flex-col items-center justify-center min-h-[320px]" padding="">
          <JarvisOrb pulse={pulse} className="w-full h-60 lg:h-72" />
          <div className="absolute bottom-6 left-0 right-0 text-center">
            <div className="text-[21px] font-semibold tracking-[-0.022em] text-textb">Jarvis</div>
            <div className="text-[13px] text-dimtext mt-1">Chief of staff · autonomous operations</div>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-[16px] font-semibold tracking-[-0.02em] text-textb">Close this week</span>
            <span className={`${NUM} ml-auto text-[21px]`} style={{ color: C.blue }}>{closeList.length}</span>
          </div>
          <div className="flex flex-col gap-2.5 max-h-[290px] overflow-y-auto">
            {closeList.slice(0, 8).map(l => (
              <motion.button key={l.id} whileTap={TAP} transition={SPRING} onClick={goLeads}
                className="press text-left rounded-2xl border border-border bg-bg2 px-3.5 py-2.5 hover:bg-white/10 transition-colors"
                style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
                <div className="text-[14px] text-textb font-medium truncate">{l.name}</div>
                <div className="flex items-center justify-between text-[12px] text-dimtext mt-0.5">
                  <span className="truncate">{l.stage}</span>
                  {l.daysInStage != null && <span className="flex-shrink-0 ml-1">{l.daysInStage}d</span>}
                </div>
              </motion.button>
            ))}
            {closeList.length === 0 && <div className="text-[13px] text-dimtext py-4 text-center">No deals in the closing lane yet</div>}
          </div>
        </GlassCard>
      </motion.div>

      {/* ④ Decaying hot/warm + Today's production funnel */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Decaying hot/warm */}
        <GlassCard>
          <SectionTitle badge="Oldest first">Decaying leads</SectionTitle>
          <div className="flex flex-col">
            {decaying.map(l => {
              const age = l.daysInCrm ?? 0;
              const c = age > 60 ? C.urg : age > 30 ? C.warn : C.dim;
              const tc = l.temp === 'hot' ? C.urg : C.warn;
              return (
                <motion.button key={l.id} whileTap={TAP} transition={SPRING} onClick={goLeads}
                  className="press flex items-center gap-3 py-2.5 border-b border-border last:border-0 text-left hover:bg-white/[0.04] transition-colors rounded-lg px-1.5 -mx-1.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tc }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-textb font-medium truncate">{l.name}</div>
                    <div className="text-[12px] text-dimtext truncate">{SOURCE_LABEL[l.source] || l.source} · {l.stage}</div>
                  </div>
                  <span className={`${NUM} text-[17px] flex-shrink-0`} style={{ color: c }}>{age}d</span>
                </motion.button>
              );
            })}
            {decaying.length === 0 && <div className="text-[13px] text-dimtext py-4 text-center">No hot or warm leads aging</div>}
          </div>
        </GlassCard>

        {/* Today's production funnel */}
        <ProductionFunnel ops={davidOps} />
      </motion.div>

      {/* ⑤ Source glance + cadence */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SourceStrip bySource={data?.bySource ?? {}} ispeedSpend={sumPP(ispeed)} ispeedLost={lostSum} onClick={goLeads} />
        <CadenceCard />
      </motion.div>

      {/* ⑥ Agent status + activity feed */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <GlassCard>
          <SectionTitle>Agents</SectionTitle>
          <div className="flex flex-col">
            {agents.map(a => (
              <div key={a.key} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                <StatusDot status={a.status === 'active' ? 'online' : a.status === 'idle' ? 'idle' : 'offline'} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] text-textb font-medium truncate">{a.name}</div>
                  <div className="text-[12px] text-dimtext truncate">{a.schedule}</div>
                </div>
                <GlassPill color={a.status === 'active' ? C.pos : a.status === 'idle' ? C.warn : undefined}>
                  {a.status === 'active' ? 'Active' : a.status === 'idle' ? 'Idle' : 'Offline'}
                </GlassPill>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <SectionTitle>Activity</SectionTitle>
          <div className="flex flex-col gap-4 max-h-[320px] overflow-y-auto">
            {feed.map(item => {
              const c = TYPE_COLOR[item.type] || C.dim;
              return (
                <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
                  className="flex gap-3">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[7px]" style={{ background: c }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-textb line-clamp-2">{item.message}</div>
                    <div className="text-[12px] text-dimtext mt-0.5">
                      {item.source && <span className="capitalize">{item.source} · </span>}{timeAgo(item.created_at)}
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {feed.length === 0 && <div className="text-[13px] text-dimtext py-4 text-center">No recent activity</div>}
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
    <motion.div whileTap={onClick ? TAP : undefined} transition={SPRING}>
      <GlassCard padding="p-5" className="h-full">
        <button onClick={onClick} className="w-full text-left" disabled={!onClick}>
          <div className="flex items-center gap-2" style={{ color }}>
            {icon}
            <span className="text-[13px] text-jtext">{label}</span>
          </div>
          <AnimatedCounter target={value} className={`${NUM} block text-[38px] leading-tight mt-2`} style={{ color } as React.CSSProperties} />
          {sub && <div className="text-[12px] mt-1" style={{ color: subWarn ? C.warn : C.dim }}>{sub}</div>}
        </button>
      </GlassCard>
    </motion.div>
  );
}

function RefundTile({ recoverable, lost, onClick }: { recoverable: number; lost: number; onClick?: () => void }) {
  return (
    <motion.div whileTap={TAP} transition={SPRING}>
      <GlassCard padding="p-5" className="h-full">
        <button onClick={onClick} className="w-full text-left">
          <div className="flex items-center gap-2" style={{ color: C.warn }}>
            <DollarSign size={14} />
            <span className="text-[13px] text-jtext">Recoverable</span>
          </div>
          <div className={`${NUM} text-[32px] leading-tight mt-2`} style={{ color: C.warn }}>{money(recoverable)}</div>
          <div className="text-[12px] mt-1" style={{ color: C.urg }}>{money(lost)} already lost</div>
        </button>
      </GlassCard>
    </motion.div>
  );
}

function ProductionFunnel({ ops }: { ops: DavidStats }) {
  const { calls, conversations, hot, voicemails, lastCall } = ops;
  const convRate = calls > 0 ? Math.round((conversations / calls) * 100) : 0;
  const hotRate  = conversations > 0 ? Math.round((hot / conversations) * 100) : 0;
  const machinesOnly = calls > 0 && conversations === 0;
  const steps = [
    { label: 'Calls made',    value: calls,         color: C.blue },
    { label: 'Conversations', value: conversations,  color: C.pos, rate: `${convRate}% answered` },
    { label: 'Hot found',     value: hot,            color: C.urg, rate: `${hotRate}% qualified` },
  ];
  const max = Math.max(calls, 1);
  return (
    <GlassCard>
      <SectionTitle badge="VA leads · today">Today&apos;s production</SectionTitle>
      {machinesOnly && (
        <div className="flex items-center gap-2 mb-3 text-[13px]" style={{ color: C.warn }}>
          <AlertTriangle size={13} /> {calls} dials, no conversations — likely all voicemail
        </div>
      )}
      <div className="flex flex-col gap-4">
        {steps.map(s => (
          <div key={s.label}>
            <div className="flex items-baseline justify-between text-[14px] mb-1.5">
              <span className="text-jtext">{s.label}</span>
              <span>
                {s.rate && <span className="text-[12px] text-dimtext mr-2.5">{s.rate}</span>}
                <span className={`${NUM} text-[16px]`} style={{ color: s.color }}>{s.value}</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-bg3 overflow-hidden">
              <motion.div className="h-full rounded-full" initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, (s.value / max) * 100)}%` }}
                transition={{ type: 'spring', stiffness: 90, damping: 22 }}
                style={{ background: s.color }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-4 pt-3.5 border-t border-border text-[12px] text-dimtext">
        <span><PhoneCall size={11} className="inline mr-1.5 -mt-px" />{voicemails} voicemails left</span>
        {lastCall && <span>Last call {timeAgo(lastCall)}</span>}
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
    <GlassCard>
      <SectionTitle badge="Free vs paid">Source performance</SectionTitle>
      <div className="grid grid-cols-2 gap-3.5">
        {cards.map(({ key, s }) => {
          const qualified = (s?.hot ?? 0) + (s?.warm ?? 0);
          return (
            <motion.button key={key} whileTap={TAP} transition={SPRING} onClick={onClick}
              className="press text-left rounded-2xl border border-border bg-bg2 p-4 hover:bg-white/10 transition-colors"
              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
              <div className="text-[13px] text-jtext">{SOURCE_LABEL[key]}</div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className={`${NUM} text-[30px] text-textb leading-none`}>{s?.total ?? 0}</span>
                <span className="text-[12px] text-dimtext">leads</span>
              </div>
              <div className="text-[13px] mt-1.5" style={{ color: C.pos }}>{qualified} hot + warm</div>
              {key === 'ispeed' && (
                <div className="text-[12px] text-dimtext mt-2 leading-relaxed">
                  {money(ispeedSpend)} spent · <span style={{ color: C.urg }}>{money(ispeedLost)} past window</span>
                </div>
              )}
            </motion.button>
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
    <GlassCard>
      <SectionTitle>Call cadence</SectionTitle>
      <div className="flex items-center gap-3">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: C.blue }} />
        <span className="text-[14px] text-textb">
          {next ? <>Next window <span className={`${NUM} text-[14px]`} style={{ color: C.blue }}>{next.time}</span> <span className="text-jtext">— {next.stages}</span></> : 'Calling done for today'}
        </span>
        <motion.button whileTap={TAP} transition={SPRING} onClick={() => setOpen(o => !o)}
          className="press ml-auto flex items-center gap-1 text-[12px] text-dimtext hover:text-jtext transition-colors flex-shrink-0">
          {open ? 'Hide' : 'Full schedule'}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="inline-flex"><ChevronDown size={13} /></motion.span>
        </motion.button>
      </div>
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-4 pt-4 border-t border-border overflow-hidden">
          <div className="flex flex-col gap-2">
            <div className="text-[12px] text-dimtext mb-0.5">Schedule (EST)</div>
            {DAVID_SCHEDULE.map(slot => {
              const done = estHour > slot.hour, active = estHour === slot.hour;
              return (
                <div key={slot.time} className="flex items-start gap-2.5">
                  <div className="mt-1.5 flex-shrink-0">
                    {active ? <div className="w-1.5 h-1.5 rounded-full" style={{ background: C.blue }} /> : done ? <CheckCircle size={11} className="text-dimtext opacity-50" /> : <Circle size={11} className="text-dimtext opacity-30" />}
                  </div>
                  <div>
                    <span className={`${NUM} text-[12px]`} style={{ color: active ? C.blue : done ? 'rgba(235,235,245,0.30)' : 'rgba(235,235,245,0.55)' }}>{slot.time}</span>
                    <span className="text-[12px] text-dimtext ml-2">{slot.stages}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="text-[12px] text-dimtext mb-0.5">Frequency rules</div>
            {FREQ_RULES.map(r => (
              <div key={r.stage}>
                <div className="text-[13px] font-medium" style={{ color: r.color }}>{r.stage}</div>
                <div className="text-[12px] text-dimtext leading-snug">{r.rule}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </GlassCard>
  );
}
