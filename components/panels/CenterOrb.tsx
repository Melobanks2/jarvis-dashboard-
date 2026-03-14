'use client';

import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useFeed } from '@/lib/hooks/useFeed';
import { useAgents } from '@/lib/hooks/useAgents';
import { useApp } from '@/lib/AppContext';

const JarvisOrb = dynamic(
  () => import('@/components/three/JarvisOrb').then(m => ({ default: m.JarvisOrb })),
  { ssr: false, loading: () => <OrbPlaceholder /> }
);

function OrbPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-64 h-64 rounded-full border border-ngreen/20 flex items-center justify-center animate-pulse">
        <div className="w-40 h-40 rounded-full border border-ngreen/30 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-ngreen/10 border border-ngreen/40" />
        </div>
      </div>
    </div>
  );
}

export function CenterOrb() {
  const { refreshKey } = useApp();
  const { items }      = useFeed(refreshKey, 5);
  const { agents }     = useAgents(refreshKey);
  const [pulse, setPulse] = useState(0);
  const [lastCount, setLastCount] = useState(0);

  // Pulse orb when new feed items arrive
  useEffect(() => {
    if (items.length > lastCount) {
      setPulse(p => p + 1);
      setLastCount(items.length);
    }
  }, [items.length]);

  const onlineCount = agents.filter(a => a.status === 'active').length;

  return (
    <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">

      {/* Ambient glow behind orb */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 520, height: 520,
          background: 'radial-gradient(circle, rgba(0,255,136,0.06) 0%, rgba(0,229,255,0.03) 40%, transparent 70%)',
          borderRadius: '50%',
        }}
      />

      {/* Outer pulse rings */}
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className="absolute rounded-full border border-ngreen/[0.07] pointer-events-none animate-pulse-ring"
          style={{
            width:  360 + i * 80,
            height: 360 + i * 80,
            animationDelay: `${i * 0.6}s`,
          }}
        />
      ))}

      {/* Floating status badges */}
      <motion.div
        className="absolute top-[18%] left-[18%] hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full"
        style={{ background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.15)', backdropFilter: 'blur(8px)' }}
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-ngreen animate-blink" style={{ boxShadow: '0 0 6px #00ff88' }} />
        <span className="text-[9px] text-ngreen font-mono tracking-[1px]">{onlineCount} Agents Online</span>
      </motion.div>

      <motion.div
        className="absolute top-[18%] right-[18%] hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full"
        style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.15)', backdropFilter: 'blur(8px)' }}
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-ncyan" style={{ boxShadow: '0 0 6px #00e5ff' }} />
        <span className="text-[9px] text-ncyan font-mono tracking-[1px]">Systems Active</span>
      </motion.div>

      <motion.div
        className="absolute bottom-[22%] left-[20%] hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full"
        style={{ background: 'rgba(170,68,255,0.08)', border: '1px solid rgba(170,68,255,0.15)', backdropFilter: 'blur(8px)' }}
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-npurple" style={{ boxShadow: '0 0 6px #aa44ff' }} />
        <span className="text-[9px] text-npurple font-mono tracking-[1px]">GHL Synced</span>
      </motion.div>

      {/* The orb */}
      <JarvisOrb
        pulse={pulse % 2}
        className="w-full max-w-[480px]"
        style={{ height: 'min(55vh, 480px)' }}
      />

      {/* Title beneath orb */}
      <motion.div
        className="text-center mt-2 relative z-10"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h1
          className="font-orbitron text-[22px] font-black tracking-[6px] uppercase"
          style={{ color: '#00ff88', textShadow: '0 0 32px rgba(0,255,136,.6), 0 0 64px rgba(0,255,136,.2)' }}
        >
          JARVIS AI
        </h1>
        <p className="text-[10px] text-dimtext tracking-[3px] uppercase mt-1 font-mono">
          Chief of Staff — Autonomous Operations
        </p>
        <div className="flex items-center justify-center gap-2 mt-3">
          <span className="w-8 h-px bg-ngreen/30" />
          <span className="text-[8px] text-dimtext tracking-[2px] font-mono uppercase">Orlando, FL • Real Estate Wholesale</span>
          <span className="w-8 h-px bg-ngreen/30" />
        </div>
      </motion.div>
    </div>
  );
}
