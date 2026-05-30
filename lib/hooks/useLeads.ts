'use client';

import { useEffect, useState } from 'react';
import { supabase, todayStart } from '../supabase';

export type Temp = 'hot' | 'warm' | 'cold' | 'dead' | 'new';

export interface Lead {
  id: string;
  contactId: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  stageName: string;
  temp: Temp;
  value: number;
  pain: string | null;
  timeline: string | null;
  askingPrice: string | null;
  condition: string | null;
  occupancy: string | null;
  marketValue: string | null;
  arv: string | null;
  mortgage: string | null;
  status: string;
  updatedAt: string | null;
  // merged from jarvis_calls
  callDuration?: number | null;
  calledAt?: string | null;
  summary?: string | null;
  transcript?: string | null;
}

export interface LeadStats {
  total: number; hot: number; warm: number; cold: number; dead: number; newLeads: number;
}

export interface LiveCall {
  id: string;
  name: string;
  address: string | null;
  duration: number;
  phase: string;
  calledAt: string;
  isLive: boolean;
}

// last 10 digits for matching GHL ↔ jarvis_calls phone formats
function pkey(phone?: string | null) {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

interface CallRow {
  id: string; phone: string | null; contact_name: string | null; address: string | null;
  call_duration: number | null; called_at: string; stage_after: string | null;
  stage_before: string | null; summary: string | null; transcript_full: string | null;
}

const TEST_PHONE = '+13479704969';
const LIVE_WINDOW_MS = 3 * 60 * 1000; // calls within 3 min are shown as "live/just landed"

export function useLeads(refreshKey: number) {
  const [leads, setLeads]   = useState<Lead[]>([]);
  const [stats, setStats]   = useState<LeadStats>({ total: 0, hot: 0, warm: 0, cold: 0, dead: 0, newLeads: 0 });
  const [live, setLive]     = useState<LiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      fetch('/api/leads').then(r => r.json()).catch(e => ({ error: e.message })),
      supabase
        .from('jarvis_calls')
        .select('id,phone,contact_name,address,call_duration,stage_after,stage_before,summary,transcript_full,called_at')
        .order('called_at', { ascending: false })
        .limit(120),
    ]).then(([leadResp, callResp]) => {
      if (!active) return;

      const calls: CallRow[] = (callResp?.data || []).filter((c: CallRow) => c.phone !== TEST_PHONE);

      // latest call per phone for merge
      const callByPhone: Record<string, CallRow> = {};
      for (const c of calls) {
        const k = pkey(c.phone);
        if (k && !callByPhone[k]) callByPhone[k] = c;
      }

      if (leadResp?.error) {
        setError(leadResp.error);
        setLeads([]);
      } else {
        const merged: Lead[] = (leadResp.leads || []).map((l: Lead) => {
          const c = callByPhone[pkey(l.phone)];
          return {
            ...l,
            callDuration: c?.call_duration ?? null,
            calledAt:     c?.called_at ?? null,
            summary:      c?.summary ?? null,
            transcript:   c?.transcript_full ?? null,
          };
        });
        setLeads(merged);
        setStats(leadResp.stats || { total: merged.length, hot: 0, warm: 0, cold: 0, dead: 0, newLeads: 0 });
        setError(null);
      }

      // Live / recent call feed from today's jarvis_calls
      const now = Date.now();
      const todays = calls.filter(c => c.called_at >= todayStart());
      const liveCalls: LiveCall[] = todays.slice(0, 8).map(c => ({
        id: c.id,
        name: c.contact_name || 'Unknown',
        address: c.address,
        duration: c.call_duration || 0,
        phase: c.stage_after || c.stage_before || '—',
        calledAt: c.called_at,
        isLive: now - new Date(c.called_at).getTime() < LIVE_WINDOW_MS,
      }));
      setLive(liveCalls);

      setLoading(false);
    });

    return () => { active = false; };
  }, [refreshKey]);

  return { leads, stats, live, loading, error };
}
