'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Bot, Phone, Search, GitBranch,
  Target, Lightbulb, BarChart2, Settings, MessageSquare, X,
} from 'lucide-react';
import clsx from 'clsx';
import { useApp, Section } from '@/lib/AppContext';

const MENU: { section: Section; label: string; icon: React.ReactNode; color: string }[] = [
  { section: 'command-center',    label: 'Command Center',   icon: <LayoutDashboard size={16} />, color: '#00ff88' },
  { section: 'ai-agents',         label: 'AI Agents',        icon: <Bot size={16} />,             color: '#ffd700' },
  { section: 'call-center',       label: 'Call Center',      icon: <Phone size={16} />,           color: '#00ff88' },
  { section: 'lead-intelligence', label: 'Lead Intelligence',icon: <Search size={16} />,          color: '#00aaff' },
  { section: 'pipeline',          label: 'Pipeline',         icon: <GitBranch size={16} />,       color: '#aa44ff' },
  { section: 'goals-vision',      label: 'Goals & Vision',   icon: <Target size={16} />,          color: '#ffd700' },
  { section: 'ideas-lab',         label: 'Ideas Lab',        icon: <Lightbulb size={16} />,       color: '#aa44ff' },
  { section: 'agent-chat',        label: 'Agent Chat',       icon: <MessageSquare size={16} />,   color: '#00e5ff' },
  { section: 'analytics',         label: 'Analytics',        icon: <BarChart2 size={16} />,       color: '#00aaff' },
  { section: 'settings',          label: 'Settings',         icon: <Settings size={16} />,        color: '#5a5a80' },
];

export function Sidebar() {
  const { activeSection, setActiveSection, sidebarOpen, setSidebarOpen } = useApp();

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            className="fixed inset-0 bg-black/60 z-40 lg:hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar panel */}
      <motion.aside
        className={clsx(
          'fixed top-14 bottom-10 left-0 z-40 flex flex-col',
          'border-r border-border2 overflow-hidden',
        )}
        style={{ background: 'rgba(8,8,18,0.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        animate={{ width: sidebarOpen ? 220 : 60 }}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      >
        {/* Logo row (mobile close) */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-border2 lg:hidden">
          <span className="font-orbitron text-[11px] text-ngreen tracking-[2px]">JARVIS</span>
          <button onClick={() => setSidebarOpen(false)} className="text-dimtext hover:text-textb">
            <X size={16} />
          </button>
        </div>

        {/* Menu items */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3">
          {MENU.map(item => {
            const active = activeSection === item.section;
            return (
              <motion.button
                key={item.section}
                onClick={() => { setActiveSection(item.section); if (window.innerWidth < 1024) setSidebarOpen(false); }}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors relative',
                  active ? 'text-textb' : 'text-dimtext hover:text-jtext',
                )}
                style={active ? { background: `${item.color}10` } : {}}
                whileHover={{ x: 2 }}
              >
                {/* Active indicator bar */}
                <AnimatePresence>
                  {active && (
                    <motion.div
                      className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r"
                      style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }}
                      initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} exit={{ scaleY: 0 }}
                    />
                  )}
                </AnimatePresence>

                <span style={{ color: active ? item.color : undefined, flexShrink: 0 }}>
                  {item.icon}
                </span>

                <AnimatePresence>
                  {sidebarOpen && (
                    <motion.span
                      className="font-mono text-[11px] tracking-[1px] uppercase whitespace-nowrap"
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.15 }}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </nav>

        {/* Footer */}
        {sidebarOpen && (
          <div className="px-3 py-3 border-t border-border2">
            <div className="text-[8px] text-dimtext tracking-[2px] uppercase">v2.0 • Jarvis OS</div>
          </div>
        )}
      </motion.aside>
    </>
  );
}
