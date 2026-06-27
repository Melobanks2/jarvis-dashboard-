'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign, AlertTriangle, Phone, Loader2, Check, X,
  Building2, CalendarClock, TrendingUp, Flame,
} from 'lucide-react';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead, LEADS_API } from '@/lib/hooks/useLeads';

/* ─────────────────────────────── helpers ─────────────────────────────── */

const FADE = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };

function attemptsOf(l: Lead) { return l.attempts ?? l.callHistory?.length ?? 0; }
function refundColor(d: number, urgent?: boolean | null): string {
  if (d < 0) return '#5a5a80';
  if (urgent || d <= 5) return '#f87171';
  if (d <= 12) return '#fbbf24';
  return '#4ade80';
}
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

async function leadAction(action: string, body: Record<string, unknown>) {
  const r = await fetch(`${LEADS_API}/lead-action?action=${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

/* ───────────────────────────────── main ──────────────────────────────── */

export function SarahMoney() {
  const { refreshKey, refresh } = useApp();
  const { leads, loading } = useLeads(refreshKey);
  const ispeed = useMemo(() => leads.filter(l => l.source === 'ispeed'), [leads]);

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-6">
      <motion.div variants={FADE}>
        <div className="text-[15px] font-semibold text-textb">Follow the Money</div>
        <div className="text-[11px] text-dimtext mt-0.5">Protect the lead spend you've already made, and see which sources are actually worth buying.</div>
      </motion.div>

      <motion.div variants={FADE}><RefundRadar leads={ispeed} loading={loading} onChanged={refresh} /></motion.div>
      <motion.div variants={FADE}><SourceROI leads={ispeed} /></motion.div>
    </motion.div>
  );
}

/* ───────────────────────────── refund radar ──────────────────────────── */

function RefundRadar({ leads, loading, onChanged }: { leads: Lead[]; loading: boolean; onChanged: () => void }) {
  // Leads with a refund clock still open, soonest deadline first.
  const atRisk = useMemo(() => {
    return leads
      .filter(l => l.daysUntilDeadline != null && l.daysUntilDeadline <= 14)
      .sort((a, b) => (a.daysUntilDeadline! - b.daysUntilDeadline!));
  }, [leads]);

  const dollarsAtRisk = atRisk
    .filter(l => (l.daysUntilDeadline ?? 99) <= 12)
    .reduce((s, l) => s + (l.purchasePrice || 0), 0);
  const neglected = atRisk.filter(l => attemptsOf(l) === 0).length;

  return (
    <div className="rounded-lg border border-border2 p-3.5" style={{ background: 'rgba(255,255,255,0.012)' }}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <AlertTriangle size={14} style={{ color: '#fbbf24' }} />
        <span className="text-[12px] font-semibold text-textb">Refund Radar</span>
        <span className="text-[10px] text-dimtext">leads nearing their refund deadline</span>
        <span className="ml-auto flex items-center gap-3 text-[11px]">
          <span style={{ color: '#fbbf24' }}>{money(dollarsAtRisk)} at risk</span>
          {neglected > 0 && <span style={{ color: '#f87171' }}>{neglected} never called</span>}
        </span>
      </div>

      {loading && atRisk.length === 0 ? (
        <div className="text-dimtext text-[11px] py-6 text-center flex items-center justify-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading…</div>
      ) : atRisk.length === 0 ? (
        <div className="text-dimtext text-[11px] italic py-6 text-center">Nothing in the refund window right now — all paid leads are safe. 👍</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {atRisk.map(l => <RadarRow key={l.id} lead={l} onChanged={onChanged} />)}
        </div>
      )}
    </div>
  );
}

function RadarRow({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const [call, setCall]     = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [refund, setRefund] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const d = lead.daysUntilDeadline ?? 0;
  const c = refundColor(d, lead.deadlineUrgent);
  const attempts = attemptsOf(lead);

  async function doCall() {
    if (!lead.contactId || !lead.phone) { setCall('err'); return; }
    setCall('busy');
    try { await leadAction('callnow', { contactId: lead.contactId, phone: lead.phone, name: lead.name, address: lead.address }); setCall('done'); }
    catch { setCall('err'); }
  }
  async function doRefund() {
    if (!lead.contactId) { setRefund('err'); return; }
    setRefund('busy');
    try { await leadAction('refund', { contactId: lead.contactId, name: lead.name, address: lead.address, pipelineId: lead.pipelineId }); setRefund('done'); setTimeout(onChanged, 800); }
    catch { setRefund('err'); }
  }

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border2 px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="flex flex-col items-center justify-center flex-shrink-0 w-12" title={`${d} days until refund deadline`}>
        <span className="text-[14px] font-semibold leading-none" style={{ color: c }}>{d < 0 ? '—' : d}</span>
        <span className="text-[8px] uppercase tracking-[0.5px]" style={{ color: c }}>{d < 0 ? 'closed' : d === 1 ? 'day' : 'days'}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-textb truncate">{lead.name}</div>
        <div className="text-[9.5px] text-dimtext truncate">
          {lead.address || '—'} · <span style={{ color: attempts === 0 ? '#f87171' : undefined }}>{attempts === 0 ? 'never called' : `${attempts} attempt${attempts === 1 ? '' : 's'}`}</span>
          {lead.purchasePrice != null && <> · {money(lead.purchasePrice)}{lead.provider ? ` · ${lead.provider}` : ''}</>}
        </div>
      </div>
      <button
        onClick={doCall}
        disabled={call === 'busy' || call === 'done'}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors flex-shrink-0 disabled:opacity-60"
        style={{ color: call === 'done' ? '#4ade80' : '#67e8f9', borderColor: call === 'err' ? 'rgba(248,113,113,0.4)' : 'rgba(103,232,249,0.3)', background: 'rgba(103,232,249,0.06)' }}
      >
        {call === 'busy' ? <Loader2 size={11} className="animate-spin" /> : call === 'done' ? <Check size={11} /> : call === 'err' ? <X size={11} /> : <Phone size={11} />}
        {call === 'done' ? 'Dialing' : call === 'err' ? 'Failed' : 'Call now'}
      </button>
      <button
        onClick={doRefund}
        disabled={refund === 'busy' || refund === 'done'}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors flex-shrink-0 disabled:opacity-60"
        style={{ color: refund === 'done' ? '#4ade80' : '#fbbf24', borderColor: refund === 'err' ? 'rgba(248,113,113,0.4)' : 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.06)' }}
        title="Tag refund-requested, close the opp, and ping Telegram"
      >
        {refund === 'busy' ? <Loader2 size={11} className="animate-spin" /> : refund === 'done' ? <Check size={11} /> : refund === 'err' ? <X size={11} /> : <DollarSign size={11} />}
        {refund === 'done' ? 'Refunded' : refund === 'err' ? 'Failed' : 'Refund'}
      </button>
    </div>
  );
}

/* ───────────────────────────── source ROI ────────────────────────────── */

interface SrcRow { key: string; leads: number; spend: number; hot: number; warm: number; contacted: number }

function SourceROI({ leads }: { leads: Lead[] }) {
  const rows = useMemo(() => {
    const map: Record<string, SrcRow> = {};
    for (const l of leads) {
      const key = l.provider || l.leadSource || 'Unknown';
      const r = map[key] || (map[key] = { key, leads: 0, spend: 0, hot: 0, warm: 0, contacted: 0 });
      r.leads += 1;
      r.spend += l.purchasePrice || 0;
      if (l.temp === 'hot') r.hot += 1;
      if (l.temp === 'warm') r.warm += 1;
      if (attemptsOf(l) > 0) r.contacted += 1;
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend);
  }, [leads]);

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalHot   = rows.reduce((s, r) => s + r.hot, 0);
  // Best $/hot among sources that produced at least one hot lead.
  const withHot = rows.filter(r => r.hot > 0);
  const bestKey  = withHot.length ? withHot.reduce((a, b) => (a.spend / a.hot <= b.spend / b.hot ? a : b)).key : null;
  const worstKey = rows.filter(r => r.spend > 0 && r.hot === 0).sort((a, b) => b.spend - a.spend)[0]?.key || null;

  return (
    <div className="rounded-lg border border-border2 p-3.5" style={{ background: 'rgba(255,255,255,0.012)' }}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <TrendingUp size={14} style={{ color: '#60a5fa' }} />
        <span className="text-[12px] font-semibold text-textb">Lead Source ROI</span>
        <span className="text-[10px] text-dimtext">where your lead budget actually converts</span>
        <span className="ml-auto text-[11px] text-dimtext">{money(totalSpend)} spent · {totalHot} hot</span>
      </div>

      {rows.length === 0 ? (
        <div className="text-dimtext text-[11px] italic py-6 text-center">No iSpeed lead data yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="text-dimtext text-[9px] uppercase tracking-[0.5px]">
                <th className="text-left font-medium pb-1.5">Source</th>
                <th className="text-right font-medium pb-1.5">Leads</th>
                <th className="text-right font-medium pb-1.5">Spend</th>
                <th className="text-right font-medium pb-1.5">Contacted</th>
                <th className="text-right font-medium pb-1.5">Hot</th>
                <th className="text-right font-medium pb-1.5">$/hot</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const perHot = r.hot > 0 ? r.spend / r.hot : null;
                const tag = r.key === bestKey ? { t: 'best',  c: '#4ade80' } : r.key === worstKey ? { t: 'cut', c: '#f87171' } : null;
                return (
                  <tr key={r.key} style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1.5">
                        <Building2 size={10} className="text-dimtext flex-shrink-0" />
                        <span className="text-textb truncate max-w-[150px]">{r.key}</span>
                        {tag && <span className="text-[8px] px-1 py-0.5 rounded-sm" style={{ background: `${tag.c}1a`, color: tag.c }}>{tag.t}</span>}
                      </div>
                    </td>
                    <td className="text-right text-jtext">{r.leads}</td>
                    <td className="text-right text-jtext">{money(r.spend)}</td>
                    <td className="text-right text-jtext">{r.leads ? Math.round((r.contacted / r.leads) * 100) : 0}%</td>
                    <td className="text-right" style={{ color: r.hot > 0 ? '#f87171' : '#52526e' }}>{r.hot}</td>
                    <td className="text-right" style={{ color: perHot == null ? '#52526e' : perHot <= 300 ? '#4ade80' : '#fbbf24' }}>
                      {perHot == null ? '—' : money(perHot)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[9.5px] text-dimtext mt-2.5 flex items-center gap-1.5">
        <Flame size={10} style={{ color: '#f87171' }} /> Lower $/hot = cheaper to find a motivated seller. <span style={{ color: '#4ade80' }}>Green</span> sources earn more budget; <span style={{ color: '#f87171' }}>red</span> ones are burning cash with no hot leads.
      </div>
    </div>
  );
}
