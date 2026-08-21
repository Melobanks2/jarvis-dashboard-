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
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { MapPin, Phone, Clock, CalendarCheck, ChevronLeft, Maximize2 } from 'lucide-react';
import { Lead, Source } from '@/lib/hooks/useLeads';
import { PropertyThumb } from '@/components/ui/PropertyPhotos';
import {
  FlowStage, flowStageOf, attemptsOf, norm, isBooked, SUB_STAGES, subStageOf,
} from '@/lib/leadStages';
import { refundStatusOf, REFUND_COLOR, ATTEMPTS_REQUIRED } from '@/lib/refundRules';
import { followUpOf, byUrgency, appointmentLabel, hoursUntil } from '@/lib/followUp';
import { useLiveCalls, LiveCall } from '@/lib/hooks/useLiveCalls';

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
  // Clicking a lane opens it into its own job board — the lane answers "whose
  // job", the opened board answers "where exactly". One at a time: three lanes
  // times seven columns is not a board anyone can read.
  const [openLane, setOpenLane] = useState<FlowStage | null>(null);
  // Who Sarah is on the phone with, refreshed every 3s independently of the
  // lead list — the aura has to be live even when GHL data is minutes stale.
  const live = useLiveCalls();

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
    // Each lane sorts by its own job, not by a shared default.
    // Closer: soonest appointment — that is the running order of the day.
    g.closer.sort((a, b) => {
      const ka = appointments[digits10(a.phone)] || '9';
      const kb = appointments[digits10(b.phone)] || '9';
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    // Working: most overdue against its own cadence. A hot seller uncalled for
    // nine days has to sit above a cold one that is not due for another week.
    g.working.sort(byUrgency);
    // New: the refund clock decides. 'behind' first (calls owed no longer fit
    // the days left), then whoever is closest to their deadline.
    g.new.sort((a, b) => {
      const ra = refundStatusOf(a), rb = refundStatusOf(b);
      const rank = (s: string | null) => (s === 'behind' ? 0 : s === 'ready' ? 1 : 2);
      const d = rank(ra.state) - rank(rb.state);
      if (d) return d;
      return (ra.daysLeft ?? 9999) - (rb.daysLeft ?? 9999);
    });
    return g;
  }, [scoped, appointments]);

  const countBySource = (stage: FlowStage, s: Source) =>
    grouped[stage].filter(l => l.source === s).length;

  // A lane glows softly when any lead inside it is on a call right now.
  const laneLive = useMemo(() => {
    const m: Record<FlowStage, LiveCall | null> = { new: null, working: null, closer: null };
    (Object.keys(grouped) as FlowStage[]).forEach(k => {
      for (const l of grouped[k]) {
        const c = live.forPhone(l.phone);
        if (c) { m[k] = c; break; }
      }
    });
    return m;
  }, [grouped, live]);

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

      <LayoutGroup>
      <AnimatePresence mode="wait" initial={false}>
      {openLane ? (
        <ExpandedLane key={`open-${openLane}`}
                      meta={STAGES.find(s => s.id === openLane)!}
                      leads={grouped[openLane]}
                      appointments={appointments}
                      live={live}
                      onClose={() => setOpenLane(null)} />
      ) : (
      <motion.div key="lanes" className="grid gap-3"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {STAGES.map(st => (
          <motion.div key={st.id} layoutId={`lane-${st.id}`}
               onClick={() => setOpenLane(st.id)}
               whileHover={{ y: -2 }}
               className={`rounded-[18px] border border-border overflow-hidden flex flex-col cursor-pointer group${laneLive[st.id] ? ' aura-soft' : ''}`}
               style={{
                 background: 'rgba(255,255,255,0.03)',
                 ...(laneLive[st.id] ? {
                   ['--aura' as string]: `${st.color}`,
                   ['--aura-line' as string]: `${st.color}88`,
                 } : {}),
               }}>
            <div className="px-3.5 py-2.5 border-b border-border"
                 style={{ background: `linear-gradient(180deg, ${st.color}1f, transparent)` }}>
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold" style={{ color: st.color }}>{st.label}</span>
                <Maximize2 size={10} className="opacity-0 group-hover:opacity-60 transition-opacity"
                           style={{ color: st.color }} />
                {laneLive[st.id] && (
                  <span className="text-[8.5px] font-semibold px-1.5 py-0.5 rounded tracking-[0.4px] flex items-center gap-1"
                        style={{ background: `${st.color}26`, color: st.color }}>
                    <span className="w-1 h-1 rounded-full aura-live"
                          style={{ background: st.color, ['--aura' as string]: st.color, ['--aura-far' as string]: 'transparent' }} />
                    {laneLive[st.id]!.phase === 'connected' ? 'ON A CALL' : 'DIALING'}
                  </span>
                )}
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
                <FlowCard key={l.id} lead={l} stage={st.id} when={appointments[digits10(l.phone)]}
                          live={live.forPhone(l.phone)} color={st.color} />
              ))}
            </div>
            <div className="px-3.5 py-2 border-t border-border text-[9.5px] text-dimtext
                            opacity-0 group-hover:opacity-100 transition-opacity">
              Click to open the job board
            </div>
          </motion.div>
        ))}
      </motion.div>
      )}
      </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}

/**
 * One lane, opened into its own job board: a column per stage inside it.
 * Reuses the same cards, so a lead reads identically whichever view it is in.
 */
function ExpandedLane({ meta, leads, appointments, live, onClose }: {
  meta: typeof STAGES[number]; leads: Lead[];
  appointments: Record<string, string>;
  live: ReturnType<typeof useLiveCalls>;
  onClose: () => void;
}) {
  const cols = useMemo(() => {
    const m: Record<string, Lead[]> = {};
    for (const sub of SUB_STAGES[meta.id]) m[sub.id] = [];
    for (const l of leads) {
      const k = subStageOf(l);
      if (k && m[k]) m[k].push(l);
    }
    return m;
  }, [leads, meta.id]);

  return (
    <motion.div layoutId={`lane-${meta.id}`}
                className="rounded-[18px] border border-border overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="px-4 py-3 border-b border-border flex items-center gap-3"
           style={{ background: `linear-gradient(180deg, ${meta.color}1f, transparent)` }}>
        <button onClick={onClose}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-medium transition-colors hover:bg-white/5"
                style={{ color: meta.color, border: `1px solid ${meta.color}44` }}>
          <ChevronLeft size={11} /> All lanes
        </button>
        <div>
          <div className="text-[15px] font-semibold" style={{ color: meta.color }}>{meta.label}</div>
          <div className="text-[10px] text-dimtext">{meta.who} · {meta.note}</div>
        </div>
        <span className="ml-auto text-[17px] font-semibold tabular-nums text-textb">{leads.length}</span>
      </div>

      <motion.div className="p-2.5 grid gap-2.5 overflow-x-auto"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08, duration: 0.2 }}
                  style={{ gridTemplateColumns: `repeat(${SUB_STAGES[meta.id].length}, minmax(190px, 1fr))` }}>
        {SUB_STAGES[meta.id].map((sub, i) => (
          <motion.div key={sub.id}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.035, duration: 0.2 }}
                      className="rounded-[14px] border border-border flex flex-col"
                      style={{ background: 'rgba(255,255,255,0.025)' }}>
            <div className="px-2.5 py-2 border-b border-border">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11.5px] font-semibold text-textb">{sub.label}</span>
                <span className="ml-auto text-[11.5px] font-semibold tabular-nums"
                      style={{ color: cols[sub.id].length ? meta.color : 'var(--dimtext)' }}>
                  {cols[sub.id].length}
                </span>
              </div>
              {sub.note && <div className="text-[9px] text-dimtext mt-0.5">{sub.note}</div>}
            </div>
            <div className="p-1.5 space-y-1.5 overflow-y-auto" style={{ maxHeight: 520 }}>
              {cols[sub.id].length === 0
                ? <div className="text-[10px] text-dimtext text-center py-4">—</div>
                : cols[sub.id].map(l => (
                    <FlowCard key={l.id} lead={l} stage={meta.id}
                              when={appointments[digits10(l.phone)]}
                              live={live.forPhone(l.phone)} color={meta.color} />
                  ))}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}

const digits10 = (p?: string | null) => String(p || '').replace(/\D/g, '').slice(-10);

const SRC_COLOR: Record<Source, string> = { ispeed: '#64d2ff', alpha: '#bf5af2', sarah: '#30d158' };

function FlowCard({ lead, stage, when, live, color = '#0a84ff' }: {
  lead: Lead; stage: FlowStage; when?: string; live?: LiveCall | null; color?: string;
}) {
  const attempts = attemptsOf(lead.stageName);
  const unresponsive = norm(lead.stageName).includes('unresponsive');
  // Booked = Sarah set a time and nothing has moved past it yet. Called out on
  // the card because "appointment set" and "contract sent" are both Closer but
  // are not the same job.
  const booked = isBooked(lead.stageName, !!when || !!lead.hasAppointment);
  const rf = refundStatusOf(lead);
  const fu = followUpOf(lead);
  const hrs = hoursUntil(when);
  const soon = hrs != null && hrs >= 0 && hrs <= 12;   // today's calls
  // One line of context for the closer: what she got out of them.
  const prep = [lead.pain, lead.timeline, lead.askingPrice, lead.condition]
    .filter(Boolean).join(' · ') || null;

  // The lead Sarah is on the phone with RIGHT NOW gets the bright aura.
  // Ringing pulses faster and thinner than connected — anticipation vs
  // conversation — so the two states are distinguishable without reading.
  const ringing = live?.phase === 'ringing';
  const auraColor = live ? (ringing ? '#ff9f0a' : '#30d158') : null;

  return (
    <div className={`rounded-[10px] p-2 flex gap-2${live ? ` aura-live${ringing ? ' aura-ringing' : ''}` : ''}`}
         style={{
           background: live ? `${auraColor}14` : 'rgba(255,255,255,0.045)',
           border: '1px solid var(--border)',
           ...(live ? {
             ['--aura' as string]: auraColor!,
             ['--aura-far' as string]: `${auraColor}55`,
           } : {}),
         }}>
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

        {live && (
          <div className="flex items-center gap-1.5 mt-1 text-[9.5px] font-semibold"
               style={{ color: auraColor! }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: auraColor! }} />
            {ringing ? 'Ringing…' : `Sarah is talking — ${live.duration}s`}
          </div>
        )}

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
          {/* iSpeed refund clock. Two numbers, because either one alone lies:
              attempts-to-five and days-to-deadline. Red when the calls owed no
              longer fit in the days left — that lead is about to expire unfiled. */}
          {stage === 'new' && rf.state && rf.state !== 'on_track' && (
            <span className="px-1 py-[1px] rounded font-semibold"
                  style={{ background: `${REFUND_COLOR[rf.state]}22`, color: REFUND_COLOR[rf.state] }}>
              {rf.state === 'ready'   ? `refund ready · ${rf.daysLeft}d`
             : rf.state === 'behind'  ? `${rf.attemptsLeft} calls in ${rf.daysLeft}d`
             : rf.state === 'expired' ? 'window closed'
             : rf.state === 'filed'   ? 'refund filed'
             : rf.state}
            </span>
          )}
          {stage === 'new' && rf.state === 'on_track' && (
            <span title={rf.why}>{rf.attempts}/{ATTEMPTS_REQUIRED} · {rf.daysLeft}d left</span>
          )}
          {stage !== 'new' && lead.askingPrice && <span style={{ color: '#30d158' }}>{lead.askingPrice}</span>}
          {lead.phone && <span className="flex items-center gap-1"><Phone size={8} />{lead.phone}</span>}
        </div>

        {/* Working: the only number that matters here is how late this call is. */}
        {stage === 'working' && (
          <div className="mt-1 flex items-center gap-1 text-[9.5px]"
               style={{ color: fu.overdue ? '#ff453a' : fu.dueInDays === 0 ? '#ff9f0a' : 'var(--dimtext)' }}>
            <Clock size={8} />
            {fu.label}
            {fu.everyDays != null && (
              <span className="opacity-60">· every {fu.everyDays}d</span>
            )}
          </div>
        )}

        {stage === 'closer' && (
          <>
            <div className="mt-1 flex items-center gap-1 text-[9.5px] font-semibold"
                 style={{ color: soon ? '#30d158' : when ? '#64d2ff' : '#ff9f0a' }}>
              {when ? <CalendarCheck size={8} /> : <Clock size={8} />}
              {appointmentLabel(when) || 'no appointment set'}
            </div>
            {/* What Chris needs in his hand when he dials — not a second click away. */}
            {prep && <div className="mt-0.5 text-[9px] text-dimtext truncate" title={prep}>{prep}</div>}
          </>
        )}
      </div>
    </div>
  );
}
