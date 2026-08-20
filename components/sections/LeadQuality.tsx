'use client';

/**
 * Lead Quality — which attributes on a purchased lead actually predict a deal.
 *
 * Every iSpeed lead arrives already described: motivation, timeline, property
 * condition, and iSpeed's own letter grade. The question worth answering
 * before spending more money is which of those descriptions is worth paying
 * attention to — including whether the vendor's own grade predicts anything.
 *
 * The honesty problem here is severe and is why the component is built the way
 * it is. With ~99 purchased leads and ~11 that became real pipeline, almost
 * every cut of the data is too small to trust: a single seller answering moves
 * a bucket by ten points. So every row shows its n, rows under a floor are
 * hidden entirely, and any rate computed on fewer than 10 leads is rendered as
 * a muted hint rather than a number to act on.
 */

import { useMemo } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead } from '@/lib/hooks/useLeads';
import { isQualified, isRefund } from '@/lib/leadStages';

const MIN_ROW = 4;      // below this a row is not shown at all
const TRUST   = 10;     // below this a percentage is a hint, not a finding

interface Cut { key: string; n: number; spend: number; qualified: number; refunds: number }

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function cutBy(leads: Lead[], pick: (l: Lead) => string): Cut[] {
  const g = new Map<string, Cut>();
  for (const l of leads) {
    const key = (pick(l) || '').trim();
    if (!key || key === 'null' || key === 'undefined') continue;
    const c = g.get(key) || { key, n: 0, spend: 0, qualified: 0, refunds: 0 };
    c.n += 1;
    c.spend += Number(l.purchasePrice) || 0;
    if (isQualified(l.stageName)) c.qualified += 1;
    if (isRefund(l.stageName))    c.refunds += 1;
    g.set(key, c);
  }
  return Array.from(g.values()).filter(c => c.n >= MIN_ROW).sort((a, b) => b.n - a.n);
}

export function LeadQuality() {
  const { refreshKey } = useApp();
  const { leads, loading, error } = useLeads(refreshKey);

  const paid = useMemo(() => leads.filter(l => l.source === 'ispeed'), [leads]);

  const cuts = useMemo(() => ([
    { title: 'iSpeed’s own grade', note: 'does the letter they sell you predict anything?',
      rows: cutBy(paid, l => String(l.predictorGrade || '')) },
    { title: 'Timeline', note: 'how soon they said they want to sell',
      rows: cutBy(paid, l => String(l.timeline || '')) },
    { title: 'Motivation', note: 'why they are selling',
      rows: cutBy(paid, l => String(l.pain || '')) },
    { title: 'Property condition', note: 'what shape the house is in',
      rows: cutBy(paid, l => String(l.condition || '')) },
    { title: 'Did they name a price?', note: 'whether an asking price came with the lead',
      rows: cutBy(paid, l => (l.askingPrice ? 'Gave a price' : 'No price given')) },
  ]), [paid]);

  if (loading) return <div className="text-[12px] text-dimtext p-4">Loading lead quality…</div>;
  if (error)   return <div className="text-[12px] p-4" style={{ color: '#ff453a' }}>{error}</div>;

  const totalQual = paid.filter(l => isQualified(l.stageName)).length;

  return (
    <div className="space-y-4">
      <GlassCard accent="orange" padding="p-4" hover={false}>
        <div className="text-[13px] font-semibold text-textb mb-1">What kind of lead turns into a deal</div>
        <div className="text-[11px] text-jtext leading-relaxed">
          Across {paid.length} purchased leads, {totalQual} became real pipeline. That is the number every
          percentage below is built on, and it is small — treat these as directions to test, not conclusions.
          Rows with fewer than {MIN_ROW} leads are hidden; rates under {TRUST} leads are dimmed.
        </div>
      </GlassCard>

      {cuts.map(c => c.rows.length > 0 && (
        <div key={c.title} className="rounded-[18px] border border-border overflow-hidden"
             style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="px-3.5 py-2.5 border-b border-border">
            <div className="text-[12.5px] font-semibold text-textb">{c.title}</div>
            <div className="text-[10px] text-dimtext mt-0.5">{c.note}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr className="text-dimtext text-[9px] uppercase tracking-[0.5px]">
                  <th className="text-left font-semibold px-3 py-1.5">Value</th>
                  <th className="text-right font-semibold px-2 py-1.5">Leads</th>
                  <th className="text-right font-semibold px-2 py-1.5">Spend</th>
                  <th className="text-right font-semibold px-2 py-1.5">Became a deal</th>
                  <th className="text-right font-semibold px-3 py-1.5">Refunded</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map(r => {
                  const q = pct(r.qualified, r.n), rf = pct(r.refunds, r.n);
                  const soft = r.n < TRUST;
                  return (
                    <tr key={r.key} className="border-t border-border">
                      <td className="px-3 py-1.5 text-textb">{r.key}</td>
                      <td className="px-2 py-1.5 text-right text-jtext">{r.n}</td>
                      <td className="px-2 py-1.5 text-right text-dimtext">{money(r.spend)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold"
                          style={{ color: soft ? 'var(--dimtext)' : q >= 15 ? '#30d158' : q > 0 ? '#ff9f0a' : '#ff453a' }}>
                        {r.qualified} <span className="font-normal opacity-70">({q}%)</span>
                      </td>
                      <td className="px-3 py-1.5 text-right"
                          style={{ color: soft ? 'var(--dimtext)' : rf >= 40 ? '#ff453a' : rf >= 25 ? '#ff9f0a' : 'var(--dimtext)' }}>
                        {r.refunds} <span className="opacity-70">({rf}%)</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="rounded-[18px] border border-border p-3.5 text-[11px] text-dimtext leading-relaxed"
           style={{ background: 'rgba(255,255,255,0.03)' }}>
        <b className="text-jtext">Two things you asked for that the data cannot answer yet.</b><br />
        <span className="text-jtext">How long the lead existed before you bought it</span> — the CRM record is
        created at purchase, so there is no earlier timestamp to measure from. iSpeed would have to send a
        lead-created date.<br />
        <span className="text-jtext">How many other buyers got the same lead</span> — not sent either. The
        closest proxy on file is the tier: exclusive means only you, coupon means shared. That comparison
        lives in the Marketing tables.
      </div>
    </div>
  );
}
