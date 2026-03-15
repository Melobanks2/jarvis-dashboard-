'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  X, LayoutDashboard, Bot, Search, GitBranch, Target, Lightbulb,
  MessageSquare, Settings, Map, Sparkles, ChevronLeft, ChevronRight, Shield,
} from 'lucide-react';
import { useApp, Section } from '@/lib/AppContext';

const ITEMS: { section: Section; label: string; Icon: React.ElementType; color: string; desc: string }[] = [
  { section: 'command-center',    label: 'Command Center',    Icon: LayoutDashboard, color: '#4ade80', desc: 'AI brain overview' },
  { section: 'david-hq',         label: 'David HQ',          Icon: Shield,          color: '#fbbf24', desc: 'Deals & training' },
  { section: 'ai-agents',        label: 'AI Agents',         Icon: Bot,             color: '#fbbf24', desc: 'Agent management' },
  { section: 'lead-intelligence',label: 'Lead Intelligence', Icon: Search,          color: '#60a5fa', desc: 'Lead database' },
  { section: 'pipeline',         label: 'Pipeline',          Icon: GitBranch,       color: '#a78bfa', desc: 'CRM pipeline view' },
  { section: 'asap-scraper',     label: 'ASAP ARV',          Icon: Map,             color: '#4ade80', desc: 'Comp reports' },
  { section: 'goals-vision',     label: 'Goals & Vision',    Icon: Target,          color: '#fbbf24', desc: 'Revenue targets' },
  { section: 'ideas-lab',        label: 'Ideas Lab',         Icon: Lightbulb,       color: '#a78bfa', desc: 'Feature backlog' },
  { section: 'intelligence-chat',label: 'Intelligence Chat', Icon: Sparkles,        color: '#a78bfa', desc: 'Jarvis AI brain' },
  { section: 'agent-chat',       label: 'Agent Chat',        Icon: MessageSquare,   color: '#67e8f9', desc: 'Talk to agents' },
  { section: 'settings',         label: 'Settings',          Icon: Settings,        color: '#52526e', desc: 'System config' },
];

const COLLAPSED_W = 56;
const EXPANDED_W  = 220;

export function SectionsDrawer() {
  const {
    sidebarOpen, setSidebarOpen,
    sidebarCollapsed, setSidebarCollapsed,
    setActiveSection, activeSection,
  } = useApp();

  const select = (s: Section) => {
    setActiveSection(s);
    setSidebarOpen(false);
  };

  return (
    <>
      {/* ── Desktop permanent sidebar ── */}
      <motion.aside
        className="hidden md:flex flex-col fixed left-0 bottom-0 z-40 overflow-hidden"
        style={{ top: 52, background: 'rgba(10,11,18,0.97)', backdropFilter: 'blur(24px)', borderRight: '1px solid rgba(255,255,255,0.05)' }}
        animate={{ width: sidebarCollapsed ? COLLAPSED_W : EXPANDED_W }}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
        initial={false}
      >
        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          {ITEMS.map(item => {
            const active = activeSection === item.section;
            const { Icon } = item;
            return (
              <button
                key={item.section}
                onClick={() => select(item.section)}
                title={sidebarCollapsed ? item.label : undefined}
                className="relative w-full flex items-center transition-colors"
                style={{
                  background: active ? `${item.color}12` : 'transparent',
                  minHeight: 42,
                  padding: sidebarCollapsed ? '0 0 0 4px' : '0 8px',
                }}
              >
                {/* Active bar */}
                {active && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{ background: item.color }}
                  />
                )}
                {/* Icon */}
                <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 40, height: 40 }}>
                  <Icon size={15} style={{ color: active ? item.color : '#52526e' }} />
                </div>
                {/* Label — hidden when collapsed */}
                <AnimatePresence>
                  {!sidebarCollapsed && (
                    <motion.div
                      className="flex-1 text-left overflow-hidden"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6 }}
                      transition={{ duration: 0.15 }}
                    >
                      <div className="text-[11px] font-medium truncate" style={{ color: active ? item.color : '#c4c4d6' }}>
                        {item.label}
                      </div>
                      <div className="text-[9px] truncate" style={{ color: '#3a3a52' }}>{item.desc}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center py-3 transition-colors"
            style={{ color: '#3a3a52' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#c4c4d6')}
            onMouseLeave={e => (e.currentTarget.style.color = '#3a3a52')}
          >
            {sidebarCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
        </div>
      </motion.aside>

      {/* ── Mobile overlay ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              className="md:hidden fixed inset-0 z-[60]"
              style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
            <motion.div
              className="md:hidden fixed top-0 left-0 bottom-0 z-[70] flex flex-col"
              style={{ width: EXPANDED_W, background: 'rgba(10,11,18,0.98)', backdropFilter: 'blur(24px)', borderRight: '1px solid rgba(255,255,255,0.06)' }}
              initial={{ x: -EXPANDED_W }} animate={{ x: 0 }} exit={{ x: -EXPANDED_W }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            >
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.25)' }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: '#4ade80', boxShadow: '0 0 6px rgba(74,222,128,0.6)' }} />
                  </div>
                  <span className="font-orbitron text-[12px] font-bold tracking-[3px]" style={{ color: '#e8e8f0' }}>JARVIS</span>
                </div>
                <button onClick={() => setSidebarOpen(false)} className="p-1 rounded transition-colors" style={{ color: '#52526e' }}>
                  <X size={15} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto py-2 px-2">
                {ITEMS.map(item => {
                  const active = activeSection === item.section;
                  const { Icon } = item;
                  return (
                    <button
                      key={item.section}
                      onClick={() => select(item.section)}
                      className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-left transition-colors"
                      style={{ background: active ? `${item.color}0c` : 'transparent' }}
                    >
                      {active && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ background: item.color }} />
                      )}
                      <Icon size={15} style={{ color: active ? item.color : '#52526e' }} />
                      <div className="flex-1">
                        <div className="text-[12px] font-medium" style={{ color: active ? item.color : '#c4c4d6' }}>{item.label}</div>
                        <div className="text-[9px] mt-0.5" style={{ color: '#3a3a52' }}>{item.desc}</div>
                      </div>
                      {active && <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.color }} />}
                    </button>
                  );
                })}
              </nav>
              <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="text-[8px] tracking-[1.5px] uppercase" style={{ color: '#3a3a52' }}>Jarvis Command Center v2.0</div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
