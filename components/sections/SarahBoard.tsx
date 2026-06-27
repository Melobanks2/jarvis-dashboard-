'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, Clock, MapPin, FileText, Check, X, Send, Loader2, Radio,
  AlertTriangle, ChevronDown, History, DollarSign, CalendarClock,
  Flame, Building2, Target, GripVertical, Copy,
  LayoutGrid, Table2, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead, Temp, CallRecord, LEADS_API } from '@/lib/hooks/useLeads';
import { timeAgo, fmtTime } from '@/lib/supabase';

/* ─────────────────────────── palette / helpers ─────────────────────────── */

const TEMP: Record<Temp, { c: string; label: string }> = {
  hot:  { c: '#f87171', label: 'HOT'  },
  warm: { c: '#fb923c', label: 'WARM' },
  cold: { c: '#60a5fa', label: 'COLD' },
  dead: { c: '#5a5a80', label: 'DEAD' },
  new:  { c: '#67e8f9', label: 'NEW'  },
};

const ISPEED_PIPELINE = 'VJwMSSMaP8KhiPiUfSG0';

// Normalize a stage label (strip emoji / spacing / case) for matching.
const normStage = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function fmtDuration(sec?: number | null) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function epochDate(ms?: number | null) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

// Refund-window economics for an iSpeed lead → color-coded urgency.
type RefundUrgency = 'safe' | 'warn' | 'danger' | 'expired';
interface RefundMeta { days: number; color: string; urgency: RefundUrgency; cost: number | null; purchasedAt: number | null; }
function refundMeta(lead: Lead): RefundMeta | null {
  if (lead.source !== 'ispeed' || lead.daysUntilDeadline == null) return null;
  const d = lead.daysUntilDeadline;
  let color = '#4ade80', urgency: RefundUrgency = 'safe';
  if (d < 0)                                   { color = '#5a5a80'; urgency = 'expired'; }
  else if (lead.deadlineUrgent || d <= 5)      { color = '#f87171'; urgency = 'danger';  }
  else if (d <= 12)                            { color = '#fbbf24'; urgency = 'warn';    }
  return { days: d, color, urgency, cost: lead.purchasePrice ?? null, purchasedAt: lead.purchasedAt ?? null };
}

function attemptCount(lead: Lead) {
  if (lead.attempts != null) return lead.attempts;
  return lead.callHistory?.length ?? 0;
}

function fmtPhone(p?: string | null) {
  if (!p) return '';
  const d = p.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

// One-click copy with a brief check confirmation. Stops propagation so copying
// from a card doesn't also open the detail modal / start a drag.
function CopyBtn({ text, label, size = 11 }: { text: string; label?: string; size?: number }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }).catch(() => {});
      }}
      title={label ? `Copy ${label}` : 'Copy'}
      aria-label={label ? `Copy ${label}` : 'Copy'}
      className="flex-shrink-0 transition-colors hover:text-ncyan"
      style={{ color: done ? '#4ade80' : '#52526e', lineHeight: 0 }}
    >
      {done ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

// A clean, paste-anywhere text block of the whole lead.
function buildLeadText(lead: Lead): string {
  const out: string[] = [lead.name];
  if (lead.address) out.push(lead.address);
  if (lead.phone)   out.push(fmtPhone(lead.phone));
  out.push('');
  const add = (k: string, v: string | number | null | undefined) => { if (v != null && v !== '') out.push(`${k}: ${v}`); };
  add('Motivation', lead.pain);
  add('Timeline', lead.timeline);
  add('Asking', lead.askingPrice);
  add('Condition', lead.condition);
  add('ARV', lead.arv);
  add('Market value', lead.marketValue);
  add('Rehab', lead.rehabCost);
  add('Occupancy', lead.occupancy);
  add('Mortgage', lead.mortgage);
  add('Deal type', lead.dealType);
  add('Stage', lead.stageName);
  add('Attempts', attemptCount(lead));
  if (lead.source === 'ispeed') {
    add('Lead cost', lead.purchasePrice != null ? `$${lead.purchasePrice}` : null);
    add('Provider', lead.provider);
    add('Lead source', lead.leadSource);
    add('Refund in', lead.daysUntilDeadline != null ? `${lead.daysUntilDeadline}d` : null);
  }
  return out.join('\n');
}

// "Copy lead" button — copies the full formatted block.
function CopyLeadBtn({ lead }: { lead: Lead }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard?.writeText(buildLeadText(lead)).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }).catch(() => {});
      }}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors flex-shrink-0"
      style={{
        color:       done ? '#4ade80' : '#67e8f9',
        borderColor: done ? 'rgba(74,222,128,0.35)' : 'rgba(103,232,249,0.3)',
        background:  done ? 'rgba(74,222,128,0.08)' : 'rgba(103,232,249,0.06)',
      }}
    >
      {done ? <Check size={11} /> : <Copy size={11} />}
      {done ? 'Copied' : 'Copy lead'}
    </button>
  );
}

const FADE_UP = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };

type TimeRange = 'all' | 'today' | '7d' | '30d';
const RANGE_TABS: { key: TimeRange; label: string }[] = [
  { key: 'all',   label: 'All' },
  { key: 'today', label: 'Today' },
  { key: '7d',    label: '7 days' },
  { key: '30d',   label: '30 days' },
];

function inRange(lead: Lead, range: TimeRange): boolean {
  if (range === 'all') return true;
  const iso = lead.createdAt || lead.updatedAt;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (range === 'today') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return t >= start.getTime();
  }
  const days = range === '7d' ? 7 : 30;
  return t >= Date.now() - days * 86400000;
}

/* ─────────────────── live-call → board glow (which lead is on the phone) ─────────────────── */

const digits10 = (p?: string | null) => (p ? p.replace(/\D/g, '').slice(-10) : '');

// Polls /dialer/sarah-live and returns the set of phone keys currently on a call,
// so the board can glow whichever lead Sarah is actively dialing.
function useSarahLiveKeys(): Set<string> {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const r = await fetch(`${LEADS_API}/sarah-live`);
        const j = await r.json();
        if (!on) return;
        const s = new Set<string>();
        for (const c of (j.calls || [])) { const k = digits10(c.phone); if (k) s.add(k); }
        setKeys(s);
      } catch { /* keep last */ }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { on = false; clearInterval(id); };
  }, []);
  return keys;
}

/* ─────────────────────────────── main board ─────────────────────────────── */

export function SarahBoard() {
  const { refreshKey, refresh } = useApp();
  const { leads, pipelines, live, callsToday, loading, error } = useLeads(refreshKey);
  const liveKeys = useSarahLiveKeys();

  const [range, setRange] = useState<TimeRange>('all');
  const [view, setView]   = useState<'board' | 'table'>('board');

  // Optimistic local mirror for drag-drop stage moves.
  const [localLeads, setLocalLeads] = useState<Lead[]>([]);
  useEffect(() => { setLocalLeads(leads); }, [leads]);

  // Sarah works iSpeed (raised-hand) leads only.
  const ispeed = useMemo(
    () => localLeads.filter(l => l.source === 'ispeed' && inRange(l, range)),
    [localLeads, range]
  );

  const ispeedPipelines = useMemo(() => pipelines.filter(p => p.source === 'ispeed'), [pipelines]);

  const metrics = useMemo(() => {
    const atRisk = ispeed.filter(l => {
      const r = refundMeta(l);
      return r && (r.urgency === 'danger' || r.urgency === 'warn');
    });
    const capitalAtRisk = atRisk.reduce((sum, l) => sum + (l.purchasePrice || 0), 0);
    const invested = ispeed.reduce((sum, l) => sum + (l.purchasePrice || 0), 0);
    return {
      total: ispeed.length,
      hot:   ispeed.filter(l => l.temp === 'hot').length,
      warm:  ispeed.filter(l => l.temp === 'warm').length,
      atRisk: atRisk.length,
      capitalAtRisk,
      invested,
    };
  }, [ispeed]);

  async function moveStage(lead: Lead, stageName: string) {
    if (normStage(lead.stageName) === normStage(stageName) || !lead.contactId) return;
    setLocalLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, stageName } : l)));
    try {
      await fetch(`${LEADS_API}/lead-action?action=setstage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: lead.contactId, pipelineId: lead.pipelineId || ISPEED_PIPELINE, stageName,
          name: lead.name, address: lead.address,
        }),
      });
    } catch { /* next 30s refresh reconciles */ }
  }

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">

      {/* intro line */}
      <motion.div variants={FADE_UP} className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div className="text-[15px] font-semibold text-textb">Opportunity Board</div>
          <div className="text-[11px] text-dimtext mt-0.5">
            Raised-hand iSpeed sellers — Sarah qualifies these one-by-one before the refund window closes.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <TimeToggle range={range} onChange={setRange} />
          <button onClick={refresh} className="text-[10px] text-dimtext hover:text-ncyan transition-colors px-2 py-1.5">↻ Refresh</button>
        </div>
      </motion.div>

      {/* stat strip */}
      <motion.div variants={FADE_UP}>
        <StatStrip m={metrics} callsToday={callsToday} />
      </motion.div>

      {/* hot — call these now */}
      <motion.div variants={FADE_UP}>
        <HotStrip leads={ispeed} />
      </motion.div>

      {/* live in-call transcript — streams Sarah's current call in real time */}
      <motion.div variants={FADE_UP}>
        <LiveTranscriptPanel />
      </motion.div>

      {/* recent calls today */}
      <motion.div variants={FADE_UP}>
        <LivePanel live={live} />
      </motion.div>

      {error && (
        <div className="text-nred text-[11px] italic py-2">Failed to load leads: {error}</div>
      )}
      {loading && localLeads.length === 0 && (
        <div className="flex items-center gap-2 text-dimtext text-[11px] py-10 justify-center">
          <Loader2 size={14} className="animate-spin" /> Loading iSpeed opportunities…
        </div>
      )}

      {/* board / table */}
      {!loading && (
        <motion.div variants={FADE_UP}>
          {view === 'board'
            ? <Board leads={ispeed} pipelines={ispeedPipelines} onMove={moveStage} liveKeys={liveKeys} />
            : <LeadTable leads={ispeed} pipelines={ispeedPipelines} onMove={moveStage} liveKeys={liveKeys} />}
        </motion.div>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────── time toggle ─────────────────────────────── */

function TimeToggle({ range, onChange }: { range: TimeRange; onChange: (r: TimeRange) => void }) {
  return (
    <div className="flex items-center rounded-md border border-border2 overflow-hidden">
      {RANGE_TABS.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className="px-2.5 py-1.5 text-[10px] font-medium transition-colors"
          style={{
            color: range === t.key ? '#0c0d14' : '#52526e',
            background: range === t.key ? '#fbbf24' : 'transparent',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────── view toggle ─────────────────────────────── */

function ViewToggle({ view, onChange }: { view: 'board' | 'table'; onChange: (v: 'board' | 'table') => void }) {
  const opts = [
    { key: 'board' as const, label: 'Board', Icon: LayoutGrid },
    { key: 'table' as const, label: 'Table', Icon: Table2 },
  ];
  return (
    <div className="flex items-center rounded-md border border-border2 overflow-hidden">
      {opts.map(o => {
        const active = view === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium transition-colors"
            style={{ color: active ? '#0c0d14' : '#52526e', background: active ? '#fbbf24' : 'transparent' }}
          >
            <o.Icon size={11} /> {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── table view ─────────────────────────────── */

// Days since an ISO timestamp; updatedAt ≈ last stage move, so this is "days in stage".
const daysSince = (iso?: string | null) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null;

type SortKey = 'name' | 'stage' | 'days' | 'attempts' | 'lastcall' | 'refund' | 'temp';
const TEMP_RANK: Record<Temp, number> = { hot: 0, warm: 1, new: 2, cold: 3, dead: 4 };

function LeadTable({ leads, pipelines, onMove, liveKeys }: {
  leads: Lead[];
  pipelines: { id: string; stages: { id: string; name: string }[] }[];
  onMove: (l: Lead, stageName: string) => void;
  liveKeys: Set<string>;
}) {
  // Default: most days-in-stage first — the leads going stale float to the top.
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'days', dir: 'desc' });
  const [detail, setDetail] = useState<{ id: string; tab: 'detail' | 'history' } | null>(null);
  const detailLead = detail ? leads.find(l => l.id === detail.id) : null;
  useEffect(() => {
    if (detail && !leads.some(l => l.id === detail.id)) setDetail(null);
  }, [leads, detail]);

  // Stage <select> options + a pipeline-order index so "Stage" sorts follow deal flow.
  const stageOptions = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const p of pipelines) for (const s of p.stages) {
      const k = normStage(s.name);
      if (!seen.has(k)) { seen.add(k); out.push(s.name); }
    }
    return out;
  }, [pipelines]);
  const stageIndex = useMemo(() => {
    const m: Record<string, number> = {};
    stageOptions.forEach((s, i) => { m[normStage(s)] = i; });
    return m;
  }, [stageOptions]);

  const rows = useMemo(() => {
    const val = (l: Lead): number | string => {
      switch (sort.key) {
        case 'name':     return l.name?.toLowerCase() || '';
        case 'stage':    return stageIndex[normStage(l.stageName)] ?? 999;
        case 'days':     return daysSince(l.updatedAt) ?? -1;
        case 'attempts': return attemptCount(l);
        case 'lastcall': {
          const ts = l.calledAt || l.callHistory?.[0]?.calledAt;
          return ts ? new Date(ts).getTime() : 0;
        }
        case 'refund':   return l.daysUntilDeadline ?? 99999;
        case 'temp':     return TEMP_RANK[l.temp];
      }
    };
    return [...leads].sort((a, b) => {
      const va = val(a), vb = val(b);
      let c: number;
      if (typeof va === 'string' && typeof vb === 'string') c = va.localeCompare(vb);
      else c = (va as number) - (vb as number);
      return sort.dir === 'asc' ? c : -c;
    });
  }, [leads, sort, stageIndex]);

  const toggleSort = (key: SortKey) =>
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: (key === 'name' || key === 'stage') ? 'asc' : 'desc' });

  if (!leads.length) {
    return <div className="text-dimtext text-[11px] italic py-10 text-center">No iSpeed opportunities in this range — Sarah has nothing to dial yet.</div>;
  }

  const cols: { key: SortKey; label: string; align?: 'left' | 'right' | 'center' }[] = [
    { key: 'name',     label: 'Lead' },
    { key: 'stage',    label: 'Stage' },
    { key: 'days',     label: 'Days in stage', align: 'right' },
    { key: 'attempts', label: 'Attempts',      align: 'right' },
    { key: 'lastcall', label: 'Last call',     align: 'right' },
    { key: 'refund',   label: 'Refund',        align: 'right' },
    { key: 'temp',     label: 'Temp',          align: 'center' },
  ];

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border2">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border2" style={{ background: 'rgba(255,255,255,0.025)' }}>
              {cols.map(c => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className="px-3 py-2.5 text-[9.5px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-jtext"
                    style={{ color: active ? '#fbbf24' : '#8a8aa3', textAlign: c.align || 'left' }}
                  >
                    <span className="inline-flex items-center gap-1" style={{ flexDirection: c.align === 'right' ? 'row-reverse' : 'row' }}>
                      {c.label}
                      {active
                        ? (sort.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)
                        : <ArrowUpDown size={9} className="opacity-30" />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(lead => {
              const dStage = daysSince(lead.updatedAt);
              const dCrm = lead.daysInCrm ?? daysSince(lead.createdAt);
              const attempts = attemptCount(lead);
              const last = lead.calledAt || lead.callHistory?.[0]?.calledAt || null;
              const r = refundMeta(lead);
              const t = TEMP[lead.temp];
              const onCall = liveKeys.has(digits10(lead.phone));
              const ageColor = dStage == null ? '#5a5a80' : dStage > 30 ? '#f87171' : dStage > 14 ? '#fbbf24' : '#9a9ab3';
              const selValue = stageOptions.find(s => normStage(s) === normStage(lead.stageName)) || lead.stageName;
              return (
                <tr
                  key={lead.id}
                  onClick={() => setDetail({ id: lead.id, tab: 'detail' })}
                  className="border-b border-border2 cursor-pointer transition-colors hover:bg-white/[0.03]"
                  style={onCall ? { background: 'rgba(248,113,113,0.06)' } : undefined}
                >
                  {/* Lead */}
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-1.5">
                      {onCall && <Radio size={10} className="text-nred animate-pulse flex-shrink-0" />}
                      <span className="text-[12px] font-semibold text-textb truncate max-w-[180px]">{lead.name}</span>
                    </div>
                    {lead.address && <div className="text-[9px] text-dimtext truncate max-w-[200px]">{lead.address}</div>}
                    {lead.phone && <div className="text-[9px] text-dimtext">{fmtPhone(lead.phone)}</div>}
                  </td>
                  {/* Stage (inline move) */}
                  <td className="px-3 py-2 align-top" onClick={e => e.stopPropagation()}>
                    <select
                      value={selValue}
                      onChange={e => onMove(lead, e.target.value)}
                      className="bg-transparent text-[10px] text-jtext border border-border2 rounded px-1.5 py-1 max-w-[160px] cursor-pointer hover:border-white/25"
                      style={{ outline: 'none' }}
                    >
                      {stageOptions.map(s => <option key={s} value={s} className="bg-[#15151f] text-jtext">{s}</option>)}
                    </select>
                  </td>
                  {/* Days in stage */}
                  <td className="px-3 py-2 text-right align-top">
                    <span className="text-[12px] font-semibold" style={{ color: ageColor }}>{dStage == null ? '—' : `${dStage}d`}</span>
                    {dCrm != null && <div className="text-[8px] text-dimtext">{dCrm}d in CRM</div>}
                  </td>
                  {/* Attempts */}
                  <td className="px-3 py-2 text-right align-top">
                    <span className="text-[12px] font-medium" style={{ color: attempts === 0 ? '#5a5a80' : '#c4c4d6' }}>{attempts}</span>
                  </td>
                  {/* Last call */}
                  <td className="px-3 py-2 text-right align-top text-[10px] text-dimtext whitespace-nowrap">{last ? timeAgo(last) : '—'}</td>
                  {/* Refund */}
                  <td className="px-3 py-2 text-right align-top whitespace-nowrap">
                    {r
                      ? <span className="text-[11px] font-medium" style={{ color: r.color }}>{r.urgency === 'expired' ? 'closed' : `${r.days}d`}{r.cost ? <span className="text-dimtext"> · ${r.cost}</span> : null}</span>
                      : <span className="text-dimtext text-[10px]">—</span>}
                  </td>
                  {/* Temp */}
                  <td className="px-3 py-2 text-center align-top">
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-sm" style={{ background: `${t.c}1a`, color: t.c, border: `1px solid ${t.c}40` }}>{t.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[9px] text-dimtext mt-2 px-1">{rows.length} leads · click a row for detail · click a column to sort · change stage inline</div>

      <AnimatePresence>
        {detail && detailLead && (
          <LeadDetailModal lead={detailLead} initialTab={detail.tab} onClose={() => setDetail(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

/* ─────────────────────────────── stat strip ─────────────────────────────── */

function StatStrip({ m, callsToday }: { m: { total: number; hot: number; warm: number; atRisk: number; capitalAtRisk: number; invested: number }; callsToday: number }) {
  const cards: { label: string; value: string | number; color: string; icon: React.ReactNode; sub?: string }[] = [
    { label: 'Opportunities', value: m.total,                       color: '#67e8f9', icon: <Target size={13} /> },
    { label: 'Hot',           value: m.hot,                         color: '#f87171', icon: <Flame size={13} /> },
    { label: 'Warm',          value: m.warm,                        color: '#fb923c', icon: <Flame size={13} /> },
    { label: 'Refund at risk',value: m.atRisk,                      color: '#fbbf24', icon: <AlertTriangle size={13} />, sub: `$${m.capitalAtRisk.toLocaleString()} exposed` },
    { label: 'Capital in',    value: `$${m.invested.toLocaleString()}`, color: '#a78bfa', icon: <DollarSign size={13} /> },
    { label: 'Calls today',   value: callsToday,                    color: '#4ade80', icon: <Phone size={13} /> },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {cards.map(c => (
        <div
          key={c.label}
          className="rounded-lg border border-border2 px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.018)' }}
        >
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.5px] mb-1.5" style={{ color: c.color }}>
            {c.icon} <span>{c.label}</span>
          </div>
          <div className="text-[22px] font-semibold leading-none" style={{ color: '#e4e4f0' }}>{c.value}</div>
          {c.sub && <div className="text-[9px] text-dimtext mt-1">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── hot — call these now ─────────────────────────── */

function HotStrip({ leads }: { leads: Lead[] }) {
  const hot = leads.filter(l => l.temp === 'hot');
  if (!hot.length) return null;
  return (
    <div className="rounded-lg border p-3" style={{ background: 'rgba(248,113,113,0.05)', borderColor: 'rgba(248,113,113,0.28)' }}>
      <div className="flex items-center gap-2 mb-2.5">
        <Flame size={14} style={{ color: '#f87171' }} />
        <span className="text-[12px] font-semibold text-textb">Call these now</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>{hot.length} hot</span>
        <span className="text-[9px] text-dimtext ml-auto">qualified hot — close while they're warm</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {hot.map(l => <HotRow key={l.id} lead={l} />)}
      </div>
    </div>
  );
}

function HotRow({ lead }: { lead: Lead }) {
  const [st, setSt] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  async function call() {
    if (!lead.contactId || !lead.phone) { setSt('err'); return; }
    setSt('busy');
    try {
      const r = await fetch(`${LEADS_API}/lead-action?action=callnow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: lead.contactId, phone: lead.phone, name: lead.name, address: lead.address }),
      });
      if (!r.ok) throw new Error();
      setSt('done');
    } catch { setSt('err'); }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(248,113,113,0.22)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-medium text-textb truncate">{lead.name}</div>
        <div className="text-[9px] text-dimtext truncate">{[lead.pain, lead.askingPrice, lead.address].filter(Boolean).join(' · ') || '—'}</div>
      </div>
      {lead.phone && <CopyBtn text={lead.phone} label="phone" size={11} />}
      <button
        onClick={call}
        disabled={st === 'busy' || st === 'done'}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border flex-shrink-0 disabled:opacity-60"
        style={{ color: st === 'done' ? '#4ade80' : '#f87171', borderColor: 'rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.08)' }}
      >
        {st === 'busy' ? <Loader2 size={11} className="animate-spin" /> : st === 'done' ? <Check size={11} /> : st === 'err' ? <X size={11} /> : <Phone size={11} />}
        {st === 'done' ? 'Dialing' : st === 'err' ? 'Failed' : 'Call'}
      </button>
    </div>
  );
}

/* ───────────────────────── live in-call transcript ───────────────────────── */

interface SarahLiveCall {
  callId: string; name: string; address: string | null; phone: string | null;
  stage: string | null; turnNum: number; human: boolean; durationSec: number; lastSpeaker: string | null;
}
interface SarahTurn { who: 'sarah' | 'seller'; speaker: string; text: string }
interface SarahTranscript {
  ok: boolean; callId: string; active: boolean; ended: boolean;
  name?: string; address?: string | null; stage?: string | null; durationSec?: number;
  turns: SarahTurn[]; offline?: boolean;
}

const STAGE_LABEL: Record<string, string> = {
  dialing: 'Dialing…', opening: 'Greeting', listening: 'Listening', generating: 'Thinking…',
  playing_response: 'Speaking', ending: 'Wrapping up',
};

function LiveTranscriptPanel() {
  const [calls, setCalls]       = useState<SarahLiveCall[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [snap, setSnap]         = useState<SarahTranscript | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll the live-call list every 3s; auto-follow the first active call.
  useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const r = await fetch(`${LEADS_API}/sarah-live`);
        const j = await r.json();
        if (!on) return;
        const list: SarahLiveCall[] = j.calls || [];
        setCalls(list);
        setActiveId(prev => (prev && list.some(c => c.callId === prev)) ? prev : (list[0]?.callId ?? null));
      } catch { if (on) setCalls([]); }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { on = false; clearInterval(id); };
  }, []);

  // Poll the active call's transcript every 2s.
  useEffect(() => {
    if (!activeId) { setSnap(null); return; }
    let on = true;
    const tick = async () => {
      try {
        const r = await fetch(`${LEADS_API}/sarah-transcript?callId=${encodeURIComponent(activeId)}`);
        const j = await r.json();
        if (on) setSnap(j);
      } catch { /* keep last snapshot */ }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { on = false; clearInterval(id); };
  }, [activeId]);

  // Auto-scroll to newest turn.
  const turnCount = snap?.turns?.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turnCount]);

  const active  = calls.find(c => c.callId === activeId) || null;
  const onCall  = !!active;
  const stageTxt = active?.stage ? (STAGE_LABEL[active.stage] || active.stage) : null;

  return (
    <div className="rounded-lg border p-3" style={{ background: 'rgba(255,255,255,0.012)', borderColor: onCall ? 'rgba(248,113,113,0.28)' : 'rgba(255,255,255,0.06)' }}>
      {/* header */}
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <Radio size={13} style={{ color: onCall ? '#f87171' : '#52526e' }} className={onCall ? 'animate-pulse' : ''} />
        <span className="text-[11px] font-semibold text-textb">Live Call</span>
        {onCall ? (
          <>
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>on call</span>
            <span className="text-[11px] text-textb font-medium ml-1 truncate max-w-[160px]">{active!.name}</span>
            {active!.address && <span className="text-[9px] text-dimtext truncate max-w-[200px] hidden sm:inline">· {active!.address}</span>}
            <span className="ml-auto flex items-center gap-2.5 text-[10px]">
              {stageTxt && <span className="text-ngold">{stageTxt}</span>}
              <span className="text-ncyan flex items-center gap-1"><Clock size={9} /> {fmtDuration(active!.durationSec)}</span>
            </span>
          </>
        ) : (
          <span className="text-[9px] px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(255,255,255,0.05)', color: '#52526e' }}>idle</span>
        )}
      </div>

      {/* multiple concurrent calls → quick switcher */}
      {calls.length > 1 && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {calls.map(c => (
            <button
              key={c.callId}
              onClick={() => setActiveId(c.callId)}
              className="text-[9px] px-1.5 py-0.5 rounded-sm border transition-colors"
              style={{
                borderColor: c.callId === activeId ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.08)',
                color: c.callId === activeId ? '#f87171' : '#7a7a9a',
                background: c.callId === activeId ? 'rgba(248,113,113,0.08)' : 'transparent',
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* transcript */}
      {!onCall ? (
        <div className="text-dimtext text-[10px] italic py-6 text-center">
          Sarah is idle. Her live conversation streams here — both sides — the moment she connects with a seller.
        </div>
      ) : (
        <div ref={scrollRef} className="flex flex-col gap-2 overflow-y-auto" style={{ minHeight: 120, maxHeight: 340 }}>
          {(!snap || snap.turns.length === 0) ? (
            <div className="text-dimtext text-[10px] italic py-6 text-center flex items-center justify-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Connected — waiting for the first words…
            </div>
          ) : snap.turns.map((t, i) => {
            const isSarah = t.who === 'sarah';
            return (
              <div key={i} className={`flex ${isSarah ? 'justify-start' : 'justify-end'}`}>
                <div
                  className="max-w-[78%] rounded-lg px-2.5 py-1.5"
                  style={{
                    background: isSarah ? 'rgba(74,222,128,0.08)' : 'rgba(103,232,249,0.08)',
                    border: `1px solid ${isSarah ? 'rgba(74,222,128,0.22)' : 'rgba(103,232,249,0.22)'}`,
                  }}
                >
                  <div className="text-[8px] uppercase tracking-[0.5px] mb-0.5" style={{ color: isSarah ? '#4ade80' : '#67e8f9' }}>
                    {isSarah ? 'Sarah' : 'Seller'}
                  </div>
                  <div className="text-[11.5px] text-jtext leading-snug whitespace-pre-wrap">{t.text}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── live & recent panel ─────────────────────────── */

function LivePanel({ live }: { live: { id: string; name: string; address: string | null; duration: number; phase: string; calledAt: string; isLive: boolean }[] }) {
  const liveCount = live.filter(l => l.isLive).length;
  return (
    <div className="rounded-lg border border-border2 p-3" style={{ background: 'rgba(255,255,255,0.012)' }}>
      <div className="flex items-center gap-2 mb-2.5">
        <Radio size={13} style={{ color: liveCount ? '#f87171' : '#52526e' }} className={liveCount ? 'animate-pulse' : ''} />
        <span className="text-[11px] font-semibold text-textb">Recent Calls Today</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-sm" style={{ background: liveCount ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.05)', color: liveCount ? '#f87171' : '#52526e' }}>
          {liveCount ? `${liveCount} just landed` : 'idle'}
        </span>
      </div>
      {live.length === 0 ? (
        <div className="text-dimtext text-[10px] italic py-2">No calls yet today. Sarah's calls land here as she dials.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {live.map(c => (
            <div
              key={c.id}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border"
              style={{
                background: c.isLive ? 'rgba(248,113,113,0.05)' : 'rgba(255,255,255,0.015)',
                borderColor: c.isLive ? 'rgba(248,113,113,0.28)' : 'rgba(255,255,255,0.06)',
              }}
            >
              <Radio size={11} style={{ color: c.isLive ? '#f87171' : '#52526e' }} className={c.isLive ? 'animate-pulse' : ''} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-textb truncate">{c.name}</div>
                {c.address && <div className="text-[9px] text-dimtext truncate">{c.address}</div>}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[10px] text-ncyan flex items-center gap-1 justify-end"><Clock size={8} /> {fmtDuration(c.duration)}</div>
                <div className="text-[9px] text-dimtext">{c.isLive ? 'just landed' : timeAgo(c.calledAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────── board ───────────────────────────────── */

function Board({ leads, pipelines, onMove, liveKeys }: { leads: Lead[]; pipelines: { id: string; stages: { id: string; name: string }[] }[]; onMove: (l: Lead, stageName: string) => void; liveKeys: Set<string> }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  // Store only the id + tab; the live lead is derived from `leads` on every render
  // so the modal stays current through the 30s auto-refresh and after a callback.
  const [detail, setDetail] = useState<{ id: string; tab: 'detail' | 'history' } | null>(null);
  const detailLead = detail ? leads.find(l => l.id === detail.id) : null;
  useEffect(() => {
    if (detail && !leads.some(l => l.id === detail.id)) setDetail(null); // lead aged out of view
  }, [leads, detail]);

  const columns = useMemo(() => {
    const seen = new Set<string>();
    const cols: { key: string; name: string }[] = [];
    for (const p of pipelines) {
      for (const s of p.stages) {
        const k = normStage(s.name);
        if (!seen.has(k)) { seen.add(k); cols.push({ key: k, name: s.name }); }
      }
    }
    return cols;
  }, [pipelines]);

  const leadsByCol = useMemo(() => {
    const map: Record<string, Lead[]> = {};
    for (const l of leads) {
      const k = normStage(l.stageName);
      (map[k] = map[k] || []).push(l);
    }
    // Within a column, surface refund-urgent leads first, then hottest.
    const rank = (l: Lead) => {
      const r = refundMeta(l);
      const urg = r ? { danger: 0, warn: 1, safe: 2, expired: 3 }[r.urgency] : 2;
      const temp = { hot: 0, warm: 1, new: 2, cold: 3, dead: 4 }[l.temp];
      return urg * 10 + temp;
    };
    for (const k of Object.keys(map)) map[k].sort((a, b) => rank(a) - rank(b));
    return map;
  }, [leads]);

  if (!columns.length) {
    return <div className="text-dimtext text-[11px] italic py-10 text-center">iSpeed pipeline stages loading…</div>;
  }
  if (!leads.length) {
    return <div className="text-dimtext text-[11px] italic py-10 text-center">No iSpeed opportunities in this range — Sarah has nothing to dial yet.</div>;
  }

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
        {columns.map(col => {
          const items = leadsByCol[col.key] || [];
          const isOver = overKey === col.key;
          return (
            <div
              key={col.key}
              onDragOver={e => { e.preventDefault(); setOverKey(col.key); }}
              onDragLeave={() => setOverKey(o => (o === col.key ? null : o))}
              onDrop={() => {
                const lead = leads.find(l => l.id === dragId);
                if (lead) onMove(lead, col.name);
                setDragId(null); setOverKey(null);
              }}
              className="flex flex-col rounded-lg border transition-colors flex-shrink-0 w-[270px]"
              style={{
                borderColor: isOver ? '#fbbf24' : 'rgba(255,255,255,0.06)',
                background: isOver ? 'rgba(251,191,36,0.05)' : 'rgba(255,255,255,0.012)',
              }}
            >
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border2">
                <span className="text-[11.5px] font-semibold text-textb leading-tight flex-1 min-w-0">{col.name}</span>
                <span className="text-[10px] text-dimtext flex-shrink-0 px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(255,255,255,0.05)' }}>{items.length}</span>
              </div>
              <div className="flex flex-col gap-2 p-2 flex-1 min-h-[140px] max-h-[68vh] overflow-y-auto">
                {items.length === 0 && (
                  <div className="text-dimtext text-[10px] italic text-center py-6">Drop here</div>
                )}
                <AnimatePresence initial={false}>
                  {items.map(lead => (
                    <motion.div
                      key={lead.id}
                      layout
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: dragId === lead.id ? 0.4 : 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    >
                      <OppCard
                        lead={lead}
                        onCall={liveKeys.has(digits10(lead.phone))}
                        onOpen={tab => setDetail({ id: lead.id, tab })}
                        onDragStart={() => setDragId(lead.id)}
                        onDragEnd={() => { setDragId(null); setOverKey(null); }}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {detail && detailLead && (
          <LeadDetailModal
            lead={detailLead}
            initialTab={detail.tab}
            onClose={() => setDetail(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/* ──────────────────────────── opportunity card ──────────────────────────── */

function RefundChip({ lead }: { lead: Lead }) {
  const r = refundMeta(lead);
  if (!r) return null;
  const text =
    r.urgency === 'expired' ? 'Refund window closed'
    : `Refund in ${r.days}d`;
  return (
    <div
      className="flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[9px] font-medium"
      style={{ background: `${r.color}14`, color: r.color, border: `1px solid ${r.color}33` }}
      title={`Lead cost $${r.cost ?? '—'} · bought ${epochDate(r.purchasedAt)} · ${r.urgency === 'expired' ? 'past refund window' : `${r.days} days until refund deadline`}`}
    >
      <CalendarClock size={10} />
      <span>{text}</span>
      {r.cost != null && <span className="opacity-70">· ${r.cost}</span>}
    </div>
  );
}

function OppCard({ lead, onCall, onOpen, onDragStart, onDragEnd }: { lead: Lead; onCall?: boolean; onOpen: (tab: 'detail' | 'history') => void; onDragStart: () => void; onDragEnd: () => void }) {
  const t = TEMP[lead.temp];
  const attempts = attemptCount(lead);
  const last = lead.calledAt || lead.callHistory?.[0]?.calledAt || null;
  // Single click → detail; double-click → call history. Disambiguate with a short timer.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);
  function handleClick() {
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => { clickTimer.current = null; onOpen('detail'); }, 220);
  }
  function handleDouble() {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    onOpen('history');
  }

  return (
    <motion.div
      onClick={handleClick}
      onDoubleClick={handleDouble}
      animate={onCall
        ? { boxShadow: ['0 0 0 1px rgba(248,113,113,0.45), 0 0 6px rgba(248,113,113,0.15)', '0 0 0 1px rgba(248,113,113,0.85), 0 0 16px rgba(248,113,113,0.5)', '0 0 0 1px rgba(248,113,113,0.45), 0 0 6px rgba(248,113,113,0.15)'] }
        : { boxShadow: '0 0 0 0 rgba(0,0,0,0)' }}
      transition={onCall ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      className="rounded-lg border p-2.5 cursor-pointer transition-colors hover:border-white/20"
      style={{ background: onCall ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.025)', borderColor: onCall ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.07)' }}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-textb truncate">{lead.name}</div>
          {lead.address && (
            <div className="text-[10px] text-dimtext flex items-center gap-1 mt-0.5">
              <MapPin size={9} className="flex-shrink-0" />
              <span className="truncate">{lead.address}</span>
              <CopyBtn text={lead.address} label="address" size={10} />
            </div>
          )}
          {lead.phone && (
            <div className="text-[10px] text-dimtext flex items-center gap-1 mt-0.5">
              <Phone size={9} className="flex-shrink-0" />
              <span className="truncate">{fmtPhone(lead.phone)}</span>
              <CopyBtn text={lead.phone} label="phone" size={10} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onCall && (
            <span className="flex items-center gap-1 text-[8px] font-semibold px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(248,113,113,0.18)', color: '#f87171' }}>
              <Radio size={8} className="animate-pulse" /> ON CALL
            </span>
          )}
          <span
            className="text-[8px] font-semibold px-1.5 py-0.5 rounded-sm"
            style={{ background: `${t.c}1a`, color: t.c, border: `1px solid ${t.c}40` }}
          >
            {t.label}
          </span>
          {/* dedicated drag handle — keeps drag-to-reorder from fighting click-to-open */}
          <span
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={e => e.stopPropagation()}
            title="Drag to move stage"
            className="text-dimtext hover:text-jtext cursor-grab active:cursor-grabbing -mr-0.5"
          >
            <GripVertical size={13} />
          </span>
        </div>
      </div>

      {/* motivation + timeline + condition */}
      {(lead.pain || lead.timeline || lead.condition) && (
        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          {lead.pain && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm truncate max-w-full" style={{ background: 'rgba(167,139,250,0.12)', color: '#a78bfa' }} title={lead.pain}>
              {lead.pain}
            </span>
          )}
          {lead.timeline && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(96,165,250,0.12)', color: '#60a5fa' }}>
              {lead.timeline}
            </span>
          )}
          {lead.condition && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm truncate max-w-full" style={{ background: 'rgba(255,255,255,0.05)', color: '#c4c4d6' }} title={lead.condition}>
              {lead.condition}
            </span>
          )}
        </div>
      )}

      {/* refund window */}
      <div className="mt-2">
        <RefundChip lead={lead} />
      </div>

      {/* footer: attempts + asking + provider */}
      <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 mt-2 text-[9.5px] text-dimtext">
        <span className="flex items-center gap-1" title={last ? `last attempt ${timeAgo(last)}` : 'no attempts yet'}>
          <Phone size={9} /> {attempts === 0 ? 'New — not called' : `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}`}
          {last && attempts > 0 && <span className="opacity-70">· {timeAgo(last)}</span>}
        </span>
        {lead.askingPrice && <span style={{ color: '#4ade80' }}>{lead.askingPrice}</span>}
        {lead.provider && <span className="flex items-center gap-1 truncate max-w-[110px]"><Building2 size={9} /> {lead.provider}</span>}
      </div>
    </motion.div>
  );
}

/* ───────────────────────────── detail modal ───────────────────────────── */

function DetailRow({ label, value, color, copyable }: { label: string; value: string | null | undefined; color?: string; copyable?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[8px] text-dimtext uppercase tracking-[0.5px]">{label}</span>
      <span className="text-[11.5px] text-textb flex items-center gap-1 min-w-0" style={color ? { color } : undefined}>
        <span className="truncate">{value}</span>
        {copyable && <CopyBtn text={value} label={label} size={10} />}
      </span>
    </div>
  );
}

function LeadDetailModal({ lead, initialTab, onClose }: { lead: Lead; initialTab: 'detail' | 'history'; onClose: () => void }) {
  const { refresh } = useApp();
  const [tab, setTab] = useState<'detail' | 'history'>(initialTab);
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [cbState, setCbState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  const t = TEMP[lead.temp];
  const r = refundMeta(lead);
  const history = lead.callHistory || [];

  async function saveNote() {
    if (!note.trim() || !lead.contactId) return;
    setNoteState('saving');
    try {
      const res = await fetch(`${LEADS_API}/lead-action?action=note`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: lead.contactId, note, name: lead.name, address: lead.address }),
      });
      if (!res.ok) throw new Error();
      setNoteState('saved'); setNote('');
      setTimeout(() => setNoteState('idle'), 2500);
    } catch { setNoteState('error'); }
  }

  async function approveCallback() {
    if (!lead.contactId) return;
    setCbState('saving');
    try {
      const res = await fetch(`${LEADS_API}/lead-action?action=callback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: lead.contactId, name: lead.name, address: lead.address, pipelineId: lead.pipelineId, note: note.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      setCbState('done');
      refresh();
    } catch { setCbState('error'); }
  }

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-border2"
        style={{ background: 'rgba(12,12,24,0.98)' }}
        initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-border2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-textb truncate">{lead.name}</span>
              <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-sm flex-shrink-0" style={{ background: `${t.c}1a`, color: t.c, border: `1px solid ${t.c}40` }}>{t.label}</span>
            </div>
            {lead.address && <div className="text-[11px] text-dimtext mt-0.5 flex items-center gap-1"><MapPin size={10} className="flex-shrink-0" /> <span className="truncate">{lead.address}</span> <CopyBtn text={lead.address} label="address" /></div>}
            {lead.phone && <div className="text-[11px] text-jtext mt-0.5 flex items-center gap-1"><Phone size={10} className="flex-shrink-0" /> {fmtPhone(lead.phone)} <CopyBtn text={lead.phone} label="phone" /></div>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <CopyLeadBtn lead={lead} />
            <button onClick={onClose} className="text-dimtext hover:text-textb"><X size={16} /></button>
          </div>
        </div>

        {/* refund banner */}
        {r && (
          <div className="px-5 py-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] min-w-0" style={{ background: `${r.color}10`, borderBottom: `1px solid ${r.color}22`, color: r.color }}>
            <CalendarClock size={13} className="flex-shrink-0" />
            <span className="font-medium">
              {r.urgency === 'expired'
                ? 'Refund window has closed'
                : `${r.days} day${r.days === 1 ? '' : 's'} left to request a refund`}
            </span>
            <span className="ml-auto text-jtext truncate min-w-0">
              ${r.cost ?? '—'} {lead.purchaseTier ? `· ${lead.purchaseTier}` : ''} · bought {epochDate(r.purchasedAt)}
            </span>
          </div>
        )}

        {/* tabs */}
        <div className="flex gap-1 px-5 pt-3">
          {([['detail', 'Detail'], ['history', `Call History${history.length ? ` (${history.length})` : ''}`]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors"
              style={{
                background: tab === id ? 'rgba(251,191,36,0.12)' : 'transparent',
                color: tab === id ? '#fbbf24' : '#52526e',
                border: tab === id ? '1px solid rgba(251,191,36,0.25)' : '1px solid transparent',
              }}
            >
              {id === 'history' ? <History size={11} /> : <FileText size={11} />} {label}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'detail' ? (
            <DetailTab lead={lead} note={note} setNote={setNote} noteState={noteState} saveNote={saveNote} cbState={cbState} approveCallback={approveCallback} />
          ) : (
            <CallHistoryTab history={history} />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function DetailTab({
  lead, note, setNote, noteState, saveNote, cbState, approveCallback,
}: {
  lead: Lead; note: string; setNote: (s: string) => void;
  noteState: 'idle' | 'saving' | 'saved' | 'error'; saveNote: () => void;
  cbState: 'idle' | 'saving' | 'done' | 'error'; approveCallback: () => void;
}) {
  return (
    <div>
      {/* qualification fields */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <DetailRow label="Motivation" value={lead.pain} color="#a78bfa" copyable />
        <DetailRow label="Timeline"   value={lead.timeline} />
        <DetailRow label="Asking"     value={lead.askingPrice} color="#4ade80" copyable />
        <DetailRow label="Condition"  value={lead.condition} />
        <DetailRow label="ARV"        value={lead.arv} copyable />
        <DetailRow label="Rehab"      value={lead.rehabCost} />
        <DetailRow label="Mkt Value"  value={lead.marketValue} copyable />
        <DetailRow label="Occupancy"  value={lead.occupancy} />
        <DetailRow label="Mortgage"   value={lead.mortgage} />
        <DetailRow label="Deal type"  value={lead.dealType} />
        <DetailRow label="Rating"     value={lead.rating} />
        <DetailRow label="Value"      value={lead.value ? `$${lead.value.toLocaleString()}` : null} color="#4ade80" copyable />
        <DetailRow label="Stage"      value={lead.stageName} />
        <DetailRow label="Attempts"   value={String(attemptCount(lead))} />
        <DetailRow label="In CRM"     value={lead.daysInCrm != null ? `${lead.daysInCrm}d` : null} />
        <DetailRow label="Status"     value={lead.status} />
      </div>

      {/* lead economics */}
      <div className="mt-4 pt-4 border-t border-border2">
        <div className="text-[9px] uppercase tracking-[0.5px] text-dimtext mb-2 flex items-center gap-1.5"><DollarSign size={11} /> Lead Economics</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <DetailRow label="Cost"        value={lead.purchasePrice != null ? `$${lead.purchasePrice}` : null} color="#fbbf24" />
          <DetailRow label="Tier"        value={lead.purchaseTier} />
          <DetailRow label="Provider"    value={lead.provider} />
          <DetailRow label="Lead Source" value={lead.leadSource} />
          <DetailRow label="Grade"       value={lead.predictorGrade} />
          <DetailRow label="Bought"      value={lead.purchasedAt ? epochDate(lead.purchasedAt) : null} />
          <DetailRow label="Funding"     value={lead.fundingSource} />
          <DetailRow label="Refund elig." value={lead.refundEligible} />
          <DetailRow label="Refund in"   value={lead.daysUntilDeadline != null ? `${lead.daysUntilDeadline}d` : null} color={lead.deadlineUrgent ? '#f87171' : undefined} />
        </div>
      </div>

      {/* latest summary */}
      {lead.summary && (
        <div className="mt-4 pt-4 border-t border-border2">
          <div className="text-[9px] uppercase tracking-[0.5px] text-dimtext mb-1.5">Latest Call Summary</div>
          <p className="text-[12px] text-jtext leading-relaxed whitespace-pre-wrap">{lead.summary}</p>
        </div>
      )}

      {/* note + callback */}
      <div className="mt-4 pt-4 border-t border-border2">
        <div className="flex gap-2">
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveNote(); }}
            placeholder="Add a note for Sarah…"
            className="flex-1 bg-bg3 border border-border2 rounded-md px-2.5 py-2 text-[11px] text-textb placeholder:text-dimtext focus:outline-none focus:border-ngold/50"
          />
          <button
            onClick={saveNote}
            disabled={!note.trim() || !lead.contactId || noteState === 'saving'}
            className="flex items-center gap-1 px-3 py-2 rounded-md text-[10px] font-medium border transition-colors disabled:opacity-40"
            style={{ color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.06)' }}
          >
            {noteState === 'saving' ? <Loader2 size={11} className="animate-spin" /> : noteState === 'saved' ? <Check size={11} /> : <Send size={11} />}
            {noteState === 'saved' ? 'Saved' : 'Note'}
          </button>
          <button
            onClick={approveCallback}
            disabled={!lead.contactId || cbState === 'saving' || cbState === 'done'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-medium border transition-colors disabled:opacity-50"
            style={{ color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.08)' }}
          >
            {cbState === 'saving' ? <Loader2 size={11} className="animate-spin" /> : cbState === 'done' ? <Check size={11} /> : cbState === 'error' ? <X size={11} /> : <Phone size={11} />}
            {cbState === 'done' ? 'Queued' : cbState === 'error' ? 'Failed' : 'Call back'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CallHistoryTab({ history }: { history: CallRecord[] }) {
  const [open, setOpen] = useState<string | null>(history[0]?.id ?? null);
  if (!history.length) {
    return <div className="text-dimtext text-[11px] italic py-8 text-center">No calls logged for this lead yet.</div>;
  }
  return (
    <div className="flex flex-col gap-2">
      {history.map((c, i) => {
        const isOpen = open === c.id;
        const moved = c.stageAfter && c.stageAfter !== c.stageBefore;
        return (
          <div key={c.id} className="rounded-lg border border-border2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)' }}>
            <button onClick={() => setOpen(isOpen ? null : c.id)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left">
              <span className="flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold flex-shrink-0" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
                {history.length - i}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-textb font-medium">{fmtTime(c.calledAt)} <span className="text-dimtext font-normal">· {timeAgo(c.calledAt)}</span></div>
                {moved && <div className="text-[9px] text-dimtext truncate">{c.stageBefore || '—'} → <span style={{ color: '#4ade80' }}>{c.stageAfter}</span></div>}
              </div>
              <span className="text-[10px] text-ncyan flex items-center gap-1 flex-shrink-0"><Clock size={9} /> {fmtDuration(c.duration)}</span>
              <ChevronDown size={13} className="text-dimtext flex-shrink-0 transition-transform" style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                  <div className="px-3 pb-3 pt-1">
                    {c.recordingUrl && <audio src={c.recordingUrl} controls className="w-full h-8 mb-2" />}
                    {c.summary && (
                      <p className="text-[11px] text-jtext leading-relaxed whitespace-pre-wrap mb-2">{c.summary}</p>
                    )}
                    {c.transcript ? (
                      <pre className="text-[10.5px] text-jtext leading-relaxed whitespace-pre-wrap font-sans border-t border-border2 pt-2">{c.transcript}</pre>
                    ) : (
                      !c.summary && <p className="text-[10px] text-dimtext italic">No transcript recorded for this call.</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
