'use client';

/**
 * /marketing-intel — Marketing Intel dashboard (dedicated route).
 *
 * Data comes from the VPS service (marketing-intel.js on :3008, exposed at
 * api.jarviscommandcenter.space/marketing-intel/api/*), NOT a Vercel function —
 * the Vercel project is at its 12 serverless-function cap, and the GHL note
 * parsing is too heavy for a serverless cold start. Mirrors the existing
 * "leads served from VPS dialer-server" pattern.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid,
  XAxis, YAxis, Tooltip, Legend, LineChart, Line, ComposedChart,
} from 'recharts';

const API_BASE = 'https://api.jarviscommandcenter.space/marketing-intel';

const fmt$ = (n: number) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmt$0 = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString();
const pct = (n: number) => ((Number(n) || 0) * 100).toFixed(1) + '%';
const num = (n: number) => (Number(n) || 0).toLocaleString();
const COLORS = { hot: '#ff4d5e', warm: '#ffb020', cold: '#3ba1ff', good: '#28d17c', accent: '#00e5ff', accent2: '#7c5cff' };
const tip = { background: '#111826', border: '1px solid #1d2942', borderRadius: 8 };

const CSS = `
:root{--bg:#0a0e17;--panel:#111826;--panel2:#0d1422;--border:#1d2942;--text:#e6edf7;--muted:#7c8db5;--accent:#00e5ff;--accent2:#7c5cff;--hot:#ff4d5e;--warm:#ffb020;--cold:#3ba1ff;--good:#28d17c;--bad:#ff4d5e;}
.mi *{box-sizing:border-box;}
.mi{min-height:100vh;background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;}
.mi a{color:var(--accent);}
.mi .wrap{max-width:1400px;margin:0 auto;padding:18px 16px 80px;}
.mi .topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px;}
.mi .brand{display:flex;align-items:center;gap:12px;}
.mi .brand h1{font-size:20px;margin:0;letter-spacing:.5px;}
.mi .brand .dot{width:10px;height:10px;border-radius:50%;background:var(--good);box-shadow:0 0 12px var(--good);}
.mi .sub{color:var(--muted);font-size:12px;}
.mi .controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.mi .seg{display:flex;background:var(--panel2);border:1px solid var(--border);border-radius:10px;overflow:hidden;}
.mi .seg button{background:transparent;color:var(--muted);border:0;padding:8px 14px;cursor:pointer;font-size:13px;}
.mi .seg button.active{background:var(--accent);color:#021018;font-weight:600;}
.mi .refresh{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;}
.mi .pulse{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:mipulse 1s infinite;}
@keyframes mipulse{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}
.mi .section{margin:26px 0 8px;}
.mi .section h2{font-size:14px;text-transform:uppercase;letter-spacing:1.5px;color:var(--accent);border-left:3px solid var(--accent);padding-left:10px;margin:0 0 14px;}
.mi .section h2 .tag{font-size:10px;color:var(--muted);letter-spacing:.5px;margin-left:8px;text-transform:none;}
.mi .grid{display:grid;gap:14px;}
.mi .g2{grid-template-columns:repeat(2,1fr);}
.mi .g3{grid-template-columns:repeat(3,1fr);}
.mi .g4{grid-template-columns:repeat(4,1fr);}
@media(max-width:900px){.mi .g3,.mi .g4{grid-template-columns:repeat(2,1fr);}}
@media(max-width:560px){.mi .g2,.mi .g3,.mi .g4{grid-template-columns:1fr;}}
.mi .card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--border);border-radius:14px;padding:16px;}
.mi .card.click{cursor:pointer;transition:transform .12s,border-color .12s;}
.mi .card.click:hover{transform:translateY(-2px);border-color:var(--accent);}
.mi .kpi .label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;}
.mi .kpi .val{font-size:28px;font-weight:700;margin-top:6px;}
.mi .kpi .delta{font-size:11px;margin-top:4px;color:var(--muted);}
.mi .v-hot{color:var(--hot)}.mi .v-warm{color:var(--warm)}.mi .v-cold{color:var(--cold)}
.mi .v-good{color:var(--good)}.mi .v-bad{color:var(--bad)}.mi .v-accent{color:var(--accent)}
.mi table{width:100%;border-collapse:collapse;font-size:13px;}
.mi th,.mi td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);}
.mi th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
.mi tr.click{cursor:pointer;}
.mi tr.click:hover td{background:rgba(0,229,255,.06);}
.mi .chip{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;}
.mi .chip.hot{background:rgba(255,77,94,.15);color:var(--hot)}
.mi .chip.warm{background:rgba(255,176,32,.15);color:var(--warm)}
.mi .chip.cold{background:rgba(59,161,255,.15);color:var(--cold)}
.mi .chip.deal{background:rgba(40,209,124,.15);color:var(--good)}
.mi .chip.alert{background:rgba(255,77,94,.2);color:var(--hot)}
.mi .chip.soon{background:rgba(255,176,32,.2);color:var(--warm)}
.mi input[type=number],.mi input[type=text]{background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;font-size:14px;width:100%;}
.mi label.fld{display:block;font-size:11px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px;}
.mi button.act{background:var(--accent);color:#021018;border:0;border-radius:8px;padding:9px 16px;font-weight:600;cursor:pointer;font-size:13px;}
.mi .barwrap{background:var(--panel2);border-radius:20px;height:14px;overflow:hidden;border:1px solid var(--border);}
.mi .barwrap>div{height:100%;background:linear-gradient(90deg,var(--accent2),var(--accent));}
.mi .heat td.cell{text-align:center;font-weight:600;color:#021018;border:1px solid var(--bg);}
.mi .modal-bg{position:fixed;inset:0;background:rgba(2,6,14,.75);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;z-index:50;overflow:auto;}
.mi .modal{background:var(--panel);border:1px solid var(--border);border-radius:16px;max-width:1050px;width:100%;padding:20px;}
.mi .modal h3{margin:0 0 4px;}
.mi .x{float:right;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;}
.mi .empty{color:var(--muted);font-size:14px;text-align:center;padding:40px;}
.mi .loading{text-align:center;padding:80px;color:var(--muted);}
.mi .err{background:rgba(255,77,94,.1);border:1px solid var(--hot);color:#ffb3bb;padding:14px;border-radius:10px;margin:14px 0;}
.mi .footnote{font-size:10px;color:var(--muted);margin-top:6px;}
.mi .placeholder{border:1px dashed var(--border);border-radius:14px;padding:30px;text-align:center;color:var(--muted);}
`;

const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'Ungraded'];
function gradeColor(g: string) {
  if (g.startsWith('A')) return COLORS.good;
  if (g.startsWith('B')) return COLORS.accent;
  if (g.startsWith('C')) return COLORS.warm;
  if (g.startsWith('D')) return COLORS.hot;
  return '#5a6b8c';
}

function Kpi({ label, val, cls, delta, onClick }: any) {
  return (
    <div className={'card kpi' + (onClick ? ' click' : '')} onClick={onClick}>
      <div className="label">{label}</div>
      <div className={'val ' + (cls || '')}>{val}</div>
      {delta != null && <div className="delta">{delta}</div>}
    </div>
  );
}

function Gauge({ value, goal }: any) {
  const p = Math.max(0, Math.min(1, goal ? value / goal : 0));
  const data = [{ name: 'v', value: p * 100 }, { name: 'r', value: 100 - p * 100 }];
  return (
    <div className="card">
      <div className="kpi"><div className="label">Revenue vs $100k/mo Goal</div></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <ResponsiveContainer width={180} height={120}>
          <PieChart>
            <Pie data={data} startAngle={180} endAngle={0} innerRadius={55} outerRadius={80} dataKey="value" stroke="none">
              <Cell fill={COLORS.good} /><Cell fill="#1d2942" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>{fmt$0(value)}</div>
          <div className="sub">{pct(p)} of {fmt$0(goal)} this month</div>
        </div>
      </div>
    </div>
  );
}

function MasterROI({ m, onDrill }: any) {
  const roiData = [
    { name: 'Cold Calling', ROI: +(m.roiByChannel.cold || 0).toFixed(2), spend: m.spendByChannel.cold, rev: m.revenueByChannel.cold },
    { name: 'iSpeed', ROI: +(m.roiByChannel.ispeed || 0).toFixed(2), spend: m.spendByChannel.ispeed, rev: m.revenueByChannel.ispeed },
    { name: 'PPC', ROI: +(m.roiByChannel.ppc || 0).toFixed(2), spend: m.spendByChannel.ppc, rev: m.revenueByChannel.ppc },
  ];
  return (
    <div className="section">
      <h2>Master ROI <span className="tag">all channels combined</span></h2>
      <div className="grid g4">
        <Kpi label="Total Marketing Spend" val={fmt$0(m.totalSpend)} cls="v-warm" />
        <Kpi label="Total Revenue (closed)" val={fmt$0(m.totalRevenue)} cls="v-good" onClick={() => onDrill('revenue')} />
        <Kpi label="Overall ROI" val={(m.roiMultiplier || 0).toFixed(2) + '×'} cls={m.roiMultiplier >= 1 ? 'v-good' : 'v-bad'} />
        <Kpi label="Revenue This Month" val={fmt$0(m.revenueThisMonth)} cls="v-accent" />
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <Gauge value={m.revenueThisMonth} goal={m.revenueGoal} />
        <div className="card">
          <div className="kpi"><div className="label">ROI by Channel</div></div>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={roiData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1d2942" />
              <XAxis dataKey="name" stroke="#7c8db5" fontSize={11} />
              <YAxis stroke="#7c8db5" fontSize={11} />
              <Tooltip contentStyle={tip} formatter={(v: any, k: any) => (k === 'ROI' ? [v + '×', 'ROI'] : [fmt$0(v), k])} />
              <Bar dataKey="ROI" radius={[6, 6, 0, 0]}>
                {roiData.map((d, i) => <Cell key={i} fill={d.ROI >= 1 ? COLORS.good : COLORS.accent2} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function ColdCalling({ c, onDrill }: any) {
  const tl = (c.timeline || []).map((d: any) => ({ ...d }));
  return (
    <div className="section">
      <h2>Channel 1 · Cold Calling <span className="tag">David/Sarah multi-dialer · Telnyx + Thunder</span></h2>
      <div className="grid g4">
        <Kpi label="Total Dials" val={num(c.totalDials)} />
        <Kpi label="Answer Rate" val={pct(c.answerRate)} cls="v-accent" />
        <Kpi label="HOT" val={num(c.hot)} cls="v-hot" onClick={() => onDrill('cold', 'temp', 'hot')} />
        <Kpi label="WARM / COLD" val={num(c.warm) + ' / ' + num(c.cold)} cls="v-warm" />
      </div>
      <div className="grid g4" style={{ marginTop: 14 }}>
        <Kpi label="Telnyx Cost ($0.002/min)" val={fmt$(c.telnyxCost)} />
        <Kpi label="Thunder Cost ($0.50/hr)" val={fmt$(c.thunderCost)} />
        <Kpi label="Cost / HOT Lead" val={c.hot ? fmt$(c.costPerHot) : '—'} />
        <Kpi label="Cost / Deal" val={c.deals ? fmt$(c.costPerDeal) : '—'} delta={(c.deals || 0) + ' deals'} />
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="kpi"><div className="label">Leads Over Time</div></div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={tl}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1d2942" />
              <XAxis dataKey="date" stroke="#7c8db5" fontSize={10} />
              <YAxis stroke="#7c8db5" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={tip} />
              <Line type="monotone" dataKey="leads" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="kpi"><div className="label">HOT / WARM / COLD by Day</div></div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tl}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1d2942" />
              <XAxis dataKey="date" stroke="#7c8db5" fontSize={10} />
              <YAxis stroke="#7c8db5" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={tip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="hot" stackId="a" fill={COLORS.hot} />
              <Bar dataKey="warm" stackId="a" fill={COLORS.warm} />
              <Bar dataKey="cold" stackId="a" fill={COLORS.cold} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function ISpeed({ s, onDrill }: any) {
  const grades = GRADE_ORDER.filter((g) => s.byGrade[g] && s.byGrade[g].leads > 0);
  const gradeData = grades.map((g) => ({ name: g, leads: s.byGrade[g].leads, conv: +(s.byGrade[g].convRate * 100).toFixed(1) }));
  const types = Object.keys(s.byType).filter((t) => s.byType[t].leads > 0);
  const typeData = types.map((t) => ({ name: t, value: s.byType[t].leads }));
  const typePalette = [COLORS.accent, COLORS.accent2, COLORS.warm, COLORS.good, '#5a6b8c'];
  return (
    <div className="section">
      <h2>Channel 2 · iSpeed To Lead <span className="tag">purchased CRM leads · {num(s.totalLeads)} leads</span></h2>
      <div className="grid g4">
        <Kpi label="Leads Purchased" val={num(s.totalLeads)} onClick={() => onDrill('ispeed')} />
        <Kpi label="Total Spent" val={fmt$0(s.totalSpent)} cls="v-warm" />
        <Kpi label="Avg Cost / Lead" val={fmt$(s.avgCostPerLead)} />
        <Kpi label="Conversion → Deal" val={pct(s.conversionRate)} cls="v-good" delta={num(s.deals) + ' deals · ' + (s.deals ? fmt$(s.costPerDeal) + '/deal' : '—')} onClick={() => onDrill('ispeed', 'deals', 'true')} />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="kpi"><div className="label">Leads & Conversion by Predictor Grade</div></div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={gradeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1d2942" />
              <XAxis dataKey="name" stroke="#7c8db5" fontSize={11} />
              <YAxis yAxisId="l" stroke="#7c8db5" fontSize={11} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" stroke="#28d17c" fontSize={11} unit="%" />
              <Tooltip contentStyle={tip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="leads" radius={[6, 6, 0, 0]}>
                {gradeData.map((d, i) => <Cell key={i} fill={gradeColor(d.name)} />)}
              </Bar>
              <Line yAxisId="r" type="monotone" dataKey="conv" name="conv %" stroke={COLORS.good} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="kpi"><div className="label">Lead Type Breakdown</div></div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={typeData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                {typeData.map((d, i) => <Cell key={i} fill={typePalette[i % typePalette.length]} />)}
              </Pie>
              <Tooltip contentStyle={tip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="footnote">Lead type inferred from note keywords + price (paid→exclusive, $0→free).</div>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="kpi"><div className="label">By Grade — conversion & cost per deal</div></div>
          <table>
            <thead><tr><th>Grade</th><th>Leads</th><th>Deals</th><th>Conv</th><th>Avg Cost</th><th>$/Deal</th></tr></thead>
            <tbody>{grades.map((g) => { const b = s.byGrade[g]; return (
              <tr key={g} className="click" onClick={() => onDrill('ispeed', 'grade', g)}>
                <td><span className="chip" style={{ background: gradeColor(g) + '22', color: gradeColor(g) }}>{g}</span></td>
                <td>{b.leads}</td><td>{b.deals}</td><td>{pct(b.convRate)}</td><td>{fmt$(b.avgCost)}</td><td>{b.deals ? fmt$(b.costPerDeal) : '—'}</td>
              </tr>); })}</tbody>
          </table>
        </div>
        <div className="card">
          <div className="kpi"><div className="label">By Type — conversion & cost per deal</div></div>
          <table>
            <thead><tr><th>Type</th><th>Leads</th><th>Deals</th><th>Conv</th><th>Avg Cost</th><th>$/Deal</th></tr></thead>
            <tbody>{types.map((t) => { const b = s.byType[t]; return (
              <tr key={t} className="click" onClick={() => onDrill('ispeed', 'type', t)}>
                <td style={{ textTransform: 'capitalize' }}>{t}</td>
                <td>{b.leads}</td><td>{b.deals}</td><td>{pct(b.convRate)}</td><td>{fmt$(b.avgCost)}</td><td>{b.deals ? fmt$(b.costPerDeal) : '—'}</td>
              </tr>); })}</tbody>
          </table>
        </div>
      </div>

      <RefundTracking s={s} />
      <BudgetROI s={s} />
    </div>
  );
}

function RefundTracking({ s }: any) {
  const r = s.refund;
  const alerts = s.deadlineAlerts || [];
  return (
    <div style={{ marginTop: 14 }}>
      <div className="grid g4">
        <Kpi label="Refunds Requested" val={num(r.requested)} cls="v-warm" />
        <Kpi label="Approved / Denied" val={num(r.approved) + ' / ' + num(r.denied)} cls="v-good" />
        <Kpi label="Pending" val={num(r.pending)} />
        <Kpi label="Money Recovered" val={fmt$0(r.moneyRecovered)} cls="v-good" />
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="kpi"><div className="label">⚠️ Refund Deadline Alerts (≤ 7 days)</div></div>
        {alerts.length === 0 ? <div className="empty">No leads with refund deadlines inside 7 days.</div> : (
          <table>
            <thead><tr><th>Lead</th><th>Provider</th><th>Grade</th><th>Paid</th><th>Deadline</th><th>Days Left</th></tr></thead>
            <tbody>{alerts.map((a: any) => {
              const danger = a.daysLeft <= 2;
              return (
                <tr key={a.id}>
                  <td>{a.name}<div className="sub">{a.address || ''}</div></td>
                  <td>{a.provider || '—'}</td><td>{a.grade || '—'}</td><td>{a.pricePaid != null ? fmt$(a.pricePaid) : '—'}</td>
                  <td>{new Date(a.refundDeadline).toLocaleDateString()}</td>
                  <td><span className={'chip ' + (danger ? 'alert' : 'soon')}>{a.daysLeft < 0 ? Math.abs(a.daysLeft) + 'd overdue' : a.daysLeft + 'd'}</span></td>
                </tr>);
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BudgetROI({ s }: any) {
  const [budget, setBudget] = useState<number | string>(0);
  const [saved, setSaved] = useState(false);
  const [invest, setInvest] = useState(1000);
  useEffect(() => { fetch(API_BASE + '/api/settings').then((r) => r.json()).then((d) => setBudget(d.ispeedBudget || 0)).catch(() => {}); }, []);
  const save = () => {
    fetch(API_BASE + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ispeedBudget: Number(budget) }) })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }).catch(() => {});
  };
  const remaining = Number(budget) - s.totalSpent;
  const convRate = s.conversionRate || 0;
  const avgCost = s.avgCostPerLead || 1;
  const projLeads = avgCost ? Math.floor(invest / avgCost) : 0;
  const projDeals = projLeads * convRate;
  const avgDealValue = 10000;
  const projReturn = projDeals * avgDealValue;
  return (
    <div className="grid g2" style={{ marginTop: 14 }}>
      <div className="card">
        <div className="kpi"><div className="label">Marketing Budget (iSpeed)</div></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 6 }}>
          <div style={{ flex: 1 }}><label className="fld">Monthly budget ($)</label>
            <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
          <button className="act" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="sub">Spent {fmt$0(s.totalSpent)} of {fmt$0(Number(budget))} · <span className={remaining >= 0 ? 'v-good' : 'v-bad'}>{remaining >= 0 ? fmt$0(remaining) + ' remaining' : fmt$0(-remaining) + ' over'}</span></div>
          <div className="barwrap" style={{ marginTop: 8 }}><div style={{ width: Math.min(100, Number(budget) ? s.totalSpent / Number(budget) * 100 : 0) + '%' }} /></div>
        </div>
      </div>
      <div className="card">
        <div className="kpi"><div className="label">ROI Calculator</div></div>
        <label className="fld">Planned investment ($)</label>
        <input type="number" value={invest} onChange={(e) => setInvest(Number(e.target.value) || 0)} />
        <div className="grid g3" style={{ marginTop: 12 }}>
          <div><div className="sub">Proj. leads</div><div style={{ fontSize: 20, fontWeight: 700 }}>{num(projLeads)}</div></div>
          <div><div className="sub">Proj. deals</div><div className="v-good" style={{ fontSize: 20, fontWeight: 700 }}>{projDeals.toFixed(1)}</div></div>
          <div><div className="sub">Proj. return*</div><div className="v-good" style={{ fontSize: 20, fontWeight: 700 }}>{fmt$0(projReturn)}</div></div>
        </div>
        <div className="footnote">*Based on historical conversion {pct(convRate)} &amp; avg cost/lead {fmt$(avgCost)}; assumes ${num(avgDealValue)} avg profit/deal.</div>
      </div>
    </div>
  );
}

function PPC() {
  return (
    <div className="section">
      <h2>Channel 3 · Property Leads PPC <span className="tag">not launched</span></h2>
      <div className="placeholder">
        <div style={{ fontSize: 34, marginBottom: 8 }}>🚧</div>
        <div style={{ fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>PPC campaign not live yet</div>
        <div>This channel is wired and ready. Once PPC launches, plug in the fields below.</div>
        <div className="grid g4" style={{ marginTop: 18, opacity: .6, maxWidth: 760, marginLeft: 'auto', marginRight: 'auto' }}>
          <div><label className="fld">Ad Spend</label><input type="number" placeholder="$0" disabled /></div>
          <div><label className="fld">Clicks</label><input type="number" placeholder="0" disabled /></div>
          <div><label className="fld">Leads</label><input type="number" placeholder="0" disabled /></div>
          <div><label className="fld">Cost / Lead</label><input type="text" placeholder="—" disabled /></div>
        </div>
      </div>
    </div>
  );
}

function GradeIntel({ gradeMarket }: any) {
  const grades = GRADE_ORDER.filter((g) => gradeMarket[g]);
  const marketSet = new Set<string>();
  grades.forEach((g) => Object.keys(gradeMarket[g]).forEach((m) => marketSet.add(m)));
  const vol = (m: string) => grades.reduce((a, g) => a + ((gradeMarket[g][m] || {}).leads || 0), 0);
  const markets = Array.from(marketSet).sort((a, b) => vol(b) - vol(a)).slice(0, 12);
  const heatColor = (rate: number, leads: number) => {
    if (!leads) return '#0d1422';
    const t = Math.min(1, rate * 4);
    return `rgba(40,209,124,${0.12 + t * 0.85})`;
  };
  if (grades.length === 0) return null;
  return (
    <div className="section">
      <h2>Predictor Grade Intelligence <span className="tag">conversion by grade × market</span></h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="heat">
          <thead><tr><th>Grade \ Market</th>{markets.map((m) => <th key={m} style={{ textAlign: 'center' }}>{m}</th>)}<th style={{ textAlign: 'center' }}>All</th></tr></thead>
          <tbody>{grades.map((g) => {
            const allLeads = Object.values(gradeMarket[g]).reduce((a: number, c: any) => a + c.leads, 0) as number;
            const allDeals = Object.values(gradeMarket[g]).reduce((a: number, c: any) => a + c.deals, 0) as number;
            return (
              <tr key={g}>
                <td><span className="chip" style={{ background: gradeColor(g) + '22', color: gradeColor(g) }}>{g}</span></td>
                {markets.map((m) => {
                  const c = gradeMarket[g][m];
                  const rate = c && c.leads ? c.deals / c.leads : 0;
                  return (
                    <td key={m} className="cell" style={{ background: heatColor(rate, c && c.leads) }} title={c ? `${c.deals}/${c.leads} deals` : 'no leads'}>
                      {c && c.leads ? (c.deals > 0 ? pct(rate) : c.leads) : '·'}
                    </td>);
                })}
                <td className="cell" style={{ background: heatColor(allLeads ? allDeals / allLeads : 0, allLeads) }}>{allLeads ? (allDeals > 0 ? pct(allDeals / allLeads) : allLeads) : '·'}</td>
              </tr>);
          })}</tbody>
        </table>
        <div className="footnote">Cell shows conversion % when ≥1 deal, else lead count. Greener = higher conversion. Hover for deals/leads.</div>
      </div>
    </div>
  );
}

function Drill({ q, range, onClose }: any) {
  const [leads, setLeads] = useState<any[] | null>(null);
  useEffect(() => {
    const u = new URL(API_BASE + '/api/leads');
    u.searchParams.set('range', range);
    Object.entries(q.params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    u.searchParams.set('channel', q.channel);
    fetch(u.toString()).then((r) => r.json()).then((d) => setLeads(d.leads || [])).catch(() => setLeads([]));
  }, []);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className="x" onClick={onClose}>×</span>
        <h3>{q.title}</h3>
        <div className="sub" style={{ marginBottom: 12 }}>{leads ? leads.length + ' records' : 'loading…'}</div>
        {!leads ? <div className="loading">Loading…</div> :
          leads.length === 0 ? <div className="empty">No matching leads.</div> :
            q.channel === 'revenue' ? (
              <table>
                <thead><tr><th>Deal</th><th>Channel</th><th>Stage</th><th>Value</th></tr></thead>
                <tbody>{leads.map((l: any) => <tr key={l.id}><td>{l.name}</td><td style={{ textTransform: 'capitalize' }}>{l.channel}</td><td>{l.stage}</td><td className="v-good">{fmt$0(l.value)}</td></tr>)}</tbody>
              </table>
            ) : (
              <table>
                <thead><tr><th>Lead</th><th>Grade</th><th>Type</th><th>Stage</th><th>Paid</th><th>Motivation</th><th>Timeline</th></tr></thead>
                <tbody>{leads.map((l: any) => (
                  <tr key={l.id}>
                    <td>{l.name}<div className="sub">{l.address || l.phone || ''}</div></td>
                    <td>{l.grade || '—'}</td><td style={{ textTransform: 'capitalize' }}>{l.leadType || '—'}</td>
                    <td><span className={'chip ' + (l.isDeal ? 'deal' : l.temp || '')}>{l.stage}</span></td>
                    <td>{l.pricePaid != null ? fmt$(l.pricePaid) : '—'}</td>
                    <td style={{ maxWidth: 200 }}>{l.motivation || '—'}</td><td>{l.timeline || '—'}</td>
                  </tr>))}</tbody>
              </table>
            )}
      </div>
    </div>
  );
}

export default function MarketingIntelPage() {
  const [range, setRange] = useState('all');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drill, setDrill] = useState<any>(null);
  const [last, setLast] = useState<Date | null>(null);
  const timer = useRef<any>(null);

  const load = useCallback(() => {
    fetch(API_BASE + '/api/metrics?range=' + range)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { if (d.error) throw new Error(d.detail || d.error); setData(d); setErr(null); setLast(new Date()); })
      .catch((e) => setErr(e.message));
  }, [range]);

  useEffect(() => { load(); timer.current = setInterval(load, 30000); return () => clearInterval(timer.current); }, [load]);

  const onDrill = (channel: string, key?: string, val?: string) => {
    if (channel === 'cold') return; // cold per-lead drill not backed by /api/leads
    const titles: any = { revenue: 'Closed Deals — Revenue', ispeed: 'iSpeed Leads' };
    let title = titles[channel] || 'Leads';
    const params: any = {};
    if (key) { params[key] = val; title += ` · ${key}=${val}`; }
    setDrill({ channel, params, title });
  };

  return (
    <div className="mi">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <div className="topbar">
          <div className="brand"><span className="dot" />
            <div><h1>MARKETING INTEL</h1><div className="sub">Jarvis Command Center · ROI across all channels</div></div>
          </div>
          <div className="controls">
            <div className="seg">
              {['today', 'week', 'month', 'all'].map((r) =>
                <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r[0].toUpperCase() + r.slice(1)}</button>)}
            </div>
            <div className="refresh"><span className="pulse" />{last ? 'updated ' + last.toLocaleTimeString() : 'live'} · 30s</div>
          </div>
        </div>

        {err && <div className="err">⚠️ {err} — retrying every 30s.</div>}
        {!data && !err && <div className="loading">Aggregating GHL + Supabase data…</div>}

        {data && (
          <>
            <MasterROI m={data.master} onDrill={onDrill} />
            <ColdCalling c={data.cold} onDrill={onDrill} />
            <ISpeed s={data.ispeed} onDrill={onDrill} />
            <GradeIntel gradeMarket={data.ispeed.gradeMarket} />
            <PPC />
          </>
        )}

        {drill && <Drill q={drill} range={range} onClose={() => setDrill(null)} />}
      </div>
    </div>
  );
}
