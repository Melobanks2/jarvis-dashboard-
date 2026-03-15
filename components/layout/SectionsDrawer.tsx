'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X, LayoutDashboard, Bot, Phone, Search, GitBranch, Target, Lightbulb, MessageSquare, BarChart2, Settings, Map, BrainCircuit, Sparkles, Users } from 'lucide-react';
import { useApp, Section } from '@/lib/AppContext';

const ITEMS: { section: Section; label: string; icon: React.ReactNode; color: string; desc: string }[] = [
  { section: 'command-center',    label: 'Command Center',    icon: <LayoutDashboard size={15} />, color: '#4ade80', desc: 'AI brain overview' },
  { section: 'ai-agents',         label: 'AI Agents',         icon: <Bot size={15} />,             color: '#fbbf24', desc: 'Agent management' },
  { section: 'call-center',       label: 'Call Center',       icon: <Phone size={15} />,           color: '#67e8f9', desc: 'Calls & recordings' },
  { section: 'lead-intelligence', label: 'Lead Intelligence', icon: <Search size={15} />,          color: '#60a5fa', desc: 'Lead database' },
  { section: 'pipeline',          label: 'Pipeline',          icon: <GitBranch size={15} />,       color: '#a78bfa', desc: 'CRM pipeline view' },
  { section: 'prospects-hub',     label: 'Prospects Hub',     icon: <Users size={15} />,           color: '#aa44ff', desc: 'Deal approvals & CRM' },
  { section: 'goals-vision',      label: 'Goals & Vision',    icon: <Target size={15} />,          color: '#fbbf24', desc: 'Revenue targets' },
  { section: 'ideas-lab',         label: 'Ideas Lab',         icon: <Lightbulb size={15} />,       color: '#a78bfa', desc: 'Feature backlog' },
  { section: 'asap-scraper',      label: 'ASAP Scraper',      icon: <Map size={15} />,             color: '#4ade80', desc: 'City scraping progress' },
  { section: 'agent-chat',        label: 'Agent Chat',        icon: <MessageSquare size={15} />,   color: '#67e8f9', desc: 'Talk to agents' },
  { section: 'intelligence-chat', label: 'Intelligence Chat', icon: <Sparkles size={15} />,        color: '#a78bfa', desc: 'Jarvis AI brain' },
  { section: 'david-training',    label: 'David Training',    icon: <BrainCircuit size={15} />,    color: '#fbbf24', desc: 'AI caller command center' },
  { section: 'analytics',         label: 'Analytics',         icon: <BarChart2 size={15} />,       color: '#60a5fa', desc: 'Deep analytics' },
  { section: 'settings',          label: 'Settings',          icon: <Settings size={15} />,        color: '#52526e', desc: 'System config' },
];

export function SectionsDrawer() {
  const { sidebarOpen, setSidebarOpen, setActiveSection, activeSection } = useApp();

  const select = (s: Section) => {
    setActiveSection(s);
    setSidebarOpen(false);
  };

  return (
    <AnimatePresence>
      {sidebarOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[60]"
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
          />

          {/* Drawer */}
          <motion.div
            className="fixed top-0 left-0 bottom-0 z-[70] flex flex-col"
            style={{
              width: 280,
              background: 'rgba(11,12,19,0.97)',
              backdropFilter: 'blur(24px)',
              borderRight: '1px solid rgba(255,255,255,0.06)',
            }}
            initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2.5">
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center"
                  style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.25)' }}
                >
                  <div className="w-2 h-2 rounded-full bg-ngreen" style={{ boxShadow: '0 0 6px rgba(74,222,128,0.6)' }} />
                </div>
                <span className="font-orbitron text-[12px] font-bold text-textb tracking-[3px]">JARVIS</span>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="text-dimtext hover:text-textb transition-colors p-1 rounded">
                <X size={15} />
              </button>
            </div>

            {/* Nav items */}
            <nav className="flex-1 overflow-y-auto py-3 px-3">
              {ITEMS.map(item => {
                const active = activeSection === item.section;
                return (
                  <motion.button
                    key={item.section}
                    onClick={() => select(item.section)}
                    className="w-full relative flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-left transition-colors"
                    style={{ background: active ? `${item.color}0c` : 'transparent' }}
                    whileHover={{ background: `${item.color}08` }}
                  >
                    {active && (
                      <div
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                        style={{ background: item.color }}
                      />
                    )}
                    <span style={{ color: active ? item.color : '#52526e' }}>{item.icon}</span>
                    <div className="flex-1">
                      <div className="text-[12px] font-medium" style={{ color: active ? item.color : '#c4c4d6' }}>{item.label}</div>
                      <div className="text-[9px] text-dimtext mt-0.5">{item.desc}</div>
                    </div>
                    {active && <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.color }} />}
                  </motion.button>
                );
              })}
            </nav>

            <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="text-[8px] text-dimtext tracking-[1.5px] uppercase">Jarvis Command Center v2.0</div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
