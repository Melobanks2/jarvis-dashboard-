'use client';

/**
 * Marketing — what each place you buy leads from actually returns.
 *
 * Cost per lead is the number vendors sell on and it is the wrong one. What
 * matters is cost per QUALIFIED lead: a $19 lead that turns into a hot seller
 * beats a $125 lead that never picks up. On the live data those two prices
 * belong to leads from the same marketplace, and the expensive tier performs
 * worse — which is invisible until it is divided out this way.
 *
 * Three ways to slice, because they answer different questions:
 *   Tier     — is exclusive worth the premium over coupon?
 *   Channel  — which ad source (Facebook, Google Ads, verified calls) converts?
 *   Provider — which individual seller of leads is sending junk?
 */

import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead } from '@/lib/hooks/useLeads';
import { wasReached, isQualified, isRefund } from '@/lib/leadStages';

type Slice = 'purchaseTier' | 'leadSource' | 'provider';

const SLICES: { id: Slice; label: string; q: string }[] = [
  { id: 'purchaseTier', label: 'Tier',     q: 'Is exclusive worth the premium?' },
  { id: 'leadSource',   label: 'Channel',  q: 'Which ad source converts?' },
  { id: 'provider',     label: 'Provider', q: 'Who is sending junk?' },
];

interface Row {
  key: string; n: number; spend: number;
  reached: number; qualified: number; refunds: number;
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function MarketingSplit() {
  const { refreshKey } = useApp();
  const { leads, loading, error } = useLeads(refreshKey);
  const [slice, setSlice] = useState<Slice>('purchaseTier');

  const rows = useMemo<Row[]>(() => {
    const g = new Map<string, Row>();
    for (const l of leads) {
      const raw = (l as unknown as Record<string, unknown>)[slice];
      const key = String(raw ?? '').trim();
      if (!key || key === 'null' || key === 'undefined') continue;   // unpaid / not tracked
      const r = g.get(key) || { key, n: 0, spend: 0, reached: 0, qualified: 0, refunds: 0 };
      r.n += 1;
      r.spend += Number(l.purchasePrice) || 0;
      if (wasReached(l.stageName))  r.reached += 1;
      if (isQualified(l.stageName)) r.qualified += 1;
      if (isRefund(l.stageName))    r.refunds += 1;
      g.set(key, r);
    }
    return Array.from(g.values())
      .filter(r => r.n >= 3)                       // 1–2 leads is not a signal
      .sort((a, b) => b.spend - a.spend);
  }, [leads, slice]);

  if (loading) return <div className="text-[12px] text-dimtext p-4">Loading marketing…</div>;
  if (error)   return <div className="text-[12px] p-4" style={{ color: '#ff453a' }}>{error}</div>;

  const totalSpend = rows.reduce((n, r) => n + r.spend, 0);
  const totalQual  = rows.reduce((n, r) => n + r.qualified, 0);
  const worst = rows.slice().filter(r => r.n >= 4)
    .sort((a, b) => pct(b.refunds, b.n) - pct(a.refunds, a.n))[0];
  const best = rows.slice().filter(r => r.qualified > 0)
    .sort((a, b) => (a.spend / a.qualified) - (b.spend / b.qualified))[0];

  return (
    <div className="space-y-4">
      <GlassCard accent="purple" padding="p-4" hover={false}>
        <div className="flex flex-wrap gap-4">
          <Stat label="Spent on leads" value={money(totalSpend)} note={`${rows.reduce((n, r) => n + r.n, 0)} leads`} color="#f5f5f7" />
          <Stat label="Became real pipeline" value={String(totalQual)} note="hot or further" color={totalQual ? '#30d158' : '#ff453a'} />
          <Stat label="Cost per qualified lead" value={totalQual ? money(totalSpend / totalQual) : '—'}
                note="what a seller actually costs" color="#bf5af2" />
        </div>
        {best && (
          <div className="mt-3 pt-3 border-t border-border text-[11.5px] text-jtext">
            Best value right now: <b className="text-textb">{best.key}</b> at {money(best.spend / best.qualified)} per
            qualified lead{worst && worst.key !== best.key && (
              <> · Worst: <b className="text-textb">{worst.key}</b> with {pct(worst.refunds, worst.n)}% refund rate</>
            )}.
          </div>
        )}
      </GlassCard>

      <div className="flex flex-wrap gap-1.5">
        {SLICES.map(s => {
          const on = slice === s.id;
          return (
            <button key={s.id} onClick={() => setSlice(s.id)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
              style={{
                background: on ? 'rgba(191,90,242,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${on ? 'rgba(191,90,242,0.5)' : 'var(--border)'}`,
                color: on ? '#bf5af2' : 'var(--text)',
              }}>{s.label}</button>
          );
        })}
        <span className="text-[10.5px] text-dimtext self-center ml-1">
          {SLICES.find(s => s.id === slice)?.q}
        </span>
      </div>

      <div className="rounded-[18px] border border-border overflow-hidden"
           style={{ background: 'rgba(255,255,255,0.03)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr className="text-dimtext text-[9px] uppercase tracking-[0.5px]">
                <th className="text-left font-semibold px-3 py-2">{SLICES.find(s => s.id === slice)?.label}</th>
                <th className="text-right font-semibold px-2 py-2">Leads</th>
                <th className="text-right font-semibold px-2 py-2">Spend</th>
                <th className="text-right font-semibold px-2 py-2">Per lead</th>
                <th className="text-right font-semibold px-2 py-2">Reached</th>
                <th className="text-right font-semibold px-2 py-2">Qualified</th>
                <th className="text-right font-semibold px-2 py-2">Per qualified</th>
                <th className="text-right font-semibold px-3 py-2">Refunds</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const cpq = r.qualified ? r.spend / r.qualified : null;
                const refundPct = pct(r.refunds, r.n);
                return (
                  <tr key={r.key} className="border-t border-border">
                    <td className="px-3 py-2 text-textb">{r.key}</td>
                    <td className="px-2 py-2 text-right text-jtext">{r.n}</td>
                    <td className="px-2 py-2 text-right text-jtext">{money(r.spend)}</td>
                    <td className="px-2 py-2 text-right text-dimtext">{money(r.spend / r.n)}</td>
                    <td className="px-2 py-2 text-right text-dimtext">{pct(r.reached, r.n)}%</td>
                    <td className="px-2 py-2 text-right" style={{ color: r.qualified ? '#30d158' : 'var(--dimtext)' }}>
                      {r.qualified}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold"
                        style={{ color: cpq == null ? '#ff453a' : cpq > 400 ? '#ff9f0a' : '#30d158' }}>
                      {cpq == null ? 'none' : money(cpq)}
                    </td>
                    <td className="px-3 py-2 text-right"
                        style={{ color: refundPct >= 50 ? '#ff453a' : refundPct >= 25 ? '#ff9f0a' : 'var(--dimtext)' }}>
                      {refundPct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 text-[11px] p-3 rounded-xl"
           style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text)' }}>
        <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" style={{ color: '#ff9f0a' }} />
        <span>
          Anything with fewer than 3 leads is hidden — at that size one seller answering
          the phone swings the whole percentage. Treat rows near the cutoff as a hint, not a verdict.
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  return (
    <div className="min-w-[130px]">
      <div className="text-[9px] uppercase tracking-[0.5px] text-dimtext">{label}</div>
      <div className="text-[21px] font-semibold tabular-nums leading-tight" style={{ color }}>{value}</div>
      <div className="text-[9.5px] text-dimtext">{note}</div>
    </div>
  );
}
