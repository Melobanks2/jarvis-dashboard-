'use client';

import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Flame, TrendingUp, Phone, Users, Activity, GitBranch } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { StatusDot } from '@/components/ui/StatusDot';
import { usePipeline } from '@/lib/hooks/usePipeline';
import { useCalls } from '@/lib/hooks/useCalls';
import { useAgents } from '@/lib/hooks/useAgents';
import { useFeed } from '@/lib/hooks/useFeed';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

const JarvisOrb = dynamic(() => import('@/components/three/JarvisOrb').then(m => ({ default: m.JarvisOrb })), { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center text-dimtext text-[11px]">Initializing AI core...</div> });

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

export function CommandCenter() {
  const { refreshKey } = useApp();
  const { data, loading: pLoading } = usePipeline(refreshKey);
  const { calls } = useCalls(refreshKey);
  const { agents } = useAgents(refreshKey);
  const { items: feed } = useFeed(refreshKey, 10);

  const hot     = data?.stages['Hot Follow Up']?.length ?? 0;
  const warm    = data?.stages['Warm Follow Up']?.length ?? 0;
  const pending = data?.stages['Decision Pending']?.length ?? 0;
  const total   = data?.total ?? 0;
  const online  = agents.filter(a => a.status === 'active').length;
  const pulse   = calls.length > 0 ? 1 : 0;

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">

      {/* Hero row */}
      <motion.div variants={FADE_UP} className="grid grid-cols-1 lg:grid-cols-5 gap-5 min-h-[360px]">

        {/* Left stats */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <BigStat label="Hot Leads"    value={hot}     color="#ff3366" icon={<Flame size={16} />} />
          <BigStat label="Warm Leads"   value={warm}    color="#ff8800" icon={<TrendingUp size={16} />} />
          <BigStat label="Pipeline"     value={total}   color="#00aaff" icon={<Users size={16} />} />
          <BigStat label="Agents Online"value={online}  color="#00ff88" icon={<Activity size={16} />} />
        </div>

        {/* Orb center */}
        <GlassCard accent="green" className="lg:col-span-3 flex flex-col items-center justify-center min-h-[320px] relative overflow-hidden" padding="">
          {/* Pulse rings */}
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
          <BigStat label="Calls Today"    value={calls.length} color="#00e5ff" icon={<Phone size={16} />} />
          <BigStat label="Decision Pending" value={pending}   color="#aa44ff" icon={<GitBranch size={16} />} />
          <BigStat label="Contract Sent"  value={data?.stages['Contract Sent']?.length ?? 0} color="#00ff88" icon={<Activity size={16} />} />
          <BigStat label="Under Contract" value={data?.stages['Under Contract']?.length ?? 0} color="#00cc66" icon={<TrendingUp size={16} />} />
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
                    {item.source && <span className="text-[8px] font-orbitron px-1.5 py-0.5 rounded-sm" style={{ background: `${TYPE_COLOR[item.type]}15`, color: TYPE_COLOR[item.type] || '#5a5a80', border: `1px solid ${TYPE_COLOR[item.type]}25` }}>{item.source}</span>}
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
