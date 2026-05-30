'use client';

/**
 * /marketing-intel — Marketing Intelligence (redesigned).
 *
 * Data comes from the VPS service (marketing-intel.js on :3008, exposed at
 * api.jarviscommandcenter.space/marketing-intel/api/*), NOT a Vercel function —
 * the Vercel project is at its 12 serverless-function cap and the GHL note
 * parsing is too heavy for a serverless cold start.
 *
 * Sources: 🤖 Sarah Leads (cold/dialer) + ⚡ iSpeed (purchased CRM leads).
 * 📍 Property Leads PPC is locked (not launched). Alpha Leads is fully retired —
 * the cold channel is Sarah only.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid,
  XAxis, YAxis, Tooltip, Legend, LineChart, Line,
} from 'recharts';

const API_BASE = 'https://api.jarviscommandcenter.space/marketing-intel';
const REVENUE_GOAL = 100000;

const fmt$ = (n: number) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmt$0 = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString();
const pct = (n: number) => ((Number(n) || 0) * 100).toFixed(1) + '%';
const num = (n: number) => (Number(n) || 0).toLocaleString();

const C = {
  accent: '#00e5a0', accent2: '#7c5cff',
  hot: '#ff5470', warm: '#ffb020', cold: '#3ba1ff', dead: '#5a6378',
  sarah: '#00e5a0', ispeed: '#7c5cff', ppc: '#3ba1ff',
};
const tip = { background: '#12121f', border: '1px solid #232338', borderRadius: 10, fontFamily: 'DM Mono, monospace', fontSize: 12 };

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7D' },
  { key: 'mtd', label: 'MTD' },
  { key: 'month', label: '30D' },
  { key: 'all', label: 'All Time' },
];
const SOURCES = [
  { key: 'all', label: 'All Sources', icon: '◎', locked: false },
  { key: 'sarah', label: 'Sarah Leads', icon: '🤖', locked: false },
  { key: 'ispeed', label: 'iSpeed', icon: '⚡', locked: false },
  { key: 'ppc', label: 'Property Leads PPC', icon: '📍', locked: true },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
:root{
  --bg:#080810;--panel:#0f0f1a;--panel2:#12121f;--border:#1e1e2e;--border2:#232338;
  --text:#e8ecf5;--muted:#7a82a0;--accent:#00e5a0;--accent2:#7c5cff;
  --hot:#ff5470;--warm:#ffb020;--cold:#3ba1ff;--dead:#5a6378;
}
.mi *{box-sizing:border-box;}
.mi{
  min-height:100vh;color:var(--text);
  font-family:'Syne',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;
  background-color:var(--bg);
  background-image:
    linear-gradient(rgba(255,255,255,.022) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px),
    radial-gradient(900px 500px at 80% -10%,rgba(0,229,160,.07),transparent 60%);
  background-size:42px 42px,42px 42px,100% 100%;
}
.mi .mono{font-family:'DM Mono',ui-monospace,monospace;}
.mi .wrap{max-width:1440px;margin:0 auto;padding:22px 18px 90px;}
.mi .topbar{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:18px;}
.mi .brand{display:flex;align-items:center;gap:13px;}
.mi .brand .dot{width:11px;height:11px;border-radius:50%;background:var(--accent);box-shadow:0 0 14px var(--accent);}
.mi .brand h1{font-size:23px;margin:0;font-weight:800;letter-spacing:.5px;}
.mi .brand .accent{color:var(--accent);}
.mi .sub{color:var(--muted);font-size:12px;font-weight:500;}
.mi .refresh{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;}
.mi .pulse{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:mipulse 1.4s infinite;}
@keyframes mipulse{0%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1)}100%{opacity:.25;transform:scale(.8)}}

.mi .bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;}
.mi .seg{display:flex;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.mi .seg button{background:transparent;color:var(--muted);border:0;padding:9px 16px;cursor:pointer;font-size:13px;font-weight:600;font-family:'Syne',sans-serif;transition:.15s;}
.mi .seg button:hover{color:var(--text);}
.mi .seg button.active{background:var(--accent);color:#021410;}
.mi .src{display:flex;gap:8px;flex-wrap:wrap;}
.mi .src button{display:flex;align-items:center;gap:7px;background:var(--panel2);border:1px solid var(--border);color:var(--muted);padding:9px 14px;border-radius:11px;cursor:pointer;font-size:13px;font-weight:600;font-family:'Syne',sans-serif;transition:.15s;}
.mi .src button:hover:not(.locked){color:var(--text);border-color:var(--border2);}
.mi .src button.active{border-color:var(--accent);color:var(--accent);background:rgba(0,229,160,.08);box-shadow:0 0 0 1px var(--accent) inset;}
.mi .src button.locked{opacity:.4;cursor:not-allowed;}
.mi .src button .soon{font-size:9px;background:var(--border2);color:var(--muted);padding:2px 6px;border-radius:6px;font-family:'DM Mono',monospace;}

.mi .section{margin:30px 0 6px;}
.mi .section h2{display:flex;align-items:center;gap:10px;font-size:13px;text-transform:uppercase;letter-spacing:2px;color:var(--accent);font-weight:700;margin:0 0 15px;}
.mi .section h2:before{content:'';width:18px;height:2px;background:var(--accent);border-radius:2px;}
.mi .section h2 .tag{font-size:10px;color:var(--muted);letter-spacing:.5px;text-transform:none;font-weight:500;}

.mi .grid{display:grid;gap:14px;}
.mi .g2{grid-template-columns:repeat(2,1fr);}
.mi .g3{grid-template-columns:repeat(3,1fr);}
.mi .g4{grid-template-columns:repeat(4,1fr);}
@media(max-width:1000px){.mi .g4{grid-template-columns:repeat(2,1fr);}.mi .g3{grid-template-columns:1fr;}}
@media(max-width:640px){.mi .g2,.mi .g4{grid-template-columns:1fr;}}

.mi .card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--border);border-radius:16px;padding:17px;}
.mi .card h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;margin:0 0 14px;font-weight:600;}
.mi .kpi .label{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;font-weight:600;display:flex;align-items:center;gap:6px;}
.mi .kpi .val{font-family:'DM Mono',monospace;font-size:30px;font-weight:500;margin-top:9px;line-height:1;letter-spacing:-1px;}
.mi .kpi .delta{font-size:11px;margin-top:7px;color:var(--muted);font-family:'DM Mono',monospace;}
.mi .ic{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;background:rgba(0,229,160,.1);}
.mi .v-accent{color:var(--accent)}.mi .v-hot{color:var(--hot)}.mi .v-warm{color:var(--warm)}
.mi .v-cold{color:var(--cold)}.mi .v-dead{color:var(--dead)}.mi .v-purple{color:var(--accent2)}

.mi table{width:100%;border-collapse:collapse;font-size:13px;}
.mi th,.mi td{text-align:left;padding:10px 11px;border-bottom:1px solid var(--border);}
.mi th{color:var(--muted);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;}
.mi td{font-family:'DM Mono',monospace;}
.mi td.src-name{font-family:'Syne',sans-serif;font-weight:600;}
.mi tbody tr:last-child td{border-bottom:0;}

.mi .funnel{display:flex;flex-direction:column;gap:9px;}
.mi .frow{display:flex;align-items:center;gap:12px;}
.mi .frow .flabel{width:96px;font-size:12px;color:var(--muted);font-weight:600;flex-shrink:0;}
.mi .ftrack{flex:1;height:34px;background:var(--panel2);border-radius:9px;overflow:hidden;border:1px solid var(--border);}
.mi .ffill{height:100%;display:flex;align-items:center;padding:0 12px;font-family:'DM Mono',monospace;font-size:13px;color:#021410;font-weight:500;border-radius:9px;min-width:fit-content;transition:width .5s;}
.mi .fconv{width:54px;text-align:right;font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);flex-shrink:0;}

.mi .tier{border:1px solid var(--border);border-radius:14px;padding:16px;background:var(--panel2);}
.mi .tier.exclusive{border-left:3px solid var(--accent);}
.mi .tier.nonexclusive{border-left:3px solid var(--accent2);}
.mi .tier.leadpack{border-left:3px solid var(--warm);}
.mi .tier .th{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;}
.mi .tier .th .nm{font-size:13px;font-weight:700;letter-spacing:.5px;}
.mi .tier .th .ct{font-family:'DM Mono',monospace;font-size:22px;font-weight:500;}
.mi .tier .stat{display:flex;justify-content:space-between;padding:6px 0;font-size:12px;border-bottom:1px solid var(--border);}
.mi .tier .stat:last-child{border-bottom:0;}
.mi .tier .stat .k{color:var(--muted);}
.mi .tier .stat .vv{font-family:'DM Mono',monospace;font-weight:500;}

.mi .tempcard{border-radius:14px;padding:16px;border:1px solid var(--border);position:relative;overflow:hidden;}
.mi .tempcard .tlabel{font-size:11px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;}
.mi .tempcard .tval{font-family:'DM Mono',monospace;font-size:34px;font-weight:500;margin-top:8px;line-height:1;}
.mi .tempcard .tpct{font-size:11px;color:var(--muted);margin-top:6px;font-family:'DM Mono',monospace;}

.mi .barwrap{background:var(--panel2);border-radius:30px;height:16px;overflow:hidden;border:1px solid var(--border);}
.mi .barwrap>div{height:100%;background:linear-gradient(90deg,var(--accent2),var(--accent));border-radius:30px;transition:width .6s;}
.mi .qbar{display:flex;flex-direction:column;gap:11px;}
.mi .qrow{display:flex;align-items:center;gap:12px;}
.mi .qrow .ql{width:130px;font-size:12px;font-weight:600;flex-shrink:0;}
.mi .qrow .qtrack{flex:1;height:22px;background:var(--panel2);border-radius:7px;overflow:hidden;border:1px solid var(--border);}
.mi .qrow .qfill{height:100%;border-radius:7px;transition:width .5s;}
.mi .qrow .qv{width:60px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;flex-shrink:0;}

.mi .err{background:rgba(255,84,112,.1);border:1px solid var(--hot);color:#ffb3c0;padding:14px;border-radius:12px;margin:14px 0;font-family:'DM Mono',monospace;font-size:13px;}
.mi .loading{text-align:center;padding:90px;color:var(--muted);font-family:'DM Mono',monospace;}
.mi .empty{color:var(--muted);font-size:13px;text-align:center;padding:30px;}
.mi .footnote{font-size:10px;color:var(--muted);margin-top:8px;font-family:'DM Mono',monospace;}
.mi .placeholder{border:1px dashed var(--border2);border-radius:16px;padding:40px;text-align:center;color:var(--muted);}
.mi .lockbadge{display:inline-block;font-size:10px;background:var(--warm);color:#1a1200;padding:3px 9px;border-radius:7px;font-family:'DM Mono',monospace;font-weight:500;margin-bottom:10px;}
`;

// ── Per-source metric model derived from the API payload ────────────────────
function buildSources(data: any) {
  const cold = data.cold || {};
  const isp = data.ispeed || {};
  const rev = (data.master && data.master.revenueByChannel) || {};
  const sarah = {
    key: 'sarah', label: 'Sarah Leads', icon: '🤖', color: C.sarah,
    leadsPurchased: cold.answered || 0,
    spend: cold.totalCost || 0,
    contacted: cold.contacted ?? cold.answered ?? 0,
    hot: cold.hot || 0, warm: cold.warm || 0, cold: cold.cold || 0, dead: 0,
    qualified: cold.qualified ?? ((cold.hot || 0) + (cold.warm || 0)),
    appts: cold.appts || 0,
    deals: cold.deals || 0,
    revenue: rev.cold || 0,
    weekly: (cold.timeline || []).map((d: any) => ({ date: d.date, leads: d.leads || 0 })),
  };
  const ispeed = {
    key: 'ispeed', label: 'iSpeed', icon: '⚡', color: C.ispeed,
    leadsPurchased: isp.totalLeads || 0,
    spend: isp.totalSpent || 0,
    contacted: isp.contacted || 0,
    hot: isp.hot || 0, warm: isp.warm || 0, cold: isp.cold || 0, dead: isp.dead || 0,
    qualified: isp.qualified || 0,
    appts: isp.appts || 0,
    deals: isp.deals || 0,
    revenue: rev.ispeed || 0,
    weekly: (isp.timeline || []).map((d: any) => ({ date: d.date, leads: d.leads || 0 })),
  };
  return { sarah, ispeed };
}

function aggregate(srcs: any[]) {
  const sum = (k: string) => srcs.reduce((a, s) => a + (s[k] || 0), 0);
  const contacted = sum('contacted');
  const spend = sum('spend');
  return {
    leadsPurchased: sum('leadsPurchased'), spend, contacted,
    hot: sum('hot'), warm: sum('warm'), cold: sum('cold'), dead: sum('dead'),
    qualified: sum('qualified'), appts: sum('appts'), deals: sum('deals'),
    revenue: sum('revenue'),
    costPerContact: contacted ? spend / contacted : 0,
  };
}

function Kpi({ icon, label, val, cls, delta }: any) {
  return (
    <div className="card kpi">
      <div className="label">{icon && <span className="ic">{icon}</span>}{label}</div>
      <div className={'val ' + (cls || '')}>{val}</div>
      {delta != null && <div className="delta">{delta}</div>}
    </div>
  );
}

function Funnel({ stages }: any) {
  const max = Math.max(1, ...stages.map((s: any) => s.value));
  const colors = [C.accent, '#28d17c', C.warm, C.accent2, C.ispeed];
  return (
    <div className="funnel">
      {stages.map((s: any, i: number) => {
        const w = Math.max(8, (s.value / max) * 100);
        const conv = i === 0 ? 100 : stages[0].value ? (s.value / stages[0].value) * 100 : 0;
        return (
          <div className="frow" key={s.label}>
            <div className="flabel">{s.label}</div>
            <div className="ftrack">
              <div className="ffill" style={{ width: w + '%', background: colors[i % colors.length] }}>{num(s.value)}</div>
            </div>
            <div className="fconv">{conv.toFixed(0)}%</div>
          </div>
        );
      })}
    </div>
  );
}

function TempDonut({ t }: any) {
  const data = [
    { name: 'Hot', value: t.hot, fill: C.hot },
    { name: 'Warm', value: t.warm, fill: C.warm },
    { name: 'Cold', value: t.cold, fill: C.cold },
    { name: 'Dead', value: t.dead, fill: C.dead },
  ].filter((d) => d.value > 0);
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="card">
      <h3>Lead Temperature</h3>
      {total === 0 ? <div className="empty">No temperature data in range.</div> : (
        <ResponsiveContainer width="100%" height={210}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={56} outerRadius={88} paddingAngle={3} stroke="none">
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
            <Tooltip contentStyle={tip} />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'DM Mono, monospace' }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function ISpeedTiers({ tiers }: any) {
  const defs = [
    { key: 'exclusive', cls: 'exclusive', sym: '◆', name: 'EXCLUSIVE', color: C.accent, note: 'Purchased exclusive leads · refund eligible' },
    { key: 'nonexclusive', cls: 'nonexclusive', sym: '◇', name: 'NON-EXCLUSIVE', color: C.accent2, note: 'Shared leads · refund eligible' },
    { key: 'leadpack', cls: 'leadpack', sym: '📋', name: 'LEAD PACK', color: C.warm, note: 'Received free · bonus balance' },
  ];
  const qmax = Math.max(0.0001, ...defs.map((d) => (tiers[d.key] || {}).qualifyRate || 0));
  return (
    <>
      <div className="grid g3">
        {defs.map((d) => {
          const t = tiers[d.key] || {};
          return (
            <div className={'tier ' + d.cls} key={d.key}>
              <div className="th">
                <div className="nm" style={{ color: d.color }}>{d.sym} {d.name}</div>
                <div className="ct mono">{num(t.purchased || 0)}</div>
              </div>
              <div className="stat"><span className="k">Purchased</span><span className="vv">{num(t.purchased || 0)}</span></div>
              <div className="stat"><span className="k">Contacted</span><span className="vv">{num(t.contacted || 0)}</span></div>
              <div className="stat"><span className="k">Hot</span><span className="vv v-hot">{num(t.hot || 0)}</span></div>
              <div className="stat"><span className="k">Deals</span><span className="vv v-accent">{num(t.deals || 0)}</span></div>
              {d.key === 'leadpack' ? (
                <div className="stat"><span className="k">Bonus balance</span><span className="vv v-warm">{fmt$0(t.spent || 0)} value</span></div>
              ) : (
                <>
                  <div className="stat"><span className="k">Refund eligible</span><span className="vv">{num(t.refundEligible || 0)}</span></div>
                  <div className="stat"><span className="k">Refunds pending</span><span className="vv v-warm">{num(t.refundsPending || 0)}</span></div>
                  <div className="stat"><span className="k">Recovered</span><span className="vv v-accent">{num(t.refundsRecovered || 0)} · {fmt$0(t.moneyRecovered || 0)}</span></div>
                </>
              )}
              <div className="footnote">{d.note}</div>
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Qualify Rate — 3-Way Compare</h3>
        <div className="qbar">
          {defs.map((d) => {
            const t = tiers[d.key] || {};
            const r = t.qualifyRate || 0;
            return (
              <div className="qrow" key={d.key}>
                <div className="ql" style={{ color: d.color }}>{d.sym} {d.name}</div>
                <div className="qtrack"><div className="qfill" style={{ width: (r / qmax) * 100 + '%', background: d.color }} /></div>
                <div className="qv">{pct(r)}</div>
              </div>
            );
          })}
        </div>
        <div className="footnote">Qualify rate = hot leads ÷ purchased, per tier.</div>
      </div>
    </>
  );
}

export default function MarketingIntelPage() {
  const [period, setPeriod] = useState('all');
  const [source, setSource] = useState('all');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<Date | null>(null);
  const timer = useRef<any>(null);

  const load = useCallback(() => {
    fetch(API_BASE + '/api/metrics?range=' + period)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { if (d.error) throw new Error(d.detail || d.error); setData(d); setErr(null); setLast(new Date()); })
      .catch((e) => setErr(e.message));
  }, [period]);

  useEffect(() => { load(); timer.current = setInterval(load, 30000); return () => clearInterval(timer.current); }, [load]);

  const model = useMemo(() => {
    if (!data) return null;
    const { sarah, ispeed } = buildSources(data);
    const active = source === 'sarah' ? [sarah] : source === 'ispeed' ? [ispeed] : [sarah, ispeed];
    const agg = aggregate(active);
    // merged weekly timeline
    const wk: Record<string, any> = {};
    if (source !== 'ppc') {
      for (const s of active) for (const p of s.weekly) {
        wk[p.date] = wk[p.date] || { date: p.date, sarah: 0, ispeed: 0, total: 0 };
        wk[p.date][s.key] += p.leads; wk[p.date].total += p.leads;
      }
    }
    const weekly = Object.values(wk).sort((a: any, b: any) => a.date.localeCompare(b.date));
    const volume = active.map((s) => ({ name: s.label, leads: s.leadsPurchased, fill: s.color }));
    return { sarah, ispeed, active, agg, weekly, volume };
  }, [data, source]);

  const showISpeed = source === 'all' || source === 'ispeed';
  const showSarah = source === 'all' || source === 'sarah';

  return (
    <div className="mi">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <div className="topbar">
          <div className="brand"><span className="dot" />
            <div>
              <h1>MARKETING <span className="accent">INTELLIGENCE</span></h1>
              <div className="sub">Jarvis Command Center · ROI across all lead channels</div>
            </div>
          </div>
          <div className="refresh"><span className="pulse" />{last ? 'updated ' + last.toLocaleTimeString() : 'connecting…'} · auto 30s</div>
        </div>

        <div className="bar">
          <div className="seg">
            {PERIODS.map((p) => (
              <button key={p.key} className={period === p.key ? 'active' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="bar">
          <div className="src">
            {SOURCES.map((s) => (
              <button key={s.key}
                className={(source === s.key ? 'active ' : '') + (s.locked ? 'locked' : '')}
                onClick={() => { if (!s.locked) setSource(s.key); }}>
                <span>{s.icon}</span>{s.label}
                {s.locked && <span className="soon">SOON</span>}
              </button>
            ))}
          </div>
        </div>

        {err && <div className="err">⚠️ {err} — retrying every 30s.</div>}
        {!data && !err && <div className="loading">Aggregating GHL + Supabase data…</div>}

        {source === 'ppc' ? (
          <div className="section">
            <h2>Property Leads PPC <span className="tag">not launched</span></h2>
            <div className="placeholder">
              <div className="lockbadge">🔒 COMING SOON</div>
              <div style={{ fontSize: 18, color: 'var(--text)', marginBottom: 6, fontWeight: 700 }}>PPC channel is wired & ready</div>
              <div>Once the pay-per-click campaign goes live, ad spend, clicks, and cost-per-lead will populate here automatically.</div>
            </div>
          </div>
        ) : model && (
          <>
            {/* KPI cards */}
            <div className="section">
              <h2>Performance KPIs <span className="tag">{SOURCES.find((s) => s.key === source)?.label}</span></h2>
              <div className="grid g4">
                <Kpi icon="🎯" label="Leads Purchased" val={num(model.agg.leadsPurchased)} cls="v-accent" />
                <Kpi icon="💸" label="Total Spend" val={fmt$0(model.agg.spend)} cls="v-warm" />
                <Kpi icon="📞" label="Leads Contacted" val={num(model.agg.contacted)} />
                <Kpi icon="🔥" label="Hot Leads" val={num(model.agg.hot)} cls="v-hot" />
              </div>
              <div className="grid g4" style={{ marginTop: 14 }}>
                <Kpi icon="📅" label="Appointments Set" val={num(model.agg.appts)} cls="v-cold" />
                <Kpi icon="🤝" label="Deals Closed" val={num(model.agg.deals)} cls="v-accent" />
                <Kpi icon="🧮" label="Cost / Contact" val={model.agg.contacted ? fmt$(model.agg.costPerContact) : '—'} />
                <Kpi icon="💰" label="Revenue Generated" val={fmt$0(model.agg.revenue)} cls="v-accent" />
              </div>
            </div>

            {/* Volume + Temperature */}
            <div className="section">
              <h2>Lead Volume & Temperature</h2>
              <div className="grid g2">
                <div className="card">
                  <h3>Lead Volume by Source</h3>
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={model.volume}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
                      <XAxis dataKey="name" stroke="#7a82a0" fontSize={11} />
                      <YAxis stroke="#7a82a0" fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={tip} cursor={{ fill: 'rgba(255,255,255,.03)' }} />
                      <Bar dataKey="leads" radius={[8, 8, 0, 0]}>
                        {model.volume.map((d: any, i: number) => <Cell key={i} fill={d.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <TempDonut t={model.agg} />
              </div>
            </div>

            {/* Funnel + Weekly trend */}
            <div className="section">
              <h2>Conversion Funnel & Trend</h2>
              <div className="grid g2">
                <div className="card">
                  <h3>Conversion Funnel</h3>
                  <Funnel stages={[
                    { label: 'Purchased', value: model.agg.leadsPurchased },
                    { label: 'Contacted', value: model.agg.contacted },
                    { label: 'Qualified', value: model.agg.qualified },
                    { label: 'Appt Set', value: model.agg.appts },
                    { label: 'Closed', value: model.agg.deals },
                  ]} />
                  <div className="footnote">% relative to purchased volume.</div>
                </div>
                <div className="card">
                  <h3>Weekly Lead Volume</h3>
                  {model.weekly.length === 0 ? <div className="empty">No dated lead activity in range.</div> : (
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={model.weekly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
                        <XAxis dataKey="date" stroke="#7a82a0" fontSize={10} />
                        <YAxis stroke="#7a82a0" fontSize={11} allowDecimals={false} />
                        <Tooltip contentStyle={tip} />
                        {source === 'all' && <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'DM Mono, monospace' }} />}
                        {showSarah && <Line type="monotone" dataKey="sarah" name="Sarah" stroke={C.sarah} strokeWidth={2} dot={{ r: 2 }} />}
                        {showISpeed && <Line type="monotone" dataKey="ispeed" name="iSpeed" stroke={C.ispeed} strokeWidth={2} dot={{ r: 2 }} />}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Cost efficiency table */}
            <div className="section">
              <h2>Cost Efficiency by Source</h2>
              <div className="card">
                <table>
                  <thead><tr><th>Source</th><th>Leads</th><th>Spend</th><th>Cost/Lead</th><th>Contacted</th><th>Cost/Contact</th><th>Deals</th><th>Revenue</th><th>ROI</th></tr></thead>
                  <tbody>
                    {model.active.map((s: any) => {
                      const cpl = s.leadsPurchased ? s.spend / s.leadsPurchased : 0;
                      const cpc = s.contacted ? s.spend / s.contacted : 0;
                      const roi = s.spend ? s.revenue / s.spend : 0;
                      return (
                        <tr key={s.key}>
                          <td className="src-name" style={{ color: s.color }}>{s.icon} {s.label}</td>
                          <td>{num(s.leadsPurchased)}</td>
                          <td>{fmt$0(s.spend)}</td>
                          <td>{s.leadsPurchased ? fmt$(cpl) : '—'}</td>
                          <td>{num(s.contacted)}</td>
                          <td>{s.contacted ? fmt$(cpc) : '—'}</td>
                          <td>{num(s.deals)}</td>
                          <td className="v-accent">{fmt$0(s.revenue)}</td>
                          <td className={roi >= 1 ? 'v-accent' : 'v-warm'}>{s.spend ? roi.toFixed(1) + '×' : '—'}</td>
                        </tr>
                      );
                    })}
                    {source === 'all' && (
                      <tr style={{ borderTop: '2px solid var(--border2)' }}>
                        <td className="src-name">◎ All Sources</td>
                        <td>{num(model.agg.leadsPurchased)}</td>
                        <td>{fmt$0(model.agg.spend)}</td>
                        <td>{model.agg.leadsPurchased ? fmt$(model.agg.spend / model.agg.leadsPurchased) : '—'}</td>
                        <td>{num(model.agg.contacted)}</td>
                        <td>{model.agg.contacted ? fmt$(model.agg.costPerContact) : '—'}</td>
                        <td>{num(model.agg.deals)}</td>
                        <td className="v-accent">{fmt$0(model.agg.revenue)}</td>
                        <td className={model.agg.spend && model.agg.revenue / model.agg.spend >= 1 ? 'v-accent' : 'v-warm'}>{model.agg.spend ? (model.agg.revenue / model.agg.spend).toFixed(1) + '×' : '—'}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* iSpeed 3-tier breakdown */}
            {showISpeed && data.ispeed && data.ispeed.tiers && (
              <div className="section">
                <h2>iSpeed Tier Breakdown <span className="tag">exclusive · non-exclusive · lead pack</span></h2>
                <ISpeedTiers tiers={data.ispeed.tiers} />
              </div>
            )}

            {/* Pipeline status */}
            <div className="section">
              <h2>Pipeline Status</h2>
              <div className="grid g4">
                {[
                  { k: 'hot', label: 'HOT', color: C.hot, v: model.agg.hot },
                  { k: 'warm', label: 'WARM', color: C.warm, v: model.agg.warm },
                  { k: 'cold', label: 'COLD', color: C.cold, v: model.agg.cold },
                  { k: 'dead', label: 'DEAD', color: C.dead, v: model.agg.dead },
                ].map((t) => {
                  const tot = model.agg.hot + model.agg.warm + model.agg.cold + model.agg.dead;
                  return (
                    <div className="tempcard" key={t.k} style={{ background: 'linear-gradient(180deg,' + t.color + '14, transparent)', borderColor: t.color + '44' }}>
                      <div className="tlabel" style={{ color: t.color }}>{t.label}</div>
                      <div className="tval" style={{ color: t.color }}>{num(t.v)}</div>
                      <div className="tpct">{tot ? pct(t.v / tot) : '0%'} of pipeline</div>
                    </div>
                  );
                })}
              </div>
              <div className="card" style={{ marginTop: 14 }}>
                <h3>Revenue vs $100K Monthly Target</h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <div className="mono" style={{ fontSize: 28, fontWeight: 500, color: C.accent }}>{fmt$0((data.master && data.master.revenueThisMonth) || 0)}</div>
                  <div className="sub mono">{pct(((data.master && data.master.revenueThisMonth) || 0) / REVENUE_GOAL)} of {fmt$0(REVENUE_GOAL)}</div>
                </div>
                <div className="barwrap"><div style={{ width: Math.min(100, (((data.master && data.master.revenueThisMonth) || 0) / REVENUE_GOAL) * 100) + '%' }} /></div>
                <div className="footnote">Company-wide closed revenue this month across all channels.</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
