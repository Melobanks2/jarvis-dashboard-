'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../supabase';

export type AgentStatus = 'active' | 'idle' | 'offline';

export interface AgentInfo {
  name: string;
  key: string;
  color: string;
  description: string;
  schedule: string;
  lastActivity: string | null;
  runCount: number;
  status: AgentStatus;
}

const AGENT_DEFS: Omit<AgentInfo, 'lastActivity' | 'runCount' | 'status'>[] = [
  { name: 'Alpha Scraper',   key: 'ALPHA_SCRAPER',   color: '#60a5fa', description: 'Scrapes AlphaLeads VA, creates GHL contacts + opps',         schedule: 'Every 30 min' },
  { name: 'Call Analyzer',   key: 'CALL_ANALYZER',   color: '#a78bfa', description: 'Analyzes transcripts, updates GHL tags, stages & notes',     schedule: 'Every hour'   },
  { name: 'County Scraper',  key: 'COUNTY_SCRAPER',  color: '#fb923c', description: 'OC Comptroller Lis Pendens + MyEClerk login',                schedule: 'Daily 7am'    },
  { name: 'Jarvis Caller',   key: 'JARVIS_CALLER',   color: '#4ade80', description: 'AI outbound caller with ElevenLabs + Claude conversation',   schedule: 'Mon-Fri noon' },
  { name: 'Jarvis Bot',      key: 'JARVIS_BOT',      color: '#67e8f9', description: 'Telegram bot polling for real-time commands',                schedule: 'Always on'    },
  { name: 'ASAP Scraper',    key: 'ASAP_SCRAPER',    color: '#fbbf24', description: 'Property data scraper for ASAP ARV database',               schedule: 'On demand'    },
];

export function useAgents(refreshKey: number) {
  const [agents,  setAgents]  = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase
      .from('jarvis_log')
      .select('source, created_at, type')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!active) return;
        const logs = data || [];
        const now = Date.now();

        const result: AgentInfo[] = AGENT_DEFS.map(def => {
          const agentLogs = logs.filter(l =>
            l.source?.toUpperCase().replace(/[\s-]/g, '_') === def.key
          );
          const last = agentLogs[0];
          const lastTime = last ? new Date(last.created_at).getTime() : null;
          const min = lastTime ? (now - lastTime) / 60000 : Infinity;
          const status: AgentStatus = min < 5 ? 'active' : min < 180 ? 'idle' : 'offline';

          return {
            ...def,
            lastActivity: last?.created_at ?? null,
            runCount: agentLogs.length,
            status,
          };
        });

        setAgents(result);
        setLoading(false);
      });
    return () => { active = false; };
  }, [refreshKey]);

  return { agents, loading };
}
