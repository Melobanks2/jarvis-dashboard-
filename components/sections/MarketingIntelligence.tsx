'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Target, TrendingUp, MapPin, Receipt, Sparkles } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
} from 'recharts';
import { GlassCard } from '@/components/ui/GlassCard';
import { RoadTo100K } from '@/components/sections/RoadTo100K';
import { MarketingSplit } from '@/components/sections/MarketingSplit';
import { SpeedToLead } from '@/components/sections/SpeedToLead';
import { LeadQuality } from '@/components/sections/LeadQuality';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { usePipeline, Lead } from '@/lib/hooks/usePipeline';
import { useApp } from '@/lib/AppContext';

// All metrics are computed client-side from the live pipeline. The old
// /api/marketing endpoint read a `marketing_metrics` table that has 0 rows —
// the real marketing ledger is the pipeline itself: iSpeed purchasePrice IS
// the ad spend, and source/temp/stage carry the funnel.
const AVG_FEE = 8500; // expected assignment fee — keep in sync with GoalsVision

const C = { blue: '#0a84ff', pos: '#30d158', urg: '#ff453a', warn: '#ff9f0a', purple: '#bf5af2', cyan: '#64d2ff' };
const NUM = 'font-orbitron font-semibold';

const SOURCE_META: Record<string, { label: string; color: string; paid: boolean }> = {
  alpha:  { label: 'Alpha',  color: C.blue,   paid: false },
  ispeed: { label: 'iSpeed', color: C.warn,   paid: true },
  sarah:  { label: 'Sarah',  color: C.purple, paid: false },
  va:     { label: 'VA',     color: C.cyan,   paid: false },
};

const DEAL_STAGES = new Set(['Decision Pending', 'Contract Sent', 'Under Contract', 'Closed']);
const REFUND_EXCLUDE = new Set(['Refund Requested', 'Refund Approved', 'Under Contract', 'Contract Sent', 'Closed', 'Disposition']);

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const fmtK = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);
const sumPP = (ls: Lead[]) => ls.reduce((a, l) => a + (l.purchasePrice || 0), 0);
const qualified = (ls: Lead[]) => ls.filter(l => l.temp === 'hot' || l.temp === 'warm');

// "3882 Cardinal Blvd, Port Orange, FL 32127" → "Port Orange"
function cityOf(l: Lead): string | null {
  const parts = (l.address || '').split(',').map(s => s.trim());
  if (parts.length < 2) return null;
  let city = parts[1].replace(/\s+FL$/i, '').trim();
  if (!/^[A-Za-z][A-Za-z .'-]{2,}$/.test(city)) return null;
  if (/^(fl|apt|suite|ste|unit|lot)\b/i.test(city)) return null;
  return city.toLowerCase().replace(/(^|[\s.'-])[a-z]/g, ch => ch.toUpperCase());
}

export function MarketingIntelligence() {
  const { refreshKey } = useApp();
  const { data, loading, error } = usePipeline(refreshKey);
  const [view, setView] = useState<'live' | 'economics' | 'model'>('live');
  const leads = useMemo(() => data?.leads ?? [], [data]);

  const m = useMemo(() => {
    const bySource: Record<string, Lead[]> = {};
    for (const l of leads) (bySource[l.source] ||= []).push(l);

    const ispeed = bySource['ispeed'] ?? [];
    const spend = sumPP(ispeed);
    const deals = leads.filter(l => DEAL_STAGES.has(l.stage));
    const qualAll = qualified(leads);

    const recoverable = ispeed.filter(l => l.daysUntilDeadline != null && l.daysUntilDeadline >= 0 && !REFUND_EXCLUDE.has(l.stage));
    const expired     = ispeed.filter(l => l.daysUntilDeadline != null && l.daysUntilDeadline < 0 && !REFUND_EXCLUDE.has(l.stage));
    const inRecovery  = ispeed.filter(l => l.stage === 'Refund Requested' || l.stage === 'Refund Approved');

    // Source scorecards
    const sources = Object.entries(SOURCE_META)
      .map(([key, meta]) => {
        const ls = bySource[key] ?? [];
        const q = qualified(ls);
        const d = ls.filter(l => DEAL_STAGES.has(l.stage));
        const sSpend = meta.paid ? sumPP(ls) : 0;
        return {
          key, ...meta,
          leads: ls.length,
          qual: q.length,
          qualRate: ls.length ? Math.round((q.length / ls.length) * 100) : 0,
          deals: d.length,
          spend: sSpend,
          costPerQual: q.length && sSpend ? sSpend / q.length : null,
        };
      })
      .filter(s => s.leads > 0)
      .sort((a, b) => b.leads - a.leads);

    // Weekly lead flow, last 8 weeks, stacked by source
    const weeks: { label: string; start: number; end: number }[] = [];
    const today = new Date();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    for (let i = 7; i >= 0; i--) {
      const s0 = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * i);
      const e0 = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() + 7);
      weeks.push({ label: `${s0.getMonth() + 1}/${s0.getDate()}`, start: s0.getTime(), end: e0.getTime() });
    }
    const flow = weeks.map(w => {
      const row: Record<string, number | string> = { week: w.label };
      for (const key of Object.keys(SOURCE_META)) row[key] = 0;
      for (const l of leads) {
        const t = l.createdAt ? new Date(l.createdAt).getTime() : NaN;
        if (t >= w.start && t < w.end && SOURCE_META[l.source]) {
          row[l.source] = (row[l.source] as number) + 1;
        }
      }
      return row;
    });

    // Top cities by qualified interest
    const cityMap: Record<string, { total: number; qual: number }> = {};
    for (const l of leads) {
      const city = cityOf(l);
      if (!city) continue;
      const e = (cityMap[city] ||= { total: 0, qual: 0 });
      e.total++;
      if (l.temp === 'hot' || l.temp === 'warm') e.qual++;
    }
    const cities = Object.entries(cityMap)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qual - a.qual || b.total - a.total)
      .slice(0, 6);

    const projected = deals.length * AVG_FEE;
    return {
      spend, deals, qualAll, sources, flow, cities,
      recoverable, expired, inRecovery,
      recoverableSum: sumPP(recoverable), expiredSum: sumPP(expired), inRecoverySum: sumPP(inRecovery),
      costPerLead: spend > 0 && ispeed.length ? spend / ispeed.length : null,
      costPerQual: spend > 0 && qualified(ispeed).length ? spend / qualified(ispeed).length : null,
      projected,
      roiX: spend > 0 ? projected / spend : null,
    };
  }, [leads]);

  if (error) {
    return <div className="flex items-center justify-center h-64 text-[13px]" style={{ color: C.urg }}>Pipeline offline — {error}</div>;
  }
  if (loading && !data) {
    return <div className="flex items-center justify-center h-64 text-[13px] text-dimtext">Reading the pipeline…</div>;
  }

  const maxCityQual = Math.max(1, ...m.cities.map(c => c.qual));

  const segBtn = (key: 'live' | 'economics' | 'model', label: string) => (
    <button onClick={() => setView(key)}
      className={`tap rounded-lg px-4 py-1.5 text-[13px] transition-colors ${view === key ? 'text-textb bg-white/[0.13]' : 'text-jtext hover:text-textb'}`}
      style={view === key ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 3px rgba(0,0,0,0.3)' } : undefined}>
      {label}
    </button>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">

      {/* View switch: live numbers vs the interactive $100K planning model */}
      <div className="flex items-center">
        <div className="inline-flex gap-0.5 rounded-xl border border-border p-1 bg-white/[0.06]">
          {segBtn('live', 'Live performance')}
          {segBtn('economics', 'Lead economics')}
          {segBtn('model', 'Road to $100K')}
        </div>
        {view === 'model' && <span className="ml-3 text-[12px] text-dimtext">Planning model · your dials save automatically</span>}
        {view === 'economics' && <span className="ml-3 text-[12px] text-dimtext">What each place you buy leads from actually returns</span>}
      </div>

      {view === 'model' ? (
        <RoadTo100K live={{ cplRaw: m.costPerLead, cpq: m.costPerQual, dealsInPlay: m.deals.length }} />
      ) : view === 'economics' ? (
        <div className="flex flex-col gap-5">
          <SpeedToLead />
          <MarketingSplit />
          <LeadQuality />
        </div>
      ) : (
      <>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <Kpi icon={<DollarSign size={14} />} color={C.warn} label="Ad spend · iSpeed">
          <AnimatedCounter target={m.spend} prefix="$" className={`${NUM} text-[30px] leading-none`} style={{ color: C.warn } as React.CSSProperties} />
          <div className="text-[12px] mt-1.5" style={{ color: C.pos }}>{money(m.recoverableSum)} still refundable</div>
        </Kpi>
        <Kpi icon={<Target size={14} />} color={C.blue} label="Cost per qualified">
          <span className={`${NUM} text-[30px] leading-none`} style={{ color: C.blue }}>{m.costPerQual != null ? fmtK(m.costPerQual) : '—'}</span>
          <div className="text-[12px] text-dimtext mt-1.5">{m.costPerLead != null ? `${fmtK(m.costPerLead)} per raw lead` : 'no paid leads yet'} · Alpha is free</div>
        </Kpi>
        <Kpi icon={<TrendingUp size={14} />} color={C.pos} label="Pipeline value">
          <AnimatedCounter target={m.projected} prefix="$" className={`${NUM} text-[30px] leading-none`} style={{ color: C.pos } as React.CSSProperties} />
          <div className="text-[12px] text-dimtext mt-1.5">{m.deals.length} deals × {money(AVG_FEE)} avg fee</div>
        </Kpi>
        <Kpi icon={<Sparkles size={14} />} color={C.purple} label="Return on spend">
          <span className={`${NUM} text-[30px] leading-none`} style={{ color: m.roiX == null ? 'rgba(235,235,245,0.35)' : m.roiX >= 1 ? C.pos : C.urg }}>
            {m.roiX == null ? '—' : `${m.roiX.toFixed(1)}×`}
          </span>
          <div className="text-[12px] text-dimtext mt-1.5">projected pipeline ÷ paid spend</div>
        </Kpi>
      </div>

      {/* Source scorecards */}
      <GlassCard>
        <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb mb-4">Where leads come from</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {m.sources.map(s => (
            <div key={s.key} className="rounded-2xl border border-border p-4 bg-bg2" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="text-[13px] font-medium text-textb">{s.label}</span>
                <span className="ml-auto text-[11px] rounded-full px-2 py-0.5"
                  style={{ background: s.paid ? `${C.warn}1a` : `${C.pos}1a`, color: s.paid ? C.warn : C.pos }}>
                  {s.paid ? 'paid' : 'free'}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`${NUM} text-[26px] leading-none text-textb`}>{s.leads}</span>
                <span className="text-[12px] text-dimtext">leads</span>
              </div>
              <div className="flex items-center justify-between text-[12px] mt-2.5 mb-1">
                <span className="text-jtext">{s.qual} qualified</span>
                <span style={{ color: s.color }}>{s.qualRate}%</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: `${s.color}18` }}>
                <motion.div className="h-full rounded-full" style={{ background: s.color }}
                  initial={{ width: 0 }} animate={{ width: `${s.qualRate}%` }}
                  transition={{ type: 'spring', stiffness: 90, damping: 24 }} />
              </div>
              <div className="text-[12px] text-dimtext mt-2.5">
                {s.deals} deal{s.deals === 1 ? '' : 's'} in play
                {s.paid && s.costPerQual != null && <> · {fmtK(s.costPerQual)}/qualified</>}
                {s.paid && <> · {money(s.spend)} spent</>}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Weekly lead flow */}
        <GlassCard>
          <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb mb-1">Lead flow</p>
          <p className="text-[12px] text-dimtext mb-4">New leads per week by source · last 8 weeks</p>
          <div className="h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={m.flow} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <XAxis dataKey="week" tick={{ fill: 'rgba(235,235,245,0.35)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(235,235,245,0.35)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{ background: 'rgba(16,20,30,0.95)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, fontSize: 12, color: '#f5f5f7' }} />
                {Object.entries(SOURCE_META).map(([key, meta]) => (
                  <Bar key={key} dataKey={key} stackId="flow" fill={meta.color} name={meta.label} radius={key === 'va' ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-2">
            {Object.values(SOURCE_META).map(meta => (
              <span key={meta.label} className="flex items-center gap-1.5 text-[11px] text-dimtext">
                <span className="w-2 h-2 rounded-full" style={{ background: meta.color }} />{meta.label}
              </span>
            ))}
          </div>
        </GlassCard>

        {/* Top cities */}
        <GlassCard>
          <div className="flex items-center gap-2 mb-1">
            <MapPin size={14} style={{ color: C.blue }} />
            <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb">Where the sellers are</p>
          </div>
          <p className="text-[12px] text-dimtext mb-4">Cities ranked by hot + warm interest</p>
          <div className="flex flex-col gap-2.5">
            {m.cities.map(c => (
              <div key={c.name} className="flex items-center gap-3">
                <span className="text-[13px] text-textb font-medium w-32 truncate">{c.name}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: `${C.blue}14` }}>
                  <motion.div className="h-full rounded-full" style={{ background: C.blue }}
                    initial={{ width: 0 }} animate={{ width: `${(c.qual / maxCityQual) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 90, damping: 24 }} />
                </div>
                <span className={`${NUM} text-[14px] w-8 text-right`} style={{ color: C.blue }}>{c.qual}</span>
                <span className="text-[11px] text-dimtext w-14">of {c.total}</span>
              </div>
            ))}
            {m.cities.length === 0 && <div className="text-[13px] text-dimtext py-6 text-center">No city data on leads yet</div>}
          </div>
        </GlassCard>
      </div>

      {/* Refund economics */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <Receipt size={14} style={{ color: C.warn }} />
          <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb">iSpeed refund economics</p>
          <span className="ml-auto text-[12px] text-dimtext">every dollar here was already spent</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <RefundStat color={C.pos} label="Recoverable now" value={m.recoverableSum} sub={`${m.recoverable.length} leads inside the window`} />
          <RefundStat color={C.blue} label="In recovery" value={m.inRecoverySum} sub={`${m.inRecovery.length} refunds requested or approved`} />
          <RefundStat color={C.urg} label="Lost to the clock" value={m.expiredSum} sub={`${m.expired.length} leads expired unworked`} />
        </div>
      </GlassCard>
      </>
      )}
    </motion.div>
  );
}

function Kpi({ icon, color, label, children }: { icon: React.ReactNode; color: string; label: string; children: React.ReactNode }) {
  return (
    <GlassCard padding="p-5">
      <div className="flex items-center gap-2 mb-2.5" style={{ color }}>
        {icon}
        <span className="text-[13px] text-jtext">{label}</span>
      </div>
      {children}
    </GlassCard>
  );
}

function RefundStat({ color, label, value, sub }: { color: string; label: string; value: number; sub: string }) {
  return (
    <div className="rounded-2xl border border-border p-4 bg-bg2" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
      <div className="text-[12px] text-dimtext mb-1.5">{label}</div>
      <div className={`${NUM} text-[24px] leading-none`} style={{ color }}>{money(value)}</div>
      <div className="text-[12px] text-dimtext mt-1.5">{sub}</div>
    </div>
  );
}
