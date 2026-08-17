'use client';

import type { Lead } from '@/lib/hooks/usePipeline';
import { STAGE_ORDER } from '@/lib/hooks/usePipeline';
import { REFUND_EXCLUDE, IN_MOTION } from '@/lib/stages';
import type { Slice, Tile, Unit } from '@/components/ui/Viz';

/**
 * Named datasets the chat model can ASK for by name.
 *
 * Same rule as the briefing: the model chooses what to show, never what the
 * numbers are. It emits `{"dataset":"refund_risk"}` and the values are computed
 * here from the live pipeline, so a chart can't disagree with the Command
 * Center or invent a figure.
 */

const C = {
  blue: '#0a84ff', green: '#30d158', red: '#ff453a', orange: '#ff9f0a',
  yellow: '#ffd60a', purple: '#bf5af2', cyan: '#64d2ff', gray: 'rgba(235,235,245,0.30)',
};

export interface VizResult {
  kind: 'bars' | 'donut' | 'tiles';
  title: string;
  subtitle?: string;
  unit?: Unit;
  slices?: Slice[];
  tiles?: Tile[];
  centerValue?: string;
  centerLabel?: string;
  empty?: string;          // set when there is genuinely nothing to draw
}

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const sum = (ls: Lead[], f: (l: Lead) => number | null) => ls.reduce((a, l) => a + (f(l) || 0), 0);

function stageColor(stage: string): string {
  if (['Decision Pending', 'Contract Sent', 'Under Contract', 'Closed', 'Disposition'].includes(stage)) return C.green;
  if (stage === 'Hot Follow Up') return C.orange;
  if (stage === 'Warm Follow Up') return C.yellow;
  if (stage === 'Cold Follow Up' || stage === 'Unresponsive') return C.cyan;
  if (stage.startsWith('Refund')) return C.purple;
  if (stage === 'Dead' || stage === 'Signed Elsewhere') return C.gray;
  return C.blue;
}

/** iSpeed leads whose refund window is still open and not already filed/converted. */
const openRefunds = (leads: Lead[]) => leads.filter(l =>
  l.source === 'ispeed' && l.daysUntilDeadline != null && l.daysUntilDeadline >= 0 && !REFUND_EXCLUDE.has(l.stage));

const bucket = (slices: Slice[]) => slices.filter(s => s.value > 0);

export interface DatasetDef {
  label: string;            // shown on the gallery card
  build: (leads: Lead[]) => VizResult;
}

export const DATASETS: Record<string, DatasetDef> = {
  stages: {
    label: 'Leads by stage',
    build: (leads) => {
      const counts: Record<string, number> = {};
      for (const l of leads) counts[l.stage] = (counts[l.stage] ?? 0) + 1;
      const known = STAGE_ORDER.filter(s => counts[s]);
      const extra = Object.keys(counts).filter(s => !STAGE_ORDER.includes(s)).sort((a, b) => counts[b] - counts[a]);
      const slices = [...known, ...extra].map(s => ({ label: s, value: counts[s], color: stageColor(s) }));
      return {
        kind: 'bars', title: 'Where your leads sit', unit: 'count', slices,
        subtitle: `${leads.length} leads across ${slices.length} stages`,
        empty: slices.length ? undefined : 'No leads in the pipeline right now.',
      };
    },
  },

  temperature: {
    label: 'Temperature mix',
    build: (leads) => {
      const t: Record<string, number> = { hot: 0, warm: 0, cold: 0, new: 0, dead: 0 };
      for (const l of leads) t[l.temp] = (t[l.temp] ?? 0) + 1;
      return {
        kind: 'donut', title: 'Temperature mix',
        centerValue: String(leads.length), centerLabel: 'leads',
        slices: bucket([
          { label: 'Hot', value: t.hot, color: C.red },
          { label: 'Warm', value: t.warm, color: C.orange },
          { label: 'Cold', value: t.cold, color: C.cyan },
          { label: 'New', value: t.new, color: C.blue },
          { label: 'Dead', value: t.dead, color: C.gray },
        ]),
        empty: leads.length ? undefined : 'No leads to break down.',
      };
    },
  },

  sources: {
    label: 'Leads by source',
    build: (leads) => {
      const s: Record<string, number> = {};
      for (const l of leads) s[l.source] = (s[l.source] ?? 0) + 1;
      const color: Record<string, string> = { ispeed: C.purple, sarah: C.blue, alpha: C.cyan, va: C.green };
      const slices = Object.entries(s).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ label: k, value: v, color: color[k] ?? C.gray }));
      return {
        kind: 'bars', title: 'Where your leads came from', unit: 'count', slices,
        subtitle: `${slices.length} sources feeding the pipeline`,
        empty: slices.length ? undefined : 'No source data.',
      };
    },
  },

  refund_risk: {
    label: 'Refund windows closing',
    build: (leads) => {
      const open = openRefunds(leads);
      const inDays = (lo: number, hi: number) => open.filter(l => {
        const d = l.daysUntilDeadline!;
        return d >= lo && d <= hi;
      });
      const b = [
        { label: '2 days or less', ls: inDays(0, 2), color: C.red },
        { label: '3 – 7 days', ls: inDays(3, 7), color: C.orange },
        { label: '8 – 14 days', ls: inDays(8, 14), color: C.yellow },
        { label: '15+ days', ls: inDays(15, 9999), color: C.blue },
      ];
      const slices = bucket(b.map(x => ({
        label: x.label,
        value: sum(x.ls, l => l.purchasePrice),
        color: x.color,
        sub: `${x.ls.length} leads`,
      })));
      return {
        kind: 'bars', title: 'Money still recoverable, by deadline', unit: 'money', slices,
        subtitle: `${money(sum(open, l => l.purchasePrice))} across ${open.length} leads still inside the window`,
        empty: open.length ? undefined : 'No refund windows are open — nothing to file.',
      };
    },
  },

  money: {
    label: 'Where the money sits',
    build: (leads) => {
      const ispeed = leads.filter(l => l.source === 'ispeed');
      const open = openRefunds(leads);
      const filed = leads.filter(l => l.source === 'ispeed' && (l.stage === 'Refund Requested' || l.stage === 'Refund Approved'));
      const motion = leads.filter(l => IN_MOTION.includes(l.stage));
      return {
        kind: 'tiles', title: 'Where your money sits right now',
        subtitle: 'Spend is cash out the door. Recoverable is cash you can still claw back.',
        tiles: [
          { label: 'iSpeed spend', value: money(sum(ispeed, l => l.purchasePrice)), color: C.purple, note: `${ispeed.length} paid leads` },
          { label: 'Still recoverable', value: money(sum(open, l => l.purchasePrice)), color: C.red, note: `${open.length} inside window` },
          { label: 'Already filed', value: money(sum(filed, l => l.purchasePrice)), color: C.orange, note: `${filed.length} refunds` },
          { label: 'Deals in motion', value: String(motion.length), color: C.green, note: 'not revenue yet' },
        ],
      };
    },
  },

  in_motion: {
    label: 'Deals in motion',
    build: (leads) => {
      const motion = leads.filter(l => IN_MOTION.includes(l.stage))
        .sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0));
      const slices = motion.slice(0, 12).map(l => ({
        label: l.name,
        value: l.daysInStage ?? 0,
        color: (l.daysInStage ?? 0) > 14 ? C.red : (l.daysInStage ?? 0) > 7 ? C.orange : C.green,
      }));
      return {
        kind: 'bars', title: 'Deals in motion — days sitting in stage', unit: 'days', slices,
        subtitle: `${motion.length} live deals. Longer bars have gone quiet.`,
        empty: motion.length ? undefined : 'Nothing is in motion — no decisions, contracts, or closings pending.',
      };
    },
  },

  hot_stale: {
    label: 'Hot leads going stale',
    build: (leads) => {
      const hot = leads.filter(l => l.temp === 'hot').sort((a, b) => (b.daysInCrm ?? 0) - (a.daysInCrm ?? 0));
      const slices = hot.slice(0, 10).map(l => ({
        label: l.name,
        value: l.daysInCrm ?? 0,
        color: (l.daysInCrm ?? 0) > 30 ? C.red : (l.daysInCrm ?? 0) > 14 ? C.orange : C.blue,
      }));
      return {
        kind: 'bars', title: 'Hot leads, oldest first', unit: 'days', slices,
        subtitle: `${hot.length} leads said they were interested. These are the ones waiting longest.`,
        empty: hot.length ? undefined : 'No hot leads right now.',
      };
    },
  },

  aging: {
    label: 'Pipeline age',
    build: (leads) => {
      const inRange = (lo: number, hi: number) => leads.filter(l => (l.daysInCrm ?? 9999) >= lo && (l.daysInCrm ?? 9999) <= hi).length;
      const slices = bucket([
        { label: '0 – 3 days', value: inRange(0, 3), color: C.green },
        { label: '4 – 7 days', value: inRange(4, 7), color: C.cyan },
        { label: '8 – 14 days', value: inRange(8, 14), color: C.blue },
        { label: '15 – 30 days', value: inRange(15, 30), color: C.orange },
        { label: '31+ days', value: inRange(31, 99998), color: C.red },
      ]);
      return {
        kind: 'bars', title: 'How old your leads are', unit: 'count', slices,
        subtitle: 'Answer rates fall off a cliff after the first week.',
        empty: slices.length ? undefined : 'No age data.',
      };
    },
  },
};

export const DATASET_NAMES = Object.keys(DATASETS);

export interface PipeSummary {
  total: number; hot: number; motion: number;
  openRefunds: number; openRefundValue: number; ispeedSpend: number;
}

/** One pass over the pipeline for the badges and the progress steps. */
export function summarize(leads: Lead[]): PipeSummary {
  const open = openRefunds(leads);
  return {
    total: leads.length,
    hot: leads.filter(l => l.temp === 'hot').length,
    motion: leads.filter(l => IN_MOTION.includes(l.stage)).length,
    openRefunds: open.length,
    openRefundValue: sum(open, l => l.purchasePrice),
    ispeedSpend: sum(leads.filter(l => l.source === 'ispeed'), l => l.purchasePrice),
  };
}

export const fmtMoney = money;

export function buildViz(dataset: string, leads: Lead[]): VizResult | null {
  const def = DATASETS[dataset];
  if (!def) return null;
  return def.build(leads);
}

/** Normalised key for joining model-returned names onto real leads. */
export const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

export interface ChatPerson {
  name: string; matched: boolean; phone: string | null; stage: string | null;
  address: string | null; daysInCrm: number | null; deadlineDays: number | null; amount: number | null;
  note?: string;
}

export function joinPeople(names: string[], leads: Lead[]): ChatPerson[] {
  const index = new Map<string, Lead>();
  for (const l of leads) if (l.name) index.set(nameKey(l.name), l);
  return names.map(n => {
    const hit = index.get(nameKey(n));
    return {
      name: hit?.name ?? n,
      matched: !!hit,
      phone: hit?.phone || null,
      stage: hit?.stage ?? null,
      address: hit?.address || null,
      daysInCrm: hit?.daysInCrm ?? null,
      deadlineDays: hit?.daysUntilDeadline ?? null,
      amount: hit?.purchasePrice ?? null,
    };
  });
}
