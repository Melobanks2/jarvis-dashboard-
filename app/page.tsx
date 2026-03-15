'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Maximize2 } from 'lucide-react';
import dynamic from 'next/dynamic';

import { useApp } from '@/lib/AppContext';
import { TopNav }              from '@/components/layout/TopNav';
import { SectionsDrawer }      from '@/components/layout/SectionsDrawer';
import { BottomTimeline }      from '@/components/layout/BottomTimeline';
import { LeftIntelPanel }      from '@/components/panels/LeftIntelPanel';
import { CenterOrb }           from '@/components/panels/CenterOrb';
import { RightAnalyticsPanel } from '@/components/panels/RightAnalyticsPanel';

import { AIAgents }         from '@/components/sections/AIAgents';
import { CallCenter }       from '@/components/sections/CallCenter';
import { LeadIntelligence } from '@/components/sections/LeadIntelligence';
import { Pipeline }         from '@/components/sections/Pipeline';
import { ProspectsHub }     from '@/components/sections/ProspectsHub';
import { GoalsVision }      from '@/components/sections/GoalsVision';
import { IdeasLab }         from '@/components/sections/IdeasLab';
import { AsapScraper }      from '@/components/sections/AsapScraper';
import { AgentChat }        from '@/components/sections/AgentChat';
import { DavidTraining }    from '@/components/sections/DavidTraining';
import { IntelligenceChat } from '@/components/sections/IntelligenceChat';

const MissionControl = dynamic(
  () => import('@/components/sections/MissionControl').then(m => ({ default: m.MissionControl })),
  { ssr: false }
);

const SECTION_TITLES: Record<string, string> = {
  'ai-agents':         'AI Agents',
  'call-center':       'Call Center',
  'lead-intelligence': 'Lead Intelligence',
  'pipeline':          'Pipeline',
  'prospects-hub':     'Prospects Hub',
  'goals-vision':      'Goals & Vision',
  'ideas-lab':         'Ideas Lab',
  'asap-scraper':      'ASAP Scraper',
  'agent-chat':        'Agent Chat',
  'david-training':    'David Training Center',
  'analytics':         'Analytics',
  'settings':          'Settings',
  'intelligence-chat': 'Intelligence Chat',
};

function SectionContent({ section }: { section: string }) {
  switch (section) {
    case 'ai-agents':         return <AIAgents />;
    case 'call-center':       return <CallCenter />;
    case 'lead-intelligence': return <LeadIntelligence />;
    case 'pipeline':          return <Pipeline />;
    case 'prospects-hub':     return <ProspectsHub />;
    case 'goals-vision':      return <GoalsVision />;
    case 'ideas-lab':         return <IdeasLab />;
    case 'asap-scraper':      return <AsapScraper />;
    case 'agent-chat':        return <AgentChat />;
    case 'david-training':    return <DavidTraining />;
    case 'intelligence-chat': return <IntelligenceChat />;
    default: return (
      <div className="flex items-center justify-center h-64 text-dimtext text-[11px]">
        Coming soon
      </div>
    );
  }
}

export default function Home() {
  const { activeSection, setActiveSection, missionControl, setMissionControl, refreshKey } = useApp();
  const isHome = activeSection === 'command-center';

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: '#0c0d14' }}>

      {/* Subtle ambient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 45%, rgba(74,222,128,0.025) 0%, transparent 70%)' }}
      />

      <TopNav />
      <SectionsDrawer />

      {/* Main content — between nav (52px) and timeline (60px) */}
      <div className="relative flex-1 overflow-hidden" style={{ marginTop: 52, marginBottom: 60 }}>

        <AnimatePresence mode="wait">
          {isHome ? (
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
            <motion.div
              key={activeSection}
              className="absolute inset-0 flex flex-col overflow-hidden"
              style={{ background: 'rgba(11,12,19,0.97)', backdropFilter: 'blur(20px)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22 }}
            >
              {/* Breadcrumb header */}
              <div
                className="flex items-center gap-3 px-6 py-3 flex-shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <motion.button
                  onClick={() => setActiveSection('command-center')}
                  className="flex items-center gap-1.5 text-dimtext hover:text-ngreen transition-colors"
                  whileHover={{ x: -2 }}
                >
                  <ArrowLeft size={13} />
                  <span className="text-[10px] font-medium">Command Center</span>
                </motion.button>
                <span className="text-white/15">›</span>
                <span className="text-[11px] font-semibold text-textb">
                  {SECTION_TITLES[activeSection]}
                </span>
                <div className="ml-auto">
                  <motion.button
                    onClick={() => setMissionControl(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-md"
                    style={{ borderColor: 'rgba(74,222,128,0.20)', color: '#4ade80', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.18)' }}
                    whileHover={{ background: 'rgba(74,222,128,0.10)' }}
                  >
                    <Maximize2 size={10} /> Mission Control
                  </motion.button>
                </div>
              </div>

              {/* Scrollable content */}
              {activeSection === 'intelligence-chat' ? (
                <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                  <SectionContent section={activeSection} />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className="p-6 max-w-[1400px] mx-auto">
                    <SectionContent section={activeSection} />
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <BottomTimeline />

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
