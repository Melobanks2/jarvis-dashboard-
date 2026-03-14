'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Menu, RefreshCw, Zap, Eye, Terminal, ChevronRight } from 'lucide-react';
import { useApp } from '@/lib/AppContext';
import { StatusDot } from '@/components/ui/StatusDot';

function EastClock() {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' }));
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="text-right">
      <div className="font-orbitron text-[15px] text-ncyan glow-cyan tracking-[2px]">{time} <span className="text-[10px] text-dimtext">ET</span></div>
      <div className="text-[9px] text-dimtext tracking-[1px] mt-0.5">{date}</div>
    </div>
  );
}

export function TopNav() {
  const { setSidebarOpen, sidebarOpen, refresh, setActiveSection } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    refresh();
    setTimeout(() => setRefreshing(false), 1200);
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-14"
      style={{
        background: 'linear-gradient(135deg, rgba(6,6,15,0.95), rgba(10,10,28,0.95))',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,255,136,.15)',
        boxShadow: '0 0 40px rgba(0,255,136,.06), 0 2px 0 rgba(0,255,136,.12)',
      }}
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded-sm transition-colors hover:bg-bg3 text-dimtext hover:text-ngreen"
        >
          <Menu size={18} />
        </button>

        <div>
          <h1 className="font-orbitron text-[18px] font-black tracking-[4px] text-ngreen glow-green leading-none">
            JARVIS <span className="text-ngold glow-gold">COMMAND CENTER</span>
          </h1>
          <p className="text-[9px] text-dimtext tracking-[3px] uppercase mt-0.5">
            Chris Lovera — Wholesale Operations • Orlando, FL
          </p>
        </div>
      </div>

      {/* Center — status indicators */}
      <div className="hidden md:flex items-center gap-6">
        <StatusPill label="Agents Online" value="5" color="#00ff88" />
        <StatusPill label="Calls Today"   value="—"  color="#00e5ff" />
        <StatusPill label="Hot Leads"     value="—"  color="#ff3366" />
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <NavButton icon={<Zap size={13} />} label="Run Calls"   onClick={() => setActiveSection('call-center')} color="#00ff88" />
        <NavButton icon={<Eye size={13} />}      label="View Leads" onClick={() => setActiveSection('lead-intelligence')} color="#00aaff" />
        <NavButton icon={<Terminal size={13} />} label="Logs"       onClick={() => setActiveSection('ai-agents')} color="#aa44ff" />

        <motion.button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono tracking-[2px] border rounded-sm transition-all disabled:opacity-40"
          style={{ borderColor: 'rgba(0,255,136,.35)', color: '#00ff88', background: 'transparent' }}
          whileHover={{ background: 'rgba(0,255,136,.06)', boxShadow: '0 0 12px rgba(0,255,136,.2)' }}
        >
          <motion.span animate={{ rotate: refreshing ? 360 : 0 }} transition={{ repeat: refreshing ? Infinity : 0, duration: 0.8, ease: 'linear' }}>
            <RefreshCw size={11} />
          </motion.span>
          SYNC
        </motion.button>

        <EastClock />
      </div>
    </header>
  );
}

function StatusPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full animate-blink" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <div>
        <div className="text-[8px] text-dimtext tracking-[1px] uppercase">{label}</div>
        <div className="font-orbitron text-[12px] font-bold" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

function NavButton({ icon, label, onClick, color }: { icon: React.ReactNode; label: string; onClick: () => void; color: string }) {
  return (
    <motion.button
      onClick={onClick}
      className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono tracking-[1px] border rounded-sm transition-colors"
      style={{ borderColor: `${color}30`, color: color, background: `${color}08` }}
      whileHover={{ background: `${color}14`, boxShadow: `0 0 10px ${color}20` }}
    >
      {icon}
      {label}
    </motion.button>
  );
}
