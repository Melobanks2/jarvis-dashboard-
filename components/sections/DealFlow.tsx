'use client';

/**
 * Deal Flow — one board for the whole lead lifecycle.
 *
 * Chris asked for pipelines: leads being qualified, leads being worked by
 * temperature, leads ready for him to close, and old leads parked somewhere
 * they stop competing for attention. GHL already has exactly those stages —
 * both pipelines run New -> Attempt 1..6 -> Cold/Warm/Hot -> Decision Pending
 * -> Contract Sent -> under contract -> Closed/Dead, and iSpeed adds two
 * refund stages. So this board does not invent a second source of truth; it
 * groups the stages GHL already reports into the four buckets he described.
 *
 * Stages are matched on normalized text, never on the literal stage string:
 * the real names carry emoji and inconsistent spacing ("📞Attempt  1🤳=No
 * contact", "⛹🏼 🌡 Warm fallow ups"), and someone editing an emoji in GHL
 * must not silently empty a column.
 */

import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, MapPin, ChevronDown, Clock, AlertTriangle, Receipt,
  Flame, Snowflake, Thermometer, CheckCircle2, Hourglass,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead, Source } from '@/lib/hooks/useLeads';
import { PropertyThumb } from '@/components/ui/PropertyPhotos';
import { supabase } from '@/lib/supabase';

/* ── stage → board ────────────────────────────────────────────────────── */

type Board = 'qualifying' | 'working' | 'closing' | 'parked' | 'refund';

const norm = (s: string) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9+ -]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Order matters — "Attempt 6+ = Unresponsive" is parked, not qualifying. */
export function classify(stageName: string): { board: Board; key: string } {
  const s = norm(stageName);
  if (s.includes('refund') && s.includes('approved'))   return { board: 'refund',     key: 'approved' };
  if (s.includes('refund'))                             return { board: 'refund',     key: 'requested' };
  if (s.includes('unresponsive') || /attempt 6/.test(s))return { board: 'parked',     key: 'unresponsive' };
  if (s.includes('dead'))                               return { board: 'parked',     key: 'dead' };
  if (s.includes('signed with someone'))                return { board: 'parked',     key: 'lost' };
  if (s.includes('under contract'))                     return { board: 'closing',    key: 'under' };
  if (s.includes('contract sent'))                      return { board: 'closing',    key: 'sent' };
  if (s.includes('decision pending'))                   return { board: 'closing',    key: 'decision' };
  if (s.includes('closed') || s.includes('dispostion') || s.includes('disposition'))
                                                        return { board: 'closing',    key: 'won' };
  if (s.includes('hot'))                                return { board: 'working',    key: 'hot' };
  if (s.includes('warm'))                               return { board: 'working',    key: 'warm' };
  if (s.includes('cold'))                               return { board: 'working',    key: 'cold' };
  if (s.includes('replied'))                            return { board: 'qualifying', key: 'replied' };
  if (s.includes('attempt'))                            return { board: 'qualifying', key: 'attempt' };
  return { board: 'qualifying', key: 'new' };
}

const BOARDS: { id: Board; label: string; sub: string; color: string; keys: [string, string][] }[] = [
  { id: 'qualifying', label: 'Qualifying', sub: 'Sarah is still trying to reach them', color: '#0a84ff',
    keys: [['replied', 'Replied — needs response'], ['new', 'New'], ['attempt', 'Attempted']] },
  { id: 'working', label: 'Working', sub: 'Reached and rated — follow-up', color: '#ff9f0a',
    keys: [['hot', 'Hot'], ['warm', 'Warm'], ['cold', 'Cold']] },
  { id: 'closing', label: 'Closing', sub: 'Yours to call and close', color: '#30d158',
    keys: [['decision', 'Decision pending'], ['sent', 'Contract sent'], ['under', 'Under contract'], ['won', 'Closed']] },
  { id: 'parked', label: 'Parked', sub: 'Aged out — revisit on a different cadence', color: '#5a5a80',
    keys: [['unresponsive', 'Unresponsive'], ['dead', 'Dead'], ['lost', 'Signed elsewhere']] },
];

/* ── lanes ────────────────────────────────────────────────────────────── */

const LANES: { id: 'all' | Source; label: string; note: string }[] = [
  { id: 'all',    label: 'All',      note: '' },
  { id: 'ispeed', label: 'iSpeed',   note: 'speed-to-lead' },
  { id: 'alpha',  label: 'Property', note: 'VA Leads' },
  { id: 'sarah',  label: 'Scout',    note: 'self-generated' },
];

/* ── helpers ──────────────────────────────────────────────────────────── */

const money = (v: string | number | null | undefined) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? '$' + n.toLocaleString('en-US') : null;
};

const KEY_ICON: Record<string, React.ElementType> = {
  hot: Flame, warm: Thermometer, cold: Snowflake,
  decision: Hourglass, sent: CheckCircle2, under: CheckCircle2, won: CheckCircle2,
};

const STALE_DAYS = 90;

/* ── section ──────────────────────────────────────────────────────────── */

export function DealFlow() {
  const { refreshKey } = useApp();
  const { leads, loading, error } = useLeads(refreshKey);
  const [lane, setLane] = useState<'all' | Source>('all');
  const [appts, setAppts] = useState<Record<string, string>>({});

  // Booked times live in Supabase, not GHL. Empty today because no call has
  // booked since the write policy was fixed — the Closing cards fall back to
  // "no time set" rather than pretending a date exists.
  useEffect(() => {
    let live = true;
    supabase.from('jarvis_appointments')
      .select('phone, starts_at, status')
      .in('status', ['scheduled', 'confirmed'])
      .order('starts_at')
      .then(({ data }) => {
        if (!live || !data) return;
        const m: Record<string, string> = {};
        for (const r of data as { phone?: string; starts_at?: string }[]) {
          const k = String(r.phone || '').replace(/\D/g, '').slice(-10);
          if (k && r.starts_at && !m[k]) m[k] = r.starts_at;   // earliest wins
        }
        setAppts(m);
      });
    return () => { live = false; };
  }, [refreshKey]);

  const laned = useMemo(
    () => leads.filter(l => lane === 'all' || l.source === lane),
    [leads, lane],
  );

  const grouped = useMemo(() => {
    const g: Record<Board, Record<string, Lead[]>> = {
      qualifying: {}, working: {}, closing: {}, parked: {}, refund: {},
    };
    for (const l of laned) {
      const { board, key } = classify(l.stageName);
      (g[board][key] ||= []).push(l);
    }
    return g;
  }, [laned]);

  const laneCount = useMemo(() => {
    const c: Record<string, number> = { all: leads.length };
    for (const l of leads) c[l.source] = (c[l.source] || 0) + 1;
    return c;
  }, [leads]);

  if (loading) return <div className="text-[12px] text-dimtext p-4">Loading the board…</div>;
  if (error)   return <div className="text-[12px] p-4" style={{ color: '#ff453a' }}>{error}</div>;

  const boardTotal = (b: Board) =>
    Object.values(grouped[b]).reduce((n, a) => n + a.length, 0);

  return (
    <div className="space-y-4">
      <Reality leads={laned} grouped={grouped} />

      {/* lane tabs */}
      <div className="flex flex-wrap gap-1.5">
        {LANES.map(l => {
          const n = laneCount[l.id] ?? 0;
          const on = lane === l.id;
          return (
            <button key={l.id} onClick={() => setLane(l.id)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
              style={{
                background: on ? 'rgba(10,132,255,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${on ? 'rgba(10,132,255,0.5)' : 'var(--border)'}`,
                color: on ? '#64d2ff' : 'var(--text)',
              }}>
              {l.label}
              <span className="ml-1.5 tabular-nums" style={{ color: on ? '#64d2ff' : 'var(--dimtext)' }}>{n}</span>
              {l.note && <span className="ml-1.5 text-[9px]" style={{ color: 'var(--dimtext)' }}>{l.note}</span>}
            </button>
          );
        })}
      </div>

      {/* the four boards */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))' }}>
        {BOARDS.map(b => (
          <BoardColumn key={b.id} meta={b} groups={grouped[b.id]} total={boardTotal(b.id)} appts={appts} />
        ))}
      </div>

      {(lane === 'all' || lane === 'ispeed') && <Refunds groups={grouped.refund} all={leads} />}
    </div>
  );
}

/* ── the honest header ────────────────────────────────────────────────── */

function Reality({ leads, grouped }: { leads: Lead[]; grouped: Record<Board, Record<string, Lead[]>> }) {
  const inPlay = ['decision', 'sent', 'under'].reduce((n, k) => n + (grouped.closing[k]?.length || 0), 0)
               + (grouped.working.hot?.length || 0);
  const ages   = leads.map(l => l.daysInCrm).filter((n): n is number => typeof n === 'number');
  const median = ages.length ? [...ages].sort((a, b) => a - b)[Math.floor(ages.length / 2)] : null;
  const fresh  = ages.filter(a => a <= 7).length;

  const cell = (label: string, value: string, tone: string, note: string) => (
    <div className="flex-1 min-w-[128px]">
      <div className="text-[9px] uppercase tracking-[0.5px] text-dimtext">{label}</div>
      <div className="text-[21px] font-semibold tabular-nums leading-tight" style={{ color: tone }}>{value}</div>
      <div className="text-[10px] text-dimtext mt-0.5">{note}</div>
    </div>
  );

  return (
    <GlassCard accent="blue" padding="p-4" hover={false}>
      <div className="flex flex-wrap gap-4">
        {cell('In play', String(inPlay), inPlay > 0 ? '#30d158' : '#ff453a', 'hot + closing — the ones that pay')}
        {cell('Fresh', String(fresh), fresh > 3 ? '#30d158' : '#ff453a', 'added in the last 7 days')}
        {cell('Median age', median == null ? '—' : `${median}d`,
              median != null && median > 60 ? '#ff453a' : '#f5f5f7', 'across every lead on the board')}
        {cell('On the board', String(leads.length), '#f5f5f7', 'total in this lane')}
      </div>
    </GlassCard>
  );
}

/* ── a column ─────────────────────────────────────────────────────────── */

function BoardColumn({ meta, groups, total, appts }: {
  meta: typeof BOARDS[number]; groups: Record<string, Lead[]>; total: number;
  appts: Record<string, string>;
}) {
  const [openStale, setOpenStale] = useState(false);

  return (
    <div className="rounded-[18px] border border-border overflow-hidden flex flex-col"
         style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="px-3.5 py-2.5 border-b border-border"
           style={{ background: `linear-gradient(180deg, ${meta.color}1f, transparent)` }}>
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
          <span className="text-[13px] font-semibold tabular-nums text-textb ml-auto">{total}</span>
        </div>
        <div className="text-[10px] text-dimtext mt-0.5">{meta.sub}</div>
      </div>

      <div className="p-2.5 space-y-3 overflow-y-auto" style={{ maxHeight: 620 }}>
        {total === 0 && (
          <div className="text-[11px] text-dimtext text-center py-6">Nothing here.</div>
        )}

        {meta.keys.map(([key, label]) => {
          const all = groups[key] || [];
          if (!all.length) return null;

          // Old leads still count, they just stop crowding the fresh ones.
          const stale = all.filter(l => (l.daysInCrm ?? 0) > STALE_DAYS);
          const live  = meta.id === 'working' ? all.filter(l => (l.daysInCrm ?? 0) <= STALE_DAYS) : all;
          const Icon  = KEY_ICON[key];

          return (
            <div key={key}>
              <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                {Icon && <Icon size={10} style={{ color: meta.color }} />}
                <span className="text-[9.5px] uppercase tracking-[0.5px] text-dimtext">{label}</span>
                <span className="text-[9.5px] tabular-nums text-dimtext ml-auto">{all.length}</span>
              </div>

              <div className="space-y-1.5">
                {live.map(l => <LeadRow key={l.id} lead={l} board={meta.id} appts={appts} />)}
              </div>

              {meta.id === 'working' && stale.length > 0 && (
                <>
                  <button onClick={() => setOpenStale(o => !o)}
                    className="mt-1.5 w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[9.5px] text-dimtext hover:text-textb transition-colors"
                    style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <ChevronDown size={9} style={{ transform: openStale ? 'none' : 'rotate(-90deg)' }} />
                    {stale.length} over {STALE_DAYS} days
                  </button>
                  <AnimatePresence initial={false}>
                    {openStale && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="space-y-1.5 mt-1.5 opacity-60">
                          {stale.map(l => <LeadRow key={l.id} lead={l} board={meta.id} appts={appts} />)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── a card ───────────────────────────────────────────────────────────── */

function LeadRow({ lead, board, appts }: { lead: Lead; board: Board; appts: Record<string, string> }) {
  const ask  = money(lead.askingPrice);
  const key  = String(lead.phone || '').replace(/\D/g, '').slice(-10);
  const when = appts[key];

  return (
    <div className="rounded-[10px] p-2 flex gap-2"
         style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid var(--border)' }}>
      <PropertyThumb phone={lead.phone} address={lead.address} size={34} radius={6} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] font-medium text-textb truncate">{lead.name}</span>
          {lead.daysInCrm != null && (
            <span className="ml-auto text-[9px] tabular-nums flex-shrink-0"
                  style={{ color: lead.daysInCrm > STALE_DAYS ? '#ff9f0a' : 'var(--dimtext)' }}>
              {lead.daysInCrm}d
            </span>
          )}
        </div>

        {lead.address && (
          <div className="text-[9.5px] text-dimtext truncate flex items-center gap-1 mt-0.5">
            <MapPin size={8} className="flex-shrink-0" />{lead.address}
          </div>
        )}

        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[9.5px]">
          {ask && <span style={{ color: '#30d158' }}>{ask}</span>}
          {lead.timeline && <span className="text-dimtext truncate max-w-[110px]">{lead.timeline}</span>}
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="text-dimtext hover:text-textb flex items-center gap-1">
              <Phone size={8} />{lead.phone}
            </a>
          )}
        </div>

        {board === 'closing' && (
          <div className="mt-1 flex items-center gap-1 text-[9.5px]"
               style={{ color: when ? '#64d2ff' : '#ff9f0a' }}>
            <Clock size={8} />
            {when
              ? new Date(when).toLocaleString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
                })
              : 'no time set — book one'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── refunds ──────────────────────────────────────────────────────────── */

/**
 * iSpeed sells a refund window. The board shows what is filed and what is
 * still open, but the number that matters is how many windows already closed —
 * a refund is only recoverable while the clock is running.
 */
function Refunds({ groups, all }: { groups: Record<string, Lead[]>; all: Lead[] }) {
  const requested = groups.requested || [];
  const approved  = groups.approved  || [];
  const sum = (ls: Lead[]) => ls.reduce((n, l) => n + (Number(l.purchasePrice) || 0), 0);

  // Still inside the window and not yet filed — the only ones still winnable.
  const open = all
    .filter(l => l.source === 'ispeed'
              && typeof l.daysUntilDeadline === 'number' && l.daysUntilDeadline >= 0
              && classify(l.stageName).board !== 'refund')
    .sort((a, b) => (a.daysUntilDeadline ?? 0) - (b.daysUntilDeadline ?? 0));

  const expired = all.filter(l => typeof l.daysUntilDeadline === 'number' && l.daysUntilDeadline < 0).length;

  return (
    <GlassCard accent="green" padding="p-4" hover={false}>
      <SectionTitle accent="green">iSpeed refunds</SectionTitle>

      <div className="flex flex-wrap gap-4 mb-3">
        <Stat label="Filed, awaiting" value={`$${sum(requested).toLocaleString()}`} note={`${requested.length} leads`} color="#ff9f0a" />
        <Stat label="Approved" value={`$${sum(approved).toLocaleString()}`} note={`${approved.length} leads`} color="#30d158" />
        <Stat label="Window still open" value={String(open.length)} note="can still be filed" color={open.length ? '#64d2ff' : 'var(--dimtext)'} />
        <Stat label="Window closed" value={String(expired)} note="past the deadline" color={expired ? '#ff453a' : 'var(--dimtext)'} />
      </div>

      {open.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.5px] text-dimtext">File these first — soonest deadline</div>
          {open.slice(0, 8).map(l => (
            <div key={l.id} className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg"
                 style={{ background: 'rgba(255,255,255,0.045)' }}>
              <span className="tabular-nums font-semibold flex-shrink-0"
                    style={{ color: (l.daysUntilDeadline ?? 0) <= 7 ? '#ff453a' : '#ff9f0a' }}>
                {l.daysUntilDeadline}d
              </span>
              <span className="text-textb truncate">{l.name}</span>
              <span className="text-dimtext truncate hidden sm:block">{l.provider}</span>
              <span className="ml-auto tabular-nums text-dimtext flex-shrink-0">
                {money(l.purchasePrice) || '—'}
              </span>
            </div>
          ))}
          {open.length > 8 && (
            <div className="text-[10px] text-dimtext pt-1">+ {open.length - 8} more inside their window</div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2 text-[11px] p-2.5 rounded-lg"
             style={{ background: 'rgba(255,69,58,0.1)', color: '#ff453a' }}>
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            No lead is still inside its refund window. Every remaining deadline has passed, so
            nothing new can be filed — only the {requested.length} already filed are still in play.
          </span>
        </div>
      )}
    </GlassCard>
  );
}

function Stat({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  return (
    <div className="min-w-[112px]">
      <div className="text-[9px] uppercase tracking-[0.5px] text-dimtext">{label}</div>
      <div className="text-[18px] font-semibold tabular-nums leading-tight" style={{ color }}>{value}</div>
      <div className="text-[9.5px] text-dimtext">{note}</div>
    </div>
  );
}
