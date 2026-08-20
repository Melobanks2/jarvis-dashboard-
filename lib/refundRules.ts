/**
 * refundRules.ts — what iSpeed actually requires to refund a lead.
 *
 * TWO conditions, and only one of them is a clock:
 *
 *   1. FIVE documented call attempts with no contact.
 *   2. Filed within 21 days of purchase. Day 21 is too late.
 *
 * (ispeedtolead.com/blog/ispeedtolead-refund-guarantee — 21-day window,
 * "unreachable after documented attempts", call logs submitted as proof. The
 * 21 days is also verified empirically against all 95 leads carrying a
 * deadline: exactly 21, every time.)
 *
 * The reason this file exists is the interaction between those two conditions,
 * which no day-counter can express on its own: a lead on day 18 with two
 * attempts is NOT refundable and cannot become refundable unless somebody
 * makes three more calls in three days. That lead looks calm on a deadline
 * board — plenty of days left, nothing overdue — and then silently expires
 * with the money gone. `behind` below is exactly that lead.
 *
 * Bonus-balance and raw leads are excluded from the guarantee entirely, so
 * they never enter the track however many times they go unanswered.
 */

import { Lead } from '@/lib/hooks/useLeads';
import { attemptsOf, groupOf, wasReached } from '@/lib/leadStages';

export const WINDOW_DAYS = 21;
export const ATTEMPTS_REQUIRED = 5;

export type RefundState =
  | 'on_track'   // attempts still owed, and enough days left to make them
  | 'behind'     // attempts still owed, NOT enough days left — call today
  | 'ready'      // 5 attempts, never reached, inside the window
  | 'filed'      // requested, waiting on iSpeed
  | 'approved'   // money back
  | 'denied'
  | 'expired'    // window closed without filing — unrecoverable
  | null;        // not on the refund track at all

export interface RefundStatus {
  state: RefundState;
  attempts: number;
  attemptsLeft: number;
  daysLeft: number | null;
  /** Calls per remaining day needed to reach five in time. */
  pace: number | null;
  price: number;
  why: string;
}

/** Days until the window shuts. Day 21 = 0 left = too late to file. */
export function daysLeftFor(lead: Lead): number | null {
  const d = lead.daysUntilDeadline;
  if (typeof d === 'number') return d;
  const since = lead.daysSincePurchase;
  return typeof since === 'number' ? WINDOW_DAYS - since : null;
}

export function refundStatusOf(lead: Lead): RefundStatus {
  const attempts = lead.attempts ?? attemptsOf(lead.stageName);
  const daysLeft = daysLeftFor(lead);
  const price = Number(lead.purchasePrice) || 0;
  const attemptsLeft = Math.max(0, ATTEMPTS_REQUIRED - attempts);
  const base = { attempts, attemptsLeft, daysLeft, price, pace: null as number | null };

  // Already resolved — read the outcome straight off the lead.
  if (lead.refund === 'approved') return { ...base, state: 'approved', why: 'Refunded' };
  if (lead.refund === 'denied')   return { ...base, state: 'denied',   why: 'iSpeed denied the claim' };
  if (lead.refund === 'requested')return { ...base, state: 'filed',    why: 'Filed — waiting on iSpeed' };

  // Never eligible: not purchased, bonus-funded, or a tier outside the guarantee.
  if (lead.source !== 'ispeed')            return { ...base, state: null, why: 'Not an iSpeed lead' };
  if (lead.refundEligible === 'no')        return { ...base, state: null, why: 'Bonus balance — not refundable' };
  if (!price)                              return { ...base, state: null, why: 'No purchase on record' };

  // Reached a human, or it turned into pipeline → you got what you paid for.
  if (wasReached(lead.stageName))          return { ...base, state: null, why: 'Seller was reached' };
  const g = groupOf(lead.stageName);
  if (['decision', 'sent', 'under', 'won'].includes(g)) {
    return { ...base, state: null, why: 'Lead turned into pipeline' };
  }

  if (daysLeft == null)                    return { ...base, state: null, why: 'No purchase date' };
  if (daysLeft <= 0) {
    return { ...base, state: 'expired',
             why: attemptsLeft ? `Expired at ${attempts} of ${ATTEMPTS_REQUIRED} attempts` : 'Expired — never filed' };
  }

  if (attemptsLeft === 0) {
    return { ...base, state: 'ready',
             why: `${attempts} attempts, no contact — file within ${daysLeft} day${daysLeft === 1 ? '' : 's'}` };
  }

  // The case the day-counter cannot see: attempts owed, days short.
  const pace = attemptsLeft / daysLeft;
  const behind = daysLeft < attemptsLeft;
  return {
    ...base, pace,
    state: behind ? 'behind' : 'on_track',
    why: behind
      ? `${attemptsLeft} more call${attemptsLeft === 1 ? '' : 's'} needed in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
      : `${attemptsLeft} more call${attemptsLeft === 1 ? '' : 's'} to qualify · ${daysLeft} days left`,
  };
}

/** Money at stake in a set of leads, by state. */
export function valueOf(leads: Lead[], state: RefundState): number {
  return leads.reduce((n, l) => n + (refundStatusOf(l).state === state ? (Number(l.purchasePrice) || 0) : 0), 0);
}

export const REFUND_COLOR: Record<NonNullable<RefundState>, string> = {
  on_track: '#8e8e93',
  behind:   '#ff453a',
  ready:    '#30d158',
  filed:    '#bf5af2',
  approved: '#30d158',
  denied:   '#ff9f0a',
  expired:  '#5a5a80',
};

export const REFUND_LABEL: Record<NonNullable<RefundState>, string> = {
  on_track: 'On track',
  behind:   'Behind — call today',
  ready:    'Ready to file',
  filed:    'Filed',
  approved: 'Refunded',
  denied:   'Denied',
  expired:  'Expired',
};
