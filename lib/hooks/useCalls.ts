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

export interface DayCount {
  day: string;   // "Mon", "Tue" etc
  date: string;  // "2026-03-17"
  count: number;
  conversations: number;
}

export function callOutcome(c: CallRecord): 'hot' | 'warm' | 'cold' | 'voicemail' {
  const stage = c.stage_after || '';
  if (stage === 'Hot Follow Up') return 'hot';
  if (stage === 'Warm Follow Up') return 'warm';
  if (
    stage.includes('No Contact') ||
    stage.includes('Unresponsive') ||
    c.call_duration < 25
  ) return 'voicemail';
  return 'cold';
}

export function useCalls(refreshKey: number) {
  const [calls,           setCalls]           = useState<CallRecord[]>([]);
  const [recentCalls,     setRecentCalls]     = useState<CallRecord[]>([]);
  const [recordings,      setRecordings]      = useState<CallRecord[]>([]);
  const [weekData,        setWeekData]        = useState<DayCount[]>([]);
  const [pendingApprovals,setPendingApprovals] = useState(0);
  const [loading,         setLoading]         = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    Promise.all([
      // Today's calls
      supabase.from('jarvis_calls')
        .select('*')
        .gte('called_at', todayStart())
        .order('called_at', { ascending: false }),
      // Last 20 calls (live feed)
      supabase.from('jarvis_calls')
        .select('*')
        .order('called_at', { ascending: false })
        .limit(20),
      // Last 7 days (for weekly chart)
      supabase.from('jarvis_calls')
        .select('called_at, call_duration, stage_after')
        .gte('called_at', sevenDaysAgo.toISOString())
        .order('called_at', { ascending: true }),
      // Pending approvals
      supabase.from('david_pending_approvals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ]).then(([today, recent, week, approvals]) => {
      if (!active) return;

      setCalls(today.data || []);
      setRecentCalls(recent.data || []);
      setRecordings((recent.data || []).filter(c => c.recording_url || c.elevenlabs_recording_url));

      // Build weekly chart data — last 7 days
      const days: DayCount[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
        const dayCalls = (week.data || []).filter(c => c.called_at.slice(0, 10) === dateStr);
        days.push({
          day: dayName,
          date: dateStr,
          count: dayCalls.length,
          conversations: dayCalls.filter(c => (c.call_duration || 0) > 30).length,
        });
      }
      setWeekData(days);
      setPendingApprovals(approvals.count ?? 0);
      setLoading(false);
    });

    return () => { active = false; };
  }, [refreshKey]);

  return { calls, recentCalls, recordings, weekData, pendingApprovals, loading };
}
