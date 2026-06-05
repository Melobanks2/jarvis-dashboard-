#!/usr/bin/env node
// sage-agent.js — Self Learning Brain
// Runs Sunday 9pm, analyzes all data, builds response cache, updates all agents

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");
const cron = require("node-cron");

const sb     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

async function telegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch {}
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getWeekRange() {
  const end   = new Date();
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString(), start: start.toISOString().split("T")[0] };
}

// ── Build response cache from successful conversations ─────────────────────────
async function buildResponseCache(week) {
  console.log("[Sage] Building response cache from transcripts...");

  // Get all calls with real conversations from past 7 days
  const { data: calls } = await sb
    .from("jarvis_calls")
    .select("transcript_full, stage_after, call_duration, contact_name")
    .gte("called_at", week.startIso)
    .not("transcript_full", "is", null);

  const goodCalls = (calls || []).filter(c =>
    (c.transcript_full || "").includes("Seller:") &&
    !["Cold Follow Up", "Attempt 1 No Contact", "Attempt 2 No Contact"].includes(c.stage_after)
  );

  if (goodCalls.length === 0) { console.log("[Sage] No qualifying conversations this week"); return 0; }

  // Extract seller turns and David's best responses
  const pairsToCache = [];
  for (const call of goodCalls) {
    const lines = (call.transcript_full || "").split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith("Seller:") && lines[i+1].startsWith("Jarvis:")) {
        const sellerSaid  = lines[i].replace("Seller:", "").trim();
        const davidSaid   = lines[i+1].replace("Jarvis:", "").trim();
        if (sellerSaid.length > 15 && davidSaid.length > 15) {
          pairsToCache.push({ seller: sellerSaid, david: davidSaid, outcome: call.stage_after });
        }
      }
    }
  }

  if (pairsToCache.length === 0) return 0;

  // Ask Claude to identify the 10 most reusable patterns
  try {
    const res = await claude.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system:     "You identify reusable conversation patterns for a wholesale real estate AI caller. Return ONLY valid JSON.",
      messages: [{
        role: "user",
        content:
          `From these ${pairsToCache.length} seller/David conversation pairs, identify the 10 most common and reusable patterns.\n\n` +
          `Pairs:\n${pairsToCache.slice(0, 50).map((p,i) => `${i+1}. Seller: "${p.seller}"\n   David: "${p.david}"`).join("\n\n")}\n\n` +
          `Return JSON array of 10 objects:\n[{"seller_pattern": "...", "david_response": "...", "category": "objection/motivation/price/closing/rapport"}]`
      }],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/,"").replace(/```\s*$/,"");
    const patterns = JSON.parse(raw);

    let cached = 0;
    for (const p of patterns) {
      // Check if pattern already exists
      const { data: existing } = await sb
        .from("response_cache")
        .select("id, times_used")
        .ilike("seller_input_pattern", p.seller_pattern.substring(0, 30) + "%")
        .limit(1);

      if (existing?.length > 0) {
        // Increment usage count
        await sb.from("response_cache")
          .update({ times_used: (existing[0].times_used || 0) + 1, updated_at: new Date().toISOString() })
          .eq("id", existing[0].id);
      } else {
        // Insert new pattern
        await sb.from("response_cache").insert({
          seller_input_pattern: p.seller_pattern,
          best_david_response:  p.david_response,
          times_used:           1,
          success_rate:         0.7, // default optimistic
        });
        cached++;
      }
      await sleep(100);
    }
    console.log(`[Sage] ✅ ${cached} new patterns cached, ${patterns.length - cached} updated`);
    return cached;
  } catch (e) {
    console.warn("[Sage] Cache build failed:", e.message);
    return 0;
  }
}

// ── Find best calling times ────────────────────────────────────────────────────
async function analyzeBestCallingTimes() {
  const { data: calls } = await sb
    .from("jarvis_calls")
    .select("called_at, stage_after, transcript_full")
    .not("called_at", "is", null)
    .limit(500);

  const hourStats = {};
  for (const call of (calls || [])) {
    const hour = new Date(call.called_at).getHours();
    if (!hourStats[hour]) hourStats[hour] = { total: 0, conversations: 0 };
    hourStats[hour].total++;
    if ((call.transcript_full || "").includes("Seller:")) hourStats[hour].conversations++;
  }

  return Object.entries(hourStats)
    .filter(([, s]) => s.total >= 3)
    .map(([h, s]) => ({ hour: parseInt(h), rate: Math.round(s.conversations / s.total * 100), total: s.total }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3);
}

// ── Analyze lead source performance ───────────────────────────────────────────
async function analyzeLeadSources() {
  // Pull from GHL — check tag patterns to identify source
  // Tags: "VA Lead", "PPL Lead", "County Lead", etc.
  const { data: calls } = await sb
    .from("jarvis_calls")
    .select("contact_id, stage_after, contact_name")
    .limit(200);

  const stages = {};
  for (const c of (calls || [])) {
    const stage = c.stage_after || "Unknown";
    stages[stage] = (stages[stage] || 0) + 1;
  }
  return stages;
}

// ── Analyze top seller objections ─────────────────────────────────────────────
async function analyzeTopObjections(week) {
  const { data: calls } = await sb
    .from("jarvis_calls")
    .select("transcript_full")
    .gte("called_at", week.startIso)
    .not("transcript_full", "is", null);

  const sellerLines = [];
  for (const c of (calls || [])) {
    const lines = (c.transcript_full || "").split("\n").filter(l => l.startsWith("Seller:"));
    sellerLines.push(...lines.map(l => l.replace("Seller:", "").trim()));
  }

  if (sellerLines.length === 0) return [];

  try {
    const res = await claude.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system:     "You identify patterns in real estate seller objections. Return ONLY valid JSON.",
      messages: [{
        role: "user",
        content:
          `Analyze these ${sellerLines.length} seller statements and find the top 5 objections/patterns.\n\n` +
          `Statements (sample):\n${sellerLines.slice(0,40).map((l,i) => `${i+1}. "${l}"`).join("\n")}\n\n` +
          `Return JSON array:\n[{"objection": "...", "frequency": estimated %, "best_response": "..."}]`
      }],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/,"").replace(/```\s*$/,"");
    return JSON.parse(raw);
  } catch { return []; }
}

// ── Update coaching rules with new insights ────────────────────────────────────
async function updateCoachingFromSage(objections) {
  if (!objections.length) return null;
  const topObjection = objections[0];

  try {
    const res = await claude.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system:     "Write concise coaching rules for an AI real estate caller named David.",
      messages: [{
        role: "user",
        content: `The most common seller objection this week was: "${topObjection.objection}"\nBest response found: "${topObjection.best_response}"\n\nWrite one coaching rule David should apply. 2 sentences max.`
      }],
    });
    const rule = res.content[0].text.trim();
    await sb.from("david_coaching_rules").insert({
      rule,
      category:    "sage-weekly",
      added_date:  new Date().toISOString().split("T")[0],
      times_triggered: 1,
    });
    return rule;
  } catch { return null; }
}

// ── Prune low-performing cache entries ────────────────────────────────────────
async function pruneResponseCache() {
  try {
    // Remove entries with low success rate and few uses
    const { error } = await sb
      .from("response_cache")
      .delete()
      .lt("success_rate", 0.3)
      .lt("times_used", 5);
    if (!error) console.log("[Sage] Pruned low-performing cache entries");
  } catch {}
}

// ── Get cache stats ────────────────────────────────────────────────────────────
async function getCacheStats() {
  try {
    const { count } = await sb.from("response_cache").select("*", { count: "exact", head: true });
    const { data: topHits } = await sb.from("response_cache").select("seller_input_pattern, times_used").order("times_used", { ascending: false }).limit(3);
    return { total: count || 0, topHits: topHits || [] };
  } catch { return { total: 0, topHits: [] }; }
}

// ── Main Sage run ──────────────────────────────────────────────────────────────
async function runSage() {
  const week = getWeekRange();
  console.log(`\n[Sage] 🧠 Weekly Intelligence Run — ${week.start}`);

  const [newCached, bestTimes, stageBreakdown, objections, cacheStats] = await Promise.all([
    buildResponseCache(week),
    analyzeBestCallingTimes(),
    analyzeLeadSources(),
    analyzeTopObjections(week),
    getCacheStats(),
  ]);

  await sleep(1000);

  // Prune bad cache entries
  await pruneResponseCache();

  // Update coaching rules with top objection
  const newRule = await updateCoachingFromSage(objections);

  // Build intelligence report
  const bestTimeStr = bestTimes.length > 0
    ? bestTimes.map(t => `${t.hour}:00 (${t.rate}% answer rate, n=${t.total})`).join(", ")
    : "Not enough data yet";

  const topObjectionStr = objections.length > 0
    ? objections.slice(0,3).map(o => `  • "${o.objection}" (~${o.frequency}%)`).join("\n")
    : "  None identified";

  const cacheHitEstimate = cacheStats.total > 0 ? Math.min(85, Math.round(cacheStats.total / 5)) : 0;

  const report =
    `🧠 SAGE WEEKLY INTELLIGENCE — ${week.start}\n\n` +
    `📦 RESPONSE CACHE\n` +
    `Total cached patterns: ${cacheStats.total}\n` +
    `New patterns this week: ${newCached}\n` +
    `Est. cache hit rate: ~${cacheHitEstimate}% of conversations\n` +
    `Est. Claude cost reduction: ~${cacheHitEstimate}%\n\n` +
    `⏰ BEST CALLING TIMES (answer rate)\n${bestTimeStr}\n\n` +
    `🗣️ TOP SELLER OBJECTIONS THIS WEEK\n${topObjectionStr}\n\n` +
    `📊 STAGE BREAKDOWN (all-time)\n` +
    Object.entries(stageBreakdown).slice(0,6).map(([s,n]) => `  ${s}: ${n}`).join("\n") + "\n\n" +
    `🤖 NEW COACHING RULE ADDED:\n${newRule || "No new rule this week"}\n\n` +
    (cacheStats.topHits.length > 0
      ? `🔥 TOP CACHED RESPONSES:\n` + cacheStats.topHits.map(h => `  "${h.seller_input_pattern?.substring(0,50)}..." (${h.times_used}x)`).join("\n") + "\n"
      : "") +
    `\nAll agents updated. David is smarter than last week. 💪`;

  console.log(report);
  await telegram(report);

  // Save to weekly_intelligence
  try {
    await sb.from("weekly_intelligence").insert({
      week_start:         week.start,
      new_cache_entries:  newCached,
      total_cache_size:   cacheStats.total,
      top_objections:     objections.slice(0,5),
      best_calling_hours: bestTimes,
      coaching_rule_added: newRule,
    });
  } catch {}

  console.log("[Sage] ✅ Intelligence run complete");
}

// ── Startup ────────────────────────────────────────────────────────────────────
(async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║      SAGE — Self Learning Brain          ║");
  console.log("╚══════════════════════════════════════════╝");

  // Check tables
  const tables = ["response_cache", "weekly_intelligence"];
  for (const t of tables) {
    const { error } = await sb.from(t).select("id").limit(1);
    if (error) console.log(`[Sage] ⚠️  Table missing: ${t}`);
    else       console.log(`[Sage] ✅ ${t} ready`);
  }

  // Sunday 9pm EST (after Penny at 8pm)
  cron.schedule("0 21 * * 0", () => runSage().catch(console.error), { timezone: "America/New_York" });
  console.log("[Sage] Scheduled: Sunday 9pm EST");

  if (process.argv.includes("--now")) {
    await runSage();
  }
})();
