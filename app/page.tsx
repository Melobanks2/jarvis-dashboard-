'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2 } from 'lucide-react';
import dynamic from 'next/dynamic';

import { useApp } from '@/lib/AppContext';
import { TopNav }            from '@/components/layout/TopNav';
import { Sidebar }           from '@/components/layout/Sidebar';
import { ActivityFeedStrip } from '@/components/layout/ActivityFeedStrip';
import { RightPanel }        from '@/components/layout/RightPanel';

import { CommandCenter }    from '@/components/sections/CommandCenter';
import { AIAgents }         from '@/components/sections/AIAgents';
import { CallCenter }       from '@/components/sections/CallCenter';
import { LeadIntelligence } from '@/components/sections/LeadIntelligence';
import { Pipeline }         from '@/components/sections/Pipeline';
import { GoalsVision }      from '@/components/sections/GoalsVision';
import { IdeasLab }         from '@/components/sections/IdeasLab';
import { AgentChat }        from '@/components/sections/AgentChat';

const MissionControl = dynamic(
  () => import('@/components/sections/MissionControl').then(m => ({ default: m.MissionControl })),
  { ssr: false }
);

const SECTION_TITLES: Record<string, string> = {
  'command-center':    'Command Center',
  'ai-agents':         'AI Agents',
  'call-center':       'Call Center',
  'lead-intelligence': 'Lead Intelligence',
  'pipeline':          'Pipeline',
  'goals-vision':      'Goals & Vision',
  'ideas-lab':         'Ideas Lab',
  'agent-chat':        'Agent Chat',
  'analytics':         'Analytics',
  'settings':          'Settings',
};

function Section() {
  const { activeSection } = useApp();
  switch (activeSection) {
    case 'command-center':    return <CommandCenter />;
    case 'ai-agents':         return <AIAgents />;
    case 'call-center':       return <CallCenter />;
    case 'lead-intelligence': return <LeadIntelligence />;
    case 'pipeline':          return <Pipeline />;
    case 'goals-vision':      return <GoalsVision />;
    case 'ideas-lab':         return <IdeasLab />;
    case 'agent-chat':        return <AgentChat />;
    case 'analytics':         return <Placeholder label="Analytics" desc="Advanced analytics coming soon." />;
    case 'settings':          return <Placeholder label="Settings" desc="System settings coming soon." />;
    default:                  return null;
  }
}

function Placeholder({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="font-orbitron text-[14px] text-ngreen tracking-[3px]">{label}</div>
      <div className="text-[11px] text-dimtext">{desc}</div>
    </div>
  );
}

export default function Home() {
  const { activeSection, sidebarOpen, rightPanelOpen, missionControl, setMissionControl, refreshKey } = useApp();

  // Sidebar width: collapsed=60px, expanded=220px
  const sidebarW   = sidebarOpen ? 220 : 60;
  const rightW     = rightPanelOpen ? 270 : 0;

  return (
    <>
      <TopNav />
      <Sidebar />
      <RightPanel />
      <ActivityFeedStrip />

      {/* Main workspace */}
      <motion.main
        className="fixed overflow-y-auto"
        style={{ top: 56, bottom: 36 }}
        animate={{
          left:  sidebarW,
          right: rightPanelOpen ? 270 : 0,
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      >
        <div className="min-h-full p-5 max-w-[1600px] mx-auto">
          {/* Section header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-1 h-5 rounded-sm bg-ngreen" style={{ boxShadow: '0 0 8px #00ff88' }} />
              <h2 className="font-orbitron text-[13px] font-bold text-textb tracking-[2px] uppercase">
                {SECTION_TITLES[activeSection]}
              </h2>
            </div>

            {/* Mission Control button */}
            <motion.button
              onClick={() => setMissionControl(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-orbitron tracking-[1px] uppercase border rounded-sm"
              style={{ borderColor: 'rgba(0,255,136,.25)', color: '#00ff88', background: 'rgba(0,255,136,.06)' }}
              whileHover={{ background: 'rgba(0,255,136,.12)', boxShadow: '0 0 12px rgba(0,255,136,.2)' }}
            >
              <Maximize2 size={11} /> Mission Control
            </motion.button>
          </div>

          {/* Section content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <Section />
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.main>

      {/* Mission Control overlay */}
      <AnimatePresence>
        {missionControl && (
          <MissionControl onClose={() => setMissionControl(false)} refreshKey={refreshKey} />
        )}
      </AnimatePresence>
    </>
  );
}
