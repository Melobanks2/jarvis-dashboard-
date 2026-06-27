'use client';

import { useEffect, useState } from 'react';
import { supabase, todayStart } from '../supabase';

export type Temp = 'hot' | 'warm' | 'cold' | 'dead' | 'new';
export type Source = 'alpha' | 'sarah' | 'ispeed';

export interface Lead {
  id: string;
  contactId: string | null;
  source: Source;
  pipelineId: string | null;
  stageId: string | null;
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
  rehabCost: string | null;
  rating: string | null;
  dealType: string | null;
  attempts: number | null;
  mortgage: string | null;
  status: string;
  createdAt?: string | null;
  updatedAt: string | null;
  // ── iSpeed lead economics (backend serves these only for source === 'ispeed') ──
  daysInCrm?: number | null;
  purchasePrice?: number | null;     // cost of the lead, USD
  purchaseTier?: string | null;      // e.g. 'exclusive'
  provider?: string | null;          // lead vendor
  leadSource?: string | null;        // e.g. 'Google Ads PPC'
  predictorGrade?: string | null;
  purchasedAt?: number | null;       // epoch ms
  daysSincePurchase?: number | null;
  fundingSource?: string | null;
  refundEligible?: string | null;
  refundDeadline?: number | null;    // epoch ms
  daysUntilDeadline?: number | null; // negative = past refund window
  deadlineUrgent?: boolean | null;
  // merged from jarvis_calls
  callDuration?: number | null;
  calledAt?: string | null;
  summary?: string | null;
  transcript?: string | null;
  recordingUrl?: string | null;
  callHistory?: CallRecord[];        // every logged attempt for this phone, newest first
}

// One past call attempt (normalized from a jarvis_calls row) for the detail view.
export interface CallRecord {
  id: string;
  calledAt: string;
  duration: number | null;
  stageBefore: string | null;
  stageAfter: string | null;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
}

export interface LeadStats {
  total: number; hot: number; warm: number; cold: number; dead: number; newLeads: number;
}
export interface StatsBySource {
  alpha: LeadStats; sarah: LeadStats; ispeed: LeadStats;
}
// pipelineId -> { hot,warm,cold,dead: stageId }
export type TempStages = Record<string, Partial<Record<Exclude<Temp, 'new'>, string | null>>>;

// Ordered GHL pipeline metadata — lets the board mirror the pipeline 1:1.
export interface PipelineStage { id: string; name: string; }
export interface PipelineMeta {
  id: string;
  label: string;
  source: string | null; // 'ispeed' | 'va' | null
  stages: PipelineStage[];
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
  recording_url: string | null; telnyx_recording_url: string | null; elevenlabs_recording_url: string | null;
}

const TEST_PHONE = '+13479704969';
const LIVE_WINDOW_MS = 3 * 60 * 1000; // calls within 3 min are shown as "live/just landed"
const AUTO_REFRESH_MS = 30 * 1000;    // real-time: re-pull leads + calls every 30s
// Leads are served by the VPS backend (Vercel Hobby is at its 12-function cap)
export const LEADS_API = 'https://api.jarviscommandcenter.space/dialer';

const EMPTY_STATS: LeadStats = { total: 0, hot: 0, warm: 0, cold: 0, dead: 0, newLeads: 0 };

export function useLeads(refreshKey: number) {
  const [leads, setLeads]   = useState<Lead[]>([]);
  const [stats, setStats]   = useState<LeadStats>({ ...EMPTY_STATS });
  const [statsBySource, setStatsBySource] = useState<StatsBySource>({ alpha: { ...EMPTY_STATS }, sarah: { ...EMPTY_STATS }, ispeed: { ...EMPTY_STATS } });
  const [tempStages, setTempStages] = useState<TempStages>({});
  const [pipelines, setPipelines] = useState<PipelineMeta[]>([]);
  const [live, setLive]     = useState<LiveCall[]>([]);
  const [callsToday, setCallsToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [tick, setTick]     = useState(0);

  // 30-second auto-refresh tick (real-time updates as David qualifies leads)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      fetch(`${LEADS_API}/leads`).then(r => r.json()).catch(e => ({ error: e.message })),
      supabase
        .from('jarvis_calls')
        .select('id,phone,contact_name,address,call_duration,stage_after,stage_before,summary,transcript_full,recording_url,telnyx_recording_url,elevenlabs_recording_url,called_at')
        .order('called_at', { ascending: false })
        .limit(120),
    ]).then(([leadResp, callResp]) => {
      if (!active) return;

      const calls: CallRow[] = (callResp?.data || []).filter((c: CallRow) => c.phone !== TEST_PHONE);

      // all calls per phone (newest first — query is ordered called_at desc),
      // so [0] is the latest attempt and the array is the full call history.
      const callsByPhone: Record<string, CallRow[]> = {};
      for (const c of calls) {
        const k = pkey(c.phone);
        if (!k) continue;
        (callsByPhone[k] = callsByPhone[k] || []).push(c);
      }
      const toRecord = (c: CallRow): CallRecord => ({
        id: c.id,
        calledAt: c.called_at,
        duration: c.call_duration,
        stageBefore: c.stage_before,
        stageAfter: c.stage_after,
        summary: c.summary,
        transcript: c.transcript_full,
        recordingUrl: c.telnyx_recording_url || c.recording_url || c.elevenlabs_recording_url || null,
      });

      if (leadResp?.error) {
        setError(leadResp.error);
        setLeads([]);
      } else {
        const merged: Lead[] = (leadResp.leads || []).map((l: Lead) => {
          const hist = callsByPhone[pkey(l.phone)] || [];
          const c = hist[0];
          return {
            ...l,
            callDuration: c?.call_duration ?? null,
            calledAt:     c?.called_at ?? null,
            summary:      c?.summary ?? null,
            transcript:   c?.transcript_full ?? null,
            recordingUrl: c?.telnyx_recording_url || c?.recording_url || c?.elevenlabs_recording_url || null,
            callHistory:  hist.map(toRecord),
          };
        });
        setLeads(merged);
        setStats(leadResp.stats || { ...EMPTY_STATS, total: merged.length });
        setStatsBySource(leadResp.statsBySource || { alpha: { ...EMPTY_STATS }, sarah: { ...EMPTY_STATS }, ispeed: { ...EMPTY_STATS } });
        setTempStages(leadResp.tempStages || {});
        setPipelines(leadResp.pipelines || []);
        setError(null);
      }

      // Live / recent call feed from today's jarvis_calls
      const now = Date.now();
      const todays = calls.filter(c => c.called_at >= todayStart());
      setCallsToday(todays.length);
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
  }, [refreshKey, tick]);

  return { leads, stats, statsBySource, tempStages, pipelines, live, callsToday, loading, error };
}
