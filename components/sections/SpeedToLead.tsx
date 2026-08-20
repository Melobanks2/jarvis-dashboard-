'use client';

/**
 * Speed to Lead — how long a purchased lead waits before Sarah dials it, and
 * whether waiting costs anything.
 *
 * This is the metric the whole "speed to lead" product is sold on, so it is
 * worth measuring against Chris's own leads rather than taking the vendor's
 * word. The gap is purchasedAt (from the CRM) to the first logged call.
 *
 * Two honesty constraints are built in, because both would otherwise produce a
 * confident wrong answer:
 *
 * 1. Sample size is shown, always. Most leads on file were bought long before
 *    the dialer ran, so the fast buckets are thin. A percentage over three
 *    leads is not a finding and is labelled as such.
 *
 * 2. Only leads with BOTH a purchase timestamp and a logged call are counted.
 *    Unanswered dials do not create a jarvis_calls row, so "first call" here
 *    means first CONNECTED call — a lead dialed ten times and never reached
 *    has no first-call time and is excluded rather than counted as slow.
 */

import { useEffect, useMemo, useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead } from '@/lib/hooks/useLeads';
import { supabase } from '@/lib/supabase';
import { wasReached, isQualified } from '@/lib/leadStages';

const BUCKETS: { lo: number; hi: number; label: string }[] = [
  { lo: 0,  hi: 1,        label: 'Under 1 hour' },
  { lo: 1,  hi: 6,        label: '1 – 6 hours' },
  { lo: 6,  hi: 24,       label: '6 – 24 hours' },
  { lo: 24, hi: 72,       label: '1 – 3 days' },
  { lo: 72, hi: Infinity, label: 'Over 3 days' },
];

const key10 = (p?: string | null) => String(p || '').replace(/\D/g, '').slice(-10);

export function SpeedToLead() {
  const { refreshKey } = useApp();
  const { leads, loading } = useLeads(refreshKey);
  const [firstCall, setFirstCall] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    supabase.from('jarvis_calls').select('phone, called_at').order('called_at').limit(2000)
      .then(({ data }) => {
        if (!live || !data) return;
        const m: Record<string, number> = {};
        for (const r of data as { phone?: string; called_at?: string }[]) {
          const k = key10(r.phone);
          const t = r.called_at ? Date.parse(r.called_at) : NaN;
          if (!k || Number.isNaN(t)) continue;
          if (!(k in m) || t < m[k]) m[k] = t;
        }
        setFirstCall(m); setReady(true);
      });
    return () => { live = false; };
  }, [refreshKey]);

  const rows = useMemo(() => {
    const paired: { hours: number; lead: Lead }[] = [];
    for (const l of leads) {
      const bought = Number(l.purchasedAt);
      const t = firstCall[key10(l.phone)];
      if (!bought || !t) continue;
      const hours = (t - bought) / 3_600_000;
      if (hours < -1) continue;                    // clock skew, not a real gap
      paired.push({ hours: Math.max(0, hours), lead: l });
    }
    return BUCKETS.map(b => {
      const sub = paired.filter(p => p.hours >= b.lo && p.hours < b.hi);
      return {
        ...b,
        n: sub.length,
        reached:   sub.filter(p => wasReached(p.lead.stageName)).length,
        qualified: sub.filter(p => isQualified(p.lead.stageName)).length,
      };
    }).filter(b => b.n > 0);
  }, [leads, firstCall]);

  const total = rows.reduce((n, r) => n + r.n, 0);
  const thin  = total < 30;

  if (loading || !ready) return <div className="text-[12px] text-dimtext p-4">Measuring speed to lead…</div>;

  return (
    <GlassCard accent="cyan" padding="p-4" hover={false}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[13px] font-semibold text-textb">Speed to lead</span>
        <span className="text-[10px] text-dimtext ml-auto tabular-nums">{total} leads measured</span>
      </div>
      <div className="text-[10.5px] text-dimtext mb-3">
        Hours from purchase to the first call that connected, against what the lead became.
      </div>

      {total === 0 ? (
        <div className="text-[11.5px] text-dimtext py-3">
          Nothing to measure yet — needs leads that have both a purchase time and a connected call.
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {rows.map(r => {
              const qp = Math.round((r.qualified / r.n) * 100);
              const rp = Math.round((r.reached / r.n) * 100);
              return (
                <div key={r.label} className="flex items-center gap-2.5">
                  <span className="text-[10.5px] text-jtext w-[92px] flex-shrink-0">{r.label}</span>
                  <div className="flex-1 h-[18px] rounded-md overflow-hidden flex"
                       style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div style={{ width: `${qp}%`, background: '#30d158' }} />
                    <div style={{ width: `${Math.max(0, rp - qp)}%`, background: 'rgba(100,210,255,0.45)' }} />
                  </div>
                  <span className="text-[10px] tabular-nums w-[104px] text-right flex-shrink-0"
                        style={{ color: r.qualified ? '#30d158' : 'var(--dimtext)' }}>
                    {r.qualified} of {r.n} qualified
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-2.5 text-[9.5px] text-dimtext">
            <span className="flex items-center gap-1">
              <i className="w-2 h-2 rounded-sm inline-block" style={{ background: '#30d158' }} /> qualified
            </span>
            <span className="flex items-center gap-1">
              <i className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(100,210,255,0.45)' }} /> reached, not qualified
            </span>
          </div>
        </>
      )}

      <div className="mt-3 pt-3 border-t border-border text-[10.5px] text-dimtext leading-relaxed">
        {thin && total > 0 && (
          <><b style={{ color: '#ff9f0a' }}>Too little data to act on yet.</b> {total} leads is a hint, not a
          finding — one seller answering swings a whole bucket. It sharpens as Sarah dials more. </>
        )}
        A lead only appears here once it has been <em>reached</em>: unanswered dials are not written to the
        call log, so a lead tried ten times and never answered has no first-call time and is left out rather
        than counted as slow.
      </div>
    </GlassCard>
  );
}
