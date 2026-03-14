'use client';

import { motion } from 'framer-motion';
import { Play, Square, RefreshCw, Crown, Activity, Clock } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { useAgents } from '@/lib/hooks/useAgents';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';
import { useFeed } from '@/lib/hooks/useFeed';

const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const FADE_UP = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const ROBOT_PATHS: Record<string, string> = {
  head: 'M18 4 Q18 2 20 2 Q22 2 22 4 L22 6 Q24 6 24 8 L24 16 Q24 18 22 18 L18 18 Q16 18 16 16 L16 8 Q16 6 18 6 Z',
};

function RobotIcon({ color, size = 40 }: { color: string; size?: number }) {
  const s = size / 40;
  return (
    <svg width={size} height={size * 1.3} viewBox="0 0 40 52" fill="none">
      <rect x="14" y="2" width="12" height="10" rx="2" fill={color} opacity="0.9" />
      <rect x="18" y="0" width="4" height="4" rx="1" fill={color} opacity="0.6" />
      <rect x="10" y="12" width="20" height="16" rx="3" fill={color} opacity="0.85" />
      <circle cx="16" cy="19" r="2.5" fill="rgba(0,0,0,.6)" />
      <circle cx="24" cy="19" r="2.5" fill="rgba(0,0,0,.6)" />
      <circle cx="16" cy="19" r="1.2" fill={color} opacity="0.9" />
      <circle cx="24" cy="19" r="1.2" fill={color} opacity="0.9" />
      <rect x="16" y="24" width="8" height="2" rx="1" fill="rgba(0,0,0,.4)" />
      <rect x="6" y="14" width="4" height="10" rx="2" fill={color} opacity="0.6" />
      <rect x="30" y="14" width="4" height="10" rx="2" fill={color} opacity="0.6" />
      <rect x="12" y="28" width="7" height="16" rx="2" fill={color} opacity="0.7" />
      <rect x="21" y="28" width="7" height="16" rx="2" fill={color} opacity="0.7" />
      <rect x="10" y="42" width="8" height="4" rx="2" fill={color} opacity="0.5" />
      <rect x="22" y="42" width="8" height="4" rx="2" fill={color} opacity="0.5" />
    </svg>
  );
}

export function AIAgents() {
  const { refreshKey } = useApp();
  const { agents, loading } = useAgents(refreshKey);
  const { items: feed } = useFeed(refreshKey, 30);

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">

      {/* Jarvis Chief card */}
      <motion.div variants={FADE_UP}>
        <GlassCard accent="gold" padding="p-5">
          <div className="flex items-center gap-6">
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}>
              <RobotIcon color="#ffd700" size={72} />
            </motion.div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Crown size={14} className="text-ngold" />
                <span className="font-orbitron text-[14px] font-black text-ngold glow-gold tracking-[2px]">JARVIS</span>
                <span className="font-orbitron text-[10px] text-dimtext tracking-[2px]">— CHIEF OF STAFF</span>
              </div>
              <p className="text-[11px] text-jtext mb-3 leading-relaxed">
                Central AI orchestrator. Coordinates all agents, manages Telegram communications,
                analyzes calls, and drives wholesale operations.
              </p>
              <div className="flex items-center gap-4">
                <StatusDot status="online" label="Always Active" />
                <span className="text-[9px] text-dimtext">• Telegram • GHL • Supabase • Claude AI</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-orbitron text-[32px] font-black text-ngold glow-gold leading-none">{agents.length}</div>
              <div className="text-[9px] text-dimtext mt-1">Sub-Agents</div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {agents.map(agent => {
          const statusColor = agent.status === 'active' ? '#00ff88' : agent.status === 'idle' ? '#ffd700' : '#333355';
          const agentFeed = feed.filter(f =>
            f.source?.toUpperCase().replace(/[\s-]/g, '_') === agent.key
          ).slice(0, 3);

          return (
            <motion.div key={agent.key} variants={FADE_UP}>
              <GlassCard accent="green" padding="p-4" className="h-full flex flex-col" style={{ '--accent': agent.color } as React.CSSProperties}>
                {/* Header */}
                <div className="flex items-start gap-3 mb-3">
                  <motion.div
                    animate={agent.status === 'active' ? { scale: [1, 1.04, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 1.8 }}
                  >
                    <RobotIcon color={agent.color} size={48} />
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <div className="font-orbitron text-[11px] font-bold truncate" style={{ color: agent.color }}>{agent.name}</div>
                    <div className="text-[9px] text-dimtext mt-0.5">{agent.schedule}</div>
                    <StatusDot status={agent.status === 'active' ? 'online' : agent.status === 'idle' ? 'idle' : 'offline'} size="sm" label={agent.status} />
                  </div>
                  <div
                    className="w-2 h-2 rounded-full mt-1 animate-blink flex-shrink-0"
                    style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}`, animationPlayState: agent.status === 'offline' ? 'paused' : 'running' }}
                  />
                </div>

                {/* Description */}
                <p className="text-[10px] text-dimtext leading-relaxed mb-3 flex-1">{agent.description}</p>

                {/* Stats row */}
                <div className="flex items-center gap-3 text-[9px] text-dimtext mb-3">
                  <span className="flex items-center gap-1">
                    <Activity size={9} style={{ color: agent.color }} />
                    <span style={{ color: agent.color }}>{agent.runCount}</span> runs
                  </span>
                  {agent.lastActivity && (
                    <span className="flex items-center gap-1">
                      <Clock size={9} />
                      {timeAgo(agent.lastActivity)}
                    </span>
                  )}
                </div>

                {/* Recent logs */}
                {agentFeed.length > 0 && (
                  <div className="border-t border-border pt-2 mb-3">
                    {agentFeed.map(f => (
                      <div key={f.id} className="text-[9px] text-dimtext py-0.5 truncate">
                        <span className="text-[8px] mr-1" style={{ color: agent.color }}>›</span>
                        {f.message?.slice(0, 55)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Controls */}
                <div className="flex gap-2">
                  <button className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono border rounded-sm transition-colors"
                    style={{ borderColor: `${agent.color}40`, color: agent.color, background: `${agent.color}08` }}>
                    <Play size={9} /> Start
                  </button>
                  <button className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono border border-border2 rounded-sm text-dimtext hover:text-jtext transition-colors">
                    <Square size={9} /> Stop
                  </button>
                  <button className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono border border-border2 rounded-sm text-dimtext hover:text-jtext transition-colors">
                    <RefreshCw size={9} /> Restart
                  </button>
                </div>
              </GlassCard>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
