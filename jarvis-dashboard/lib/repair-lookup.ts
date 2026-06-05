/**
 * lib/repair-lookup.ts
 *
 * Rule 5 — Statistical repair estimates by year_built + sqft.
 * Zero Claude calls. Hardcoded ranges derived from Tampa/Florida rehab averages.
 *
 * Output feeds api/repair-estimate.js when no photos are available.
 * Toggles and line-item adjustments are handled client-side (pure JS addition).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RepairItem {
  key:       string;
  label:     string;
  cost_low:  number;
  cost_high: number;
  condition: string;   // "likely needed" | "possible" | "unlikely" | "check"
  enabled:   boolean;  // default toggle state
  category:  'structural' | 'mechanical' | 'cosmetic' | 'exterior';
}

export interface RepairEstimate {
  source:          'statistical' | 'claude';
  year_bucket:     string;
  repair_items:    RepairItem[];
  light_rehab_low:  number;
  light_rehab_high: number;
  mini_rehab_low:   number;
  mini_rehab_high:  number;
  full_rehab_low:   number;
  full_rehab_high:  number;
}

// ─── Year buckets ─────────────────────────────────────────────────────────────

type YearBucket = 'pre_1950' | 'y1950_1975' | 'y1975_2000' | 'y2000_2015' | 'post_2015';

function getYearBucket(yearBuilt: number | null): YearBucket {
  if (!yearBuilt || yearBuilt < 1950)  return 'pre_1950';
  if (yearBuilt < 1975)                return 'y1950_1975';
  if (yearBuilt < 2000)                return 'y1975_2000';
  if (yearBuilt < 2015)                return 'y2000_2015';
  return 'post_2015';
}

// ─── Per-item condition table by year bucket ──────────────────────────────────
// condition: "likely needed" = default enabled, "possible" = enabled, "unlikely" = disabled

type Condition = 'likely needed' | 'possible' | 'unlikely' | 'check';

const ITEM_CONDITIONS: Record<YearBucket, Record<string, Condition>> = {
  pre_1950: {
    roof:        'likely needed',
    hvac:        'likely needed',
    electrical:  'likely needed',  // knob-and-tube era
    plumbing:    'likely needed',  // galvanized/cast iron
    foundation:  'check',
    kitchen:     'likely needed',
    baths:       'likely needed',
    flooring:    'likely needed',
    windows:     'likely needed',
    paint:       'likely needed',
    landscaping: 'possible',
    driveway:    'possible',
  },
  y1950_1975: {
    roof:        'likely needed',
    hvac:        'likely needed',
    electrical:  'possible',       // may have been updated
    plumbing:    'possible',
    foundation:  'check',
    kitchen:     'likely needed',
    baths:       'likely needed',
    flooring:    'likely needed',
    windows:     'likely needed',
    paint:       'likely needed',
    landscaping: 'possible',
    driveway:    'possible',
  },
  y1975_2000: {
    roof:        'likely needed',
    hvac:        'possible',
    electrical:  'unlikely',
    plumbing:    'unlikely',
    foundation:  'unlikely',
    kitchen:     'possible',
    baths:       'possible',
    flooring:    'possible',
    windows:     'possible',
    paint:       'likely needed',
    landscaping: 'possible',
    driveway:    'unlikely',
  },
  y2000_2015: {
    roof:        'possible',
    hvac:        'possible',
    electrical:  'unlikely',
    plumbing:    'unlikely',
    foundation:  'unlikely',
    kitchen:     'unlikely',
    baths:       'unlikely',
    flooring:    'possible',
    windows:     'unlikely',
    paint:       'possible',
    landscaping: 'unlikely',
    driveway:    'unlikely',
  },
  post_2015: {
    roof:        'unlikely',
    hvac:        'unlikely',
    electrical:  'unlikely',
    plumbing:    'unlikely',
    foundation:  'unlikely',
    kitchen:     'unlikely',
    baths:       'unlikely',
    flooring:    'unlikely',
    windows:     'unlikely',
    paint:       'unlikely',
    landscaping: 'unlikely',
    driveway:    'unlikely',
  },
};

// ─── Base cost ranges (Florida market, 2024) ──────────────────────────────────
// These are per-item absolute ranges, then scaled lightly by sqft where relevant.

const BASE_COSTS: Record<string, { low: number; high: number; sqft_scale?: boolean }> = {
  roof:        { low: 8_000,  high: 22_000 },                        // 1,500–2,500 sqft house
  hvac:        { low: 5_000,  high: 12_000 },
  electrical:  { low: 4_000,  high: 14_000 },
  plumbing:    { low: 3_500,  high: 16_000 },
  foundation:  { low: 6_000,  high: 35_000 },
  kitchen:     { low: 10_000, high: 28_000 },
  baths:       { low: 5_500,  high: 14_000 },                        // per bath
  flooring:    { low: 3,      high: 8,      sqft_scale: true },      // $/sqft
  windows:     { low: 4_000,  high: 10_000 },
  paint:       { low: 2,      high: 4,      sqft_scale: true },      // $/sqft interior+exterior
  landscaping: { low: 1_500,  high: 6_000 },
  driveway:    { low: 2_000,  high: 6_000 },
};

const ITEM_META: Record<string, { label: string; category: RepairItem['category'] }> = {
  roof:        { label: 'Roof Replacement',   category: 'structural'  },
  hvac:        { label: 'HVAC System',         category: 'mechanical'  },
  electrical:  { label: 'Electrical Update',  category: 'mechanical'  },
  plumbing:    { label: 'Plumbing Update',     category: 'mechanical'  },
  foundation:  { label: 'Foundation Repair',  category: 'structural'  },
  kitchen:     { label: 'Kitchen Renovation', category: 'cosmetic'    },
  baths:       { label: 'Bathroom Reno (×2)', category: 'cosmetic'    },
  flooring:    { label: 'Flooring',           category: 'cosmetic'    },
  windows:     { label: 'Windows',            category: 'exterior'    },
  paint:       { label: 'Interior + Exterior Paint', category: 'cosmetic' },
  landscaping: { label: 'Landscaping / Cleanup', category: 'exterior' },
  driveway:    { label: 'Driveway / Concrete', category: 'exterior'   },
};

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildStatisticalEstimate(
  yearBuilt: number | null,
  sqft: number | null,
): RepairEstimate {
  const bucket = getYearBucket(yearBuilt);
  const sf     = sqft && sqft > 0 ? sqft : 1500;   // fallback if unknown
  const conditions = ITEM_CONDITIONS[bucket];

  const items: RepairItem[] = Object.keys(BASE_COSTS).map(key => {
    const base = BASE_COSTS[key];
    const meta = ITEM_META[key];
    const cond = conditions[key] as Condition;

    // Scale sqft-dependent items
    const low  = base.sqft_scale ? Math.round(base.low  * sf) : base.low;
    const high = base.sqft_scale ? Math.round(base.high * sf) : base.high;

    // Baths: multiply by typical 2 bathrooms
    const adjLow  = key === 'baths' ? low  * 2 : low;
    const adjHigh = key === 'baths' ? high * 2 : high;

    return {
      key,
      label:     meta.label,
      cost_low:  adjLow,
      cost_high: adjHigh,
      condition: cond,
      enabled:   cond === 'likely needed' || cond === 'possible',
      category:  meta.category,
    };
  });

  // Contingency (10% of enabled total high) — added as a non-togglable line
  const enabledHigh = items.filter(i => i.enabled).reduce((s, i) => s + i.cost_high, 0);
  const contingency = Math.round(enabledHigh * 0.10);
  items.push({
    key: 'contingency', label: 'Contingency (10%)',
    cost_low: Math.round(enabledHigh * 0.08),
    cost_high: contingency,
    condition: 'likely needed', enabled: true,
    category: 'structural',
  });

  return buildTotals(bucket, items);
}

// ─── Pure math: sum enabled items into scenario buckets ──────────────────────
// Rule 4/5: client calls this on every toggle — ZERO Claude calls.

export function buildTotals(bucket: string, items: RepairItem[]): RepairEstimate {
  const structural = items.filter(i => i.enabled && i.category === 'structural');
  const mechanical = items.filter(i => i.enabled && i.category === 'mechanical');
  const cosmetic   = items.filter(i => i.enabled && (i.category === 'cosmetic' || i.category === 'exterior'));

  // Light rehab = cosmetic + minor mechanical only
  const lightItems  = items.filter(i => i.enabled && (i.category === 'cosmetic' || i.category === 'exterior'));
  // Mini rehab   = cosmetic + mechanical (no structural)
  const miniItems   = items.filter(i => i.enabled && i.category !== 'structural');
  // Full rehab   = all enabled
  const fullItems   = items.filter(i => i.enabled);

  const sum = (arr: RepairItem[], field: 'cost_low' | 'cost_high') =>
    arr.reduce((s, i) => s + i[field], 0);

  return {
    source:          'statistical',
    year_bucket:     bucket,
    repair_items:    items,
    light_rehab_low:  sum(lightItems, 'cost_low'),
    light_rehab_high: sum(lightItems, 'cost_high'),
    mini_rehab_low:   sum(miniItems,  'cost_low'),
    mini_rehab_high:  sum(miniItems,  'cost_high'),
    full_rehab_low:   sum(fullItems,  'cost_low'),
    full_rehab_high:  sum(fullItems,  'cost_high'),
  };
}

// ─── Client-side toggle recalc (pure JS — Rule 4/5) ──────────────────────────
// Call this whenever user toggles an item. Returns updated totals instantly.

export function recalcAfterToggle(
  items: RepairItem[],
  toggledKey: string,
  newEnabled: boolean,
): RepairEstimate {
  const updated = items.map(item =>
    item.key === toggledKey ? { ...item, enabled: newEnabled } : item
  );
  return buildTotals('user_modified', updated);
}
