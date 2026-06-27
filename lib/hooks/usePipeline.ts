'use client';

import { useEffect, useState } from 'react';

// Pipeline data is served by the VPS dialer-server (Vercel Hobby is at its 12-function cap).
// Same endpoint the Leads board uses; here we group leads by a CLEAN canonical stage name
// because the raw GHL stage names are emoji-decorated with typos (e.g. "⛹🏿‍♀️🔥Hot fallow ups").
const PIPELINE_API = 'https://api.jarviscommandcenter.space/dialer/leads';
const AUTO_REFRESH_MS = 60 * 1000;
const DAY_MS = 86_400_000;

export type Temp = 'hot' | 'warm' | 'cold' | 'dead' | 'new';
export type Source = 'alpha' | 'sarah' | 'ispeed' | 'va';

export interface Lead {
  id: string;
  contactId: string;
  name: string;
  phone: string;
  address: string;
  tags: string[];
  stage: string;            // canonical clean name
  stageRaw: string;         // original GHL stage name
  source: Source;
  temp: Temp;
  pipelineId: string | null;
  createdAt: string;
  updatedAt: string;
  lastChange: string;
  daysInStage: number | null;
  daysInCrm: number | null;
  value: number;
  askingPrice: number | null;
  pain: string | null;
  timeline: string | null;
  condition: string | null;
  lastNote: string | null;
  // iSpeed lead economics (present only for source === 'ispeed')
  purchasePrice: number | null;
  daysUntilDeadline: number | null;
  deadlineUrgent: boolean | null;
  refundEligible: string | null;
  leadSource: string | null;
}

export interface TempCounts { hot: number; warm: number; cold: number; dead: number; new: number; }
export interface SourceStats { total: number; hot: number; warm: number; cold: number; dead: number; newLeads: number; }

export interface PipelineData {
  stages: Record<string, Lead[]>;
  total: number;
  stageOrder: string[];
  leads: Lead[];
  byTemp: TempCounts;
  bySource: Record<string, SourceStats>;
  // iSpeed leads still inside the refund window (money recoverable) — most urgent first
  refundRisk: Lead[];
  fetchedAt: string | null;
}

// Canonical stage order used across the dashboard (deal-flow left→right).
export const STAGE_ORDER = [
  'New Lead', 'Attempt 1', 'Attempt 2', 'Attempt 3-5', 'Unresponsive',
  'Cold Follow Up', 'Warm Follow Up', 'Hot Follow Up',
  'Decision Pending', 'Contract Sent', 'Under Contract', 'Closed',
  'Signed Elsewhere', 'Refund Requested', 'Refund Approved', 'Disposition', 'Dead',
];

// Map a messy GHL stage name to a clean canonical bucket. Keyword-based + order-sensitive
// (specific before generic) so typos / emoji / casing don't matter.
export function canonicalStage(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s.includes('decision'))        return 'Decision Pending';
  if (s.includes('contract sent'))   return 'Contract Sent';
  if (s.includes('under contract'))  return 'Under Contract';
  if (s.includes('signed'))          return 'Signed Elsewhere';
  if (s.includes('refund approved')) return 'Refund Approved';
  if (s.includes('refund') || s.includes('bad lead')) return 'Refund Requested';
  if (s.includes('hot'))             return 'Hot Follow Up';
  if (s.includes('warm'))            return 'Warm Follow Up';
  if (s.includes('cold'))            return 'Cold Follow Up';
  if (s.includes('dispos'))          return 'Disposition';
  if (s.includes('closed'))          return 'Closed';
  if (s.includes('dead'))            return 'Dead';
  if (s.includes('unrespons') || s.includes('6+')) return 'Unresponsive';
  if (s.includes('attempt 3'))       return 'Attempt 3-5';
  if (s.includes('attempt 2'))       return 'Attempt 2';
  if (s.includes('attempt 1') || s.includes('attempt  1')) return 'Attempt 1';
  if (s.includes('new'))             return 'New Lead';
  return raw.replace(/[^a-zA-Z0-9 +-]/g, '').trim() || 'Other';
}

interface RawLead {
  id: string; contactId: string | null; name?: string; phone?: string | null; address?: string | null;
  source?: string; temp?: string; stageName?: string; stageId?: string; pipelineId?: string | null;
  createdAt?: string; updatedAt?: string | null; daysInCrm?: number | null; value?: number | null;
  askingPrice?: string | number | null; pain?: string | null; timeline?: string | null; condition?: string | null;
  purchasePrice?: number | null; daysUntilDeadline?: number | null; deadlineUrgent?: boolean | null;
  refundEligible?: string | null; leadSource?: string | null; tags?: string[];
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mapLead(r: RawLead): Lead {
  const updated = r.updatedAt || r.createdAt || '';
  const daysInStage = updated ? Math.max(0, Math.floor((Date.now() - new Date(updated).getTime()) / DAY_MS)) : null;
  return {
    id: r.id,
    contactId: r.contactId || '',
    name: r.name || 'Unknown',
    phone: r.phone || '',
    address: r.address || '',
    tags: r.tags || [],
    stage: canonicalStage(r.stageName || ''),
    stageRaw: r.stageName || '',
    source: (r.source as Source) || 'va',
    temp: (r.temp as Temp) || 'new',
    pipelineId: r.pipelineId ?? null,
    createdAt: r.createdAt || '',
    updatedAt: updated,
    lastChange: updated,
    daysInStage,
    daysInCrm: r.daysInCrm ?? null,
    value: typeof r.value === 'number' ? r.value : 0,
    askingPrice: num(r.askingPrice),
    pain: r.pain || null,
    timeline: r.timeline || null,
    condition: r.condition || null,
    lastNote: r.pain || null,
    purchasePrice: r.purchasePrice ?? null,
    daysUntilDeadline: r.daysUntilDeadline ?? null,
    deadlineUrgent: r.deadlineUrgent ?? null,
    refundEligible: r.refundEligible ?? null,
    leadSource: r.leadSource ?? null,
  };
}

const EMPTY_TEMP: TempCounts = { hot: 0, warm: 0, cold: 0, dead: 0, new: 0 };

export function usePipeline(refreshKey: number) {
  const [data, setData]       = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tick, setTick]       = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetch(PIPELINE_API)
      .then(r => r.json())
      .then((resp) => {
        if (!active) return;
        if (resp?.error) { setError(String(resp.error)); setData(null); setLoading(false); return; }

        const leads: Lead[] = (resp.leads || []).map(mapLead);

        const stages: Record<string, Lead[]> = {};
        for (const l of leads) (stages[l.stage] = stages[l.stage] || []).push(l);

        const byTemp = { ...EMPTY_TEMP };
        for (const l of leads) byTemp[l.temp] = (byTemp[l.temp] ?? 0) + 1;

        // iSpeed leads whose refund window is still open (>=0 days left) — money still recoverable.
        const refundRisk = leads
          .filter(l => l.source === 'ispeed' && l.daysUntilDeadline != null && l.daysUntilDeadline >= 0
                       && l.stage !== 'Refund Requested' && l.stage !== 'Refund Approved')
          .sort((a, b) => (a.daysUntilDeadline! - b.daysUntilDeadline!));

        const present = STAGE_ORDER.filter(s => stages[s]?.length);
        const extras  = Object.keys(stages).filter(s => !STAGE_ORDER.includes(s));

        setData({
          stages,
          total: resp.stats?.total ?? leads.length,
          stageOrder: [...present, ...extras],
          leads,
          byTemp,
          bySource: resp.statsBySource || {},
          refundRisk,
          fetchedAt: resp.fetchedAt || null,
        });
        setError(null);
        setLoading(false);
      })
      .catch((e) => { if (active) { setError(e.message); setLoading(false); } });

    return () => { active = false; };
  }, [refreshKey, tick]);

  return { data, loading, error };
}
