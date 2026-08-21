'use client';

import { useEffect, useState } from 'react';
import { DIALER_API } from '@/lib/config';

/**
 * Property Leads scoreboard feed — served by dialer-server (:3007) from
 * ppl-tracker.js, which assembles it out of GHL's own call log plus Sarah's
 * attempt notes. Chris dials these leads inside GHL, so GHL is the system of
 * record and this dashboard is a mirror, not a second ledger.
 *
 * Polled a minute at a time like the other boards. The server recomputes on a
 * 5-minute loop because each lead costs two GHL round-trips, so a faster poll
 * here would only re-read the same cache.
 */
const PPL_API = `${DIALER_API}/dialer/property-leads`;
const AUTO_REFRESH_MS = 60 * 1000;

/** What Jarvis thinks should happen to a lead. Drives colour and sort order. */
export type PplState =
  | 'building'    // inside the window, still owed dials
  | 'at_risk'     // cannot finish the 4 dial-days before the window shuts
  | 'ready'       // claim earned, file it
  | 'file_now'    // window closed but the dials were done — try anyway
  | 'expired'     // window closed short of proof — money gone
  | 'reached'     // seller engaged; no claim exists
  | 'working'     // live deal
  | 'filed' | 'approved' | 'closed';

export interface PplDay { day: string; chris: number; sarah: number; inbound: number; total: number }

export interface PplLead {
  id: string;
  contactId: string | null;
  name: string;
  phone: string;
  stage: string;
  stageKey: string | null;
  receivedAt: string;
  daysOwned: number;
  windowLeft: number;
  cost: number;
  attempts: {
    total: number; chris: number; sarah: number; inbound: number;
    outreachDays: number; compliantDays: number; byDay: PplDay[];
  };
  today: { made: number; needed: number; owner: 'chris' | 'sarah' };
  state: PplState;
  action: string;
  lastAttemptAt: string | null;
}

export interface PplKpis {
  leads: number;
  spend: number; recovered: number; netSpend: number; costPerLead: number;
  qualified: number; deals: number;
  costPerDeal: number | null; costPerQualified: number | null; liveRatio: number | null;
  projected: { best: number; avg: number; bad: number };
  dueTodayCount: number; dialsDueToday: number;
  claimsReady: number; claimsReadyCash: number;
  atRisk: number; atRiskCash: number;
  expiredCount: number; expiredCash: number;
  attemptSplit: { chris: number; sarah: number };
}

export interface PplData {
  builtAt: number;
  ready: boolean;
  reason?: string;
  stagePlan?: { key: string; name: string }[];
  pipelineName?: string;
  bid: number;
  rules: {
    windowDays: number; outreachDays: number;
    attemptsPerDay: number; attemptsRequired: number; chrisAttempts: number;
  };
  benchmarks: { best: number; avg: number; bad: number };
  kpis: PplKpis;
  dueToday: PplLead[];
  claimsReady: PplLead[];
  atRisk: PplLead[];
  expired: PplLead[];
  leads: PplLead[];
}

export function usePropertyLeads(refreshKey: number) {
  const [data, setData]       = useState<PplData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tick, setTick]       = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(PPL_API, { cache: 'no-store' })
      .then(r => r.json())
      .then((resp) => {
        if (!active) return;
        // `ready: false` is not an error — it is the pipeline not existing yet,
        // and the section renders setup instructions from it.
        if (resp?.error) { setError(String(resp.error)); setLoading(false); return; }
        setData(resp as PplData);
        setError(null);
        setLoading(false);
      })
      .catch((e) => { if (active) { setError(e.message); setLoading(false); } });
    return () => { active = false; };
  }, [refreshKey, tick]);

  return { data, loading, error };
}
