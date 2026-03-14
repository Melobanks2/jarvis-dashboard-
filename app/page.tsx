'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Maximize2 } from 'lucide-react';
import dynamic from 'next/dynamic';

import { useApp } from '@/lib/AppContext';
import { TopNav }         from '@/components/layout/TopNav';
import { SectionsDrawer } from '@/components/layout/SectionsDrawer';
import { BottomTimeline } from '@/components/layout/BottomTimeline';
import { LeftIntelPanel }         from '@/components/panels/LeftIntelPanel';
import { CenterOrb }              from '@/components/panels/CenterOrb';
import { RightAnalyticsPanel }    from '@/components/panels/RightAnalyticsPanel';

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

function SectionContent({ section }: { section: string }) {
  switch (section) {
    case 'ai-agents':         return <AIAgents />;
    case 'call-center':       return <CallCenter />;
    case 'lead-intelligence': return <LeadIntelligence />;
    case 'pipeline':          return <Pipeline />;
    case 'goals-vision':      return <GoalsVision />;
    case 'ideas-lab':         return <IdeasLab />;
    case 'agent-chat':        return <AgentChat />;
    default: return (
      <div className="flex items-center justify-center h-64 text-dimtext font-mono text-[11px]">
        Coming soon
      </div>
    );
  }
}

export default function Home() {
  const { activeSection, setActiveSection, missionControl, setMissionControl, refreshKey } = useApp();
  const isHome = activeSection === 'command-center';

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: '#0a0a0f' }}
    >
      {/* Subtle radial ambient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 45%, rgba(0,255,136,0.03) 0%, transparent 70%)' }}
      />

      <TopNav />
      <SectionsDrawer />

      {/* Main content area — between nav (52px) and timeline (68px) */}
      <div className="relative flex-1 overflow-hidden" style={{ marginTop: 52, marginBottom: 68 }}>

        <AnimatePresence mode="wait">
          {isHome ? (
            /* ── COMMAND CENTER: spatial 3-panel layout ── */
            <motion.div
              key="home"
              className="absolute inset-0 flex"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <LeftIntelPanel />
              <CenterOrb />
              <RightAnalyticsPanel />
            </motion.div>

          ) : (
            /* ── SECTION VIEW: slides over command center ── */
            <motion.div
              key={activeSection}
              className="absolute inset-0 flex flex-col overflow-hidden"
              style={{ background: 'rgba(6,6,14,0.97)', backdropFilter: 'blur(20px)' }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25 }}
            >
              {/* Section header breadcrumb */}
              <div
                className="flex items-center gap-3 px-6 py-3 flex-shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <motion.button
                  onClick={() => setActiveSection('command-center')}
                  className="flex items-center gap-2 text-dimtext hover:text-ngreen transition-colors"
                  whileHover={{ x: -2 }}
                >
                  <ArrowLeft size={14} />
                  <span className="font-mono text-[9px] tracking-[2px] uppercase">Command Center</span>
                </motion.button>
                <span className="text-white/10">›</span>
                <span className="font-orbitron text-[10px] text-textb tracking-[2px] uppercase">
                  {SECTION_TITLES[activeSection]}
                </span>
                <div className="ml-auto">
                  <motion.button
                    onClick={() => setMissionControl(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-orbitron tracking-[1px] border rounded-sm"
                    style={{ borderColor: 'rgba(0,255,136,.2)', color: '#00ff88', background: 'rgba(0,255,136,.05)' }}
                    whileHover={{ background: 'rgba(0,255,136,.1)' }}
                  >
                    <Maximize2 size={10} /> Mission Control
                  </motion.button>
                </div>
              </div>

              {/* Scrollable section content */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 max-w-[1400px] mx-auto">
                  <SectionContent section={activeSection} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <BottomTimeline />

      {/* Mission Control overlay */}
      <AnimatePresence>
        {missionControl && (
          <MissionControl
            onClose={() => setMissionControl(false)}
            refreshKey={refreshKey}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
