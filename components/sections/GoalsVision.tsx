'use client';

import { motion } from 'framer-motion';
import { Target, Home, DollarSign, Star, TrendingUp } from 'lucide-react';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { usePipeline } from '@/lib/hooks/usePipeline';
import { useApp } from '@/lib/AppContext';

const MONTHLY_GOAL = 30000;
const YEARLY_GOAL  = 360000;

const PERSONAL_GOALS = [
  { label: 'BMW M4 Competition',     category: 'Vehicle',     target: 85000, current: 0,  color: '#60a5fa', prefix: '$' },
  { label: 'Waterfront Property',    category: 'Real Estate', target: 1,     current: 0,  color: '#4ade80', unit: 'deal' },
  { label: 'Move to Miami Beach',    category: 'Lifestyle',   target: 1,     current: 0,  color: '#a78bfa', unit: 'ready' },
  { label: 'Monthly Passive Income', category: 'Finance',     target: 10000, current: 0,  color: '#fbbf24', prefix: '$' },
];

const LIFESTYLE_GOALS = [
  { label: 'Deals Closed This Month', value: 0, target: 3,      color: '#4ade80' },
  { label: 'Properties Owned',        value: 0, target: 5,      color: '#60a5fa' },
  { label: 'Monthly Cash Flow',       value: 0, target: 10000,  color: '#fbbf24', prefix: '$' },
  { label: 'Yearly Revenue',          value: 0, target: 360000, color: '#a78bfa', prefix: '$' },
];

export function GoalsVision() {
  const { refreshKey } = useApp();
  const { data } = usePipeline(refreshKey);

  const closedDeals    = data?.stages['Closed']?.length ?? 0;
  const contractDeals  = data?.stages['Contract Sent']?.length ?? 0;
  const currentRevenue = closedDeals * 8500;
  const revenuePercent = Math.min(100, (currentRevenue / MONTHLY_GOAL) * 100);

  return (
    <div className="flex flex-col gap-5">

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Monthly revenue card */}
        <Card accent="#fbbf24">
          <Label>Monthly Revenue Goal</Label>
          <div className="flex items-end gap-3 mb-5">
            <div>
              <div className="text-[10px] text-dimtext mb-1">Current</div>
              <AnimatedCounter
                target={currentRevenue}
                prefix="$"
                className="font-orbitron text-[32px] font-bold"
                style={{ color: '#fbbf24' } as React.CSSProperties}
              />
            </div>
            <span className="text-dimtext text-[18px] mb-1 font-light">/</span>
            <div>
              <div className="text-[10px] text-dimtext mb-1">Target</div>
              <div className="font-orbitron text-[20px] font-bold text-dimtext">${MONTHLY_GOAL.toLocaleString()}</div>
            </div>
          </div>

          <ProgressBar value={revenuePercent} color="#fbbf24" />
          <div className="flex justify-between mt-2 text-[9px] text-dimtext">
            <span>{revenuePercent.toFixed(1)}% complete</span>
            <span>${(MONTHLY_GOAL - currentRevenue).toLocaleString()} remaining</span>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-5">
            <MiniStat label="Deals Closed"   value={closedDeals}   color="#4ade80" />
            <MiniStat label="Under Contract" value={contractDeals} color="#a78bfa" />
            <MiniStat label="Deals Needed"   value={Math.max(0, Math.ceil((MONTHLY_GOAL - currentRevenue) / 8500))} color="#fbbf24" />
            <MiniStat label="Daily Target"   value={Math.ceil((MONTHLY_GOAL - currentRevenue) / 18)} color="#fb923c" prefix="$" />
          </div>
        </Card>

        {/* Yearly vision card */}
        <Card accent="#4ade80">
          <Label>2026 Vision</Label>

          <div className="mb-5">
            <div className="flex justify-between text-[10px] text-dimtext mb-2">
              <span>Yearly Target: $360K</span>
              <span>{((currentRevenue * 12) / YEARLY_GOAL * 100).toFixed(0)}% pace</span>
            </div>
            <ProgressBar value={Math.min(100, (currentRevenue / (YEARLY_GOAL / 12)) * 100)} color="#4ade80" />
          </div>

          <div className="flex flex-col gap-3.5">
            {LIFESTYLE_GOALS.map(g => {
              const pct = Math.min(100, (g.value / g.target) * 100);
              return (
                <div key={g.label}>
                  <div className="flex justify-between text-[10px] mb-1.5">
                    <span className="text-jtext">{g.label}</span>
                    <span className="text-dimtext font-mono">
                      {g.prefix ?? ''}{g.value.toLocaleString()} / {g.prefix ?? ''}{g.target.toLocaleString()}
                    </span>
                  </div>
                  <ProgressBar value={pct} color={g.color} thin />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Personal goals */}
      <Card accent="#a78bfa">
        <Label>Personal Goals</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-1">
          {PERSONAL_GOALS.map(g => {
            const pct = g.unit ? g.current * 100 : Math.min(100, (g.current / g.target) * 100);
            return (
              <div
                key={g.label}
                className="rounded-xl p-4"
                style={{ background: `${g.color}07`, border: `1px solid ${g.color}18` }}
              >
                <div className="text-[9px] font-semibold uppercase tracking-[1px] mb-1.5" style={{ color: g.color }}>{g.category}</div>
                <div className="text-[12px] font-medium text-textb mb-2.5 leading-snug">{g.label}</div>
                <div className="text-[9px] text-dimtext mb-2">
                  {g.unit
                    ? `${g.current}/${g.target} ${g.unit}`
                    : `${g.prefix ?? ''}${g.current.toLocaleString()} / ${g.prefix ?? ''}${g.target.toLocaleString()}`
                  }
                </div>
                <ProgressBar value={pct} color={g.color} thin />
              </div>
            );
          })}
        </div>
      </Card>

      {/* Vision board */}
      <Card accent="#67e8f9">
        <Label>Vision Board</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-1">
          <VisionItem icon={<Home size={18} />}        title="Real Estate Portfolio" desc="Own 5+ cash-flowing rental properties generating $10K/mo passive income" color="#4ade80" />
          <VisionItem icon={<DollarSign size={18} />}  title="$1M Revenue"           desc="Hit $1M in wholesale assignment fees and build a 7-figure business" color="#fbbf24" />
          <VisionItem icon={<Star size={18} />}        title="Automation Empire"     desc="Fully automated deal flow — AI handles 90% of operations end-to-end" color="#a78bfa" />
        </div>
      </Card>
    </div>
  );
}

function Card({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'rgba(18,19,32,0.8)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: `inset 0 1px 0 ${accent}18`,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px] mb-4">{children}</p>;
}

function ProgressBar({ value, color, thin }: { value: number; color: string; thin?: boolean }) {
  return (
    <div
      className={`relative ${thin ? 'h-1' : 'h-1.5'} rounded-full overflow-hidden`}
      style={{ background: `${color}12` }}
    >
      <motion.div
        className="absolute top-0 left-0 h-full rounded-full"
        style={{ background: color, opacity: 0.7 }}
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 1, ease: 'easeOut' }}
      />
    </div>
  );
}

function MiniStat({ label, value, color, prefix = '' }: { label: string; value: number; color: string; prefix?: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: `${color}07`, border: `1px solid ${color}18` }}>
      <div className="text-[8px] text-dimtext uppercase tracking-[1px] mb-1">{label}</div>
      <AnimatedCounter
        target={value}
        prefix={prefix}
        className="font-orbitron text-[18px] font-bold"
        style={{ color } as React.CSSProperties}
      />
    </div>
  );
}

function VisionItem({ icon, title, desc, color }: { icon: React.ReactNode; title: string; desc: string; color: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: `${color}06`, border: `1px solid ${color}15` }}>
      <div className="mb-3" style={{ color }}>{icon}</div>
      <div className="text-[12px] font-semibold text-textb mb-1.5">{title}</div>
      <div className="text-[10px] text-dimtext leading-relaxed">{desc}</div>
    </div>
  );
}
