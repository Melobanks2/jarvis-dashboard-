'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Phone, Flame, Activity, GitBranch } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCalls } from '@/lib/hooks/useCalls';
import { usePipeline } from '@/lib/hooks/usePipeline';
import { useAgents } from '@/lib/hooks/useAgents';
import { useFeed } from '@/lib/hooks/useFeed';
import { StatusDot } from '@/components/ui/StatusDot';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { timeAgo } from '@/lib/supabase';

const JarvisOrb = dynamic(() => import('@/components/three/JarvisOrb').then(m => ({ default: m.JarvisOrb })), { ssr: false });

const TYPE_COLOR: Record<string, string> = {
  success: '#00ff88', error: '#ff3366', warning: '#ff8800', info: '#00aaff', call: '#00e5ff',
};

export function MissionControl({ onClose, refreshKey }: { onClose: () => void; refreshKey: number }) {
  const { calls }   = useCalls(refreshKey);
  const { data }    = usePipeline(refreshKey);
  const { agents }  = useAgents(refreshKey);
  const { items }   = useFeed(refreshKey, 20);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const hot  = data?.stages['Hot Follow Up']?.length ?? 0;
  const online = agents.filter(a => a.status === 'active').length;

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col overflow-hidden"
      style={{ background: 'rgba(4,4,12,0.98)', backdropFilter: 'blur(20px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      {/* Scanlines */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,136,.02) 2px,rgba(0,255,136,.02) 4px)' }} />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'rgba(0,255,136,.15)' }}>
        <div>
          <h1 className="font-orbitron text-[20px] font-black text-ngreen glow-green tracking-[4px]">MISSION CONTROL</h1>
          <p className="text-[9px] text-dimtext tracking-[3px] uppercase mt-0.5">Live Operations · Jarvis AI System</p>
        </div>
        <button onClick={onClose} className="p-2 text-dimtext hover:text-nred transition-colors"><X size={18} /></button>
      </div>

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">

        {/* Left: Orb + stats */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-3">
          <div className="flex-1 relative rounded-sm border border-ngreen/15 overflow-hidden flex items-center justify-center" style={{ background: 'rgba(0,255,136,.03)' }}>
            <JarvisOrb pulse={calls.length > 0 ? 1 : 0} className="w-full h-full max-h-[280px]" />
            <div className="absolute bottom-4 text-center">
              <div className="font-orbitron text-[10px] text-ngreen glow-green tracking-[2px]">JARVIS AI · ACTIVE</div>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Live Calls"    value={calls.length} color="#00e5ff" icon={<Phone size={12} />} />
            <Kpi label="Hot Leads"     value={hot}          color="#ff3366" icon={<Flame size={12} />} />
            <Kpi label="Agents Online" value={online}       color="#00ff88" icon={<Activity size={12} />} />
            <Kpi label="Pipeline"      value={data?.total ?? 0} color="#aa44ff" icon={<GitBranch size={12} />} />
          </div>
        </div>

        {/* Center: Agent status + calls */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-3 overflow-hidden">
          <SectionBlock title="Agent Status" color="#ffd700">
            {agents.map(a => (
              <div key={a.key} className="flex items-center gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,.05)' }}>
                <StatusDot status={a.status === 'active' ? 'online' : a.status === 'idle' ? 'idle' : 'offline'} size="sm" />
                <span className="font-orbitron text-[10px] flex-1" style={{ color: a.color }}>{a.name}</span>
                <span className="text-[9px] text-dimtext">{a.runCount} runs</span>
              </div>
            ))}
          </SectionBlock>

          <SectionBlock title="Today's Calls" color="#00e5ff">
            {calls.length === 0 && <div className="text-[9px] text-dimtext italic">No calls yet today</div>}
            {calls.slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,.05)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-ncyan flex-shrink-0" style={{ boxShadow: '0 0 6px #00e5ff' }} />
                <span className="flex-1 text-[10px] text-textb truncate">{c.contact_name}</span>
                <span className="text-[9px] text-dimtext flex-shrink-0">{Math.floor(c.call_duration / 60)}:{String(c.call_duration % 60).padStart(2,'0')}</span>
              </div>
            ))}
          </SectionBlock>
        </div>

        {/* Right: Live activity feed */}
        <div className="col-span-12 lg:col-span-4 overflow-hidden">
          <SectionBlock title="Live Activity Feed" color="#00ff88" fullHeight>
            <div className="flex flex-col gap-1.5 overflow-y-auto max-h-full">
              <AnimatePresence>
                {items.map(item => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex gap-2 py-1.5 border-b border-border text-[10px]"
                  >
                    <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: TYPE_COLOR[item.type] || '#5a5a80' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-jtext line-clamp-2">{item.message}</div>
                      <div className="text-[8px] text-dimtext">{timeAgo(item.created_at)}</div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </SectionBlock>
        </div>
      </div>
    </motion.div>
  );
}

function Kpi({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="p-2.5 rounded-sm border text-center" style={{ background: `${color}08`, borderColor: `${color}20` }}>
      <div className="flex justify-center mb-1" style={{ color }}>{icon}</div>
      <AnimatedCounter target={value} className="font-orbitron text-[22px] font-black block" style={{ color } as React.CSSProperties} />
      <div className="text-[8px] text-dimtext mt-0.5">{label}</div>
    </div>
  );
}

function SectionBlock({ title, color, children, fullHeight }: { title: string; color: string; children: React.ReactNode; fullHeight?: boolean }) {
  return (
    <div className={`rounded-sm border overflow-hidden ${fullHeight ? 'flex-1 flex flex-col' : ''}`} style={{ background: 'rgba(10,10,22,.8)', borderColor: `${color}20` }}>
      <div className="px-3 py-2 border-b" style={{ borderColor: `${color}20`, background: `${color}08` }}>
        <span className="font-orbitron text-[9px] font-bold tracking-[2px] uppercase" style={{ color }}>{title}</span>
      </div>
      <div className={`p-3 ${fullHeight ? 'flex-1 overflow-hidden flex flex-col' : ''}`}>
        {children}
      </div>
    </div>
  );
}
