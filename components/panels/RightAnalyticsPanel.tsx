'use client';

import { motion } from 'framer-motion';
import { useApp } from '@/lib/AppContext';
import { useCalls } from '@/lib/hooks/useCalls';
import { useFeed } from '@/lib/hooks/useFeed';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { timeAgo } from '@/lib/supabase';

const MONTHLY_GOAL = 30000;

const STAGE_COLORS: Record<string, string> = {
  'Hot Follow Up':    '#f87171',
  'Warm Follow Up':   '#fb923c',
  'Decision Pending': '#a78bfa',
  'Contract Sent':    '#4ade80',
  'Under Contract':   '#4ade80',
  'New Lead':         '#60a5fa',
};

export function RightAnalyticsPanel() {
  const { refreshKey }  = useApp();
  const { calls }       = useCalls(refreshKey);
  const { items: feed } = useFeed(refreshKey, 6);

  const hotFound = calls.filter(c => c.stage_after === 'Hot Follow Up' && c.stage_before !== 'Hot Follow Up').length;
  const answered = calls.filter(c => c.call_duration > 10).length;
  const revenue  = 0;
  const revPct   = Math.min(100, (revenue / MONTHLY_GOAL) * 100);

  return (
    <div
      className="hidden lg:flex flex-col overflow-y-auto flex-shrink-0"
      style={{
        width: 260,
        background: 'rgba(11,12,19,0.60)',
        borderLeft: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div className="flex flex-col gap-0 py-6 px-5">

        {/* Call stats */}
        <Module label="Call Performance">
          <div className="grid grid-cols-2 gap-3 mb-1">
            <BigNum label="Calls Today" value={calls.length}                          color="#67e8f9" />
            <BigNum label="Answered"    value={answered}                              color="#4ade80" />
            <BigNum label="Hot Found"   value={hotFound}                              color="#f87171" />
            <BigNum label="Voicemails"  value={Math.max(0, calls.length - answered)}  color="#fbbf24" />
          </div>
        </Module>

        <Divider />

        {/* Revenue goal */}
        <Module label="Monthly Goal">
          <div className="mb-3">
            <div className="flex items-end gap-1 mb-2">
              <AnimatedCounter
                target={revenue}
                prefix="$"
                className="font-orbitron text-[24px] font-bold"
                style={{ color: '#fbbf24' } as React.CSSProperties}
              />
              <span className="text-dimtext text-[11px] mb-0.5">/ $30K</span>
            </div>
            <div className="relative h-1 rounded-full overflow-hidden" style={{ background: 'rgba(251,191,36,0.10)' }}>
              <motion.div
                className="absolute top-0 left-0 h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #fbbf24, #fb923c)' }}
                initial={{ width: 0 }}
                animate={{ width: `${revPct}%` }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[8px] text-dimtext">
              <span>{revPct.toFixed(0)}%</span>
              <span>${(MONTHLY_GOAL - revenue).toLocaleString()} left</span>
            </div>
          </div>
        </Module>

        <Divider />

        {/* Pipeline snapshot */}
        <Module label="Pipeline">
          <div className="flex flex-col gap-1.5">
            {Object.entries(STAGE_COLORS).map(([stage, color]) => (
              <div key={stage} className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-[10px] text-jtext truncate">{stage}</span>
                </div>
                <span className="font-orbitron text-[11px] font-bold flex-shrink-0 text-dimtext">—</span>
              </div>
            ))}
          </div>
        </Module>

        <Divider />

        {/* Recent activity */}
        <Module label="Activity">
          <div className="flex flex-col gap-2">
            {feed.slice(0, 5).map(item => {
              const tc = { success: '#4ade80', error: '#f87171', warning: '#fb923c', info: '#60a5fa', call: '#67e8f9' }[item.type] || '#52526e';
              return (
                <motion.div key={item.id} className="flex gap-2" whileHover={{ x: 2 }}>
                  <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: tc }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-jtext line-clamp-1">{item.message}</div>
                    <div className="text-[8px] text-dimtext mt-0.5">{timeAgo(item.created_at)}</div>
                  </div>
                </motion.div>
              );
            })}
            {feed.length === 0 && <div className="text-[10px] text-dimtext italic">No activity yet</div>}
          </div>
        </Module>
      </div>
    </div>
  );
}

function Module({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-4">
      <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px] mb-3">{label}</p>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-white/[0.045]" />;
}

function BigNum({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <AnimatedCounter
        target={value}
        className="font-orbitron text-[22px] font-bold block leading-none"
        style={{ color } as React.CSSProperties}
      />
      <div className="text-[9px] text-dimtext mt-1">{label}</div>
    </div>
  );
}
