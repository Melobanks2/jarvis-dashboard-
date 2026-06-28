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
  telnyx_recording_url: string;
  transcript_full: string;
  caller: string;
}

// Best playable audio URL for a call, or null if none was recorded.
export function recordingUrl(c: CallRecord): string | null {
  return c.recording_url || c.elevenlabs_recording_url || c.telnyx_recording_url || null;
}

// Was this a real two-way conversation, a voicemail, or no pickup? Derived from
// the transcript (did a human actually speak?), the brain's explicit verdict in
// the summary, then duration as a fallback. Used for the call-log badge.
export function callType(c: CallRecord): 'conversation' | 'voicemail' | 'no-answer' {
  const blob = `${c.summary || ''} ${c.notes || ''}`.toLowerCase();
  const tx = c.transcript_full || '';

  // Explicit brain verdicts (multi-dialer) win outright.
  if (/verdict:\s*voicemail/i.test(blob)) return 'voicemail';
  if (/verdict:\s*(no[_ ]response|no[_ ]answer)/i.test(blob)) return 'no-answer';

  // What did the human/machine actually say? Pull the seller's lines from the
  // "Seller:"-labelled turns (both callers use this format).
  const sellerLines = tx.split(/\n+/)
    .map(l => l.trim())
    .filter(l => /^(seller|contact|human|owner|prospect)\s*[:[]/i.test(l))
    .map(l => l.replace(/^(seller|contact|human|owner|prospect)\s*[:[]\s*/i, '').trim())
    .filter(Boolean);
  const sellerText = sellerLines.join(' ').toLowerCase();
  const vmPhrase = /not available|leave a message|after the (tone|beep)|you'?ve reached|the (person|number|party)|mailbox|press \d|voicemail/;

  if (sellerLines.length > 0) {
    // A lone voicemail-greeting line → voicemail; real back-and-forth → conversation.
    if (vmPhrase.test(sellerText) && sellerLines.length <= 2) return 'voicemail';
    return 'conversation';
  }

  // Nobody spoke. Verdict implying engagement → conversation; a long open line
  // where the AI monologued → almost certainly a machine; else no pickup.
  if (/verdict:\s*(hot|warm|cold)\b/i.test(blob)) return 'conversation';
  if (/voicemail|left a message|answering machine/.test(blob) && !/no answer or voicemail/.test(blob)) return 'voicemail';
  if ((c.call_duration || 0) >= 20) return 'voicemail';
  return 'no-answer';
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
      // Today's calls — exclude test calls to Chris
      supabase.from('jarvis_calls')
        .select('*')
        .gte('called_at', todayStart())
        .neq('phone', '+13479704969')
        .order('called_at', { ascending: false }),
      // Last 50 calls (live feed) — exclude test calls
      supabase.from('jarvis_calls')
        .select('*')
        .neq('phone', '+13479704969')
        .order('called_at', { ascending: false })
        .limit(50),
      // Last 7 days (for weekly chart) — exclude test calls
      supabase.from('jarvis_calls')
        .select('called_at, call_duration, stage_after')
        .gte('called_at', sevenDaysAgo.toISOString())
        .neq('phone', '+13479704969')
        .order('called_at', { ascending: true }),
      // Pending approvals
      supabase.from('david_pending_approvals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ]).then(([today, recent, week, approvals]) => {
      if (!active) return;

      setCalls(today.data || []);
      setRecentCalls(recent.data || []);
      setRecordings((recent.data || []).filter(c => recordingUrl(c)));

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
