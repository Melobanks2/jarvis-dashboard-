'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Activity, TrendingUp, Phone, Flame } from 'lucide-react';
import { useApp } from '@/lib/AppContext';
import { useFeed } from '@/lib/hooks/useFeed';
import { usePipeline } from '@/lib/hooks/usePipeline';
import { useCalls } from '@/lib/hooks/useCalls';
import { timeAgo } from '@/lib/supabase';

const TYPE_COLOR: Record<string, string> = {
  success: '#00ff88', error: '#ff3366', warning: '#ff8800', info: '#00aaff', call: '#00e5ff',
};

export function RightPanel() {
  const { rightPanelOpen, setRightPanelOpen, refreshKey } = useApp();
  const { items } = useFeed(refreshKey, 8);
  const { data }  = usePipeline(refreshKey);
  const { calls } = useCalls(refreshKey);

  const hotLeads   = data?.stages['Hot Follow Up']?.length ?? 0;
  const warmLeads  = data?.stages['Warm Follow Up']?.length ?? 0;
  const contractSent = data?.stages['Contract Sent']?.length ?? 0;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setRightPanelOpen(!rightPanelOpen)}
        className="fixed top-20 right-0 z-40 flex items-center justify-center w-5 h-10 border border-r-0 border-border2 rounded-l-sm text-dimtext hover:text-ngreen transition-colors"
        style={{ background: 'rgba(10,10,20,0.9)' }}
      >
        <motion.span animate={{ rotate: rightPanelOpen ? 0 : 180 }}>
          <ChevronRight size={12} />
        </motion.span>
      </button>

      <AnimatePresence>
        {rightPanelOpen && (
          <motion.aside
            className="fixed top-14 right-0 bottom-10 z-30 overflow-y-auto border-l border-border2 flex flex-col gap-4 p-3"
            style={{ width: 270, background: 'rgba(8,8,18,0.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
            initial={{ x: 270, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 270, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          >
            {/* Intelligence header */}
            <div>
              <div className="font-orbitron text-[9px] tracking-[3px] text-ncyan uppercase mb-3 flex items-center gap-2">
                <Activity size={11} className="text-ncyan" /> Intelligence Panel
              </div>

              {/* Key metrics */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <MetricCard label="Hot Leads"    value={hotLeads}      color="#ff3366" icon={<Flame size={12} />} />
                <MetricCard label="Warm Leads"   value={warmLeads}     color="#ff8800" icon={<TrendingUp size={12} />} />
                <MetricCard label="Calls Today"  value={calls.length}  color="#00e5ff" icon={<Phone size={12} />} />
                <MetricCard label="Contract Sent"value={contractSent}  color="#00ff88" icon={<Activity size={12} />} />
              </div>
            </div>

            {/* Hot sellers */}
            {hotLeads > 0 && (
              <div>
                <div className="font-orbitron text-[8px] tracking-[2px] text-nred uppercase mb-2">🔥 Hot Sellers</div>
                <div className="flex flex-col gap-1.5">
                  {(data?.stages['Hot Follow Up'] ?? []).slice(0, 5).map(l => (
                    <div key={l.id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{ background: 'rgba(255,51,102,.06)', border: '1px solid rgba(255,51,102,.15)' }}>
                      <span className="w-1 h-1 rounded-full bg-nred flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-textb truncate">{l.name}</div>
                        <div className="text-[9px] text-dimtext truncate">{l.address || l.phone}</div>
                      </div>
                      {l.daysInStage != null && <span className="text-[8px] text-nred flex-shrink-0">{l.daysInStage}d</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent activity */}
            <div>
              <div className="font-orbitron text-[8px] tracking-[2px] text-ncyan uppercase mb-2">Recent Activity</div>
              <div className="flex flex-col gap-1">
                {items.map(item => (
                  <div key={item.id} className="flex gap-2 text-[10px] py-1 border-b border-border last:border-0">
                    <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: TYPE_COLOR[item.type] || '#5a5a80' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-jtext line-clamp-1">{item.message}</div>
                      <div className="text-[8px] text-dimtext">{timeAgo(item.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function MetricCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="p-2 rounded-sm border" style={{ background: `${color}08`, borderColor: `${color}20` }}>
      <div className="flex items-center gap-1.5 mb-1" style={{ color }}>
        {icon}
        <span className="text-[8px] font-orbitron tracking-[1px] uppercase">{label}</span>
      </div>
      <div className="font-orbitron text-[20px] font-black" style={{ color }}>{value}</div>
    </div>
  );
}
