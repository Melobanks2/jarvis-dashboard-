'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Receipt, Clock, Flame, AlertTriangle, CheckCircle2, Loader2, RefreshCw,
} from 'lucide-react';
import { useApp } from '@/lib/AppContext';
import { useIspeedRefunds, SubmittableLead, Disposition } from '@/lib/hooks/useIspeedRefunds';

const money = (n: number) => '$' + Math.round(n).toLocaleString();

// Urgency color by days left in the 21-day window.
function urgency(daysLeft: number) {
  if (daysLeft <= 8)  return { color: '#ff453a', bg: 'rgba(255,69,58,0.12)' };
  if (daysLeft <= 14) return { color: '#ff9f0a', bg: 'rgba(255,159,10,0.14)' };
  return { color: '#30d158', bg: 'rgba(48,209,88,0.12)' };
}

function DispositionTag({ d }: { d: Disposition }) {
  if (d === 'keep') return (
    <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: '#30d158' }}>
      <Flame size={11} /> keep
    </span>
  );
  if (d === 'requested') return (
    <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: '#bf5af2' }}>
      <CheckCircle2 size={11} /> filed
    </span>
  );
  if (d === 'new') return <span className="text-[10px]" style={{ color: '#52526e' }}>work it</span>;
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: '#c4c4d6' }}>
      <Receipt size={11} /> refund
    </span>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[11px] mb-1.5" style={{ color: '#52526e' }}>{label}</div>
      <div className="text-[22px] font-semibold leading-none" style={{ color: color || '#e4e4f0' }}>{value}</div>
      <div className="text-[10px] mt-1.5" style={{ color: '#52526e' }}>{sub}</div>
    </div>
  );
}

function SubmitRow({ l, first }: { l: SubmittableLead; first: boolean }) {
  const u = urgency(l.daysLeft);
  return (
    <div
      className="flex items-center gap-3 px-3.5 py-2.5"
      style={{ borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.05)' }}
    >
      <div
        className="text-center rounded-md py-1.5 text-[12px] font-semibold flex-shrink-0"
        style={{ minWidth: 46, background: u.bg, color: u.color }}
      >
        {l.daysLeft}d
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate" style={{ color: '#e4e4f0' }}>{l.name}</div>
        <div className="text-[10px] truncate" style={{ color: '#52526e' }}>
          {l.city} · {money(l.price)}
        </div>
      </div>
      <div className="hidden sm:block flex-1 min-w-0 text-right text-[11px] truncate" style={{ color: '#8888a0' }}>
        {l.stage.replace(/[^\x20-\x7E]/g, '').trim() || '—'}
      </div>
      <div className="flex-shrink-0 text-right" style={{ minWidth: 56 }}>
        <DispositionTag d={l.disposition} />
      </div>
    </div>
  );
}

export function IspeedRefunds() {
  const { refreshKey } = useApp();
  const { data, loading, error } = useIspeedRefunds(refreshKey);

  const tierBar = useMemo(() => {
    if (!data) return { excl: 0, coup: 0 };
    const t = data.kpis.recoveredByTier;
    const total = t.exclusive + t.coupon || 1;
    return { excl: (t.exclusive / total) * 100, coup: (t.coupon / total) * 100 };
  }, [data]);

  if (loading && !data) return (
    <div className="flex items-center justify-center h-64 gap-2 text-[12px]" style={{ color: '#52526e' }}>
      <Loader2 size={14} className="animate-spin" /> Loading refund tracker…
    </div>
  );
  if (error && !data) return (
    <div className="flex items-center justify-center h-64 gap-2 text-[12px]" style={{ color: '#ff453a' }}>
      <AlertTriangle size={14} /> Couldn&apos;t reach the refund feed — {error}
    </div>
  );
  if (!data) return null;

  const k = data.kpis;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Receipt size={16} style={{ color: '#30d158' }} />
        <span className="text-[14px] font-semibold" style={{ color: '#e4e4f0' }}>iSpeed refunds</span>
        <span className="ml-auto flex items-center gap-1 text-[10px]" style={{ color: '#52526e' }}>
          <RefreshCw size={10} /> live · syncs every 5 min
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Recovered"        value={money(k.recovered)}         sub={`${k.recoveredCount} leads back`} color="#30d158" />
        <Kpi label="Open window"      value={String(k.openWindow)}       sub="submittable now" />
        <Kpi label="Closing ≤8 days"  value={String(k.closingSoon)}      sub="act first" color={k.closingSoon ? '#ff453a' : '#e4e4f0'} />
        <Kpi label="Expired unrefunded" value={money(k.expiredUnrefunded)} sub={`${k.expiredCount} missed`} />
      </div>

      {/* Submit-now board */}
      <div>
        <div className="flex items-center gap-1.5 mb-2 text-[11px]" style={{ color: '#8888a0' }}>
          <Clock size={13} /> submit now — sorted by days left
        </div>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(12,12,24,0.6)' }}>
          {data.submittable.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px]" style={{ color: '#52526e' }}>
              Nothing in the window right now — you&apos;re clean.
            </div>
          ) : (
            data.submittable.map((l, i) => <SubmitRow key={`${l.name}-${i}`} l={l} first={i === 0} />)
          )}
        </div>
        <div className="flex flex-wrap gap-4 mt-2.5 text-[10px]" style={{ color: '#52526e' }}>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#ff453a' }} />≤8 days</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#ff9f0a' }} />9–14 days</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#30d158' }} />15+ days</span>
          <span className="ml-auto flex items-center gap-1"><Flame size={11} style={{ color: '#30d158' }} /> keep = you&apos;re working it</span>
        </div>
      </div>

      {/* Recovered by tier + capture rate */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl px-4 py-3.5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[11px] mb-2.5" style={{ color: '#8888a0' }}>Recovered by tier</div>
          <div className="flex h-3.5 rounded-full overflow-hidden mb-2.5" style={{ background: 'rgba(255,255,255,0.10)' }}>
            <div style={{ width: `${tierBar.excl}%`, background: '#0a84ff' }} />
            <div style={{ width: `${tierBar.coup}%`, background: '#ff9f0a' }} />
          </div>
          <div className="flex flex-col gap-1 text-[11px]" style={{ color: '#c4c4d6' }}>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ background: '#0a84ff' }} />
              Exclusive $125 — {money(k.recoveredByTier.exclusive)}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ background: '#ff9f0a' }} />
              Coupon $29 — {money(k.recoveredByTier.coupon)}
            </span>
          </div>
        </div>
        <div className="rounded-xl px-4 py-3.5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[11px] mb-2" style={{ color: '#8888a0' }}>$125 leads — capture rate</div>
          <div className="text-[30px] font-semibold leading-none" style={{ color: '#e4e4f0' }}>{k.captureRatePct}%</div>
          <div className="text-[10px] mt-2" style={{ color: '#52526e' }}>
            {k.exclRefunded} of {k.exclTotal} refunded · {k.exclTotal - k.exclRefunded} slipped past the window
          </div>
        </div>
      </div>

      {/* Refunded + missed lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ListCard title={`Already refunded · ${data.refunded.length}`} icon={<CheckCircle2 size={13} style={{ color: '#30d158' }} />}>
          {data.refunded.map((l, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[11px]" style={{ borderTop: i ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <span className="truncate" style={{ color: '#c4c4d6' }}>{l.name}</span>
              <span className="flex-shrink-0 ml-2" style={{ color: '#30d158' }}>{money(l.price)}</span>
            </div>
          ))}
        </ListCard>
        <ListCard title={`Past window · ${data.missed.length}`} icon={<AlertTriangle size={13} style={{ color: '#ff453a' }} />}>
          {data.missed.slice(0, 12).map((l, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[11px]" style={{ borderTop: i ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <span className="truncate" style={{ color: '#8888a0' }}>{l.name}</span>
              <span className="flex-shrink-0 ml-2" style={{ color: '#52526e' }}>{money(l.price)} · {l.closedDaysAgo}d</span>
            </div>
          ))}
          {data.missed.length > 12 && (
            <div className="px-3 py-1.5 text-[10px]" style={{ color: '#3a3a52' }}>+ {data.missed.length - 12} more</div>
          )}
        </ListCard>
      </div>
    </div>
  );
}

function ListCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.div
      className="rounded-xl overflow-hidden"
      style={{ background: 'rgba(12,12,24,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium" style={{ color: '#c4c4d6', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {icon} {title}
      </div>
      <div className="max-h-[280px] overflow-y-auto py-0.5">{children}</div>
    </motion.div>
  );
}
