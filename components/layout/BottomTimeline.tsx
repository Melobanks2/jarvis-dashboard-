'use client';

import { motion } from 'framer-motion';
import { Phone, Zap, TrendingUp, FileText, User, AlertCircle, CheckCircle } from 'lucide-react';
import { useFeed } from '@/lib/hooks/useFeed';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  call:    { icon: <Phone size={10} />,        color: '#00e5ff', bg: 'rgba(0,229,255,0.08)'  },
  success: { icon: <CheckCircle size={10} />,  color: '#00ff88', bg: 'rgba(0,255,136,0.08)'  },
  error:   { icon: <AlertCircle size={10} />,  color: '#ff3366', bg: 'rgba(255,51,102,0.08)' },
  warning: { icon: <Zap size={10} />,          color: '#ff8800', bg: 'rgba(255,136,0,0.08)'  },
  info:    { icon: <TrendingUp size={10} />,   color: '#00aaff', bg: 'rgba(0,170,255,0.08)'  },
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
        height: 68,
        background: 'rgba(4,4,12,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* Label */}
      <div
        className="flex-shrink-0 flex flex-col items-center justify-center gap-1 px-4 h-full"
        style={{ borderRight: '1px solid rgba(255,255,255,0.05)', minWidth: 80 }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-ngreen animate-blink" style={{ boxShadow: '0 0 6px #00ff88' }} />
        <span className="font-orbitron text-[7px] text-ngreen tracking-[2px] uppercase">Live</span>
      </div>

      {/* Scrollable events */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-4">
        <div className="flex items-center gap-3 h-full py-3" style={{ width: 'max-content' }}>
          {items.length === 0 && (
            <span className="text-[10px] text-dimtext italic font-mono">No recent activity...</span>
          )}
          {items.map((item, i) => {
            const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.info;
            const srcIcon = item.source ? SOURCE_ICONS[item.source.toUpperCase()] : null;

            return (
              <motion.div
                key={item.id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-sm flex-shrink-0 cursor-default"
                style={{
                  background: cfg.bg,
                  border: `1px solid ${cfg.color}20`,
                  maxWidth: 280,
                }}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                whileHover={{ y: -2, borderColor: `${cfg.color}40` }}
              >
                {/* Type icon */}
                <span style={{ color: cfg.color }} className="flex-shrink-0">{cfg.icon}</span>

                <div className="flex-1 min-w-0">
                  {/* Source badge */}
                  {item.source && (
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-[7px] font-orbitron tracking-[1px]" style={{ color: cfg.color }}>
                        {item.source.replace(/_/g, ' ')}
                      </span>
                    </div>
                  )}
                  <div className="text-[9px] text-jtext font-mono truncate" style={{ maxWidth: 200 }}>
                    {item.message}
                  </div>
                </div>

                {/* Time */}
                <span className="text-[7px] text-dimtext font-mono flex-shrink-0">{timeAgo(item.created_at)}</span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
