'use client';

/**
 * Contact Board — purchased leads that have not answered yet.
 *
 * These are the leads Chris paid for and Sarah has not reached. Two clocks run
 * on every one of them at the same time, and the whole point of this board is
 * to show both at once:
 *
 *   attempts   — how many times Sarah has tried
 *   refund     — 21 days from purchase, then the money is gone for good
 *
 * Neither clock is useful alone. A lead on attempt 5 is worth refunding only
 * while the window is open; a lead with 18 days left is worth calling, not
 * refunding. Deal Flow groups by CRM stage and the Refund Pipeline tracks the
 * money — this is the working view that joins them and says what to do next.
 *
 * Paid leads are dialed ONE at a time on a single line (five lanes is Scout's
 * shape, for cold lists), so the call button here dials exactly one seller.
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Phone, MapPin, Receipt, AlertTriangle, Loader2, PhoneOutgoing } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead, Source, LEADS_API } from '@/lib/hooks/useLeads';
import { PropertyThumb } from '@/components/ui/PropertyPhotos';

const WINDOW_DAYS = 21;

/** Attempts live in the CRM stage name ("📞Attempt 3-5 🔕=No contact"). */
function attemptsOf(stageName: string): number {
  const s = String(stageName || '').toLowerCase();
  if (s.includes('unresponsive') || /attempt\s*6/.test(s)) return 6;
  const m = /attempt\s*(\d)/.exec(s);
  if (m) return Number(m[1]);
  return 0;
}

/** A lead only belongs here while it is unreached and still workable. */
function unreached(stageName: string): boolean {
  const s = String(stageName || '').toLowerCase();
  if (s.includes('refund')) return false;                       // already filed
  if (/hot|warm|cold|decision|contract|closed|dispostion|disposition|signed with someone|replied/.test(s))
    return false;                                               // reached
  if (s.includes('dead')) return false;
  return /new|attempt|unresponsive/.test(s);
}

type Verdict = 'call' | 'refund' | 'lost';

/**
 * What to do with this lead.
 *
 * "Refund" needs BOTH a real effort made and time left on the clock. Filing on
 * a lead Sarah has barely tried is leaving a deal on the table; filing after
 * day 21 is not possible at all.
 */
function verdictFor(l: Lead): { v: Verdict; why: string } {
  const days = typeof l.daysUntilDeadline === 'number' ? l.daysUntilDeadline : null;
  const a = attemptsOf(l.stageName);
  if (days === null) return { v: 'call', why: 'no purchase record' };
  if (days < 0)      return { v: 'lost', why: `window closed ${Math.abs(days)}d ago` };
  if (a >= 4)        return { v: 'refund', why: `${a} attempts, ${days}d left to file` };
  return { v: 'call', why: a === 0 ? 'never called' : `${a} attempt${a === 1 ? '' : 's'}, ${days}d left` };
}

const VERDICT_STYLE: Record<Verdict, { label: string; color: string; bg: string }> = {
  call:   { label: 'call again', color: '#64d2ff', bg: 'rgba(100,210,255,0.15)' },
  refund: { label: 'file refund', color: '#ff453a', bg: 'rgba(255,69,58,0.16)' },
  lost:   { label: 'expired',     color: '#8a8ab0', bg: 'rgba(255,255,255,0.06)' },
};

const LANES: { id: Source | 'all'; label: string }[] = [
  { id: 'ispeed', label: 'iSpeed' },
  { id: 'alpha',  label: 'Property' },
  { id: 'all',    label: 'All paid' },
];

export function ContactBoard() {
  const { refreshKey, refresh } = useApp();
  const { leads, loading, error } = useLeads(refreshKey);
  const [lane, setLane] = useState<Source | 'all'>('ispeed');

  const rows = useMemo(() => {
    return leads
      .filter(l => (lane === 'all' ? l.source !== 'sarah' : l.source === lane))
      .filter(l => unreached(l.stageName))
      .map(l => ({ lead: l, attempts: attemptsOf(l.stageName), ...verdictFor(l) }))
      .sort((a, b) => {
        const rank = { refund: 0, call: 1, lost: 2 } as const;
        if (rank[a.v] !== rank[b.v]) return rank[a.v] - rank[b.v];
        const ad = a.lead.daysUntilDeadline ?? 999, bd = b.lead.daysUntilDeadline ?? 999;
        return ad - bd;                       // soonest deadline first
      });
  }, [leads, lane]);

  const byGroup = useMemo(() => {
    const g: Record<number, typeof rows> = {};
    for (const r of rows) (g[r.attempts] ||= []).push(r);
    return g;
  }, [rows]);

  if (loading) return <div className="text-[12px] text-dimtext p-4">Loading the contact board…</div>;
  if (error)   return <div className="text-[12px] p-4" style={{ color: '#ff453a' }}>{error}</div>;

  const nRefund = rows.filter(r => r.v === 'refund').length;
  const nCall   = rows.filter(r => r.v === 'call').length;
  const nLost   = rows.filter(r => r.v === 'lost').length;
  const money   = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  const atRisk  = rows.filter(r => r.v === 'refund')
                      .reduce((n, r) => n + (Number(r.lead.purchasePrice) || 0), 0);

  return (
    <div className="space-y-4">
      <GlassCard accent="cyan" padding="p-4" hover={false}>
        <div className="flex flex-wrap gap-4">
          <Stat label="Still worth calling" value={String(nCall)} note="Sarah has not reached them" color="#64d2ff" />
          <Stat label="File a refund" value={String(nRefund)} note={nRefund ? `${money(atRisk)} recoverable` : 'nothing due'} color={nRefund ? '#ff453a' : 'var(--dimtext)'} />
          <Stat label="Expired" value={String(nLost)} note={`past ${WINDOW_DAYS} days`} color="var(--dimtext)" />
        </div>
      </GlassCard>

      <div className="flex flex-wrap gap-1.5">
        {LANES.map(l => {
          const on = lane === l.id;
          return (
            <button key={l.id} onClick={() => setLane(l.id)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
              style={{
                background: on ? 'rgba(10,132,255,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${on ? 'rgba(10,132,255,0.5)' : 'var(--border)'}`,
                color: on ? '#64d2ff' : 'var(--text)',
              }}>{l.label}</button>
          );
        })}
      </div>

      {rows.length === 0 && (
        <div className="text-[12px] text-dimtext p-6 text-center rounded-xl"
             style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
          No unreached purchased leads in this lane.
        </div>
      )}

      {Object.keys(byGroup).map(Number).sort((a, b) => b - a).map(n => (
        <div key={n}>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[11px] font-semibold text-textb">
              {n === 0 ? 'Never called' : n >= 6 ? '6+ attempts' : `${n} attempt${n === 1 ? '' : 's'}`}
            </span>
            <span className="text-[10px] text-dimtext tabular-nums">{byGroup[n].length}</span>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }}>
            {byGroup[n].map(r => <Row key={r.lead.id} row={r} onDialed={refresh} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ row, onDialed }: {
  row: { lead: Lead; attempts: number; v: Verdict; why: string }; onDialed: () => void;
}) {
  const { lead, v, why } = row;
  const st = VERDICT_STYLE[v];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);
  const days = lead.daysUntilDeadline;

  async function dial() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${LEADS_API}/call-one`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: lead.name, phone: lead.phone, address: lead.address, pipeline: 'ispeed',
        }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok && j.ok ? 'ringing…' : (j.error || j.reason || 'could not dial'));
      if (r.ok && j.ok) setTimeout(onDialed, 4000);
    } catch { setMsg('dialer unreachable'); }
    setBusy(false);
  }

  return (
    <div className="rounded-xl p-2.5 flex gap-2.5"
         style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid var(--border)' }}>
      <PropertyThumb phone={lead.phone} address={lead.address} size={40} radius={7} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-textb truncate">{lead.name}</span>
          <span className="ml-auto text-[8.5px] font-semibold uppercase tracking-[0.3px] px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ background: st.bg, color: st.color }}>{st.label}</span>
        </div>

        {lead.address && (
          <div className="text-[9.5px] text-dimtext truncate flex items-center gap-1 mt-0.5">
            <MapPin size={8} className="flex-shrink-0" />{lead.address}
          </div>
        )}

        <div className="flex items-center gap-2 mt-1 text-[9.5px] text-dimtext tabular-nums flex-wrap">
          {lead.provider && <span className="truncate max-w-[110px]">{lead.provider}</span>}
          {lead.purchasePrice != null && <span>${Number(lead.purchasePrice)}</span>}
          {typeof days === 'number' && (
            <span style={{ color: days < 0 ? 'var(--dimtext)' : days <= 7 ? '#ff453a' : '#ff9f0a' }}>
              {days < 0 ? `${Math.abs(days)}d past` : `${days}d left`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[9.5px] text-dimtext truncate flex-1">{why}</span>
          {v !== 'lost' && lead.phone && (
            <button onClick={dial} disabled={busy}
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg flex-shrink-0 transition-colors disabled:opacity-50"
              style={{ background: 'rgba(48,209,88,0.15)', color: '#30d158', border: '1px solid rgba(48,209,88,0.3)' }}>
              {busy ? <Loader2 size={10} className="animate-spin" /> : <PhoneOutgoing size={10} />}
              {busy ? 'dialing' : 'call'}
            </button>
          )}
        </div>
        {msg && <div className="text-[9px] mt-1" style={{ color: msg === 'ringing…' ? '#30d158' : '#ff9f0a' }}>{msg}</div>}
      </div>
    </div>
  );
}

function Stat({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  return (
    <div className="min-w-[120px]">
      <div className="text-[9px] uppercase tracking-[0.5px] text-dimtext">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums leading-tight" style={{ color }}>{value}</div>
      <div className="text-[9.5px] text-dimtext">{note}</div>
    </div>
  );
}
