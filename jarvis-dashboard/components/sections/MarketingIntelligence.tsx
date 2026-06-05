'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Minus, DollarSign, Users, Target,
  BarChart2, MapPin, Zap, RefreshCw, AlertCircle,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthMetrics {
  totalLeads: number;
  totalSpend: number;
  contacted: number;
  qualified: number;
  appointments: number;
  dealsClosed: number;
  revenue: number;
  roi: number;
  costPerContact: number;
  costPerQual: number;
  costPerAppt: number;
  costPerDeal: number;
}

interface SourceRow {
  name: string;
  leads: number;
  contacted: number;
  qualified: number;
  appointments: number;
  deals: number;
  spend: number;
  revenue: number;
  roi: number;
  qualRate: number;
  contactRate: number;
  dealRate: number;
  costPerDeal: number | null;
}

interface CountyRow {
  name: string;
  leads: number;
  contacted: number;
  qualified: number;
  appointments: number;
  deals: number;
  spend: number;
  revenue: number;
  roi: number;
  qualRate: number;
  contactRate: number;
}

interface AgeBucket {
  label: string;
  leads: number;
  qualified: number;
  deals: number;
  qualRate: number;
}

interface MarketingData {
  month: MonthMetrics;
  week: MonthMetrics;
  prev: MonthMetrics;
  trends: Record<string, 'up' | 'down' | 'flat'>;
  sources: SourceRow[];
  counties: CountyRow[];
  ageBuckets: AgeBucket[];
  updatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

function TrendIcon({ dir, invert = false }: { dir?: string; invert?: boolean }) {
  const up   = invert ? dir === 'down' : dir === 'up';
  const down = invert ? dir === 'up'   : dir === 'down';
  if (up)   return <TrendingUp   size={12} style={{ color: '#00ff88' }} />;
  if (down) return <TrendingDown size={12} style={{ color: '#ff3366' }} />;
  return <Minus size={12} style={{ color: '#52526e' }} />;
}

function MetricCard({
  label, value, trend, invert = false, accent = '#00aaff',
}: {
  label: string;
  value: string;
  trend?: string;
  invert?: boolean;
  accent?: string;
}) {
  return (
    <div
      className="rounded-sm border p-3 flex flex-col gap-1"
      style={{ background: 'rgba(255,255,255,0.03)', borderColor: `${accent}22` }}
    >
      <div className="text-[10px] uppercase tracking-wider" style={{ color: '#52526e' }}>{label}</div>
      <div className="text-[18px] font-bold" style={{ color: accent }}>{value}</div>
      {trend && (
        <div className="flex items-center gap-1">
          <TrendIcon dir={trend} invert={invert} />
          <span className="text-[10px]" style={{ color: '#52526e' }}>vs last week</span>
        </div>
      )}
    </div>
  );
}

const TABS = ['Overview', 'Lead Sources', 'Counties', 'Lead Age'] as const;
type Tab = typeof TABS[number];

const ACCENT: Record<string, string> = {
  Google:         '#4285f4',
  Facebook:       '#1877f2',
  'Speed To Lead': '#ff8800',
  'Cold Call':    '#00ff88',
  'Text Campaign':'#aa44ff',
  Unknown:        '#52526e',
  County:         '#67e8f9',
};

// ── Main Component ────────────────────────────────────────────────────────────

export function MarketingIntelligence() {
  const [data,      setData]      = useState<MarketingData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [tab,       setTab]       = useState<Tab>('Overview');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/marketing');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30 * 60 * 1000); // 30 min
    return () => clearInterval(iv);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#00aaff44', borderTopColor: 'transparent' }} />
        <span className="text-[11px]" style={{ color: '#52526e' }}>Loading marketing metrics…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2">
        <AlertCircle size={20} style={{ color: '#ff3366' }} />
        <span className="text-[11px]" style={{ color: '#ff3366' }}>{error}</span>
        <button onClick={load} className="text-[10px] px-3 py-1 rounded border" style={{ color: '#00aaff', borderColor: '#00aaff44' }}>Retry</button>
      </div>
    );
  }

  const m = data!.month;
  const t = data!.trends;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold" style={{ color: '#00aaff' }}>Marketing Intelligence</h2>
          <p className="text-[11px]" style={{ color: '#52526e' }}>
            Month-to-date · updated {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1 px-3 py-1 rounded-sm border text-[11px] transition-opacity hover:opacity-70"
          style={{ borderColor: '#00aaff33', color: '#00aaff' }}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-[11px] transition-colors"
            style={{ color: tab === t ? '#00aaff' : '#52526e', borderBottom: tab === t ? '2px solid #00aaff' : '2px solid transparent' }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === 'Overview' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Leads Purchased"    value={String(m.totalLeads)}          trend={t.totalLeads}     accent="#00aaff" />
            <MetricCard label="Total Spend"        value={fmt$(m.totalSpend)}            trend={t.totalSpend}     accent="#ff8800" invert />
            <MetricCard label="Leads Contacted"    value={String(m.contacted)}           trend={t.contacted}      accent="#4ade80" />
            <MetricCard label="Leads Qualified"    value={String(m.qualified)}           trend={t.qualified}      accent="#fbbf24" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Appointments Set"   value={String(m.appointments)}        trend={t.appointments}   accent="#a78bfa" />
            <MetricCard label="Deals Closed"       value={String(m.dealsClosed)}         trend={t.dealsClosed}    accent="#00ff88" />
            <MetricCard label="Revenue Generated"  value={fmt$(m.revenue)}              trend={t.revenue}        accent="#00ff88" />
            <MetricCard label="ROI"                value={fmtPct(m.roi)}                trend={t.roi}            accent={m.roi >= 0 ? '#00ff88' : '#ff3366'} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Cost per Contact"   value={fmt$(m.costPerContact)}        trend={t.costPerContact} accent="#67e8f9" invert />
            <MetricCard label="Cost per Qualified" value={fmt$(m.costPerQual)}           trend={t.costPerQual}    accent="#67e8f9" invert />
            <MetricCard label="Cost per Appt"      value={fmt$(m.costPerAppt)}           trend={t.costPerAppt}    accent="#67e8f9" invert />
            <MetricCard label="Cost per Deal"      value={m.costPerDeal > 0 ? fmt$(m.costPerDeal) : '—'} trend={t.costPerDeal} accent="#67e8f9" invert />
          </div>

          {/* Empty state hint */}
          {m.totalLeads === 0 && (
            <div className="rounded-sm border p-4 text-center" style={{ borderColor: '#00aaff22', background: 'rgba(0,170,255,0.04)' }}>
              <Zap size={18} style={{ color: '#00aaff', margin: '0 auto 8px' }} />
              <p className="text-[12px]" style={{ color: '#00aaff' }}>No leads tracked yet</p>
              <p className="text-[11px] mt-1" style={{ color: '#52526e' }}>
                Configure GHL to POST new leads to{' '}
                <code className="px-1 rounded" style={{ background: 'rgba(0,170,255,0.1)', color: '#67e8f9' }}>
                  YOUR_VPS:3005/new-lead
                </code>
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Lead Sources Tab ── */}
      {tab === 'Lead Sources' && (
        <div className="flex flex-col gap-3">
          {data!.sources.length === 0 ? (
            <div className="text-[12px] text-center py-8" style={{ color: '#52526e' }}>No source data yet</div>
          ) : (
            <>
              <p className="text-[11px]" style={{ color: '#52526e' }}>Month-to-date · Best performers highlighted</p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#52526e' }}>
                      <th className="text-left py-2 pr-3">Source</th>
                      <th className="text-right py-2 px-2">Leads</th>
                      <th className="text-right py-2 px-2">Contact%</th>
                      <th className="text-right py-2 px-2">Qual%</th>
                      <th className="text-right py-2 px-2">Deals</th>
                      <th className="text-right py-2 px-2">Spend</th>
                      <th className="text-right py-2 px-2">ROI</th>
                      <th className="text-right py-2 pl-2">CPD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.sources.map((s, i) => {
                      const accent = ACCENT[s.name] || '#52526e';
                      const best = i === 0;
                      return (
                        <tr key={s.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: best ? 'rgba(0,255,136,0.03)' : 'transparent' }}>
                          <td className="py-2 pr-3 font-medium" style={{ color: accent }}>
                            {best && <span className="mr-1">⭐</span>}{s.name}
                          </td>
                          <td className="text-right py-2 px-2" style={{ color: '#c8c8d8' }}>{s.leads}</td>
                          <td className="text-right py-2 px-2" style={{ color: s.contactRate >= 50 ? '#4ade80' : '#c8c8d8' }}>{s.contactRate}%</td>
                          <td className="text-right py-2 px-2" style={{ color: s.qualRate >= 20 ? '#fbbf24' : '#c8c8d8' }}>{s.qualRate}%</td>
                          <td className="text-right py-2 px-2" style={{ color: s.deals > 0 ? '#00ff88' : '#52526e' }}>{s.deals}</td>
                          <td className="text-right py-2 px-2" style={{ color: '#c8c8d8' }}>{fmt$(s.spend)}</td>
                          <td className="text-right py-2 px-2" style={{ color: s.roi > 0 ? '#00ff88' : s.roi < 0 ? '#ff3366' : '#52526e' }}>
                            {s.spend > 0 ? fmtPct(s.roi) : '—'}
                          </td>
                          <td className="text-right py-2 pl-2" style={{ color: '#67e8f9' }}>
                            {s.costPerDeal != null ? fmt$(s.costPerDeal) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Counties Tab ── */}
      {tab === 'Counties' && (
        <div className="flex flex-col gap-3">
          {data!.counties.length === 0 ? (
            <div className="text-[12px] text-center py-8" style={{ color: '#52526e' }}>No county data yet</div>
          ) : (
            <>
              <p className="text-[11px]" style={{ color: '#52526e' }}>Month-to-date · Orange, Osceola, Seminole focus</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data!.counties.map((c) => (
                  <div key={c.name} className="rounded-sm border p-3" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin size={12} style={{ color: '#00aaff' }} />
                      <span className="text-[12px] font-bold" style={{ color: '#c8c8d8' }}>{c.name} County</span>
                      {c.deals > 0 && <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full" style={{ background: '#00ff8820', color: '#00ff88' }}>{c.deals} deals</span>}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[10px]" style={{ color: '#52526e' }}>Leads</div>
                        <div className="text-[14px] font-bold" style={{ color: '#00aaff' }}>{c.leads}</div>
                      </div>
                      <div>
                        <div className="text-[10px]" style={{ color: '#52526e' }}>Contact%</div>
                        <div className="text-[14px] font-bold" style={{ color: c.contactRate >= 50 ? '#4ade80' : '#c8c8d8' }}>{c.contactRate}%</div>
                      </div>
                      <div>
                        <div className="text-[10px]" style={{ color: '#52526e' }}>Qual%</div>
                        <div className="text-[14px] font-bold" style={{ color: c.qualRate >= 20 ? '#fbbf24' : '#c8c8d8' }}>{c.qualRate}%</div>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <span className="text-[10px]" style={{ color: '#52526e' }}>Spend: {fmt$(c.spend)}</span>
                      <span className="text-[10px]" style={{ color: c.roi > 0 ? '#00ff88' : c.roi < 0 ? '#ff3366' : '#52526e' }}>
                        ROI: {c.spend > 0 ? fmtPct(c.roi) : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Lead Age Tab (Coupon Club Optimizer) ── */}
      {tab === 'Lead Age' && (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-[12px] font-bold mb-1" style={{ color: '#fbbf24' }}>Coupon Club Lead Age Optimizer</h3>
            <p className="text-[11px]" style={{ color: '#52526e' }}>Which age of lead converts best? Activates full recommendation after 30 leads.</p>
          </div>
          {data!.ageBuckets.length === 0 ? (
            <div className="text-[12px] text-center py-8" style={{ color: '#52526e' }}>No lead age data yet</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {data!.ageBuckets.map((b) => {
                const isBest = b.qualRate === Math.max(...data!.ageBuckets.map(x => x.qualRate));
                return (
                  <div
                    key={b.label}
                    className="rounded-sm border p-3"
                    style={{
                      background: isBest ? 'rgba(0,255,136,0.05)' : 'rgba(255,255,255,0.03)',
                      borderColor: isBest ? '#00ff8833' : 'rgba(255,255,255,0.06)',
                    }}
                  >
                    {isBest && <div className="text-[9px] font-bold mb-1" style={{ color: '#00ff88' }}>⭐ BEST CONVERTING</div>}
                    <div className="text-[13px] font-bold mb-2" style={{ color: '#c8c8d8' }}>{b.label}</div>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: '#52526e' }}>Leads</span>
                        <span style={{ color: '#c8c8d8' }}>{b.leads}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: '#52526e' }}>Qual Rate</span>
                        <span style={{ color: b.qualRate >= 20 ? '#fbbf24' : '#c8c8d8' }}>{b.qualRate}%</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: '#52526e' }}>Deals</span>
                        <span style={{ color: b.deals > 0 ? '#00ff88' : '#52526e' }}>{b.deals}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recommendation bar */}
          {data!.ageBuckets.length > 0 && (() => {
            const total = data!.ageBuckets.reduce((s, b) => s + b.leads, 0);
            const best  = [...data!.ageBuckets].sort((a, b) => b.qualRate - a.qualRate)[0];
            const worst = [...data!.ageBuckets].sort((a, b) => a.qualRate - b.qualRate)[0];
            if (total < 10) return (
              <div className="rounded-sm border p-3 text-[11px]" style={{ borderColor: '#fbbf2422', background: 'rgba(251,191,36,0.04)', color: '#fbbf24' }}>
                Need {10 - total} more leads for initial pattern detection · {30 - total} more for full Coupon Club recommendation
              </div>
            );
            return (
              <div className="rounded-sm border p-3" style={{ borderColor: '#00ff8822', background: 'rgba(0,255,136,0.04)' }}>
                <div className="text-[11px] font-bold mb-1" style={{ color: '#00ff88' }}>AI Recommendation</div>
                <p className="text-[11px]" style={{ color: '#c8c8d8' }}>
                  ✅ Prioritize <strong style={{ color: '#00ff88' }}>{best.label}</strong> leads ({best.qualRate}% qual rate) ·{' '}
                  ⛔ Deprioritize <strong style={{ color: '#ff3366' }}>{worst.label}</strong> leads ({worst.qualRate}% qual rate)
                </p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
