'use client';

/**
 * Refunds — one screen for the whole refund problem.
 *
 * This was three separate sections (iSpeed Refunds, Refund Pipeline, Refund
 * Desk) and nobody could find the number they wanted, because the three
 * answered three different questions about the same money and none of them
 * said which. Merged here as tabs named after the question:
 *
 *   Money         what has come back, what was lost, and how good we are at this
 *   Before filing who still qualifies, who is behind on calls, what expires when
 *   After filing  claims already sent, and what the vendor said back
 *
 * The header stays constant across tabs and always leads with the number that
 * costs money today, so switching tabs never hides the urgent thing.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Clock, Receipt, TrendingDown } from 'lucide-react';
import { useApp } from '@/lib/AppContext';
import { useLeads } from '@/lib/hooks/useLeads';
import { refundStatusOf } from '@/lib/refundRules';
import { DIALER_API } from '@/lib/config';
import { IspeedRefunds } from '@/components/sections/IspeedRefunds';
import { RefundPipeline } from '@/components/sections/RefundPipeline';
import { RefundDesk } from '@/components/sections/RefundDesk';

export type RefundTab = 'money' | 'before' | 'after';

// Set by another section before it navigates here, so "Open Refund Desk" from
// the Stage Map lands on the right tab instead of the default one.
let pendingTab: RefundTab | null = null;
export function openRefunds(tab: RefundTab) { pendingTab = tab; }

const TABS: { id: RefundTab; label: string; sub: string; Icon: typeof Clock }[] = [
  { id: 'money',  label: 'Money',        sub: 'recovered vs lost',        Icon: TrendingDown },
  { id: 'before', label: 'Before filing', sub: 'who still qualifies',     Icon: Clock },
  { id: 'after',  label: 'After filing',  sub: 'claims and vendor replies', Icon: Receipt },
];

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US');

export function Refunds() {
  const { refreshKey } = useApp();
  const { leads } = useLeads(refreshKey);
  const [tab, setTab] = useState<RefundTab>(() => {
    const t = pendingTab; pendingTab = null; return t ?? 'money';
  });
  const [atRisk, setAtRisk] = useState<{ value: number; count: number; oldest: number } | null>(null);

  useEffect(() => {
    fetch(`${DIALER_API}/dialer/refund-desk`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setAtRisk({
        value: j.rollup?.atRiskValue || 0,
        count: j.rollup?.atRisk || 0,
        oldest: j.rollup?.oldestWaitDays || 0,
      }))
      .catch(() => {});
  }, [refreshKey]);

  // The two things that lose money if ignored today, computed the same way the
  // boards compute them so the header can never disagree with the tab below it.
  const urgent = useMemo(() => {
    let behindValue = 0, behind = 0, expiringValue = 0, expiring = 0, soonestDays: number | null = null;
    for (const l of leads) {
      const rf = refundStatusOf(l);
      if (rf.state === 'behind') { behind++; behindValue += rf.price; }
      if (rf.state === 'ready') {
        expiring++; expiringValue += rf.price;
        if (rf.daysLeft != null && (soonestDays == null || rf.daysLeft < soonestDays)) soonestDays = rf.daysLeft;
      }
    }
    return { behindValue, behind, expiringValue, expiring, soonestDays };
  }, [leads]);

  const alarm =
    urgent.soonestDays != null && urgent.soonestDays <= 2
      ? { text: `${money(urgent.expiringValue)} expires in ${urgent.soonestDays} day${urgent.soonestDays === 1 ? '' : 's'} — file it today`, tab: 'before' as RefundTab }
      : urgent.behind > 0
      ? { text: `${money(urgent.behindValue)} is behind on calls and will expire unfiled`, tab: 'before' as RefundTab }
      : atRisk && atRisk.count > 0
      ? { text: `${money(atRisk.value)} is waiting on your reply${atRisk.oldest ? ` — oldest ${atRisk.oldest} days` : ''}`, tab: 'after' as RefundTab }
      : null;

  return (
    <div className="space-y-4">
      {alarm && (
        <button onClick={() => setTab(alarm.tab)}
                className="w-full text-left flex items-start gap-2 text-[11.5px] p-3 rounded-xl transition-colors hover:bg-white/[0.03]"
                style={{ background: 'rgba(255,69,58,0.12)', border: '1px solid rgba(255,69,58,0.3)', color: '#ff453a' }}>
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span><b>{alarm.text}.</b> Click to open it.</span>
        </button>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(t => {
          const on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
                    className="relative px-3 py-2 rounded-xl text-left transition-colors"
                    style={{
                      background: on ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${on ? 'rgba(255,255,255,0.16)' : 'var(--border)'}`,
                    }}>
              {on && (
                <motion.span layoutId="refund-tab" className="absolute inset-0 rounded-xl"
                             style={{ background: 'rgba(100,210,255,0.10)', border: '1px solid rgba(100,210,255,0.35)' }} />
              )}
              <span className="relative flex items-center gap-1.5">
                <t.Icon size={12} style={{ color: on ? '#64d2ff' : 'var(--dimtext)' }} />
                <span className="text-[12px] font-semibold" style={{ color: on ? '#64d2ff' : 'var(--text)' }}>
                  {t.label}
                </span>
              </span>
              <span className="relative block text-[9.5px] text-dimtext mt-0.5">{t.sub}</span>
            </button>
          );
        })}
      </div>

      <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}>
        {tab === 'money'  && <IspeedRefunds />}
        {tab === 'before' && <RefundPipeline />}
        {tab === 'after'  && <RefundDesk />}
      </motion.div>
    </div>
  );
}
