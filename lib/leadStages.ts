/**
 * leadStages.ts — the single definition of what a lead's stage means.
 *
 * GHL reports twenty stage names across two pipelines, with emoji and
 * inconsistent spacing ("📞Attempt  1🤳=No contact", "⛹🏼 🌡 Warm fallow ups").
 * Every board needs the same answer about the same lead, so the mapping lives
 * here once instead of being re-derived per screen — three copies had already
 * started to drift apart.
 *
 * Matching is on normalized text, never the literal stage string: editing an
 * emoji in GHL must not silently empty a column.
 */

export type FlowStage  = 'new' | 'working' | 'closer';
export type StageGroup =
  | 'new' | 'attempt' | 'replied' | 'hot' | 'warm' | 'cold'
  | 'decision' | 'sent' | 'under' | 'won'
  | 'unresponsive' | 'dead' | 'lost'
  | 'refund_requested' | 'refund_approved';

export const norm = (s: string) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9+ -]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Fine-grained group. Order matters — "Attempt 6+ = Unresponsive" is not an attempt. */
export function groupOf(stageName: string): StageGroup {
  const s = norm(stageName);
  if (s.includes('refund') && s.includes('approved'))    return 'refund_approved';
  if (s.includes('refund'))                              return 'refund_requested';
  if (s.includes('unresponsive') || /attempt 6/.test(s)) return 'unresponsive';
  if (s.includes('dead'))                                return 'dead';
  if (s.includes('signed with someone'))                 return 'lost';
  if (s.includes('under contract'))                      return 'under';
  if (s.includes('contract sent'))                       return 'sent';
  if (s.includes('decision pending'))                    return 'decision';
  if (s.includes('closed') || s.includes('dispostion') || s.includes('disposition')) return 'won';
  if (s.includes('hot'))                                 return 'hot';
  if (s.includes('warm'))                                return 'warm';
  if (s.includes('cold'))                                return 'cold';
  if (s.includes('replied'))                             return 'replied';
  if (s.includes('attempt'))                             return 'attempt';
  return 'new';
}

/** Which of the three work stages, or null for leads nobody will touch again. */
export function flowStageOf(stageName: string): FlowStage | null {
  const g = groupOf(stageName);
  if (g === 'refund_requested' || g === 'refund_approved') return null;
  if (g === 'dead' || g === 'lost' || g === 'won')         return null;
  if (g === 'decision' || g === 'sent' || g === 'under')   return 'closer';
  if (g === 'hot' || g === 'warm' || g === 'cold' || g === 'replied') return 'working';
  return 'new';   // new, attempt, unresponsive
}

/** Attempts made, read from the stage name — the leads API returns a null
 *  attempts field on most rows. */
export function attemptsOf(stageName: string): number {
  const s = norm(stageName);
  if (s.includes('unresponsive') || /attempt 6/.test(s)) return 6;
  const m = /attempt (\d)/.exec(s);
  return m ? Number(m[1]) : 0;
}

/** True once a human conversation has happened, however badly it went. */
export const wasReached = (stageName: string) => {
  const g = groupOf(stageName);
  return ['hot', 'warm', 'cold', 'replied', 'decision', 'sent', 'under', 'won'].includes(g);
};

/** A lead that turned into real pipeline — the outcome worth paying for. */
export const isQualified = (stageName: string) =>
  ['hot', 'decision', 'sent', 'under', 'won'].includes(groupOf(stageName));

export const isRefund = (stageName: string) => groupOf(stageName).startsWith('refund');
