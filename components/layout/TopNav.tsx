'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Menu, Zap, Maximize2, Search } from 'lucide-react';
import { useApp } from '@/lib/AppContext';
import { useCalls } from '@/lib/hooks/useCalls';
import { useAgents } from '@/lib/hooks/useAgents';
import { useFeed } from '@/lib/hooks/useFeed';

function Clock() {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'America/New_York',
    }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-orbitron text-[13px] text-ncyan tracking-[2px]" style={{ textShadow: '0 0 12px rgba(0,229,255,.5)' }}>{t} <span className="text-[9px] text-dimtext">ET</span></span>;
}

export function TopNav() {
  const { setSidebarOpen, sidebarOpen, setMissionControl, setActiveSection, refreshKey } = useApp();
  const { calls }   = useCalls(refreshKey);
  const { agents }  = useAgents(refreshKey);
  const { items }   = useFeed(refreshKey, 5);

  const online  = agents.filter(a => a.status === 'active').length;
  const hotCount = 0; // pulled from pipeline in panel

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center px-4 gap-4"
      style={{
        height: 52,
        background: 'rgba(6,6,14,0.88)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* Left: logo + hamburger */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="w-8 h-8 flex items-center justify-center rounded-sm text-dimtext hover:text-ngreen transition-colors"
        >
          <Menu size={16} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-ngreen" style={{ boxShadow: '0 0 8px #00ff88, 0 0 16px #00ff8840' }} />
          <span className="font-orbitron text-[14px] font-black tracking-[3px]" style={{ color: '#00ff88', textShadow: '0 0 20px rgba(0,255,136,.5)' }}>
            JARVIS
          </span>
        </div>
      </div>

      {/* Center: live stats */}
      <div className="flex-1 flex items-center justify-center gap-8">
        <Stat label="Agents Online" value={String(online)}  color="#00ff88" pulse />
        <Stat label="Calls Today"   value={String(calls.length)} color="#00e5ff" />
        <Stat label="Hot Sellers"   value="—"               color="#ff3366" />
      </div>

      {/* Right: actions + clock */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <GhostButton
          icon={<Zap size={12} />}
          label="Run Calls"
          color="#00ff88"
          onClick={() => setActiveSection('call-center')}
        />
        <GhostButton
          icon={<Maximize2 size={12} />}
          label="Mission Control"
          color="#aa44ff"
          onClick={() => setMissionControl(true)}
        />
        <GhostButton
          icon={<Search size={12} />}
          label="Leads"
          color="#00aaff"
          onClick={() => setActiveSection('lead-intelligence')}
        />
        <div className="w-px h-5 bg-white/10 mx-1" />
        <Clock />
      </div>
    </header>
  );
}

function Stat({ label, value, color, pulse }: { label: string; value: string; color: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <span className="w-1.5 h-1.5 rounded-full block" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        {pulse && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: color, opacity: 0.4 }} />}
      </div>
      <div>
        <div className="text-[8px] text-dimtext uppercase tracking-[1.5px]">{label}</div>
        <div className="font-orbitron text-[13px] font-bold leading-none mt-0.5" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

function GhostButton({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-mono text-[10px] tracking-[1px] transition-all"
      style={{ color, border: `1px solid ${color}22`, background: `${color}08` }}
      whileHover={{ background: `${color}16`, boxShadow: `0 0 16px ${color}25` }}
      whileTap={{ scale: 0.97 }}
    >
      {icon}{label}
    </motion.button>
  );
}
