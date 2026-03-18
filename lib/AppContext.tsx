'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

export type Section =
  | 'command-center'
  | 'david-hq'
  | 'ai-agents'
  | 'lead-intelligence'
  | 'pipeline'
  | 'asap-scraper'
  | 'goals-vision'
  | 'ideas-lab'
  | 'intelligence-chat'
  | 'agent-chat'
  | 'settings'
  // Legacy sections (kept in type but removed from sidebar nav)
  | 'call-center'
  | 'prospects-hub'
  | 'david-training'
  | 'analytics'
  | 'knowledge-base';

interface AppState {
  activeSection: Section;
  setActiveSection: (s: Section) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (v: boolean) => void;
  missionControl: boolean;
  setMissionControl: (v: boolean) => void;
  chatAgent: string;
  setChatAgent: (a: string) => void;
  refreshKey: number;
  refresh: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeSection,   setActiveSection]   = useState<Section>('command-center');
  const [sidebarOpen,     setSidebarOpen]     = useState(false);
  const [sidebarCollapsed,setSidebarCollapsed]= useState(false);
  const [rightPanelOpen,  setRightPanelOpen]  = useState(true);
  const [missionControl,  setMissionControl]  = useState(false);
  const [chatAgent,       setChatAgent]       = useState('Jarvis');
  const [refreshKey,      setRefreshKey]      = useState(0);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <Ctx.Provider value={{
      activeSection, setActiveSection,
      sidebarOpen, setSidebarOpen,
      sidebarCollapsed, setSidebarCollapsed,
      rightPanelOpen, setRightPanelOpen,
      missionControl, setMissionControl,
      chatAgent, setChatAgent,
      refreshKey, refresh,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
