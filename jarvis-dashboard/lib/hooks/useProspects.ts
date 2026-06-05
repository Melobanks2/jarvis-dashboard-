'use client';

import { useState, useEffect } from 'react';
import { supabase as sb } from '@/lib/supabase';

export interface DealApproval {
  id: string;
  contact_id: string;
  contact_name: string;
  address: string;
  arv: number | null;
  repair_estimate: number | null;
  offer_60: number | null;
  offer_65: number | null;
  offer_70: number | null;
  motivation: string | null;
  interest_level: string | null;
  call_summary: string | null;
  transcript: string | null;
  asaparv_report_url: string | null;
  status: 'pending' | 'approved' | 'passed';
  decision_at: string | null;
  created_at: string;
}

export interface ProspectCall {
  id: string;
  contact_id: string;
  contact_name: string;
  phone: string | null;
  address: string | null;
  call_duration: number;
  stage_before: string | null;
  stage_after: string | null;
  tags_applied: string | string[];
  summary: string | null;
  notes: string | null;
  called_at: string;
  recording_url: string | null;
  transcript_full: string | null;
}

export function useProspects(refreshKey: number) {
  const [approvals, setApprovals]   = useState<DealApproval[]>([]);
  const [calls,     setCalls]       = useState<ProspectCall[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [error,     setError]       = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      // Pending + recent approvals
      sb
        .from('deal_approvals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),

      // Recent calls for prospect cards
      sb
        .from('jarvis_calls')
        .select('*')
        .order('called_at', { ascending: false })
        .limit(50),
    ])
      .then(([appRes, callRes]) => {
        if (cancelled) return;
        if (appRes.error)  setError(appRes.error.message);
        if (callRes.error) setError(prev => prev || callRes.error!.message);
        setApprovals((appRes.data as DealApproval[]) || []);
        setCalls((callRes.data as ProspectCall[]) || []);
        setLoading(false);
      })
      .catch(err => {
        if (!cancelled) { setError(err.message); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [refreshKey]);

  const pendingApprovals = approvals.filter(a => a.status === 'pending');
  const decidedApprovals = approvals.filter(a => a.status !== 'pending');

  return { approvals, pendingApprovals, decidedApprovals, calls, loading, error };
}
