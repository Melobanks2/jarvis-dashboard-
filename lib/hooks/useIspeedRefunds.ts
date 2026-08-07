'use client';

import { useEffect, useState } from 'react';

// Refund tracker feed — served by the VPS dialer-server (joins iSpeed orders to
// the GHL iSpeed pipeline by phone, then buckets by refund window). Same host
// as the leads board. Recomputed server-side every 5 min; we poll every 60s.
const REFUNDS_API = 'https://api.jarviscommandcenter.space/dialer/ispeed-refunds';
const AUTO_REFRESH_MS = 60 * 1000;

export type Disposition = 'keep' | 'refund' | 'new' | 'requested';

export interface SubmittableLead {
  name: string;
  city: string;
  address: string;
  price: number;
  tier: string;
  daysLeft: number;
  dayN: number;
  stage: string;
  disposition: Disposition;
}
export interface RefundedLead { name: string; city: string; price: number; tier: string; }
export interface MissedLead extends RefundedLead { closedDaysAgo: number; }

export interface RefundKpis {
  recovered: number;
  recoveredCount: number;
  recoveredByTier: { exclusive: number; coupon: number };
  openWindow: number;
  closingSoon: number;
  expiredUnrefunded: number;
  expiredCount: number;
  captureRatePct: number;
  exclRefunded: number;
  exclTotal: number;
}

export interface RefundData {
  builtAt: number;
  kpis: RefundKpis;
  submittable: SubmittableLead[];
  refunded: RefundedLead[];
  missed: MissedLead[];
}

export function useIspeedRefunds(refreshKey: number) {
  const [data, setData]       = useState<RefundData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tick, setTick]       = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(REFUNDS_API)
      .then(r => r.json())
      .then((resp) => {
        if (!active) return;
        if (resp?.error) { setError(String(resp.error)); setLoading(false); return; }
        setData(resp as RefundData);
        setError(null);
        setLoading(false);
      })
      .catch((e) => { if (active) { setError(e.message); setLoading(false); } });
    return () => { active = false; };
  }, [refreshKey, tick]);

  return { data, loading, error };
}
