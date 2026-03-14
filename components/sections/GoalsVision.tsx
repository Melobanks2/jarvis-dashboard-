'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Target, TrendingUp, Home, DollarSign, Star } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { usePipeline } from '@/lib/hooks/usePipeline';
import { useApp } from '@/lib/AppContext';

const MONTHLY_GOAL = 30000;
const YEARLY_GOAL  = 360000;

const PERSONAL_GOALS = [
  { label: 'BMW M4 Competition',    category: 'Vehicle',    target: 85000,  current: 0,   color: '#00aaff' },
  { label: 'Waterfront Property',   category: 'Real Estate',target: 1,      current: 0,   color: '#00ff88', unit: 'deal' },
  { label: 'Move to Miami Beach',   category: 'Lifestyle',  target: 1,      current: 0,   color: '#aa44ff', unit: 'ready' },
  { label: 'Monthly Passive Income',category: 'Finance',    target: 10000,  current: 0,   color: '#ffd700', prefix: '$' },
];

const LIFESTYLE_GOALS = [
  { label: 'Deals Closed This Month', value: 0,  target: 3,  color: '#00ff88' },
  { label: 'Properties Owned',        value: 0,  target: 5,  color: '#00aaff' },
  { label: 'Monthly Cash Flow',       value: 0,  target: 10000, color: '#ffd700', prefix: '$' },
  { label: 'Yearly Revenue',          value: 0,  target: 360000, color: '#aa44ff', prefix: '$' },
];

export function GoalsVision() {
  const { refreshKey } = useApp();
  const { data } = usePipeline(refreshKey);

  // Estimate revenue from closed deals
  const closedDeals   = data?.stages['Closed']?.length ?? 0;
  const contractDeals = data?.stages['Contract Sent']?.length ?? 0;
  const currentRevenue = closedDeals * 8500; // ~avg assignment fee
  const revenuePercent = Math.min(100, (currentRevenue / MONTHLY_GOAL) * 100);

  return (
    <div className="flex flex-col gap-5">

      {/* Revenue goal */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Monthly goal tracker */}
        <GlassCard accent="gold" padding="p-5">
          <SectionTitle accent="gold">Monthly Revenue Goal</SectionTitle>
          <div className="flex items-end gap-3 mb-4">
            <div>
              <div className="text-[10px] text-dimtext mb-1">Current</div>
              <AnimatedCounter target={currentRevenue} prefix="$" className="font-orbitron text-[36px] font-black text-ngold glow-gold" />
            </div>
            <div className="text-dimtext text-[20px] mb-1">/</div>
            <div>
              <div className="text-[10px] text-dimtext mb-1">Target</div>
              <div className="font-orbitron text-[24px] font-bold text-dimtext">${MONTHLY_GOAL.toLocaleString()}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="relative h-3 bg-bg3 rounded-full overflow-hidden mb-2 border border-border2">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #ffd700, #ff8800)' }}
              initial={{ width: 0 }}
              animate={{ width: `${revenuePercent}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          </div>

          <div className="flex justify-between text-[9px] text-dimtext mb-4">
            <span>{revenuePercent.toFixed(1)}% complete</span>
            <span>${(MONTHLY_GOAL - currentRevenue).toLocaleString()} remaining</span>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <StatBox label="Deals Closed"    value={closedDeals}   color="#00ff88" />
            <StatBox label="Under Contract"  value={contractDeals} color="#aa44ff" />
            <StatBox label="Deals Needed"    value={Math.max(0, Math.ceil((MONTHLY_GOAL - currentRevenue) / 8500))} color="#ffd700" />
            <StatBox label="Daily Target"    value={Math.ceil((MONTHLY_GOAL - currentRevenue) / 18)} prefix="$" color="#ff8800" />
          </div>
        </GlassCard>

        {/* Yearly goal */}
        <GlassCard accent="green" padding="p-5">
          <SectionTitle accent="green">Yearly Vision</SectionTitle>

          {/* Yearly bar */}
          <div className="mb-4">
            <div className="flex justify-between text-[9px] text-dimtext mb-1">
              <span>2026 Target: $360K</span>
              <span>{((currentRevenue * 12) / YEARLY_GOAL * 100).toFixed(0)}% pace</span>
            </div>
            <div className="h-2 bg-bg3 rounded-full overflow-hidden border border-border2">
              <motion.div
                className="h-full rounded-full bg-ngreen"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (currentRevenue / (YEARLY_GOAL / 12)) * 100)}%` }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            </div>
          </div>

          {/* Lifestyle trackers */}
          <div className="flex flex-col gap-3">
            {LIFESTYLE_GOALS.map(g => {
              const pct = Math.min(100, (g.value / g.target) * 100);
              return (
                <div key={g.label}>
                  <div className="flex justify-between text-[9px] mb-1">
                    <span style={{ color: g.color }}>{g.label}</span>
                    <span className="text-dimtext">{g.prefix ?? ''}{g.value.toLocaleString()} / {g.prefix ?? ''}{g.target.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 bg-bg3 rounded-full overflow-hidden border border-border2">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: g.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>

      {/* Personal goals */}
      <GlassCard accent="purple" padding="p-5">
        <SectionTitle accent="purple">Personal Goals</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PERSONAL_GOALS.map(g => {
            const pct = g.unit ? g.current * 100 : Math.min(100, (g.current / g.target) * 100);
            return (
              <div key={g.label} className="p-3 rounded-sm border" style={{ background: `${g.color}08`, borderColor: `${g.color}20` }}>
                <div className="font-orbitron text-[9px] font-bold mb-1" style={{ color: g.color }}>{g.category}</div>
                <div className="text-[11px] text-textb mb-2 leading-tight">{g.label}</div>
                <div className="text-[9px] text-dimtext mb-1">
                  {g.unit
                    ? `${g.current}/${g.target} ${g.unit}`
                    : `${g.prefix ?? ''}${g.current.toLocaleString()} / ${g.prefix ?? ''}${g.target.toLocaleString()}`
                  }
                </div>
                <div className="h-1.5 bg-bg3 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: g.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 1 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Vision board */}
      <GlassCard accent="cyan" padding="p-5">
        <SectionTitle accent="cyan">Vision Board</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <VisionItem icon={<Home size={20} className="text-ngreen" />} title="Real Estate Portfolio" desc="Own 5+ cash-flowing rental properties generating $10K/mo passive income" color="#00ff88" />
          <VisionItem icon={<DollarSign size={20} className="text-ngold" />} title="$1M Revenue" desc="Hit $1M in wholesale assignment fees and build 7-figure business" color="#ffd700" />
          <VisionItem icon={<Star size={20} className="text-npurple" />} title="Automation Empire" desc="Fully automated deal flow — AI handles 90% of operations end-to-end" color="#aa44ff" />
        </div>
      </GlassCard>
    </div>
  );
}

function StatBox({ label, value, color, prefix = '' }: { label: string; value: number; color: string; prefix?: string }) {
  return (
    <div className="p-2 rounded-sm border" style={{ background: `${color}08`, borderColor: `${color}20` }}>
      <div className="text-[8px] text-dimtext font-orbitron uppercase tracking-[1px] mb-1">{label}</div>
      <AnimatedCounter target={value} prefix={prefix} className="font-orbitron text-[20px] font-black" style={{ color } as React.CSSProperties} />
    </div>
  );
}

function VisionItem({ icon, title, desc, color }: { icon: React.ReactNode; title: string; desc: string; color: string }) {
  return (
    <div className="p-4 rounded-sm border" style={{ background: `${color}06`, borderColor: `${color}18` }}>
      <div className="mb-2">{icon}</div>
      <div className="font-orbitron text-[11px] font-bold mb-1" style={{ color }}>{title}</div>
      <div className="text-[10px] text-dimtext leading-relaxed">{desc}</div>
    </div>
  );
}
