'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Menu, Zap, Maximize2, Search } from 'lucide-react';
import { useApp } from '@/lib/AppContext';
import { useCalls } from '@/lib/hooks/useCalls';
import { useAgents } from '@/lib/hooks/useAgents';

function Clock() {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
    }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-orbitron text-[12px] text-dimtext tracking-[2px]">{t} <span className="text-[9px]">ET</span></span>
  );
}

export function TopNav() {
  const { setSidebarOpen, sidebarOpen, setMissionControl, setActiveSection, refreshKey } = useApp();
  const { calls }  = useCalls(refreshKey);
  const { agents } = useAgents(refreshKey);

  const online = agents.filter(a => a.status === 'active').length;

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center px-5 gap-4"
      style={{
        height: 52,
        background: 'rgba(12, 13, 20, 0.90)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Left: logo */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="w-8 h-8 flex items-center justify-center text-dimtext hover:text-textb transition-colors rounded"
        >
          <Menu size={16} />
        </button>
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded-md flex items-center justify-center"
            style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.25)' }}
          >
            <div className="w-2 h-2 rounded-full bg-ngreen" style={{ boxShadow: '0 0 6px rgba(74,222,128,0.6)' }} />
          </div>
          <span className="font-orbitron text-[13px] font-bold tracking-[3px] text-textb">JARVIS</span>
        </div>
      </div>

      {/* Center: status pills */}
      <div className="flex-1 flex items-center justify-center gap-3">
        <Pill label="Agents Online" value={String(online)} color="#4ade80" active />
        <Pill label="Calls Today"   value={String(calls.length)} color="#67e8f9" />
        <Pill label="Hot Sellers"   value="—"  color="#f87171" />
      </div>

      {/* Right: actions + clock */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <NavBtn icon={<Zap size={11} />}      label="Run Calls"       color="#4ade80" onClick={() => setActiveSection('call-center')} />
        <NavBtn icon={<Maximize2 size={11} />} label="Mission Control" color="#a78bfa" onClick={() => setMissionControl(true)} />
        <NavBtn icon={<Search size={11} />}   label="Leads"           color="#60a5fa" onClick={() => setActiveSection('lead-intelligence')} />
        <div className="w-px h-4 bg-white/10 mx-1" />
        <Clock />
      </div>
    </header>
  );
}

function Pill({ label, value, color, active }: { label: string; value: string; color: string; active?: boolean }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1 rounded-full"
      style={{ background: `${color}0c`, border: `1px solid ${color}1a` }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: color, opacity: 0.8, boxShadow: active ? `0 0 5px ${color}60` : 'none' }}
      />
      <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</span>
      <span className="font-orbitron text-[11px] font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function NavBtn({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all"
      style={{ color: 'rgba(255,255,255,0.55)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
      whileHover={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.88)' }}
      whileTap={{ scale: 0.97 }}
    >
      <span style={{ color }}>{icon}</span>
      {label}
    </motion.button>
  );
}
