/**
 * Canonical GHL stage names — shared by client hooks AND server routes.
 *
 * The dialer API returns `stageName`, the raw emoji-decorated, typo-bearing GHL
 * label (e.g. "⛹🏿‍♀️🔥Hot fallow ups"). Nothing downstream should match on that
 * directly. `usePipeline` used to own this mapping, but it is a 'use client'
 * module, so server routes silently read `lead.stage` as undefined and every
 * stage filter quietly returned nothing — including the exclusion that stops
 * already-filed refunds being surfaced again. Keep this file free of
 * 'use client' so both sides can import it.
 */

/** Map a messy GHL stage name to a clean canonical bucket. Order-sensitive. */
export function canonicalStage(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s.includes('decision'))        return 'Decision Pending';
  if (s.includes('contract sent'))   return 'Contract Sent';
  if (s.includes('under contract'))  return 'Under Contract';
  if (s.includes('signed'))          return 'Signed Elsewhere';
  if (s.includes('refund approved')) return 'Refund Approved';
  if (s.includes('refund') || s.includes('bad lead')) return 'Refund Requested';
  if (s.includes('hot'))             return 'Hot Follow Up';
  if (s.includes('warm'))            return 'Warm Follow Up';
  if (s.includes('cold'))            return 'Cold Follow Up';
  if (s.includes('dispos'))          return 'Disposition';
  if (s.includes('closed'))          return 'Closed';
  if (s.includes('dead'))            return 'Dead';
  if (s.includes('unrespons') || s.includes('6+')) return 'Unresponsive';
  if (s.includes('attempt 3'))       return 'Attempt 3-5';
  if (s.includes('attempt 2'))       return 'Attempt 2';
  if (s.includes('attempt 1') || s.includes('attempt  1')) return 'Attempt 1';
  if (s.includes('new'))             return 'New Lead';
  return raw.replace(/[^a-zA-Z0-9 +-]/g, '').trim() || 'Other';
}

/** Stages where a refund is already filed or the lead converted — never re-file. */
export const REFUND_EXCLUDE = new Set([
  'Refund Requested', 'Refund Approved', 'Under Contract', 'Contract Sent', 'Closed', 'Disposition',
]);

/** Stages that represent a live deal moving toward cash. */
export const IN_MOTION = ['Decision Pending', 'Contract Sent', 'Under Contract'];

/** Convenience for server code reading the RAW dialer payload. */
export function stageOf(raw: { stage?: string; stageName?: string }): string {
  return raw.stage || canonicalStage(raw.stageName || '');
}
