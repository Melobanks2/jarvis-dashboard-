'use client';

/**
 * /marketing-intel — Marketing Intelligence.
 *
 * Data comes from the VPS service (marketing-intel.js on :3008, exposed at
 * api.jarviscommandcenter.space/marketing-intel/api/*), NOT a Vercel function —
 * the Vercel project is at its 12 serverless-function cap. The VPS keeps a
 * background-refreshed snapshot of GHL + Supabase, so every request here
 * returns instantly.
 *
 * Channels: 🤖 Sarah Leads (cold dialer) · ⚡ iSpeed To Lead (purchased) ·
 * 📍 Property Leads PPC (locked until launch).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell, CartesianGrid,
  XAxis, YAxis, Tooltip, ComposedChart, Line, Area, Legend,
} from 'recharts';
import {
  Phone, Zap, MapPin, DollarSign, TrendingUp, Flame, Snowflake,
  ThermometerSun, AlertTriangle, RefreshCw, Lock, X, Target,
  Receipt, Clock, BadgeCheck, BadgeX, HelpCircle, Activity,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';

const API_BASE = 'https://api.jarviscommandcenter.space/marketing-intel';
const REVENUE_GOAL = 100000;

// ── formatting ───────────────────────────────────────────────────────────
const fmt$ = (n: number) =>
  '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmt$0 = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString();
const pct = (n: number) => ((Number(n) || 0) * 100).toFixed(1) + '%';
const pct0 = (n: number) => ((Number(n) || 0) * 100).toFixed(0) + '%';
const num = (n: number) => (Number(n) || 0).toLocaleString();

const C = {
  green: '#4ade80', gold: '#fbbf24', red: '#f87171', orange: '#fb923c',
  blue: '#60a5fa', purple: '#a78bfa', cyan: '#67e8f9', dim: '#52526e',
};
const CH = { sarah: C.green, ispeed: C.purple, ppc: C.blue };

const tipStyle = {
  background: '#121320', border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 8, fontSize: 12, fontFamily: 'Inter, sans-serif',
};

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7D' },
  { key: 'mtd', label: 'MTD' },
  { key: 'month', label: '30D' },
  { key: 'all', label: 'All Time' },
];
const SOURCES = [
  { key: 'all', label: 'All Sources', locked: false },
  { key: 'sarah', label: '🤖 Sarah Leads', locked: false },
  { key: 'ispeed', label: '⚡ iSpeed', locked: false },
  { key: 'ppc', label: '📍 Property Leads PPC', locked: true },
];

type Drill = { title: string; query: string } | null;

// ── small building blocks ────────────────────────────────────────────────
function Kpi({ label, value, sub, color, icon: Icon, onClick }: {
  label: string; value: string; sub?: string; color?: string;
  icon?: any; onClick?: () => void;
}) {
  return (
    <GlassCard
      accent="green" hover={!!onClick} padding="p-4"
      className={onClick ? 'cursor-pointer' : ''}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext">{label}</span>
        {Icon && <Icon size={14} style={{ color: color || C.green, opacity: 0.7 }} />}
      </div>
      <div className="text-2xl font-bold font-spacemono leading-none" style={{ color: color || '#e4e4f0' }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-dimtext mt-2">{sub}</div>}
      {onClick && <div className="text-[9px] text-dimtext mt-1 opacity-60">click for leads ›</div>}
    </GlassCard>
  );
}

function Gauge({ value, goal }: { value: number; goal: number }) {
  const p = Math.max(0, Math.min(1, goal ? value / goal : 0));
  const R = 84, CX = 100, CY = 96, SW = 13;
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from), a1 = Math.PI * (1 - to);
    const x0 = CX + R * Math.cos(a0), y0 = CY - R * Math.sin(a0);
    const x1 = CX + R * Math.cos(a1), y1 = CY - R * Math.sin(a1);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const color = p >= 1 ? C.green : p >= 0.5 ? C.gold : p >= 0.25 ? C.orange : C.red;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 104" className="w-full max-w-[260px]">
        <path d={arc(0, 1)} stroke="rgba(255,255,255,0.07)" strokeWidth={SW} fill="none" strokeLinecap="round" />
        {p > 0.005 && (
          <path d={arc(0, p)} stroke={color} strokeWidth={SW} fill="none" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${color}66)` }} />
        )}
        <text x={CX} y={CY - 22} textAnchor="middle" fill="#e4e4f0" fontSize="22" fontWeight="700"
          fontFamily="'Space Mono', monospace">{fmt$0(value)}</text>
        <text x={CX} y={CY - 4} textAnchor="middle" fill="#52526e" fontSize="10"
          fontFamily="Orbitron, monospace" letterSpacing="2">{pct0(p)} OF {fmt$0(REVENUE_GOAL)}</text>
      </svg>
      <div className="text-[10px] text-dimtext font-orbitron tracking-[2px] uppercase -mt-1">
        Monthly revenue goal
      </div>
    </div>
  );
}

function TempTile({ label, value, color, share, onClick }: {
  label: string; value: number; color: string; share: number; onClick?: () => void;
}) {
  return (
    <div
      className={'rounded-sm border p-3 sm:p-4 transition-transform ' + (onClick ? 'cursor-pointer hover:-translate-y-0.5' : '')}
      style={{ borderColor: color + '55', background: `linear-gradient(180deg, ${color}14, transparent)` }}
      onClick={onClick}
    >
      <div className="text-[10px] font-orbitron tracking-[2px] uppercase" style={{ color }}>{label}</div>
      <div className="text-3xl font-bold font-spacemono mt-1" style={{ color }}>{num(value)}</div>
      <div className="text-[10px] text-dimtext mt-1">{pct(share)} of pipeline</div>
    </div>
  );
}

// ── drill-down modal ─────────────────────────────────────────────────────
function DrillModal({ drill, period, onClose }: { drill: Drill; period: string; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!drill) return;
    setRows(null); setErr(null);
    fetch(`${API_BASE}/api/leads?range=${period}&${drill.query}`)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => setRows(d.leads || []))
      .catch(e => setErr(e.message));
  }, [drill, period]);

  if (!drill) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8"
      style={{ background: 'rgba(5,6,12,0.82)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="glass border border-border2 rounded-sm w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-jborder">
          <span className="font-orbitron text-[11px] tracking-[2px] uppercase text-ngreen">{drill.title}</span>
          <button onClick={onClose} className="text-dimtext hover:text-textb"><X size={16} /></button>
        </div>
        <div className="overflow-auto p-3">
          {err && <div className="text-nred text-sm p-4">⚠️ {err}</div>}
          {!rows && !err && <div className="text-dimtext text-sm p-4 animate-pulse">Loading leads…</div>}
          {rows && rows.length === 0 && <div className="text-dimtext text-sm p-4">No leads match this filter in the selected period.</div>}
          {rows && rows.length > 0 && (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-dimtext text-left">
                  <th className="px-2 py-1.5 font-orbitron text-[9px] tracking-wider uppercase">Name</th>
                  <th className="px-2 py-1.5 font-orbitron text-[9px] tracking-wider uppercase hidden sm:table-cell">Address / Summary</th>
                  <th className="px-2 py-1.5 font-orbitron text-[9px] tracking-wider uppercase">Stage</th>
                  <th className="px-2 py-1.5 font-orbitron text-[9px] tracking-wider uppercase">Grade</th>
                  <th className="px-2 py-1.5 font-orbitron text-[9px] tracking-wider uppercase text-right">$</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l: any, i: number) => (
                  <tr key={l.id || i} className="border-t border-jborder text-jtext">
                    <td className="px-2 py-2 font-medium text-textb">{l.name || '—'}<div className="text-[10px] text-dimtext">{l.phone || ''}</div></td>
                    <td className="px-2 py-2 hidden sm:table-cell text-[11px] text-dimtext max-w-[260px] truncate">{l.address || l.summary || '—'}</td>
                    <td className="px-2 py-2 text-[11px]">{l.stage || '—'}</td>
                    <td className="px-2 py-2">{l.grade || '—'}</td>
                    <td className="px-2 py-2 text-right font-spacemono">
                      {l.pricePaid != null ? fmt$0(l.pricePaid) : l.value != null ? fmt$0(l.value) : l.duration != null ? l.duration + 's' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {rows && rows.length > 0 && (
          <div className="px-4 py-2 border-t border-jborder text-[10px] text-dimtext">{rows.length} lead{rows.length === 1 ? '' : 's'}</div>
        )}
      </div>
    </div>
  );
}

// ── grade heatmap ────────────────────────────────────────────────────────
function GradeHeatmap({ heatmap, onDrill }: { heatmap: any; onDrill: (g: string) => void }) {
  const weeks: string[] = heatmap?.weeks || [];
  const rows: any[] = (heatmap?.rows || []).filter((r: any) =>
    r.cells.some((c: any) => c.leads > 0));
  if (!weeks.length || !rows.length) {
    return <div className="text-dimtext text-sm p-6 text-center">No graded leads in this period yet — the matrix builds automatically as leads are dispositioned.</div>;
  }
  const wkLabel = (w: string) => w.slice(5).replace('-', '/');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]" style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
        <thead>
          <tr>
            <th className="text-left text-dimtext font-orbitron text-[9px] tracking-wider uppercase px-2">Grade</th>
            {weeks.map(w => (
              <th key={w} className="text-dimtext font-spacemono text-[9px] px-1 whitespace-nowrap">wk {wkLabel(w)}</th>
            ))}
            <th className="text-dimtext font-orbitron text-[9px] tracking-wider uppercase px-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => {
            const tot = r.cells.reduce((a: any, c: any) => ({ leads: a.leads + c.leads, deals: a.deals + c.deals, hot: a.hot + c.hot }), { leads: 0, deals: 0, hot: 0 });
            const totConv = tot.leads ? tot.deals / tot.leads : 0;
            return (
              <tr key={r.grade}>
                <td className="px-2 py-1 font-bold cursor-pointer hover:text-ngreen text-textb" onClick={() => onDrill(r.grade)}>
                  {r.grade}
                </td>
                {r.cells.map((c: any) => {
                  const intensity = c.leads ? Math.min(1, 0.18 + c.convRate * 2 + c.hotRate * 0.5) : 0;
                  return (
                    <td key={c.week}
                      className="text-center rounded-sm py-2 px-1 font-spacemono"
                      title={`${r.grade} · week of ${c.week}\n${c.leads} leads · ${c.hot} hot · ${c.deals} deals\nconversion ${pct(c.convRate)}`}
                      style={{
                        background: c.leads ? `rgba(74,222,128,${(intensity * 0.5).toFixed(3)})` : 'rgba(255,255,255,0.02)',
                        color: c.leads ? '#e4e4f0' : '#2a2a3e',
                        minWidth: 52,
                      }}>
                      {c.leads ? (c.deals ? pct0(c.convRate) : `${c.leads}↳${c.hot}🔥`) : '·'}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right font-spacemono text-jtext whitespace-nowrap">
                  {tot.leads} · {pct0(totConv)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-[10px] text-dimtext mt-2">
        Cells show <span className="text-jtext">conversion %</span> once a grade-week has deals, otherwise <span className="text-jtext">leads↳hot</span>. Greener = converting better. Hover any cell for detail; click a grade for its leads.
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────
export default function MarketingIntelPage() {
  const [period, setPeriod] = useState('all');
  const [source, setSource] = useState('all');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<Date | null>(null);
  const [drill, setDrill] = useState<Drill>(null);
  const timer = useRef<any>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/api/metrics?range=${period}`)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { if (d.error) throw new Error(d.detail || d.error); setData(d); setErr(null); setLast(new Date()); })
      .catch(e => setErr(e.message));
  }, [period]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 30000);
    return () => clearInterval(timer.current);
  }, [load]);

  const m = data?.master;
  const cold = data?.cold;
  const isp = data?.ispeed;

  const roiBars = useMemo(() => m ? [
    { name: 'Sarah Leads', roi: m.roiByChannel.cold, spend: m.spendByChannel.cold, revenue: m.revenueByChannel.cold, fill: CH.sarah },
    { name: 'iSpeed', roi: m.roiByChannel.ispeed, spend: m.spendByChannel.ispeed, revenue: m.revenueByChannel.ispeed, fill: CH.ispeed },
    { name: 'PPC', roi: 0, spend: 0, revenue: 0, fill: CH.ppc },
  ] : [], [m]);

  const tierDefs = [
    { key: 'exclusive', name: 'EXCLUSIVE', sym: '◆', color: C.green, note: 'Purchased exclusively · refund eligible' },
    { key: 'nonexclusive', name: 'NON-EXCLUSIVE', sym: '◇', color: C.purple, note: 'Shared with other buyers · refund eligible' },
    { key: 'leadpack', name: 'LEAD PACK', sym: '▣', color: C.gold, note: 'Bonus / free balance leads' },
  ];

  const gradeBars = useMemo(() => {
    if (!isp?.byLetter) return [];
    return ['A', 'B', 'C', 'D', 'Ungraded'].map(g => ({
      name: g === 'Ungraded' ? 'N/A' : g,
      grade: g,
      leads: isp.byLetter[g]?.leads || 0,
      costPerLead: isp.byLetter[g]?.avgCost || 0,
      convRate: isp.byLetter[g]?.convRate || 0,
      hot: isp.byLetter[g]?.hot || 0,
    })).filter(d => d.leads > 0);
  }, [isp]);

  const showSarah = source === 'all' || source === 'sarah';
  const showISpeed = source === 'all' || source === 'ispeed';
  const showPpcOnly = source === 'ppc';

  const expiring = (isp?.deadlineAlerts || []).filter((a: any) => !a.expired);
  const expired = (isp?.deadlineAlerts || []).filter((a: any) => a.expired);
  const [showExpired, setShowExpired] = useState(false);

  const coldTempTotal = cold ? cold.hot + cold.warm + cold.cold + cold.dead : 0;
  const ispTempTotal = isp ? isp.hot + isp.warm + isp.cold + isp.dead : 0;

  return (
    <div className="min-h-screen bg-bg text-textb font-sans"
      style={{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),' +
          'linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px),' +
          'radial-gradient(900px 480px at 80% -10%, rgba(74,222,128,.06), transparent 60%)',
        backgroundSize: '42px 42px, 42px 42px, 100% 100%',
      }}>
      <div className="max-w-[1440px] mx-auto px-3 sm:px-5 pt-5 pb-24">

        {/* header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-ngreen animate-blink" style={{ boxShadow: '0 0 12px #4ade80' }} />
            <div>
              <h1 className="font-orbitron font-bold text-lg sm:text-xl tracking-wide m-0">
                MARKETING <span className="text-ngreen glow-green">INTELLIGENCE</span>
              </h1>
              <div className="text-[11px] text-dimtext">Jarvis Command Center · ROI across all lead channels</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-dimtext font-spacemono">
            <RefreshCw size={11} className={err ? 'text-nred' : 'text-ngreen'} />
            {last ? `updated ${last.toLocaleTimeString()}` : 'connecting…'} · auto 30s
          </div>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex rounded-sm border border-border2 overflow-hidden bg-bg2">
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={'px-3 sm:px-4 py-2 text-[12px] font-semibold transition-colors ' +
                  (period === p.key ? 'bg-ngreen text-bg' : 'text-dimtext hover:text-textb')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-6">
          {SOURCES.map(s => (
            <button key={s.key}
              onClick={() => { if (!s.locked) setSource(s.key); else setSource('ppc'); }}
              className={'flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-sm border transition-colors ' +
                (source === s.key
                  ? 'border-ngreen text-ngreen bg-ngreen/10'
                  : 'border-border2 text-dimtext hover:text-textb bg-bg2') +
                (s.locked ? ' opacity-50' : '')}>
              {s.label}
              {s.locked && <span className="text-[8px] font-orbitron tracking-wider border border-border2 rounded-sm px-1.5 py-0.5 ml-1">SOON</span>}
            </button>
          ))}
        </div>

        {err && (
          <div className="border border-nred/60 bg-nred/10 text-nred rounded-sm p-3 mb-4 text-sm font-spacemono">
            ⚠️ {err} — retrying every 30s.
          </div>
        )}
        {!data && !err && (
          <div className="text-center text-dimtext py-24 font-spacemono animate-pulse">
            Aggregating GHL + dialer data…
          </div>
        )}

        {showPpcOnly ? (
          <PpcPlaceholder full />
        ) : data && (
          <>
            {/* ════ MASTER ROI ════ */}
            <SectionTitle accent="green" badge={`range: ${PERIODS.find(p => p.key === period)?.label}`}>
              Master ROI — All Channels
            </SectionTitle>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <Kpi label="Total Spend" value={fmt$(m.totalSpend)} color={C.gold} icon={DollarSign}
                sub={`Sarah ${fmt$(m.spendByChannel.cold)} · iSpeed ${fmt$0(m.spendByChannel.ispeed)}`} />
              <Kpi label="Total Revenue" value={fmt$0(m.totalRevenue)} color={C.green} icon={TrendingUp}
                sub="closed + under-contract deal value"
                onClick={() => setDrill({ title: 'Revenue — deals', query: 'channel=revenue' })} />
              <Kpi label="Overall ROI" value={m.totalSpend ? m.roiMultiplier.toFixed(1) + '×' : '—'}
                color={m.roiMultiplier >= 1 ? C.green : C.red} icon={Target}
                sub="revenue ÷ spend, selected period" />
              <Kpi label="Deals" value={num((cold?.deals || 0) + (isp?.deals || 0))} color={C.cyan} icon={BadgeCheck}
                sub={`Sarah ${num(cold?.deals || 0)} · iSpeed ${num(isp?.deals || 0)}`}
                onClick={() => setDrill({ title: 'All deals', query: 'channel=revenue' })} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-8">
              <GlassCard accent="green" hover={false} padding="p-5">
                <div className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext mb-3">
                  Revenue vs {fmt$0(REVENUE_GOAL)}/mo goal
                </div>
                <Gauge value={m.revenueThisMonth} goal={m.revenueGoal || REVENUE_GOAL} />
              </GlassCard>
              <GlassCard accent="purple" hover={false} padding="p-5">
                <div className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext mb-3">
                  ROI by channel
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={roiBars} barCategoryGap="28%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="name" stroke="#52526e" fontSize={11} />
                    <YAxis stroke="#52526e" fontSize={11} tickFormatter={(v: number) => v + '×'} />
                    <Tooltip contentStyle={tipStyle} cursor={{ fill: 'rgba(255,255,255,.04)' }}
                      formatter={(v: any, k: any, p: any) => k === 'roi'
                        ? [`${Number(v).toFixed(1)}× (spend ${fmt$(p.payload.spend)} → ${fmt$0(p.payload.revenue)})`, 'ROI'] : [v, k]} />
                    <Bar dataKey="roi" radius={[6, 6, 0, 0]}>
                      {roiBars.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="text-[10px] text-dimtext">PPC shows 0× until the channel launches.</div>
              </GlassCard>
            </div>

            {/* ════ CHANNEL 1 — COLD CALLING ════ */}
            {showSarah && cold && (
              <>
                <SectionTitle accent="green" badge="Supabase dialer + GHL VA♦️Leads">
                  Channel 1 — Cold Calling (Sarah)
                </SectionTitle>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                  <Kpi label="Dials" value={num(cold.totalDials)} icon={Phone} color={C.green}
                    sub={`${num(cold.talkMinutes)} talk minutes`}
                    onClick={() => setDrill({ title: 'All dial attempts', query: 'channel=calls' })} />
                  <Kpi label="Answer Rate" value={pct(cold.answerRate)} icon={Activity}
                    color={cold.answerRate >= 0.3 ? C.green : C.orange}
                    sub={`${num(cold.answered)} answered`}
                    onClick={() => setDrill({ title: 'Answered calls', query: 'channel=calls&answered=true' })} />
                  <Kpi label="Cost / Hot Lead" value={cold.hot ? fmt$(cold.costPerHot) : '—'} icon={Flame} color={C.red}
                    sub={`total cost ${fmt$(cold.totalCost)}`} />
                  <Kpi label="Appointments" value={num(cold.appts)} icon={Clock} color={C.cyan}
                    sub={`${num(cold.deals)} deals in pipeline`}
                    onClick={() => setDrill({ title: 'Cold pipeline — deals', query: 'channel=cold&deals=true' })} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <TempTile label="HOT" value={cold.hot} color={C.red} share={coldTempTotal ? cold.hot / coldTempTotal : 0}
                    onClick={() => setDrill({ title: 'Sarah — HOT leads', query: 'channel=cold&temp=hot' })} />
                  <TempTile label="WARM" value={cold.warm} color={C.orange} share={coldTempTotal ? cold.warm / coldTempTotal : 0}
                    onClick={() => setDrill({ title: 'Sarah — WARM leads', query: 'channel=cold&temp=warm' })} />
                  <TempTile label="COLD" value={cold.cold} color={C.blue} share={coldTempTotal ? cold.cold / coldTempTotal : 0}
                    onClick={() => setDrill({ title: 'Sarah — COLD leads', query: 'channel=cold&temp=cold' })} />
                  <TempTile label="DEAD" value={cold.dead} color={C.dim} share={coldTempTotal ? cold.dead / coldTempTotal : 0}
                    onClick={() => setDrill({ title: 'Sarah — DEAD leads', query: 'channel=cold&temp=dead' })} />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-8">
                  <GlassCard accent="green" hover={false} padding="p-5" className="lg:col-span-2">
                    <div className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext mb-3">
                      Daily dial activity
                    </div>
                    {cold.timeline.length === 0 ? (
                      <div className="text-dimtext text-sm py-10 text-center">No dials in this period.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <ComposedChart data={cold.timeline}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                          <XAxis dataKey="date" stroke="#52526e" fontSize={10} tickFormatter={(d: string) => d.slice(5)} />
                          <YAxis stroke="#52526e" fontSize={11} allowDecimals={false} />
                          <Tooltip contentStyle={tipStyle} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="dials" name="Dials" fill="rgba(74,222,128,0.25)" radius={[4, 4, 0, 0]} />
                          <Line type="monotone" dataKey="answered" name="Answered" stroke={C.green} strokeWidth={2} dot={{ r: 2 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </GlassCard>
                  <GlassCard accent="gold" hover={false} padding="p-5">
                    <div className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext mb-3">
                      Cost model
                    </div>
                    {[
                      { k: 'Telnyx (per-minute)', v: fmt$(cold.telnyxCost) },
                      { k: 'Thunder GPU (per-hour)', v: fmt$(cold.thunderCost) },
                      { k: 'Total channel cost', v: fmt$(cold.totalCost), hi: true },
                      { k: 'Cost per deal', v: cold.deals ? fmt$(cold.costPerDeal) : '—' },
                      { k: 'Qualified (hot+warm)', v: num(cold.qualified) },
                      { k: 'GHL leads in pipeline', v: num(cold.leads) },
                    ].map(r => (
                      <div key={r.k} className="flex justify-between py-2 border-b border-jborder last:border-0 text-[12px]">
                        <span className="text-dimtext">{r.k}</span>
                        <span className={'font-spacemono ' + (r.hi ? 'text-ngold font-bold' : 'text-jtext')}>{r.v}</span>
                      </div>
                    ))}
                  </GlassCard>
                </div>
              </>
            )}

            {/* ════ CHANNEL 2 — iSPEED ════ */}
            {showISpeed && isp && (
              <>
                <SectionTitle accent="purple" badge="GHL i Speed To Lead🐆💥">
                  Channel 2 — iSpeed To Lead
                </SectionTitle>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                  <Kpi label="Leads Purchased" value={num(isp.totalLeads)} icon={Zap} color={C.purple}
                    onClick={() => setDrill({ title: 'iSpeed — all leads', query: 'channel=ispeed' })} />
                  <Kpi label="Total Spent" value={fmt$0(isp.totalSpent)} icon={DollarSign} color={C.gold}
                    sub={`avg ${fmt$(isp.avgCostPerLead)} / lead`} />
                  <Kpi label="Hot Leads" value={num(isp.hot)} icon={Flame} color={C.red}
                    sub={`cost/hot ${isp.hot ? fmt$(isp.costPerHot) : '—'}`}
                    onClick={() => setDrill({ title: 'iSpeed — HOT leads', query: 'channel=ispeed&temp=hot' })} />
                  <Kpi label="Deals" value={num(isp.deals)} icon={BadgeCheck} color={C.green}
                    sub={`conv ${pct(isp.conversionRate)} · revenue ${fmt$0(isp.revenue)}`}
                    onClick={() => setDrill({ title: 'iSpeed — deals', query: 'channel=ispeed&deals=true' })} />
                </div>

                {/* tiers */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  {tierDefs.map(d => {
                    const t = isp.tiers?.[d.key] || {};
                    return (
                      <GlassCard key={d.key} accent={d.key === 'exclusive' ? 'green' : d.key === 'nonexclusive' ? 'purple' : 'gold'}
                        hover padding="p-4" className="cursor-pointer"
                        onClick={() => setDrill({ title: `iSpeed — ${d.name} tier`, query: `channel=ispeed&tier=${d.key}` })}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[11px] font-orbitron tracking-[1.5px] font-bold" style={{ color: d.color }}>
                            {d.sym} {d.name}
                          </span>
                          <span className="text-xl font-bold font-spacemono" style={{ color: d.color }}>{num(t.purchased || 0)}</span>
                        </div>
                        {[
                          ['Spent', fmt$0(t.spent || 0)],
                          ['Contacted', num(t.contacted || 0)],
                          ['Hot', num(t.hot || 0)],
                          ['Deals', num(t.deals || 0)],
                          ['Conv rate', pct(t.convRate || 0)],
                          d.key === 'leadpack'
                            ? ['Bonus value', fmt$0(t.spent || 0)]
                            : ['Refunds: pending / won', `${num(t.refundsPending || 0)} / ${num(t.refundsRecovered || 0)} (${fmt$0(t.moneyRecovered || 0)})`],
                        ].map(([k, v]) => (
                          <div key={k as string} className="flex justify-between py-1.5 border-b border-jborder last:border-0 text-[12px]">
                            <span className="text-dimtext">{k}</span>
                            <span className="font-spacemono text-jtext">{v}</span>
                          </div>
                        ))}
                        <div className="text-[10px] text-dimtext mt-2">{d.note}</div>
                      </GlassCard>
                    );
                  })}
                </div>

                {/* tier conversion compare + grade cost */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
                  <GlassCard accent="purple" hover={false} padding="p-5">
                    <div className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext mb-3">
                      Conversion by tier
                    </div>
                    <ResponsiveContainer width="100%" height={190}>
                      <BarChart data={tierDefs.map(d => ({
                        name: d.name.replace('NON-EXCLUSIVE', 'NON-EXCL'),
                        'Hot rate': +(100 * (isp.tiers?.[d.key]?.qualifyRate || 0)).toFixed(1),
                        'Deal rate': +(100 * (isp.tiers?.[d.key]?.convRate || 0)).toFixed(1),
                        fill: d.color,
                      }))} barCategoryGap="24%">
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="name" stroke="#52526e" fontSize={10} />
                        <YAxis stroke="#52526e" fontSize={11} tickFormatter={(v: number) => v + '%'} />
                        <Tooltip contentStyle={tipStyle} formatter={(v: any) => v + '%'} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Hot rate" fill={C.red} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Deal rate" fill={C.green} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </GlassCard>
                  <GlassCard accent="cyan" hover={false} padding="p-5">
                    <div className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext mb-3">
                      Predictor grade — cost per lead
                    </div>
                    {gradeBars.length === 0 ? (
                      <div className="text-dimtext text-sm py-10 text-center">No graded leads in range.</div>
                    ) : (
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-dimtext text-left">
                            {['Grade', 'Leads', 'Hot', 'Cost/Lead', 'Conv'].map(h => (
                              <th key={h} className="px-2 py-1.5 font-orbitron text-[9px] tracking-wider uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {gradeBars.map(g => (
                            <tr key={g.grade}
                              className="border-t border-jborder cursor-pointer hover:bg-white/[0.03]"
                              onClick={() => setDrill({ title: `iSpeed — grade ${g.grade}`, query: `channel=ispeed&grade=${g.grade}` })}>
                              <td className="px-2 py-2 font-bold text-textb">{g.name}</td>
                              <td className="px-2 py-2 font-spacemono">{num(g.leads)}</td>
                              <td className="px-2 py-2 font-spacemono text-nred">{num(g.hot)}</td>
                              <td className="px-2 py-2 font-spacemono text-ngold">{fmt$(g.costPerLead)}</td>
                              <td className="px-2 py-2 font-spacemono">{pct(g.convRate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </GlassCard>
                </div>

                {/* refunds + deadlines */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
                  <GlassCard accent="orange" hover={false} padding="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext">
                        Refund tracker
                      </span>
                      <Receipt size={14} className="text-norange opacity-70" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                      {[
                        { k: 'Requested', v: isp.refund.requested, c: C.blue, icon: HelpCircle },
                        { k: 'Pending', v: isp.refund.pending, c: C.orange, icon: Clock },
                        { k: 'Approved', v: isp.refund.approved, c: C.green, icon: BadgeCheck },
                        { k: 'Denied', v: isp.refund.denied, c: C.red, icon: BadgeX },
                      ].map(r => (
                        <div key={r.k} className="rounded-sm border p-3 cursor-pointer hover:-translate-y-0.5 transition-transform"
                          style={{ borderColor: r.c + '44', background: r.c + '0d' }}
                          onClick={() => setDrill({ title: `iSpeed — refunds (${r.k.toLowerCase()})`, query: 'channel=ispeed&refund=true' })}>
                          <r.icon size={13} style={{ color: r.c }} />
                          <div className="text-xl font-bold font-spacemono mt-1" style={{ color: r.c }}>{num(r.v)}</div>
                          <div className="text-[9px] text-dimtext font-orbitron tracking-wider uppercase">{r.k}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-baseline border-t border-jborder pt-3">
                      <span className="text-[11px] text-dimtext">Money recovered</span>
                      <span className="text-lg font-bold font-spacemono text-ngreen">{fmt$0(isp.refund.moneyRecovered)}</span>
                    </div>
                  </GlassCard>

                  <GlassCard accent="red" hover={false} padding="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext">
                        Refund deadlines — next 7 days
                      </span>
                      <AlertTriangle size={14} className="text-nred opacity-70" />
                    </div>
                    {expiring.length === 0 ? (
                      <div className="text-dimtext text-[12px] py-4 text-center">No refund windows closing in the next 7 days. ✅</div>
                    ) : (
                      <div className="space-y-2 max-h-[210px] overflow-auto pr-1">
                        {expiring.map((a: any) => {
                          const urgent = a.daysLeft <= 2;
                          const col = urgent ? C.red : C.orange;
                          return (
                            <div key={a.id} className="flex items-center justify-between rounded-sm border px-3 py-2"
                              style={{ borderColor: col + '66', background: col + '10' }}>
                              <div className="min-w-0">
                                <div className="text-[12px] font-semibold text-textb truncate">{a.name}</div>
                                <div className="text-[10px] text-dimtext truncate">{a.provider || '—'} · {a.grade || 'ungraded'} · {fmt$0(a.pricePaid || 0)}</div>
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <div className="text-[13px] font-bold font-spacemono" style={{ color: col }}>
                                  {a.daysLeft <= 0 ? 'TODAY' : `${a.daysLeft}d left`}
                                </div>
                                <div className="text-[9px] text-dimtext">{new Date(a.refundDeadline).toLocaleDateString()}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {expired.length > 0 && (
                      <div className="mt-3 border-t border-jborder pt-2">
                        <button className="text-[10px] text-dimtext hover:text-norange font-orbitron tracking-wider uppercase"
                          onClick={() => setShowExpired(v => !v)}>
                          {showExpired ? '▾' : '▸'} {expired.length} window{expired.length === 1 ? '' : 's'} expired recently (not refunded)
                        </button>
                        {showExpired && (
                          <div className="space-y-1 mt-2 max-h-[140px] overflow-auto pr-1">
                            {expired.map((a: any) => (
                              <div key={a.id} className="flex justify-between text-[11px] px-2 py-1 rounded-sm bg-white/[0.02]">
                                <span className="text-jtext truncate">{a.name} <span className="text-dimtext">({fmt$0(a.pricePaid || 0)})</span></span>
                                <span className="text-dimtext shrink-0 ml-2">{Math.abs(a.daysLeft)}d ago</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </GlassCard>
                </div>

                {/* iSpeed temp + purchase trend */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-8">
                  <GlassCard accent="purple" hover={false} padding="p-5">
                    <div className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext mb-3">
                      Lead temperature (iSpeed)
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <TempTile label="HOT" value={isp.hot} color={C.red} share={ispTempTotal ? isp.hot / ispTempTotal : 0}
                        onClick={() => setDrill({ title: 'iSpeed — HOT', query: 'channel=ispeed&temp=hot' })} />
                      <TempTile label="WARM" value={isp.warm} color={C.orange} share={ispTempTotal ? isp.warm / ispTempTotal : 0}
                        onClick={() => setDrill({ title: 'iSpeed — WARM', query: 'channel=ispeed&temp=warm' })} />
                      <TempTile label="COLD" value={isp.cold} color={C.blue} share={ispTempTotal ? isp.cold / ispTempTotal : 0}
                        onClick={() => setDrill({ title: 'iSpeed — COLD', query: 'channel=ispeed&temp=cold' })} />
                      <TempTile label="DEAD" value={isp.dead} color={C.dim} share={ispTempTotal ? isp.dead / ispTempTotal : 0}
                        onClick={() => setDrill({ title: 'iSpeed — DEAD', query: 'channel=ispeed&temp=dead' })} />
                    </div>
                    <div className="text-[10px] text-dimtext mt-3">
                      {num(isp.contacted)} of {num(isp.totalLeads)} contacted · {num(isp.appts)} appointments
                    </div>
                  </GlassCard>
                  <GlassCard accent="purple" hover={false} padding="p-5">
                    <div className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext mb-3">
                      Purchases per day
                    </div>
                    {isp.timeline.length === 0 ? (
                      <div className="text-dimtext text-sm py-10 text-center">No purchases in this period.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={190}>
                        <ComposedChart data={isp.timeline}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                          <XAxis dataKey="date" stroke="#52526e" fontSize={10} tickFormatter={(d: string) => d.slice(5)} />
                          <YAxis stroke="#52526e" fontSize={11} allowDecimals={false} />
                          <Tooltip contentStyle={tipStyle} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Area type="monotone" dataKey="leads" name="Purchased" stroke={C.purple} fill="rgba(167,139,250,0.18)" strokeWidth={2} />
                          <Line type="monotone" dataKey="hot" name="Hot" stroke={C.red} strokeWidth={2} dot={{ r: 2 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </GlassCard>
                </div>
              </>
            )}

            {/* ════ CHANNEL 3 — PPC (locked) ════ */}
            {source === 'all' && <PpcPlaceholder />}

            {/* ════ PREDICTOR GRADE INTELLIGENCE ════ */}
            {showISpeed && isp && (
              <>
                <SectionTitle accent="cyan" badge="builds automatically as leads are dispositioned">
                  Predictor Grade Intelligence
                </SectionTitle>
                <GlassCard accent="cyan" hover={false} padding="p-5" className="mb-8">
                  <GradeHeatmap heatmap={isp.gradeHeatmap}
                    onDrill={(g) => setDrill({ title: `iSpeed — grade ${g}`, query: `channel=ispeed&grade=${g}` })} />
                </GlassCard>
              </>
            )}
          </>
        )}

        <div className="text-center text-[10px] text-dimtext font-spacemono">
          {data?.snapshotAt && <>VPS snapshot {new Date(data.snapshotAt).toLocaleTimeString()} · </>}
          marketing-intel · api.jarviscommandcenter.space
        </div>
      </div>

      <DrillModal drill={drill} period={period} onClose={() => setDrill(null)} />
    </div>
  );
}

// ── PPC placeholder ──────────────────────────────────────────────────────
function PpcPlaceholder({ full }: { full?: boolean }) {
  return (
    <div className={full ? '' : 'mb-8'}>
      <SectionTitle accent="blue" badge="not launched">
        Channel 3 — Property Leads PPC
      </SectionTitle>
      <GlassCard accent="blue" hover={false} padding="p-6" className="relative">
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2"
          style={{ background: 'rgba(10,11,18,0.55)', backdropFilter: 'blur(2px)' }}>
          <span className="flex items-center gap-2 text-[11px] font-orbitron tracking-[2px] uppercase px-3 py-1.5 rounded-sm border border-ngold/50 text-ngold bg-ngold/10">
            <Lock size={12} /> Coming soon
          </span>
          <span className="text-[11px] text-dimtext max-w-xs text-center">
            Wired & ready — once the PPC campaign goes live, spend, clicks and cost-per-lead populate here automatically.
          </span>
        </div>
        <div className="opacity-40 pointer-events-none select-none">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {['Ad Spend', 'Clicks', 'Leads', 'Cost / Lead'].map(k => (
              <div key={k} className="rounded-sm border border-border2 p-4">
                <div className="text-[10px] font-orbitron tracking-[2px] uppercase text-dimtext">{k}</div>
                <div className="text-2xl font-bold font-spacemono mt-2 text-dimtext">—</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Monthly budget ($)', ph: 'e.g. 2500' },
              { label: 'Target cost per lead ($)', ph: 'e.g. 80' },
              { label: 'Campaign / landing URL', ph: 'https://…' },
            ].map(f => (
              <label key={f.label} className="block">
                <span className="text-[10px] font-orbitron tracking-wider uppercase text-dimtext">{f.label}</span>
                <input disabled placeholder={f.ph}
                  className="mt-1 w-full bg-bg2 border border-border2 rounded-sm px-3 py-2 text-[13px] text-jtext placeholder:text-dimtext/50" />
              </label>
            ))}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
