'use client';

/**
 * Property Leads — the scoreboard for the $250-a-lead inbound source.
 *
 * This screen exists because Property Leads economics are unforgiving in a way
 * iSpeed's are not. A $29 iSpeed lead that never gets dialled is a rounding
 * error; a $250 Property Leads lead that never gets its four documented days of
 * outreach is $250 burned, and the only warning is a window quietly closing.
 *
 * So the page is ordered by what costs money soonest, not by what is tidiest:
 *
 *   1. dials owed TODAY, and the dollars that expire if they are skipped
 *   2. claims that are earned and just need filing
 *   3. cost per deal against the benchmarks the rep quoted, so the
 *      keep-or-kill decision has a live number instead of a sales promise
 *
 * Everything here is a mirror of GHL. Chris dials inside GHL, Sarah writes her
 * attempts back as notes, and ppl-tracker.js reassembles both — nothing on this
 * screen asks a human to remember to log anything.
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Loader2, Phone, PhoneIncoming, Target, TrendingDown,
} from 'lucide-react';
import { useApp } from '@/lib/AppContext';
import { usePropertyLeads, PplLead, PplState, PplData } from '@/lib/hooks/usePropertyLeads';

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US');

const STATE_STYLE: Record<PplState, { color: string; bg: string; label: string }> = {
  at_risk:  { color: '#ff453a', bg: 'rgba(255,69,58,0.12)',  label: 'at risk' },
  expired:  { color: '#8e8ea0', bg: 'rgba(255,255,255,0.05)', label: 'lost' },
  ready:    { color: '#30d158', bg: 'rgba(48,209,88,0.12)',  label: 'file it' },
  file_now: { color: '#ff9f0a', bg: 'rgba(255,159,10,0.14)', label: 'file now' },
  building: { color: '#0a84ff', bg: 'rgba(10,132,255,0.12)', label: 'dialing' },
  reached:  { color: '#bf5af2', bg: 'rgba(191,90,242,0.12)', label: 'engaged' },
  working:  { color: '#30d158', bg: 'rgba(48,209,88,0.12)',  label: 'live deal' },
  filed:    { color: '#bf5af2', bg: 'rgba(191,90,242,0.12)', label: 'filed' },
  approved: { color: '#30d158', bg: 'rgba(48,209,88,0.12)',  label: 'refunded' },
  closed:   { color: '#52526e', bg: 'rgba(255,255,255,0.04)', label: 'closed' },
};

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[11px] mb-1.5" style={{ color: '#52526e' }}>{label}</div>
      <div className="text-[22px] font-semibold leading-none" style={{ color: color || '#e4e4f0' }}>{value}</div>
      <div className="text-[10px] mt-1.5" style={{ color: '#52526e' }}>{sub}</div>
    </div>
  );
}

/** Four boxes, one per required day of outreach — the refund case at a glance. */
function DayPips({ lead, outreachDays }: { lead: PplLead; outreachDays: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: outreachDays }, (_, i) => {
        const done = i < lead.attempts.outreachDays;
        return (
          <div
            key={i}
            title={done ? `day ${i + 1} dialled` : `day ${i + 1} still owed`}
            style={{
              width: 14, height: 6, borderRadius: 3,
              background: done ? '#30d158' : 'rgba(255,255,255,0.10)',
            }}
          />
        );
      })}
    </div>
  );
}

function LeadRow({ lead, first, outreachDays }: { lead: PplLead; first: boolean; outreachDays: number }) {
  const s = STATE_STYLE[lead.state] || STATE_STYLE.building;
  // Days left is the number that decides everything, so it leads the row and
  // goes red as it runs out — never buried in a column on the right.
  const urgent = lead.windowLeft <= 2;
  return (
    <div
      className="flex items-center gap-3 px-3.5 py-2.5"
      style={{ borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.05)' }}
    >
      <div
        className="text-center rounded-md py-1.5 text-[12px] font-semibold flex-shrink-0"
        style={{
          minWidth: 46,
          background: urgent ? 'rgba(255,69,58,0.12)' : 'rgba(255,255,255,0.05)',
          color: urgent ? '#ff453a' : '#c4c4d6',
        }}
      >
        {lead.windowLeft < 0 ? 'shut' : `${lead.windowLeft}d`}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium truncate" style={{ color: '#e4e4f0' }}>{lead.name}</span>
          {lead.attempts.inbound > 0 && (
            <PhoneIncoming size={11} style={{ color: '#bf5af2' }} />
          )}
        </div>
        <div className="text-[10px] truncate" style={{ color: '#52526e' }}>{lead.action}</div>
      </div>

      <DayPips lead={lead} outreachDays={outreachDays} />

      <div className="text-[10px] text-right flex-shrink-0" style={{ minWidth: 74, color: '#52526e' }}>
        {lead.attempts.total} dial{lead.attempts.total === 1 ? '' : 's'}
        <div style={{ color: '#3a3a4e' }}>
          {lead.attempts.chris}c / {lead.attempts.sarah}s
        </div>
      </div>

      {lead.today.needed > 0 && ['building', 'at_risk'].includes(lead.state) && (
        <div
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium flex-shrink-0"
          style={{ background: 'rgba(10,132,255,0.12)', color: '#0a84ff' }}
        >
          <Phone size={10} /> {lead.today.needed} today
          <span style={{ color: '#52526e' }}>· {lead.today.owner === 'chris' ? 'you' : 'Sarah'}</span>
        </div>
      )}

      <span
        className="rounded px-1.5 py-0.5 text-[9px] font-medium flex-shrink-0"
        style={{ background: s.bg, color: s.color, minWidth: 56, textAlign: 'center' }}
      >
        {s.label}
      </span>
    </div>
  );
}

function Board({ title, sub, leads, outreachDays, empty, accent }: {
  title: string; sub: string; leads: PplLead[]; outreachDays: number; empty: string; accent?: string;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="px-3.5 py-2.5 flex items-baseline gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="text-[12px] font-semibold" style={{ color: accent || '#e4e4f0' }}>{title}</span>
        <span className="text-[10px]" style={{ color: '#52526e' }}>{sub}</span>
        <span className="ml-auto text-[11px] font-semibold" style={{ color: accent || '#c4c4d6' }}>{leads.length}</span>
      </div>
      {leads.length === 0
        ? <div className="px-3.5 py-5 text-[11px]" style={{ color: '#52526e' }}>{empty}</div>
        : leads.map((l, i) => <LeadRow key={l.id} lead={l} first={i === 0} outreachDays={outreachDays} />)}
    </div>
  );
}

/**
 * Shown until the GHL pipeline exists. GHL's API cannot create pipelines
 * (POST /opportunities/pipelines → 401 "not authorized for this scope"), so the
 * stage list has to be built by hand — and the exact names matter, because the
 * rest of the dashboard classifies PPL leads by parsing them.
 */
function SetupCard({ data }: { data: PplData }) {
  const [copied, setCopied] = useState(false);
  const plan = data.stagePlan || [];
  const text = plan.map(s => s.name).join('\n');

  return (
    <div className="rounded-xl p-5" style={{ background: 'rgba(255,159,10,0.06)', border: '1px solid rgba(255,159,10,0.20)' }}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} style={{ color: '#ff9f0a' }} />
        <span className="text-[13px] font-semibold" style={{ color: '#ff9f0a' }}>Pipeline not built yet</span>
      </div>
      <p className="text-[11px] leading-relaxed mb-1" style={{ color: '#c4c4d6' }}>
        GoHighLevel does not allow creating a pipeline over its API — the token comes back
        <span style={{ color: '#e4e4f0' }}> 401 not authorized for this scope</span>. Build it once in
        the GHL UI under <span style={{ color: '#e4e4f0' }}>Settings → Pipelines → Add Pipeline</span>,
        name it <span style={{ color: '#e4e4f0' }}>Property Leads</span>, and add these {plan.length} stages in order.
      </p>
      <p className="text-[10px] mb-3" style={{ color: '#52526e' }}>
        Names matter — the rest of Jarvis reads a lead&rsquo;s status by parsing them. Then run{' '}
        <span style={{ color: '#c4c4d6' }}>node ppl-setup.js</span> to capture the stage IDs.
      </p>

      <div className="rounded-lg overflow-hidden mb-3" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {plan.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2.5 px-3 py-1.5"
               style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
            <span className="text-[10px] w-5 text-right" style={{ color: '#3a3a4e' }}>{i + 1}</span>
            <span className="text-[11px]" style={{ color: '#e4e4f0' }}>{s.name}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
        className="rounded-md px-3 py-1.5 text-[11px] font-medium"
        style={{ background: 'rgba(10,132,255,0.12)', color: '#0a84ff', border: '1px solid rgba(10,132,255,0.22)' }}
      >
        {copied ? 'Copied — paste one per stage' : 'Copy all stage names'}
      </button>
    </div>
  );
}

export function PropertyLeads() {
  const { refreshKey } = useApp();
  const { data, loading, error } = usePropertyLeads(refreshKey);

  // The benchmark the live cost-per-deal is closest to. This is the whole
  // keep-or-kill judgement in one line, so it is computed once and shown next
  // to the number rather than left for Chris to work out.
  const verdict = useMemo(() => {
    const cpd = data?.kpis?.costPerDeal;
    if (!data?.ready || cpd == null) return null;
    const b = data.benchmarks;
    if (cpd <= b.best * data.bid) return { text: 'beating their best FL account', color: '#30d158' };
    if (cpd <= b.avg  * data.bid)  return { text: 'at or better than their quoted average', color: '#30d158' };
    if (cpd <= b.bad  * data.bid)  return { text: 'worse than quoted, still under a novation fee', color: '#ff9f0a' };
    return { text: 'above the downside case — reconsider the bid', color: '#ff453a' };
  }, [data]);

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-2 text-[11px]" style={{ color: '#52526e' }}>
      <Loader2 size={14} className="animate-spin" /> Loading Property Leads…
    </div>
  );

  if (error) return (
    <div className="rounded-xl p-5 text-[11px]" style={{ background: 'rgba(255,69,58,0.06)', border: '1px solid rgba(255,69,58,0.20)', color: '#ff453a' }}>
      Property Leads feed unreachable — {error}
      <div className="mt-1 text-[10px]" style={{ color: '#52526e' }}>
        dialer-server (:3007) serves this. Check it is running, and that dialer/property-leads is in the proxy allowlist.
      </div>
    </div>
  );

  if (!data) return null;
  if (!data.ready) return <SetupCard data={data} />;

  const k = data.kpis;

  return (
    <div className="space-y-4">
      {/* The money-now bar. Two numbers only: what to dial today, and what
          walks out the door if today gets skipped. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl px-4 py-3.5 flex items-center gap-3"
          style={{ background: k.dialsDueToday ? 'rgba(10,132,255,0.08)' : 'rgba(255,255,255,0.03)',
                   border: `1px solid ${k.dialsDueToday ? 'rgba(10,132,255,0.22)' : 'rgba(255,255,255,0.06)'}` }}
        >
          <Phone size={18} style={{ color: k.dialsDueToday ? '#0a84ff' : '#52526e' }} />
          <div>
            <div className="text-[20px] font-semibold leading-none" style={{ color: k.dialsDueToday ? '#0a84ff' : '#52526e' }}>
              {k.dialsDueToday} dial{k.dialsDueToday === 1 ? '' : 's'} due today
            </div>
            <div className="text-[10px] mt-1" style={{ color: '#52526e' }}>
              across {k.dueTodayCount} lead{k.dueTodayCount === 1 ? '' : 's'} · {data.rules.attemptsPerDay}/day keeps each claim alive
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="rounded-xl px-4 py-3.5 flex items-center gap-3"
          style={{ background: k.atRiskCash ? 'rgba(255,69,58,0.08)' : 'rgba(255,255,255,0.03)',
                   border: `1px solid ${k.atRiskCash ? 'rgba(255,69,58,0.22)' : 'rgba(255,255,255,0.06)'}` }}
        >
          <AlertTriangle size={18} style={{ color: k.atRiskCash ? '#ff453a' : '#52526e' }} />
          <div>
            <div className="text-[20px] font-semibold leading-none" style={{ color: k.atRiskCash ? '#ff453a' : '#52526e' }}>
              {money(k.atRiskCash)} at risk
            </div>
            <div className="text-[10px] mt-1" style={{ color: '#52526e' }}>
              {k.atRisk} lead{k.atRisk === 1 ? '' : 's'} cannot finish {data.rules.outreachDays} dial-days before the window shuts
            </div>
          </div>
        </motion.div>
      </div>

      {/* Economics. Cost per deal is the keep-or-kill number; the rep's
          benchmarks sit beside it labelled as claims, not facts. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Leads bought" value={String(k.leads)} sub={`${money(k.costPerLead)} each`} />
        <Kpi label="Net spend" value={money(k.netSpend)}
             sub={k.recovered ? `${money(k.recovered)} refunded back` : 'nothing recovered yet'} />
        <Kpi label="Cost per deal" value={k.costPerDeal == null ? '—' : money(k.costPerDeal)}
             sub={verdict ? verdict.text : `${k.deals} deal${k.deals === 1 ? '' : 's'} closed so far`}
             color={verdict?.color} />
        <Kpi label="Live ratio" value={k.liveRatio == null ? '—' : `${k.liveRatio}:1`}
             sub={`they claimed ${data.benchmarks.avg}:1 (unverified)`} />
        <Kpi label="Claims ready" value={money(k.claimsReadyCash)}
             sub={`${k.claimsReady} earned, file within ${data.rules.windowDays}d`}
             color={k.claimsReady ? '#30d158' : undefined} />
      </div>

      {/* Boards, ordered by how fast the money disappears. */}
      <Board title="Dial today" sub={`${data.rules.attemptsPerDay} attempts each — you take the first ${data.rules.chrisAttempts}, Sarah takes the rest`}
             leads={data.dueToday} outreachDays={data.rules.outreachDays} accent="#0a84ff"
             empty="Nothing owed today. Every live lead has had its attempts." />

      {data.atRisk.length > 0 && (
        <Board title="Running out of window" sub="not enough days left to earn the claim — dial now or write it off"
               leads={data.atRisk} outreachDays={data.rules.outreachDays} accent="#ff453a" empty="" />
      )}

      <Board title="Claims ready to file" sub={`${data.rules.outreachDays} days of outreach documented, seller never engaged`}
             leads={data.claimsReady} outreachDays={data.rules.outreachDays} accent="#30d158"
             empty="No claims earned yet." />

      {data.expired.length > 0 && (
        <Board title="Lost" sub="window closed without the required dial-days"
               leads={data.expired} outreachDays={data.rules.outreachDays} accent="#8e8ea0" empty="" />
      )}

      <div className="flex items-center gap-4 px-1 text-[10px]" style={{ color: '#52526e' }}>
        <span className="flex items-center gap-1.5"><Target size={11} /> {k.qualified} qualified of {k.leads}</span>
        <span className="flex items-center gap-1.5"><Phone size={11} /> {k.attemptSplit.chris} dials by you · {k.attemptSplit.sarah} by Sarah</span>
        {k.expiredCount > 0 && (
          <span className="flex items-center gap-1.5" style={{ color: '#8e8ea0' }}>
            <TrendingDown size={11} /> {money(k.expiredCash)} written off
          </span>
        )}
        <span className="ml-auto">GHL is the source of truth · refreshed {new Date(data.builtAt).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
