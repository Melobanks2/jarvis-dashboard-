'use client';

/**
 * Stage Map — the whole operation on one screen, with live counts.
 *
 * Not documentation. Every number here is read from the same hooks the boards
 * use, so this doubles as the answer to "where is everything right now" and
 * "what are the rules". A static diagram would drift from the code inside a
 * week; this cannot, because it is the code.
 *
 * Reading order matches the work: who owns the lead (three lanes), then the
 * money at risk (refund clock, then refund claims), then what falls off.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, AlertTriangle, CalendarCheck, Clock, Receipt } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead } from '@/lib/hooks/useLeads';
import { flowStageOf, groupOf, FlowStage } from '@/lib/leadStages';
import { refundStatusOf, ATTEMPTS_REQUIRED, WINDOW_DAYS } from '@/lib/refundRules';
import { followUpOf, CADENCE_DAYS } from '@/lib/followUp';
import { DIALER_API } from '@/lib/config';
import { openRefunds } from '@/components/sections/Refunds';

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US');

interface Rollup {
  open: number; openValue: number; atRisk: number; atRiskValue: number;
  oldestWaitDays: number; recovered: number; recoveredValue: number;
  denied: number; deniedValue: number; approvalRatePct: number | null;
}

const LANES: {
  id: FlowStage; label: string; who: string; sub: string; color: string;
  stages: { label: string; note?: string; key?: boolean }[];
  sortedBy: string; cardShows: string;
}[] = [
  {
    id: 'new', label: 'New', who: 'Sarah — reach them', sub: 'nobody has had a conversation yet', color: '#0a84ff',
    stages: [
      { label: 'New lead', note: 'never dialed' },
      { label: 'Attempt 1' }, { label: 'Attempt 2' }, { label: 'Attempt 3' },
      { label: 'Attempt 4' }, { label: 'Attempt 5' },
      { label: 'Unresponsive', note: '6+ · refund track' },
    ],
    sortedBy: 'refund risk — behind-on-calls first, then nearest deadline',
    cardShows: 'attempts 3/5 and days left. Red when the calls owed no longer fit the days.',
  },
  {
    id: 'working', label: 'Working', who: 'Sarah — follow up', sub: 'reached, talked to, and rated', color: '#ff9f0a',
    stages: [
      { label: 'Hot follow-up', note: 'every 3d' },
      { label: 'Warm follow-up', note: 'every 7d' },
      { label: 'Cold follow-up', note: 'every 14d' },
      { label: 'Callback booked' },
      { label: 'Replied — needs response', note: 'next day' },
    ],
    sortedBy: 'most overdue against its own cadence',
    cardShows: '“4d overdue” in red, or due today in amber.',
  },
  {
    id: 'closer', label: 'Closer', who: 'Chris — call and close', sub: 'a real appointment exists', color: '#30d158',
    stages: [
      { label: 'Appointment set', note: 'date + time', key: true },
      { label: 'Decision pending' }, { label: 'Contract sent' },
      { label: 'Under contract' }, { label: 'Disposition' }, { label: 'Closed' },
    ],
    sortedBy: 'soonest appointment — your running order for the day',
    cardShows: '“in 2h” countdown, plus pain · timeline · asking price · condition.',
  },
];

const TICKET_COLS = [
  { label: 'Waiting on you', sub: 'they asked for something', color: '#ff453a', alarm: true },
  { label: 'Ready to file',  sub: 'qualified, not sent',      color: '#64d2ff' },
  { label: 'Filed',          sub: 'waiting on the vendor',    color: '#bf5af2' },
  { label: 'Answered',       sub: 'back in their court',      color: '#5e9cff' },
  { label: 'Recovered',      sub: 'money back',               color: '#30d158' },
  { label: 'Denied',         sub: 'money gone — logged why',  color: '#ff9f0a' },
];

export function StageMap() {
  const { refreshKey, setActiveSection } = useApp();
  const { leads } = useLeads(refreshKey);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [ticketCounts, setTicketCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch(`${DIALER_API}/dialer/refund-desk`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        setRollup(j.rollup || null);
        const c: Record<string, number> = {};
        for (const t of (j.tickets || [])) c[t.status] = (c[t.status] || 0) + 1;
        setTicketCounts(c);
      })
      .catch(() => {});
  }, [refreshKey]);

  const stats = useMemo(() => {
    const lane: Record<FlowStage, Lead[]> = { new: [], working: [], closer: [] };
    let behind = 0, behindValue = 0, ready = 0, readyValue = 0, overdue = 0;

    for (const l of leads) {
      const st = flowStageOf(l.stageName, !!l.hasAppointment);
      if (st) lane[st].push(l);

      const rf = refundStatusOf(l);
      if (rf.state === 'behind') { behind++; behindValue += rf.price; }
      if (rf.state === 'ready')  { ready++;  readyValue  += rf.price; }
      if (st === 'working' && followUpOf(l).overdue) overdue++;
    }
    return { lane, behind, behindValue, ready, readyValue, overdue };
  }, [leads]);

  const countIn = (id: FlowStage, match: (g: string) => boolean) =>
    stats.lane[id].filter(l => match(groupOf(l.stageName))).length;

  return (
    <div className="space-y-4">
      {/* what needs a human right now */}
      <GlassCard accent="blue" padding="p-4" hover={false}>
        <div className="flex flex-wrap gap-4">
          <Stat label="Behind on calls" value={money(stats.behindValue)}
                note={stats.behind ? `${stats.behind} short of ${ATTEMPTS_REQUIRED} attempts` : 'none'}
                color={stats.behind ? '#ff453a' : 'var(--dimtext)'} />
          <Stat label="Follow-ups overdue" value={String(stats.overdue)}
                note={stats.overdue ? 'past their cadence' : 'all current'}
                color={stats.overdue ? '#ff9f0a' : 'var(--dimtext)'} />
          <Stat label="Ready to file" value={money(stats.readyValue)}
                note={`${stats.ready} claim${stats.ready === 1 ? '' : 's'} qualified`}
                color={stats.ready ? '#64d2ff' : 'var(--dimtext)'} />
          <Stat label="Claims on your reply" value={money(rollup?.atRiskValue || 0)}
                note={rollup?.atRisk ? `oldest ${rollup.oldestWaitDays}d` : 'nothing stuck'}
                color={rollup?.atRisk ? '#ff453a' : 'var(--dimtext)'} />
          <Stat label="Appointments" value={String(stats.lane.closer.length)}
                note="in the closer lane" color="#30d158" />
        </div>
      </GlassCard>

      <Law color="#ff453a" rule="RULE 01"
           head="A booked appointment is a deal, not a follow-up."
           body="The moment Sarah books a time, the lead leaves her lane completely and lands in Closer. No cadence touches it. Nobody calls it again except you, at the booked time. Hot follow-up means she reached them and they are interested — a different thing entirely." />

      {/* the three lanes */}
      <div>
        <SectionTitle accent="blue">Who owns the lead right now</SectionTitle>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {LANES.map(L => (
            <div key={L.id} className="rounded-[18px] border border-border overflow-hidden flex flex-col"
                 style={{ background: 'rgba(255,255,255,0.03)', borderTop: `3px solid ${L.color}` }}>
              <div className="px-3.5 py-3 border-b border-border"
                   style={{ background: `linear-gradient(180deg, ${L.color}1f, transparent)` }}>
                <div className="text-[9.5px] uppercase tracking-[1px] font-semibold mb-1" style={{ color: L.color }}>
                  {L.who}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[17px] font-semibold text-textb">{L.label}</span>
                  <span className="ml-auto text-[17px] font-semibold tabular-nums" style={{ color: L.color }}>
                    {stats.lane[L.id].length}
                  </span>
                </div>
                <div className="text-[10px] text-dimtext mt-0.5">{L.sub}</div>
              </div>

              <div className="p-2.5 space-y-1 flex-1">
                {L.stages.map(s => {
                  const n = countFor(stats.lane[L.id], s.label);
                  return (
                    <div key={s.label}
                         className="flex items-baseline gap-2 px-2 py-1.5 rounded-lg text-[11.5px]"
                         style={{
                           border: `1px solid ${s.key ? L.color + '66' : 'var(--border)'}`,
                           background: s.key ? `${L.color}14` : 'transparent',
                         }}>
                      <span className={s.key ? 'font-semibold text-textb' : 'text-textb'}>{s.label}</span>
                      {s.note && <span className="text-[9px] text-dimtext">{s.note}</span>}
                      <span className="ml-auto tabular-nums text-[11px]"
                            style={{ color: n ? L.color : 'var(--dimtext)' }}>{n}</span>
                    </div>
                  );
                })}
              </div>

              <div className="px-3.5 py-2.5 border-t border-border text-[10px] text-dimtext leading-relaxed">
                <div><span className="text-textb font-semibold">Sorted by</span> {L.sortedBy}</div>
                <div className="mt-1"><span className="text-textb font-semibold">Card shows</span> {L.cardShows}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-3 text-[10px] text-dimtext font-mono uppercase tracking-[1px]">
          <span style={{ color: '#0a84ff' }}>Sarah owns</span>
          <span className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          <span className="flex items-center gap-1"><CalendarCheck size={10} /> the handoff is the appointment</span>
          <span className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          <span style={{ color: '#30d158' }}>Chris owns</span>
        </div>
      </div>

      {/* refund clock */}
      <div>
        <SectionTitle accent="orange">The refund clock — before you file</SectionTitle>
        <GlassCard padding="p-4" hover={false}>
          <p className="text-[12px] text-textb mb-3">
            Two conditions, and only one of them is a clock:
            {' '}<b>{ATTEMPTS_REQUIRED} documented call attempts</b>, filed inside <b>{WINDOW_DAYS} days</b>.
          </p>
          <div className="flex items-start gap-2 text-[11.5px] p-2.5 rounded-lg mb-3"
               style={{ background: 'rgba(255,69,58,0.10)', border: '1px solid rgba(255,69,58,0.25)', color: '#ff453a' }}>
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>
              <b>Days alone lie.</b> Day 18 with 2 attempts is not refundable — it needs 3 calls in 3 days.
              That is the <b>Behind on calls</b> column, and it is the money that quietly disappears.
              {stats.behind > 0 && <> Right now that is <b>{money(stats.behindValue)}</b>.</>}
            </span>
          </div>
          <ul className="space-y-1.5 text-[11.5px] text-dimtext">
            <Rule>A lead sits in <b className="text-textb">New</b> and the refund track at once. One is Sarah&apos;s job, the other is a deadline.</Rule>
            <Rule>Reach a human and eligibility is gone — you got what you paid for.</Rule>
            <Rule>Bonus-funded and raw leads never refund. Real balance only.</Rule>
          </ul>
          <button onClick={() => { openRefunds('before'); setActiveSection('refunds'); }}
                  className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold"
                  style={{ color: '#ff9f0a' }}>
            Open Refund Pipeline <ArrowRight size={11} />
          </button>
        </GlassCard>
      </div>

      {/* refund desk */}
      <div>
        <SectionTitle accent="purple">The refund desk — after you file</SectionTitle>
        <Law color="#ff9f0a" rule="RULE 02"
             head="A denied claim is money you already spent."
             body="Vendors rarely just approve or deny — they reply asking for call logs, and the claim then sits waiting on you. The deadline board cannot show that, because the deadline is already behind you the moment you file. So filed claims get their own board, ordered by whose move it is." />

        <div className="grid gap-2.5 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {TICKET_COLS.map((c, i) => {
            const key = ['needs_response', 'ready', 'submitted', 'responded', 'approved', 'denied'][i];
            const n = ticketCounts[key] || 0;
            return (
              <div key={c.label} className="rounded-[14px] p-3 border"
                   style={{
                     background: 'rgba(255,255,255,0.03)',
                     borderColor: c.alarm && n ? `${c.color}66` : 'var(--border)',
                     borderTop: `3px solid ${c.color}`,
                   }}>
                <div className="flex items-baseline gap-2">
                  <span className="text-[12.5px] font-semibold" style={{ color: c.color }}>{c.label}</span>
                  <span className="ml-auto text-[13px] font-semibold tabular-nums text-textb">{n}</span>
                </div>
                <div className="text-[9.5px] text-dimtext mt-0.5">{c.sub}</div>
              </div>
            );
          })}
        </div>

        <GlassCard padding="p-4" hover={false} className="mt-3">
          <ul className="space-y-1.5 text-[11.5px] text-dimtext">
            <Rule>Every ticket carries a <b className="text-textb">thread</b>. Log what they said with <b className="text-textb">Them</b> — that flips it to <i>Waiting on you</i> and starts the clock. Your reply flips it back.</Rule>
            <Rule>One open ticket per phone. Filing twice damages the vendor relationship and double-counts the money.</Rule>
            <Rule>Roughly <b className="text-textb">1 in 5 claims is denied</b>. Reasons are tallied so you stop filing the kind that lose.
              {rollup?.approvalRatePct != null && <> Yours is running at <b className="text-textb">{rollup.approvalRatePct}%</b> approved.</>}
            </Rule>
            <Rule>Vendor is a field, not a hard-code — <b className="text-textb">property leads drop straight in</b>.</Rule>
          </ul>
          <button onClick={() => { openRefunds('after'); setActiveSection('refunds'); }}
                  className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold"
                  style={{ color: '#bf5af2' }}>
            <Receipt size={11} /> Open Refund Desk <ArrowRight size={11} />
          </button>
        </GlassCard>
      </div>

      {/* sources + cadence reference */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <GlassCard padding="p-4" hover={false}>
          <div className="text-[13px] font-semibold text-textb mb-1">Every lane splits by source</div>
          <div className="text-[11px] text-dimtext mb-3">Three businesses sharing one board.</div>
          <div className="flex gap-2 flex-wrap mb-3">
            {[['iSpeed', '#64d2ff', 'ispeed'], ['Property', '#bf5af2', 'alpha'], ['Scout', '#30d158', 'sarah']].map(([l, c, k]) => (
              <span key={l} className="px-2.5 py-1 rounded-full text-[10.5px] font-medium tabular-nums"
                    style={{ background: `${c}1a`, color: c }}>
                {l} {leads.filter(x => x.source === k).length}
              </span>
            ))}
          </div>
          <ul className="space-y-1.5 text-[11.5px] text-dimtext">
            <Rule><b className="text-textb">Sarah dials one line at a time</b> on purchased leads. You paid for them individually.</Rule>
            <Rule><b className="text-textb">Scout runs the multi-line dialer.</b> Cold volume, nothing paid per lead.</Rule>
          </ul>
        </GlassCard>

        <GlassCard padding="p-4" hover={false}>
          <div className="text-[13px] font-semibold text-textb mb-1">Follow-up cadence</div>
          <div className="text-[11px] text-dimtext mb-3">What makes a Working lead overdue.</div>
          <div className="space-y-1.5">
            {(['hot', 'warm', 'cold', 'replied'] as const).map(k => {
              const n = countIn('working', g => g === k);
              const color = k === 'hot' ? '#ff453a' : k === 'warm' ? '#ff9f0a' : k === 'cold' ? '#64d2ff' : '#bf5af2';
              return (
                <div key={k} className="flex items-center gap-2 text-[11.5px]">
                  <Clock size={10} style={{ color }} />
                  <span className="text-textb capitalize">{k}</span>
                  <span className="text-dimtext">every {CADENCE_DAYS[k]}d</span>
                  <span className="ml-auto tabular-nums" style={{ color: n ? color : 'var(--dimtext)' }}>{n}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>

      <div className="text-[10.5px] text-dimtext pt-3 border-t border-border">
        These stages live in Jarvis. GHL is written to as a mirror so nothing is lost there, but Jarvis
        decides where a lead sits — which is why “appointment set” exists here without existing in GHL&apos;s
        stage list. Refund rule verified 2026-08-20 against iSpeedToLead&apos;s published guarantee.
      </div>
    </div>
  );
}

/** Count leads in a lane whose stage name matches a map row. */
function countFor(leads: Lead[], label: string): number {
  const l = label.toLowerCase();
  return leads.filter(x => {
    const g = groupOf(x.stageName);
    const s = x.stageName.toLowerCase();
    if (l.startsWith('attempt')) return s.includes(l.replace('attempt ', 'attempt')) || s.includes(l);
    if (l === 'new lead')      return g === 'new';
    if (l === 'unresponsive')  return g === 'unresponsive';
    if (l.includes('hot'))     return g === 'hot';
    if (l.includes('warm'))    return g === 'warm';
    if (l.includes('cold'))    return g === 'cold';
    if (l.includes('replied')) return g === 'replied';
    if (l.includes('callback'))return s.includes('callback');
    if (l.includes('appointment')) return !!x.hasAppointment;
    if (l.includes('decision'))return g === 'decision';
    if (l.includes('contract sent')) return g === 'sent';
    if (l.includes('under contract'))return g === 'under';
    if (l.includes('disposition'))   return s.includes('dispos');
    if (l === 'closed')        return s.includes('closed');
    return false;
  }).length;
}

function Law({ color, rule, head, body }: { color: string; rule: string; head: string; body: string }) {
  return (
    <div className="flex gap-3 p-3.5 rounded-r-xl"
         style={{ background: 'rgba(255,255,255,0.03)', borderLeft: `3px solid ${color}` }}>
      <span className="text-[10px] font-mono font-bold tracking-wider flex-shrink-0 pt-0.5" style={{ color }}>
        {rule}
      </span>
      <div>
        <div className="text-[12.5px] font-semibold text-textb">{head}</div>
        <div className="text-[11.5px] text-dimtext mt-1 leading-relaxed">{body}</div>
      </div>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="flex-shrink-0" style={{ color: '#0a84ff' }}>→</span>
      <span>{children}</span>
    </li>
  );
}

function Stat({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  return (
    <div className="min-w-[130px]">
      <div className="text-[10px] uppercase tracking-[0.5px] text-dimtext">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums leading-tight" style={{ color }}>{value}</div>
      <div className="text-[10px] text-dimtext mt-0.5">{note}</div>
    </div>
  );
}
