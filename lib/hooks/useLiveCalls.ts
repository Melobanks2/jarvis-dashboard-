'use client';

/**
 * useLiveCalls — who Sarah is actually on the phone with, right now.
 *
 * Polls every 3s, which is fast enough that a card lights up while the phone
 * is still ringing, and slow enough that it costs nothing. Deliberately a
 * separate hook from useLeads: leads refresh on a slow cycle because GHL is
 * slow, and "who is she talking to" has to be live even when the lead list is
 * minutes stale.
 *
 * Everything is keyed on the last 10 digits of the phone, because the dialer
 * reports E.164 (+14075551234) and GHL stores whatever the seller typed.
 */

import { useEffect, useRef, useState } from 'react';
import { DIALER_API } from '@/lib/config';

export interface LiveCall {
  callId: string | null;
  sessionId: string;
  name: string;
  phone: string;
  address: string | null;
  /** ringing | connected | ... — 'connected' means a human is on the line. */
  phase: string;
  amd: string | null;
  duration: number;
}

export const digits10 = (p?: string | null) => String(p || '').replace(/\D/g, '').slice(-10);

export function useLiveCalls(pollMs = 3000) {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const r = await fetch(`${DIALER_API}/dialer/sarah-live`, { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (!alive) return;
        setCalls(Array.isArray(j.calls) ? j.calls : []);
        // `offline: true` is the dialer telling us it could not read its own
        // state — distinct from "no calls", and worth showing differently.
        setReachable(!j.offline);
      } catch {
        if (!alive) return;
        setCalls([]);
        setReachable(false);
      }
    };

    tick();
    timer.current = setInterval(tick, pollMs);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [pollMs]);

  /** Live call for a phone number, or null. */
  const forPhone = (phone?: string | null): LiveCall | null => {
    const k = digits10(phone);
    if (!k) return null;
    return calls.find(c => digits10(c.phone) === k) || null;
  };

  return {
    calls,
    reachable,
    forPhone,
    /** Any call at all — ringing counts. */
    isBusy: calls.length > 0,
    /** Someone actually picked up. */
    isTalking: calls.some(c => c.phase === 'connected'),
  };
}
