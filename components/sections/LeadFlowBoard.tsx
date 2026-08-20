'use client';

/**
 * Lead Flow — three stages, by who owns the lead next.
 *
 * Not the CRM's stage list, which has twenty columns. Three, because there are
 * only three jobs:
 *
 *   New      — nobody has had a conversation yet. Sarah's job: reach them.
 *   Working  — reached and rated. Sarah's job: follow up until they commit.
 *   Closer   — an appointment exists. Chris's job: call and close.
 *
 * The New/Working line is drawn exactly where Chris drew it: everything up to
 * and including Attempt 6 is New, and it stops the moment a lead lands in a
 * follow-up column. A cold follow-up means somebody talked to them, so it is
 * not a "not contacted yet" lead however cold it went.
 *
 * Every stage splits by where the lead came from — iSpeed, Property, Scout —
 * because those are three different businesses that happen to share a board.
 */

import { useMemo, useState } from 'react';
import { MapPin, Phone, Clock, CalendarCheck } from 'lucide-react';
import { Lead, Source } from '@/lib/hooks/useLeads';
import { PropertyThumb } from '@/components/ui/PropertyPhotos';
import { FlowStage, flowStageOf, attemptsOf, norm, isBooked } from '@/lib/leadStages';

export { flowStageOf as stageOf };

const STAGES: { id: FlowStage; label: string; who: string; note: string; color: string }[] = [
  { id: 'new',     label: 'New',     who: 'Sarah — reach them',     note: 'no conversation yet',        color: '#0a84ff' },
  { id: 'working', label: 'Working', who: 'Sarah — follow up',      note: 'reached and rated',          color: '#ff9f0a' },
  { id: 'closer',  label: 'Closer',  who: 'Chris — call and close', note: 'appointment booked or contract out', color: '#30d158' },
];

const SRC: { id: Source; label: string; color: string }[] = [
  { id: 'ispeed', label: 'iSpeed',   color: '#64d2ff' },
  { id: 'alpha',  label: 'Property', color: '#bf5af2' },
  { id: 'sarah',  label: 'Scout',    color: '#30d158' },
];

export function LeadFlowBoard({ leads, appointments = {} }: {
  leads: Lead[]; appointments?: Record<string, string>;
}) {
  const [src, setSrc] = useState<Source | 'all'>('all');

  const scoped = useMemo(
    () => leads.filter(l => src === 'all' || l.source === src),
    [leads, src],
  );

  const grouped = useMemo(() => {
    const g: Record<FlowStage, Lead[]> = { new: [], working: [], closer: [] };
    for (const l of scoped) {
      // An appointment moves the lead to Closer whatever the CRM stage says.
      // Two independent signals, either one counts: the appointments table, or
      // the backend's "appointment set" tag if that insert did not land.
      const st = flowStageOf(l.stageName, !!appointments[digits10(l.phone)] || !!l.hasAppointment);
      if (st) g[st].push(l);
    }
    // Closer first by soonest appointment; the others by most recently touched.
    g.closer.sort((a, b) => {
      const ka = appointments[digits10(a.phone)] || '9';
      const kb = appointments[digits10(b.phone)] || '9';
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return g;
  }, [scoped, appointments]);

  const countBySource = (stage: FlowStage, s: Source) =>
    grouped[stage].filter(l => l.source === s).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.5px] text-dimtext mr-1">Source</span>
        {([{ id: 'all' as const, label: 'All three', color: '#f5f5f7' }, ...SRC]).map(s => {
          const on = src === s.id;
          const n = s.id === 'all' ? scoped.length : scoped.filter(l => l.source === s.id).length;
          return (
            <button key={s.id} onClick={() => setSrc(s.id as Source | 'all')}
              className="px-2.5 py-1 rounded-lg text-[10.5px] font-medium transition-colors"
              style={{
                background: on ? `${s.color}22` : 'rgba(255,255,255,0.05)',
                border: `1px solid ${on ? `${s.color}88` : 'var(--border)'}`,
                color: on ? s.color : 'var(--text)',
              }}>
              {s.label} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {STAGES.map(st => (
          <div key={st.id} className="rounded-[18px] border border-border overflow-hidden flex flex-col"
               style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="px-3.5 py-2.5 border-b border-border"
                 style={{ background: `linear-gradient(180deg, ${st.color}1f, transparent)` }}>
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold" style={{ color: st.color }}>{st.label}</span>
                <span className="ml-auto text-[13px] font-semibold tabular-nums text-textb">{grouped[st.id].length}</span>
              </div>
              <div className="text-[10px] text-dimtext mt-0.5">{st.who} · {st.note}</div>

              {src === 'all' && grouped[st.id].length > 0 && (
                <div className="flex gap-1.5 mt-1.5">
                  {SRC.map(s => {
                    const n = countBySource(st.id, s.id);
                    if (!n) return null;
                    return (
                      <span key={s.id} className="text-[9px] px-1.5 py-0.5 rounded tabular-nums"
                            style={{ background: `${s.color}1a`, color: s.color }}>
                        {s.label} {n}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-2 space-y-1.5 overflow-y-auto" style={{ maxHeight: 560 }}>
              {grouped[st.id].length === 0 && (
                <div className="text-[11px] text-dimtext text-center py-6">Nothing here.</div>
              )}
              {grouped[st.id].map(l => (
                <FlowCard key={l.id} lead={l} stage={st.id} when={appointments[digits10(l.phone)]} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const digits10 = (p?: string | null) => String(p || '').replace(/\D/g, '').slice(-10);

const SRC_COLOR: Record<Source, string> = { ispeed: '#64d2ff', alpha: '#bf5af2', sarah: '#30d158' };

function FlowCard({ lead, stage, when }: { lead: Lead; stage: FlowStage; when?: string }) {
  const attempts = attemptsOf(lead.stageName);
  const unresponsive = norm(lead.stageName).includes('unresponsive');
  // Booked = Sarah set a time and nothing has moved past it yet. Called out on
  // the card because "appointment set" and "contract sent" are both Closer but
  // are not the same job.
  const booked = isBooked(lead.stageName, !!when || !!lead.hasAppointment);

  return (
    <div className="rounded-[10px] p-2 flex gap-2"
         style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid var(--border)' }}>
      <PropertyThumb phone={lead.phone} address={lead.address} size={34} radius={6} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] font-medium text-textb truncate">{lead.name}</span>
          {booked && (
            <span className="flex-shrink-0 text-[8.5px] font-semibold px-1 py-[1px] rounded tracking-[0.4px]"
                  style={{ background: 'rgba(48,209,88,0.16)', color: '#30d158' }}>BOOKED</span>
          )}
          <span className="ml-auto flex-shrink-0 w-1.5 h-1.5 rounded-full"
                style={{ background: SRC_COLOR[lead.source] }} title={lead.source} />
        </div>

        {lead.address && (
          <div className="text-[9.5px] text-dimtext truncate flex items-center gap-1 mt-0.5">
            <MapPin size={8} className="flex-shrink-0" />{lead.address}
          </div>
        )}

        <div className="flex items-center gap-2 mt-1 text-[9.5px] text-dimtext tabular-nums flex-wrap">
          {stage === 'new' && (
            <span style={{ color: unresponsive ? '#ff9f0a' : undefined }}>
              {unresponsive ? '6+ attempts' : attempts ? `attempt ${attempts}` : 'never called'}
            </span>
          )}
          {stage !== 'new' && lead.askingPrice && <span style={{ color: '#30d158' }}>{lead.askingPrice}</span>}
          {lead.phone && <span className="flex items-center gap-1"><Phone size={8} />{lead.phone}</span>}
        </div>

        {stage === 'closer' && (
          <div className="mt-1 flex items-center gap-1 text-[9.5px]"
               style={{ color: when ? '#64d2ff' : '#ff9f0a' }}>
            {when ? <CalendarCheck size={8} /> : <Clock size={8} />}
            {when
              ? new Date(when).toLocaleString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
              : 'no appointment set'}
          </div>
        )}
      </div>
    </div>
  );
}
