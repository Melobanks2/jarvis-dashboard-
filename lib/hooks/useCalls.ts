'use client';

import { useState, useEffect } from 'react';
import { supabase, todayStart } from '../supabase';

export interface CallRecord {
  id: string;
  contact_id: string;
  contact_name: string;
  phone: string;
  address: string;
  call_duration: number;
  stage_before: string;
  stage_after: string;
  tags_applied: string[];
  summary: string;
  notes: string;
  called_at: string;
  twilio_call_sid: string;
  recording_url: string;
  recording_duration: number;
  elevenlabs_recording_url: string;
  transcript_full: string;
}

export function useCalls(refreshKey: number) {
  const [calls,      setCalls]      = useState<CallRecord[]>([]);
  const [recordings, setRecordings] = useState<CallRecord[]>([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      supabase.from('jarvis_calls').select('*').gte('called_at', todayStart()).order('called_at', { ascending: false }),
      supabase.from('jarvis_calls').select('*').order('called_at', { ascending: false }).limit(10),
    ]).then(([today, recs]) => {
      if (!active) return;
      setCalls(today.data || []);
      setRecordings(recs.data || []);
      setLoading(false);
    });
    return () => { active = false; };
  }, [refreshKey]);

  return { calls, recordings, loading };
}
