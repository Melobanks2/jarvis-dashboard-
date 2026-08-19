'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Maximize2 } from 'lucide-react';
import dynamic from 'next/dynamic';

import { useApp } from '@/lib/AppContext';
import { TopNav }              from '@/components/layout/TopNav';
import { SectionsDrawer }      from '@/components/layout/SectionsDrawer';
import { BottomTimeline }      from '@/components/layout/BottomTimeline';
import { CommandCenter }       from '@/components/sections/CommandCenter';

import { AIAgents }         from '@/components/sections/AIAgents';
import { CallCenter }       from '@/components/sections/CallCenter';
import { Pipeline }         from '@/components/sections/Pipeline';
import { DealFlow }         from '@/components/sections/DealFlow';
import { RefundPipeline }   from '@/components/sections/RefundPipeline';
import { ProspectsHub }     from '@/components/sections/ProspectsHub';
import { GoalsVision }      from '@/components/sections/GoalsVision';
import { IdeasLab }         from '@/components/sections/IdeasLab';
import { AsapScraper }      from '@/components/sections/AsapScraper';
import { AgentChat }        from '@/components/sections/AgentChat';
import { DavidTraining }    from '@/components/sections/DavidTraining';
import { IntelligenceChat } from '@/components/sections/IntelligenceChat';
import { DavidHQ }          from '@/components/sections/DavidHQ';
import { KnowledgeBase }          from '@/components/sections/KnowledgeBase';
import { MarketingIntelligence }  from '@/components/sections/MarketingIntelligence';
import { MultiDialer }            from '@/components/sections/MultiDialer';
import { Conversations }          from '@/components/sections/Conversations';
import { Leads }                  from '@/components/sections/Leads';
import { Acquisitions }           from '@/components/sections/Acquisitions';
import { ContractCannon }         from '@/components/sections/ContractCannon';
import { NovationTracker }        from '@/components/sections/NovationTracker';
import { IspeedRefunds }          from '@/components/sections/IspeedRefunds';

const MissionControl = dynamic(
  () => import('@/components/sections/MissionControl').then(m => ({ default: m.MissionControl })),
  { ssr: false }
);

const SECTION_TITLES: Record<string, string> = {
  'david-hq':          'Sarah HQ',
  'ai-agents':         'AI Agents',
  'call-center':       'Call Center',
  'lead-intelligence': 'Leads',
  'pipeline':          'Pipeline',
  'deal-flow':         'Deal Flow',
  'refund-pipeline':   'Refund Pipeline',
  'acquisitions':      'Acquisitions',
  'prospects-hub':     'Prospects Hub',
  'goals-vision':      'Goals & Vision',
  'ideas-lab':         'Ideas Lab',
  'asap-scraper':      'ASAP ARV',
  'agent-chat':        'Agent Chat',
  'david-training':    'David Training Center',
  'analytics':         'Analytics',
  'settings':          'Settings',
  'intelligence-chat': 'Intelligence Chat',
  'knowledge-base':         'Knowledge Base',
  'marketing-intelligence': 'Marketing Intelligence',
  'multi-dialer':           'Scout HQ — Multi-Line Dialer',
  'leads':                  'Leads',
  'contract-cannon':        'Contract Cannon',
  'novation-deal':          'Novation Deal',
  'ispeed-refunds':         'iSpeed Refunds',
};

function SectionContent({ section }: { section: string }) {
  switch (section) {
    case 'david-hq':          return <DavidHQ />;
    case 'ai-agents':         return <AIAgents />;
    case 'call-center':       return <CallCenter />;
    case 'lead-intelligence': return <Leads />; {/* retired — consolidated into Leads board */}
    case 'acquisitions':      return <Acquisitions />;
    case 'pipeline':          return <Pipeline />;
    case 'deal-flow':         return <DealFlow />;
    case 'refund-pipeline':   return <RefundPipeline />;
    case 'prospects-hub':     return <ProspectsHub />;
    case 'goals-vision':      return <GoalsVision />;
    case 'ideas-lab':         return <IdeasLab />;
    case 'asap-scraper':      return <AsapScraper />;
    case 'agent-chat':        return <AgentChat />;
    case 'david-training':    return <DavidTraining />;
    case 'intelligence-chat': return <IntelligenceChat />;
    case 'knowledge-base':          return <KnowledgeBase />;
    case 'marketing-intelligence':  return <MarketingIntelligence />;
    case 'multi-dialer':            return <MultiDialer />;
    case 'conversations':           return <Conversations />;
    case 'leads':                   return <Leads />;
    case 'contract-cannon':         return <ContractCannon />;
    case 'novation-deal':           return <NovationTracker />;
    case 'ispeed-refunds':          return <IspeedRefunds />;
    default: return (
      <div className="flex items-center justify-center h-64 text-dimtext text-[11px]">
        Coming soon
      </div>
    );
  }
}

export default function Home() {
  const { activeSection, setActiveSection, missionControl, setMissionControl, refreshKey, sidebarCollapsed } = useApp();
  const isHome = activeSection === 'command-center';
  // Sidebar placeholder width on desktop: 56px collapsed, 220px expanded
  const sidebarW = sidebarCollapsed ? 56 : 220;

  // Root stays transparent so the body's ambient color field shows through —
  // the Liquid Glass cards blur it. An opaque background here kills the effect.
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">

      <TopNav />
      <SectionsDrawer />

      {/* Main row: sidebar placeholder (desktop) + content */}
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: 52, marginBottom: 60 }}>

        {/* Invisible spacer that mirrors the fixed sidebar on desktop */}
        <div
          className="hidden md:block flex-shrink-0"
          style={{ width: sidebarW, transition: 'width 0.3s' }}
        />

        {/* Content area */}
        <div className="relative flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {isHome ? (
              <motion.div
                key="home"
                className="absolute inset-0 overflow-y-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="p-6 max-w-[1400px] mx-auto">
                  <CommandCenter />
                </div>
              </motion.div>

            ) : (
              <motion.div
                key={activeSection}
                className="absolute inset-0 flex flex-col overflow-hidden"
                style={{ background: 'rgba(5,7,13,0.60)', backdropFilter: 'blur(28px) saturate(160%)', WebkitBackdropFilter: 'blur(28px) saturate(160%)' }}
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
                    className="flex items-center gap-1.5 text-dimtext hover:text-nblue transition-colors"
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
                      style={{ color: '#0a84ff', background: 'rgba(10,132,255,0.08)', border: '1px solid rgba(10,132,255,0.22)' }}
                      whileHover={{ background: 'rgba(10,132,255,0.14)' }}
                    >
                      <Maximize2 size={10} /> Mission Control
                    </motion.button>
                  </div>
                </div>

                {/* Scrollable content. Chat sections manage their own scroll
                    and need a height-bounded parent, so they skip the wrapper. */}
                {activeSection === 'intelligence-chat' || activeSection === 'agent-chat' ? (
                  <div className="flex-1 overflow-hidden flex flex-col min-h-0 p-6">
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
