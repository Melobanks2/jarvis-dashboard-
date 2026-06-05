/**
 * GET  /api/repair-estimate?address=...&year_built=...&sqft=...
 *   → Returns cached estimate if exists, else computes statistical estimate (Rule 5).
 *     Zero Claude tokens for properties without photos.
 *
 * POST /api/repair-estimate
 *   Body: { address, year_built, sqft, property_data, photos[] }
 *   → If photos present: calls Claude ONCE, saves to cache (Rule 4).
 *   → If no photos: statistical estimate saved to cache (Rule 5).
 *   → If already cached: returns cache immediately, Claude never called again.
 *
 * Rule 3 — Offer math (60/65/70%) is pure JS. This endpoint does NOT calculate offers.
 * Rule 4 — Claude called AT MOST once per address. All subsequent calls return cache.
 * Rule 5 — No photos = zero Claude. Statistical lookup by year_built + sqft.
 */

const { createClient } = require('@supabase/supabase-js');
const Anthropic        = require('@anthropic-ai/sdk');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY     || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

// ─── Statistical lookup (Rule 5) — zero Claude calls ─────────────────────────
// Cost ranges based on Florida market 2024. All numbers are dollars.

const YEAR_BUCKETS = [
  { maxYear: 1950, label: 'Pre-1950',   fullPerSqft: [55, 85] },
  { maxYear: 1975, label: '1950–1975',  fullPerSqft: [45, 70] },
  { maxYear: 2000, label: '1975–2000',  fullPerSqft: [35, 55] },
  { maxYear: 2015, label: '2000–2015',  fullPerSqft: [25, 40] },
  { maxYear: 9999, label: '2015+',      fullPerSqft: [15, 25] },
];

// Condition probability by year bucket: 1=likely needed (enabled), 0.5=possible (enabled), 0=unlikely (disabled)
const ITEM_TABLE = {
  //                         pre1950  50-75  75-00  00-15  post15
  roof:        { e: [1,    1,    1,    0.5,  0   ], base: [8000,  22000] },
  hvac:        { e: [1,    1,    0.5,  0.5,  0   ], base: [5000,  12000] },
  electrical:  { e: [1,    0.5,  0,    0,    0   ], base: [4000,  14000] },
  plumbing:    { e: [1,    0.5,  0,    0,    0   ], base: [3500,  16000] },
  foundation:  { e: [0.5,  0.5,  0,    0,    0   ], base: [6000,  35000] },
  kitchen:     { e: [1,    1,    0.5,  0,    0   ], base: [10000, 28000] },
  baths:       { e: [1,    1,    0.5,  0,    0   ], base: [11000, 28000] }, // ×2 included
  flooring:    { e: [1,    1,    0.5,  0.5,  0   ], sqftScale: true, base: [3, 8] },
  windows:     { e: [1,    1,    0.5,  0,    0   ], base: [4000,  10000] },
  paint:       { e: [1,    1,    1,    0.5,  0   ], sqftScale: true, base: [2, 4] },
  landscaping: { e: [0.5,  0.5,  0.5,  0,    0   ], base: [1500,  6000]  },
  driveway:    { e: [0.5,  0.5,  0,    0,    0   ], base: [2000,  6000]  },
};

const ITEM_LABELS = {
  roof: 'Roof Replacement', hvac: 'HVAC System', electrical: 'Electrical Update',
  plumbing: 'Plumbing Update', foundation: 'Foundation Repair', kitchen: 'Kitchen Renovation',
  baths: 'Bathrooms (×2)', flooring: 'Flooring', windows: 'Windows',
  paint: 'Interior + Exterior Paint', landscaping: 'Landscaping / Cleanup', driveway: 'Driveway / Concrete',
};

const ITEM_CATEGORIES = {
  roof: 'structural', hvac: 'mechanical', electrical: 'mechanical', plumbing: 'mechanical',
  foundation: 'structural', kitchen: 'cosmetic', baths: 'cosmetic', flooring: 'cosmetic',
  windows: 'exterior', paint: 'cosmetic', landscaping: 'exterior', driveway: 'exterior',
};

function getBucketIdx(yearBuilt) {
  const y = yearBuilt || 1960;
  return YEAR_BUCKETS.findIndex(b => y < b.maxYear);
}

function statisticalEstimate(yearBuilt, sqft) {
  const idx  = getBucketIdx(yearBuilt);
  const buck = YEAR_BUCKETS[Math.max(0, idx)];
  const sf   = sqft && sqft > 0 ? sqft : 1500;

  const items = Object.keys(ITEM_TABLE).map(key => {
    const row  = ITEM_TABLE[key];
    const prob = row.e[Math.max(0, idx)] ?? 0;
    const low  = row.sqftScale ? Math.round(row.base[0] * sf) : row.base[0];
    const high = row.sqftScale ? Math.round(row.base[1] * sf) : row.base[1];
    return {
      key,
      label:     ITEM_LABELS[key],
      category:  ITEM_CATEGORIES[key],
      cost_low:  low,
      cost_high: high,
      condition: prob === 1 ? 'likely needed' : prob === 0.5 ? 'possible' : 'unlikely',
      enabled:   prob >= 0.5,
    };
  });

  // Contingency 10% of enabled high
  const enabledHigh = items.filter(i => i.enabled).reduce((s, i) => s + i.cost_high, 0);
  items.push({
    key: 'contingency', label: 'Contingency (10%)', category: 'structural',
    cost_low:  Math.round(enabledHigh * 0.08),
    cost_high: Math.round(enabledHigh * 0.10),
    condition: 'likely needed', enabled: true,
  });

  return calcTotals(items, 'statistical', buck.label);
}

function calcTotals(items, source, yearBucket) {
  const sum = (arr, field) => arr.reduce((s, i) => s + (i[field] || 0), 0);
  const light = items.filter(i => i.enabled && (i.category === 'cosmetic' || i.category === 'exterior'));
  const mini  = items.filter(i => i.enabled && i.category !== 'structural');
  const full  = items.filter(i => i.enabled);
  return {
    source, year_bucket: yearBucket, repair_items: items,
    light_rehab_low:  sum(light, 'cost_low'),  light_rehab_high:  sum(light, 'cost_high'),
    mini_rehab_low:   sum(mini,  'cost_low'),  mini_rehab_high:   sum(mini,  'cost_high'),
    full_rehab_low:   sum(full,  'cost_low'),  full_rehab_high:   sum(full,  'cost_high'),
  };
}

// ─── Claude prompt (Rule 4) — fires ONCE per address when photos present ──────
function buildClaudePrompt(address, propertyData, photos) {
  const pd = propertyData || {};
  return {
    system: `You are a professional real estate repair estimator specializing in Florida residential properties.
Analyze the property and return ONLY valid JSON. No text outside the JSON.
Cost ranges should be realistic for the Tampa/Florida market in 2024.
All values are USD integers.`,
    user: `Property: ${address}
Year Built: ${pd.year_built || 'unknown'}
Sqft: ${pd.sqft || 'unknown'}
Bedrooms: ${pd.beds || 'unknown'}  Bathrooms: ${pd.baths || 'unknown'}
Additional notes: ${pd.notes || 'none'}

${photos?.length ? `${photos.length} property photo(s) attached.` : 'No photos available — use statistical estimates.'}

Return this exact JSON structure:
{
  "repair_items": [
    {
      "key": "roof",
      "label": "Roof Replacement",
      "category": "structural",
      "cost_low": 8000,
      "cost_high": 18000,
      "condition": "needs replacement in 2-3 years",
      "enabled": true
    }
    // repeat for each item: roof, hvac, electrical, plumbing, foundation, kitchen, baths, flooring, windows, paint, landscaping, driveway, contingency
  ],
  "notes": "one sentence summary of overall property condition"
}

Only include items that are relevant. Be specific about condition. Cost ranges must reflect actual contractor pricing for Florida 2024.`,
  };
}

// ─── Vercel handler ───────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sb = createClient(SB_URL, SB_KEY);

  // ── GET — return cached or compute statistical ──────────────────────────────
  if (req.method === 'GET') {
    const { address, year_built, sqft } = req.query || {};
    if (!address) return res.status(400).json({ error: 'address required' });

    // Rule 2 — check Supabase cache first
    const { data: cached } = await sb
      .from('asap_repair_estimates')
      .select('*')
      .ilike('address', address.trim())
      .limit(1)
      .single();

    if (cached) {
      return res.status(200).json({ ...cached, cache_hit: true });
    }

    // Rule 5 — no photos, no Claude: statistical estimate
    const est = statisticalEstimate(
      year_built ? parseInt(year_built) : null,
      sqft       ? parseInt(sqft)       : null,
    );

    // Save statistical result to cache so next GET is instant
    const row = {
      address:          address.trim(),
      property_data:    { year_built: year_built ? parseInt(year_built) : null, sqft: sqft ? parseInt(sqft) : null },
      repair_items:     est.repair_items,
      light_rehab_low:  est.light_rehab_low,
      light_rehab_high: est.light_rehab_high,
      mini_rehab_low:   est.mini_rehab_low,
      mini_rehab_high:  est.mini_rehab_high,
      full_rehab_low:   est.full_rehab_low,
      full_rehab_high:  est.full_rehab_high,
    };
    await sb.from('asap_repair_estimates').upsert(row, { onConflict: 'address' }).catch(() => {});

    return res.status(200).json({ ...row, source: est.source, year_bucket: est.year_bucket, cache_hit: false });
  }

  // ── POST — Claude analysis with photos, or statistical if no photos ─────────
  if (req.method === 'POST') {
    const { address, year_built, sqft, property_data, photos, force_refresh } = req.body || {};
    if (!address) return res.status(400).json({ error: 'address required' });

    // Rule 2 — cache check: never call Claude twice for the same address
    if (!force_refresh) {
      const { data: cached } = await sb
        .from('asap_repair_estimates')
        .select('*')
        .ilike('address', address.trim())
        .limit(1)
        .single();

      if (cached) {
        return res.status(200).json({ ...cached, cache_hit: true });
      }
    }

    let estimate;

    // Rule 4 — Claude only when photos are present
    if (photos && photos.length > 0) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

      const client = new Anthropic({ apiKey });
      const { system, user } = buildClaudePrompt(address, property_data, photos);

      // Build message content — include up to 5 photos to keep token cost reasonable
      const imageContent = photos.slice(0, 5).map(photo => ({
        type: 'image',
        source: {
          type:       'base64',
          media_type: photo.media_type || 'image/jpeg',
          data:       photo.data,
        },
      }));

      const response = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',  // cheapest model that handles vision
        max_tokens: 1500,
        system,
        messages: [{
          role:    'user',
          content: [...imageContent, { type: 'text', text: user }],
        }],
      });

      try {
        const raw  = response.content[0]?.text?.trim() || '{}';
        const json = JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''));
        estimate = calcTotals(json.repair_items || [], 'claude', 'claude_analysis');
        estimate.notes = json.notes;
      } catch {
        // Claude parse failed — fall back to statistical
        estimate = statisticalEstimate(year_built, sqft);
        estimate.source = 'statistical_fallback';
      }
    } else {
      // Rule 5 — no photos, pure statistical math
      estimate = statisticalEstimate(year_built, sqft);
    }

    // Save to cache — Rule 4 guarantee: this address will never hit Claude again
    const pd  = property_data || {};
    const row = {
      address:          address.trim(),
      property_data:    { year_built: year_built || pd.year_built || null, sqft: sqft || pd.sqft || null, ...pd },
      repair_items:     estimate.repair_items,
      light_rehab_low:  estimate.light_rehab_low,
      light_rehab_high: estimate.light_rehab_high,
      mini_rehab_low:   estimate.mini_rehab_low,
      mini_rehab_high:  estimate.mini_rehab_high,
      full_rehab_low:   estimate.full_rehab_low,
      full_rehab_high:  estimate.full_rehab_high,
    };

    await sb.from('asap_repair_estimates')
      .upsert(row, { onConflict: 'address' })
      .catch(() => {});

    return res.status(200).json({
      ...row,
      source:      estimate.source,
      year_bucket: estimate.year_bucket,
      notes:       estimate.notes || null,
      cache_hit:   false,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
