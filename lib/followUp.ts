/**
 * followUp.ts — when a Working lead is actually due for its next call.
 *
 * A follow-up board without a due date is just a list. Chris's own cadence,
 * written on the Wholesalers pipeline stages in GHL:
 *
 *   hot     timeline ≤ 30 days, motivated, price workable  → every 2–3 days
 *   warm    timeline 1–3 months, or motivated but unrealistic → every 7 days
 *   cold    timeline 3+ months, low motivation, price fishing → every 14 days
 *
 * Overdue is the only number that matters on that lane, so it sorts first and
 * is the only thing coloured. Everything else is noise while a hot seller sits
 * uncalled for nine days.
 *
 * A booked lead is NEVER due: it left this lane entirely. That check lives in
 * leadStages, and this file simply never sees those leads.
 */

import { Lead } from '@/lib/hooks/useLeads';
import { groupOf } from '@/lib/leadStages';

export const CADENCE_DAYS: Record<string, number> = {
  hot: 3, replied: 1, warm: 7, cold: 14, decision: 3,
};

export interface FollowUp {
  /** Days since anyone touched this lead. Null when we have no timestamp. */
  sinceDays: number | null;
  /** The cadence this lead's temperature calls for. */
  everyDays: number | null;
  /** Negative = overdue by that many days. Null when unknown. */
  dueInDays: number | null;
  overdue: boolean;
  label: string;
}

/** Most recent evidence anyone touched this lead. */
function lastTouch(lead: Lead): number | null {
  const stamps = [lead.calledAt, lead.updatedAt]
    .map(s => (s ? new Date(s).getTime() : NaN))
    .filter(n => Number.isFinite(n));
  return stamps.length ? Math.max(...stamps) : null;
}

export function followUpOf(lead: Lead): FollowUp {
  const g = groupOf(lead.stageName);
  const everyDays = CADENCE_DAYS[g] ?? null;
  const touch = lastTouch(lead);
  const sinceDays = touch == null ? null : Math.floor((Date.now() - touch) / 86400000);

  if (everyDays == null || sinceDays == null) {
    return { sinceDays, everyDays, dueInDays: null, overdue: false, label: sinceDays == null ? 'no activity on record' : `${sinceDays}d since last touch` };
  }

  const dueInDays = everyDays - sinceDays;
  if (dueInDays < 0) {
    return { sinceDays, everyDays, dueInDays, overdue: true,
             label: `${Math.abs(dueInDays)}d overdue` };
  }
  return { sinceDays, everyDays, dueInDays, overdue: false,
           label: dueInDays === 0 ? 'due today' : `due in ${dueInDays}d` };
}

/** Overdue first, then soonest due. Used to sort the Working lane. */
export function byUrgency(a: Lead, b: Lead): number {
  const fa = followUpOf(a), fb = followUpOf(b);
  const ka = fa.dueInDays ?? 9999;
  const kb = fb.dueInDays ?? 9999;
  return ka - kb;
}

/** Hours until an appointment; negative once it has started. */
export function hoursUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (t - Date.now()) / 3600000 : null;
}

/** "in 2h" / "tomorrow 2:00 PM" / "started 15m ago" — the closer's only clock. */
export function appointmentLabel(iso?: string | null): string | null {
  const h = hoursUntil(iso);
  if (h == null) return null;
  if (h < -1) return 'appointment passed';
  if (h < 0)  return 'happening now';
  if (h < 1)  return `in ${Math.round(h * 60)}m`;
  if (h < 12) return `in ${Math.round(h)}h`;
  return new Date(iso!).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  });
}
