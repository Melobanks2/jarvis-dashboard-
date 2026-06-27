'use client';

import { useState, useEffect } from 'react';
import type { WorkStatus } from '@/components/ui/WorkBadge';

// Internal status values kept stable for existing consumers (the 3D scene, dot maps).
// active = Working, idle = Standby, offline = Off. Display labels live in the UI.
export type AgentStatus = 'active' | 'idle' | 'offline';

const API_BASE = 'https://api.jarviscommandcenter.space';

export interface AgentInfo {
  key: string;
  name: string;
  role: string;
  color: string;
  description: string;
  schedule: string;
  lastActivity: string | null;
  runCount: number;          // now carries PM2 restart count (health signal)
  status: AgentStatus;       // re-derived from real PM2 state
  pm2Status: string;         // raw: online | stopped | errored | missing
  uptimeMs: number | null;
  work: WorkStatus;          // working | standby | off (the real signal)
}

// Roster mapped to the backend /dialer/agents-health `key`s. Jarvis is rendered
// separately by AIAgents (the 3D centerpiece), so it's intentionally not here.
const AGENT_DEFS = [
  { key: 'scout',          name: 'Scout',         role: 'Lead Generator', color: '#ff3366', description: 'Cold multi-line dialer — generates raised hands from VA lists.', schedule: 'On demand' },
  { key: 'sarah',          name: 'Sarah',         role: 'Lead Qualifier', color: '#fbbf24', description: 'Calls raised-hand iSpeed leads one-by-one and qualifies them hot/warm/cold.', schedule: 'Mon–Sat 9a–8p' },
  { key: 'lead_manager',   name: 'Call Analyzer', role: 'Lead QA',        color: '#a78bfa', description: 'Reviews call transcripts and updates GHL tags/stages/notes. (Future: Lead Manager — double-checks every call.)', schedule: 'Every hour' },
  { key: 'alpha_scraper',  name: 'Alpha Scraper', role: 'Lead Source',    color: '#60a5fa', description: 'Scrapes AlphaLeads VA and feeds Scout fresh contact lists.', schedule: 'Every 30 min' },
  { key: 'asap',           name: 'ASAP Scraper',  role: 'Deal Data',      color: '#fbbf24', description: 'Property/comp scraper for the ASAP ARV database.', schedule: 'On demand' },
  { key: 'speed_to_lead',  name: 'Speed-to-Lead', role: 'Lead Intake',    color: '#67e8f9', description: 'Instant-dials each new iSpeed lead the moment it arrives.', schedule: 'Always on' },
  { key: 'county_scraper', name: 'County Scraper',role: 'Lead Source',    color: '#fb923c', description: 'OC Comptroller Lis Pendens + MyEClerk lead source.', schedule: 'Daily 7am' },
];

interface HealthAgent { key: string; status: string; online: boolean; restarts: number | null; uptimeMs: number | null; }

export function useAgents(refreshKey: number) {
  const [agents,  setAgents]  = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      fetch(`${API_BASE}/dialer/agents-health`).then(r => r.json()).catch(() => ({ agents: [] })),
      fetch(`${API_BASE}/dialer/sarah-live`).then(r => r.json()).catch(() => ({ calls: [] })),
    ]).then(([health, sarahLive]) => {
      if (!active) return;

      const byKey: Record<string, HealthAgent> = {};
      for (const a of (health?.agents || [])) byKey[a.key] = a;
      const sarahOnCall = Array.isArray(sarahLive?.calls) && sarahLive.calls.length > 0;

      const result: AgentInfo[] = AGENT_DEFS.map(def => {
        const h = byKey[def.key];
        let work: WorkStatus = 'off';
        if (h?.online) {
          work = 'standby';
          if (def.key === 'sarah' && sarahOnCall) work = 'working';
        }
        const status: AgentStatus = work === 'working' ? 'active' : work === 'standby' ? 'idle' : 'offline';
        return {
          ...def,
          lastActivity: null,
          runCount: h?.restarts ?? 0,
          status,
          pm2Status: h?.status ?? 'unknown',
          uptimeMs: h?.uptimeMs ?? null,
          work,
        };
      });

      setAgents(result);
      setLoading(false);
    });

    return () => { active = false; };
  }, [refreshKey]);

  return { agents, loading };
}
