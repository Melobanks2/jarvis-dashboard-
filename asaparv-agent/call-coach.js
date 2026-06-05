#!/usr/bin/env node
// call-coach.js — Nightly AI call coaching agent
// Runs at 9pm Mon–Sat, analyzes all calls from that day,
// updates David's coaching rules, and sends Telegram report

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");
const { aiChat } = require("./ai-router");
const cron      = require("node-cron");

const sb     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GHL_TOKEN   = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_API     = "https://services.leadconnectorhq.com";
const GHL_HEADERS = {
  "Authorization": `Bearer ${GHL_TOKEN}`,
  "Content-Type":  "application/json",
  "Version":       "2021-07-28",
};
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

// Stage mapping by motivation score
const STAGE_BY_SCORE = {
  hot:  "Hot Follow Up",
  warm: "Warm Follow Up",
  cold: "Cold Follow Up",
};

async function ghl(method, urlPath, body) {
  const res = await fetch(`${GHL_API}${urlPath}`, {
    method,
    headers: GHL_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({}));
}

async function telegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("[Telegram] Failed:", e.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Ensure tables exist ────────────────────────────────────────────────────────
async function ensureTables() {
  // Just verify tables exist by querying them — Supabase doesn't expose DDL via JS client
  // Tables must be created manually in Supabase dashboard if missing

  // Check tables exist by querying them
  const { error: ce1 } = await sb.from("david_coaching_log").select("id").limit(1);
  const { error: ce2 } = await sb.from("david_coaching_rules").select("id").limit(1);

  if (ce1) console.warn("[DB] david_coaching_log may not exist:", ce1.message);
  if (ce2) console.warn("[DB] david_coaching_rules may not exist:", ce2.message);

  if (!ce1) console.log("[DB] ✅ david_coaching_log ready");
  if (!ce2) console.log("[DB] ✅ david_coaching_rules ready");
}

// ── Analyze a single call transcript ──────────────────────────────────────────
async function analyzeCall(call) {
  const transcript = call.transcript_full || "";
  if (!transcript || transcript.length < 50) return null;

  try {
    const res = await aiChat({
      max_tokens: 800,
      system:     "You are an expert wholesale real estate call coach. Return ONLY valid JSON, no markdown.",
      messages: [{
        role: "user",
        content:
          `Analyze this call transcript for ${call.contact_name} about ${call.address || "their property"}.\n\n` +
          `Transcript:\n${transcript}\n\n` +
          `Determine:\n` +
          `1. is_voicemail: true if this hit voicemail (look for: "leave a message", "press 1", "not available", "mailbox", "after the tone", "record your message")\n` +
          `2. motivation_score: 1-10 based on urgency, flexibility, and pain points (0 if voicemail)\n` +
          `3. did_well: array of specific things David did well (rapport building, probing questions, handling objections)\n` +
          `4. improve: array of specific moments David could have done better\n` +
          `5. next_action: "call back tomorrow" | "set appointment" | "skip follow up" | "move to cold" | "voicemail only"\n` +
          `6. summary: one sentence outcome\n\n` +
          `Return JSON:\n` +
          `{"is_voicemail": bool, "motivation_score": int, "did_well": [...], "improve": [...], "next_action": "...", "summary": "..."}`
      }],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/,"").replace(/```\s*$/,"");
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`  [Claude] Analysis failed for ${call.contact_name}: ${e.message}`);
    return null;
  }
}

// ── Load GHL stage IDs ─────────────────────────────────────────────────────────
let STAGE_IDS = {};
async function loadStageIds() {
  try {
    const data = await ghl("GET", `/opportunities/pipelines?locationId=${GHL_LOCATION}`);
    const pipeline = (data.pipelines || []).find(p => p.name && p.name.includes("VA"));
    if (!pipeline) return;
    for (const s of (pipeline.stages || [])) {
      STAGE_IDS[s.name] = s.id;
    }
    console.log("[GHL] Stages loaded:", Object.keys(STAGE_IDS).join(", "));
  } catch (e) {
    console.error("[GHL] Stage load failed:", e.message);
  }
}

// ── Update GHL stage based on motivation score ─────────────────────────────────
async function updateGhlStage(call, score, oppId) {
  if (!oppId || !score) return;
  let stageName = null;
  if (score >= 7)      stageName = STAGE_BY_SCORE.hot;
  else if (score >= 4) stageName = STAGE_BY_SCORE.warm;
  else if (score >= 1) stageName = STAGE_BY_SCORE.cold;
  if (!stageName || !STAGE_IDS[stageName]) return;

  // No backwards movement — get current stage rank
  const STAGE_RANK = {
    "Attempt 1 No Contact": 1, "Attempt 2 No Contact": 2, "Attempt 3-5 No Contact": 3,
    "Attempt 6+ Unresponsive": 4, "Attempt 1": 4, "New Lead": 5,
    "Cold Follow Up": 6, "Warm Follow Up": 7, "Hot Follow Up": 8,
    "Decision Pending": 9, "Contract Sent": 10, "Under Contract": 11,
  };
  const currentRank = STAGE_RANK[call.stage_after] || 0;
  const newRank     = STAGE_RANK[stageName] || 0;
  if (newRank <= currentRank) return; // don't move backwards

  try {
    await ghl("PUT", `/opportunities/${oppId}`, { pipelineStageId: STAGE_IDS[stageName], status: "open" });
    console.log(`  [GHL] Stage → ${stageName}`);
  } catch (e) {
    console.warn(`  [GHL] Stage update failed: ${e.message}`);
  }
}

// ── Update coaching rules based on last 7 days of coaching logs ────────────────
async function updateCoachingRules() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const { data: logs } = await sb
    .from("david_coaching_log")
    .select("improve, did_well")
    .gte("call_date", sevenDaysAgo)
    .not("improve", "is", null);

  if (!logs || logs.length === 0) return null;

  // Flatten all improvement areas
  const allImprovements = [];
  const allStrengths    = [];
  for (const log of logs) {
    if (Array.isArray(log.improve))  allImprovements.push(...log.improve);
    if (Array.isArray(log.did_well)) allStrengths.push(...log.did_well);
  }

  // Count frequency
  const freq = {};
  for (const item of allImprovements) {
    const key = item.substring(0, 60).toLowerCase();
    freq[key] = (freq[key] || 0) + 1;
  }
  const top3 = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,3).map(([k]) => k);

  if (top3.length === 0) return null;

  // Ask Claude to synthesize a coaching rule from top improvement areas
  let newRule = null;
  try {
    const ruleRes = await aiChat({
      max_tokens: 200,
      system:     "You write concise coaching rules for an AI real estate caller named David. Return only the rule text, no JSON.",
      messages: [{
        role: "user",
        content:
          `Based on these top improvement areas from David's recent calls:\n` +
          top3.map((t,i) => `${i+1}. ${t}`).join("\n") +
          `\n\nWrite ONE specific, actionable coaching rule David should apply on every call (2-3 sentences max).`
      }],
    });
    newRule = ruleRes.content[0].text.trim();
  } catch {}

  if (!newRule) return null;

  // Upsert rule into david_coaching_rules
  try {
    await sb.from("david_coaching_rules").insert({
      rule:            newRule,
      category:        top3[0] || "general",
      added_date:      new Date().toISOString().split("T")[0],
      times_triggered: 1,
    });
    console.log(`[Coach] ✅ New coaching rule added`);
  } catch {}

  return { rule: newRule, topImprovement: top3[0], topStrength: allStrengths[0] || null };
}

// ── Main nightly analysis run ──────────────────────────────────────────────────
async function runNightlyCoaching() {
  const today = new Date().toISOString().split("T")[0];
  console.log(`\n[Coach] 🧠 Nightly coaching run — ${today}`);

  await loadStageIds();

  // Fetch today's calls with real transcripts
  const { data: calls, error } = await sb
    .from("jarvis_calls")
    .select("*")
    .gte("called_at", `${today}T00:00:00Z`)
    .lte("called_at", `${today}T23:59:59Z`)
    .not("transcript_full", "is", null);

  if (error) { console.error("[Coach] Supabase error:", error.message); return; }
  if (!calls || calls.length === 0) {
    console.log("[Coach] No calls today.");
    await telegram(`🧠 DAVID COACHING REPORT — ${today}\n\nNo calls found for today.`);
    return;
  }

  console.log(`[Coach] Analyzing ${calls.length} calls...`);

  let realConvos = 0, voicemails = 0, hot = 0, warm = 0;
  let allDidWell = [], allImprove = [];
  let totalScore = 0, scoredCount = 0;

  for (const call of calls) {
    const hasConversation = (call.transcript_full || "").includes("Seller:");
    if (!hasConversation) continue;

    console.log(`  → ${call.contact_name} | ${call.address}`);
    const analysis = await analyzeCall(call);
    await sleep(600);
    if (!analysis) continue;

    if (analysis.is_voicemail) { voicemails++; continue; }
    realConvos++;

    if (analysis.motivation_score >= 7) hot++;
    else if (analysis.motivation_score >= 4) warm++;

    if (analysis.motivation_score > 0) {
      totalScore  += analysis.motivation_score;
      scoredCount += 1;
    }

    if (analysis.did_well?.length) allDidWell.push(...analysis.did_well);
    if (analysis.improve?.length)  allImprove.push(...analysis.improve);

    // Log to david_coaching_log
    try {
      await sb.from("david_coaching_log").insert({
        call_id:          String(call.id),
        call_date:        today,
        contact_name:     call.contact_name,
        did_well:         analysis.did_well,
        improve:          analysis.improve,
        next_action:      analysis.next_action,
        summary:          analysis.summary,
        motivation_score: analysis.motivation_score,
      });
    } catch {}

    // Update jarvis_calls with score from coaching
    try {
      await sb.from("jarvis_calls").update({
        summary: analysis.summary,
      }).eq("id", call.id);
    } catch {}

    // Update GHL stage if we found a better score
    if (analysis.motivation_score > 0 && call.contact_id) {
      // Get opportunity ID from GHL
      try {
        const oppsData = await ghl("GET", `/opportunities/search?contact_id=${call.contact_id}&location_id=${GHL_LOCATION}&limit=5`);
        const opp = (oppsData.opportunities || [])[0];
        if (opp?.id) await updateGhlStage(call, analysis.motivation_score, opp.id);
      } catch {}
      await sleep(400);
    }
  }

  // Update coaching rules
  const coachingResult = await updateCoachingRules();

  // Build Telegram report
  const avgScore = scoredCount > 0 ? (totalScore / scoredCount).toFixed(1) : "—";
  const topStrength   = allDidWell.length > 0 ? allDidWell[0] : "—";
  const topImprovement = allImprove.length > 0 ? allImprove[0] : "—";

  const report =
    `🧠 DAVID COACHING REPORT — ${today}\n` +
    `Calls analyzed: ${calls.length}\n` +
    `Real conversations: ${realConvos}\n` +
    `Voicemails correctly identified: ${voicemails}\n` +
    `Average motivation score: ${avgScore}/10\n` +
    `Hot leads found: ${hot}\n` +
    `Warm leads: ${warm}\n` +
    `\nCommon strength: ${topStrength}\n` +
    `Top improvement area: ${topImprovement}\n` +
    `\nDavid's updated coaching rule:\n${coachingResult?.rule || "No new rule added today"}\n`;

  console.log("\n" + report);
  await telegram(report);
  console.log("[Coach] ✅ Done");
}

// ── Startup: ensure tables exist ───────────────────────────────────────────────
(async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║       DAVID CALL COACH — Active          ║");
  console.log("╚══════════════════════════════════════════╝");

  await ensureTables();

  // Print current coaching rules at startup
  let rules = [];
  try {
    const res = await sb.from("david_coaching_rules")
      .select("rule, added_date")
      .order("added_date", { ascending: false })
      .limit(5);
    rules = res.data || [];
  } catch {}

  if (rules?.length > 0) {
    console.log("\n[Coach] Current top coaching rules:");
    rules.forEach((r, i) => console.log(`  ${i+1}. ${r.rule}`));
  }

  // Schedule: 9pm Mon–Sat (cron: 0 21 * * 1-6)
  cron.schedule("0 21 * * 1-6", () => {
    runNightlyCoaching().catch(e => console.error("[Coach] Error:", e));
  }, { timezone: "America/New_York" });

  console.log("\n[Coach] Scheduled: 9pm Mon–Sat EST");

  // Run immediately if --now flag passed
  if (process.argv.includes("--now")) {
    console.log("[Coach] --now flag detected, running immediately...");
    await runNightlyCoaching();
  }
})();
