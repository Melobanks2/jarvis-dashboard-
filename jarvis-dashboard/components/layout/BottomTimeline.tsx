'use client';

import { motion } from 'framer-motion';
import { Phone, Zap, TrendingUp, FileText, User, AlertCircle, CheckCircle } from 'lucide-react';
import { useFeed } from '@/lib/hooks/useFeed';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  call:    { icon: <Phone size={10} />,       color: '#67e8f9' },
  success: { icon: <CheckCircle size={10} />, color: '#4ade80' },
  error:   { icon: <AlertCircle size={10} />, color: '#f87171' },
  warning: { icon: <Zap size={10} />,         color: '#fb923c' },
  info:    { icon: <TrendingUp size={10} />,  color: '#60a5fa' },
};

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  JARVIS_CALLER:  <Phone size={9} />,
  ALPHA_SCRAPER:  <Zap size={9} />,
  CALL_ANALYZER:  <FileText size={9} />,
  COUNTY_SCRAPER: <User size={9} />,
};

export function BottomTimeline() {
  const { refreshKey } = useApp();
  const { items }      = useFeed(refreshKey, 20);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center"
      style={{
        height: 60,
        background: 'rgba(11,12,19,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* Live indicator */}
      <div
        className="flex-shrink-0 flex flex-col items-center justify-center gap-1 px-4 h-full"
        style={{ borderRight: '1px solid rgba(255,255,255,0.05)', minWidth: 72 }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-ngreen animate-blink" />
        <span className="text-[8px] font-semibold text-ngreen tracking-[1.5px] uppercase">Live</span>
      </div>

      {/* Scrollable events */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-4" style={{ scrollbarWidth: 'none' }}>
        <div className="flex items-center gap-2.5 h-full py-2.5" style={{ width: 'max-content' }}>
          {items.length === 0 && (
            <span className="text-[10px] text-dimtext italic">No recent activity</span>
          )}
          {items.map((item, i) => {
            const cfg     = TYPE_CONFIG[item.type] || TYPE_CONFIG.info;
            const srcIcon = item.source ? SOURCE_ICONS[item.source.toUpperCase()] : null;

            return (
              <motion.div
                key={item.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md flex-shrink-0 cursor-default"
                style={{
                  background: `${cfg.color}08`,
                  border: `1px solid ${cfg.color}18`,
                  maxWidth: 260,
                }}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                whileHover={{ y: -1 }}
              >
                <span style={{ color: cfg.color }} className="flex-shrink-0">{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  {item.source && (
                    <div className="text-[7px] font-medium mb-0.5 uppercase tracking-[0.5px]" style={{ color: cfg.color }}>
                      {item.source.replace(/_/g, ' ')}
                    </div>
                  )}
                  <div className="text-[9px] text-jtext truncate" style={{ maxWidth: 180 }}>
                    {item.message}
                  </div>
                </div>
                <span className="text-[7px] text-dimtext flex-shrink-0">{timeAgo(item.created_at)}</span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
