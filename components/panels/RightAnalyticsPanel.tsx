'use client';

import { motion } from 'framer-motion';
import { useApp } from '@/lib/AppContext';
import { useCalls } from '@/lib/hooks/useCalls';
import { useFeed } from '@/lib/hooks/useFeed';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { timeAgo } from '@/lib/supabase';

const MONTHLY_GOAL = 30000;
const AVG_FEE = 8500;

const STAGE_COLORS: Record<string, string> = {
  'Hot Follow Up':    '#ff3366',
  'Warm Follow Up':   '#ff8800',
  'Decision Pending': '#aa44ff',
  'Contract Sent':    '#00ff88',
  'Under Contract':   '#00cc66',
  'New Lead':         '#00aaff',
};

export function RightAnalyticsPanel() {
  const { refreshKey }     = useApp();
  const { calls }          = useCalls(refreshKey);
  const { items: feed }    = useFeed(refreshKey, 6);

  const hotFound    = calls.filter(c => c.stage_after === 'Hot Follow Up' && c.stage_before !== 'Hot Follow Up').length;
  const answered    = calls.filter(c => c.call_duration > 10).length;
  const revenue     = 0; // from pipeline when available
  const revPct      = Math.min(100, (revenue / MONTHLY_GOAL) * 100);

  return (
    <div
      className="hidden lg:flex flex-col overflow-y-auto flex-shrink-0"
      style={{
        width: 260,
        background: 'rgba(8,8,20,0.55)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderLeft: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div className="flex flex-col gap-0 py-6 px-5">

        {/* Big call stats */}
        <Module label="Call Performance">
          <div className="grid grid-cols-2 gap-3 mb-1">
            <BigNum label="Calls Today"  value={calls.length}  color="#00e5ff" />
            <BigNum label="Answered"     value={answered}      color="#00ff88" />
            <BigNum label="Hot Found"    value={hotFound}      color="#ff3366" />
            <BigNum label="Voicemails"   value={Math.max(0, calls.length - answered)} color="#ffd700" />
          </div>
        </Module>

        <Divider />

        {/* Revenue goal */}
        <Module label="Monthly Goal">
          <div className="mb-3">
            <div className="flex items-end gap-1 mb-2">
              <AnimatedCounter target={revenue} prefix="$" className="font-orbitron text-[26px] font-black text-ngold" style={{ textShadow: '0 0 20px rgba(255,215,0,.4)' } as React.CSSProperties} />
              <span className="text-dimtext text-[12px] mb-1 font-mono">/ $30K</span>
            </div>
            {/* Progress bar */}
            <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,215,0,0.1)' }}>
              <motion.div
                className="absolute top-0 left-0 h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #ffd700, #ff8800)' }}
                initial={{ width: 0 }}
                animate={{ width: `${revPct}%` }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[8px] text-dimtext font-mono">
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
                  <span className="text-[9px] text-dimtext font-mono truncate">{stage}</span>
                </div>
                <span className="font-orbitron text-[11px] font-bold flex-shrink-0" style={{ color }}>—</span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[8px] text-dimtext italic">
            Pipeline data via asaparv-agent
          </div>
        </Module>

        <Divider />

        {/* Recent feed */}
        <Module label="Activity">
          <div className="flex flex-col gap-2">
            {feed.slice(0, 5).map(item => {
              const tc = { success: '#00ff88', error: '#ff3366', warning: '#ff8800', info: '#00aaff', call: '#00e5ff' }[item.type] || '#5a5a80';
              return (
                <motion.div key={item.id} className="flex gap-2" whileHover={{ x: 2 }}>
                  <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: tc }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] text-jtext line-clamp-1 font-mono">{item.message}</div>
                    <div className="text-[7px] text-dimtext mt-0.5">{timeAgo(item.created_at)}</div>
                  </div>
                </motion.div>
              );
            })}
            {feed.length === 0 && <div className="text-[9px] text-dimtext italic">No activity yet</div>}
          </div>
        </Module>
      </div>
    </div>
  );
}

function Module({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-px bg-ncyan/40" />
        <span className="text-[8px] font-orbitron tracking-[2.5px] uppercase text-dimtext">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-white/[0.04]" />;
}

function BigNum({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <AnimatedCounter target={value} className="font-orbitron text-[24px] font-black block" style={{ color } as React.CSSProperties} />
      <div className="text-[8px] text-dimtext font-mono tracking-[0.5px] mt-0.5">{label}</div>
    </div>
  );
}
