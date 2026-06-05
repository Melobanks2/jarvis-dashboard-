#!/usr/bin/env node
// max-agent.js — Deal Analyzer Agent
// Fires after every hot lead, deep financial analysis, updates approval card

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");
const cron = require("node-cron");

const sb     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_API      = "https://services.leadconnectorhq.com";
const GHL_HEADERS  = { "Authorization": `Bearer ${GHL_TOKEN}`, "Content-Type": "application/json", "Version": "2021-07-28" };
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

// Assignment fee target
const MIN_ASSIGNMENT_FEE = 10000;
const CLOSING_COST_PCT   = 0.03;
const HOLDING_COST_PCT   = 0.02;

async function ghl(method, urlPath, body) {
  const r = await fetch(`${GHL_API}${urlPath}`, { method, headers: GHL_HEADERS, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}
async function telegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch {}
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Analyze a deal ─────────────────────────────────────────────────────────────
async function analyzeDeal(approval) {
  const arv         = approval.arv || 0;
  const repairCost  = approval.repair_cost || Math.round(arv * 0.15); // estimate 15% if unknown
  const askingPrice = approval.asking_price || null;

  // Calculate costs
  const closingCosts  = Math.round(arv * CLOSING_COST_PCT);
  const holdingCosts  = Math.round(arv * HOLDING_COST_PCT);
  const totalCosts    = repairCost + closingCosts + holdingCosts + MIN_ASSIGNMENT_FEE;

  // Max offers at different percentages
  const mao60 = Math.round(arv * 0.60 - repairCost);
  const mao65 = Math.round(arv * 0.65 - repairCost);
  const mao70 = Math.round(arv * 0.70 - repairCost);

  // True MAO = ARV - repairs - closing - holding - min fee
  const trueMao = Math.round(arv - repairCost - closingCosts - holdingCosts - MIN_ASSIGNMENT_FEE);

  // Assignment fee at each offer tier
  const fee60 = Math.max(0, trueMao - mao60);
  const fee65 = Math.max(0, trueMao - mao65);
  const fee70 = Math.max(0, trueMao - mao70);

  // Deal rating
  let rating, ratingEmoji, ratingReason;
  if (arv === 0) {
    rating = "UNKNOWN"; ratingEmoji = "❓";
    ratingReason = "ARV not available — run ASAP ARV first";
  } else if (mao60 > (askingPrice || 0) * 1.1) {
    rating = "GREEN"; ratingEmoji = "🟢";
    ratingReason = `Excellent spread — offer at 60% leaves strong margin`;
  } else if (mao65 > (askingPrice || trueMao * 0.9)) {
    rating = "GREEN"; ratingEmoji = "🟢";
    ratingReason = `Good deal — numbers work comfortably at 65%`;
  } else if (mao70 > (askingPrice || trueMao * 0.85)) {
    rating = "YELLOW"; ratingEmoji = "🟡";
    ratingReason = `Tight deal — need seller at or below 70% to work`;
  } else {
    rating = "RED"; ratingEmoji = "🔴";
    ratingReason = askingPrice
      ? `Seller at $${askingPrice.toLocaleString()} — MAO is $${trueMao.toLocaleString()}. Gap too wide.`
      : `Numbers don't support minimum $${MIN_ASSIGNMENT_FEE.toLocaleString()} fee at any tier`;
  }

  // Claude deep analysis on the repair breakdown
  let repairBreakdown = null;
  if (approval.transcript_snippet) {
    try {
      const res = await claude.messages.create({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system:     "You are Max, a wholesale real estate deal analyzer. Return ONLY valid JSON.",
        messages: [{
          role: "user",
          content:
            `Analyze this deal and estimate repair breakdown.\n\n` +
            `ARV: $${arv.toLocaleString()}\nRepair estimate: $${repairCost.toLocaleString()}\n` +
            `Seller transcript excerpt:\n${approval.transcript_snippet}\n\n` +
            `Return JSON:\n{\n` +
            `  "repair_items": {"roof": "$X or OK", "hvac": "$X or OK", "kitchen": "$X or OK", "bathrooms": "$X or OK", "foundation": "$X or OK", "other": "$X or OK"},\n` +
            `  "rehab_confidence": "low/medium/high",\n` +
            `  "deal_notes": "key insight about this deal in one sentence"\n` +
            `}`
        }],
      });
      const raw = res.content[0].text.trim().replace(/^```json\s*/,"").replace(/```\s*$/,"");
      repairBreakdown = JSON.parse(raw);
    } catch {}
  }

  return {
    arv, repairCost, closingCosts, holdingCosts, totalCosts, trueMao,
    mao60, mao65, mao70, fee60, fee65, fee70,
    rating, ratingEmoji, ratingReason,
    repairBreakdown,
    askingPrice,
  };
}

// ── Send Max analysis to Telegram ──────────────────────────────────────────────
async function sendMaxReport(approval, analysis) {
  const { arv, repairCost, closingCosts, holdingCosts, mao60, mao65, mao70,
          rating, ratingEmoji, ratingReason, repairBreakdown, askingPrice } = analysis;

  const repairs = repairBreakdown?.repair_items
    ? Object.entries(repairBreakdown.repair_items).map(([k,v]) => `  ${k}: ${v}`).join("\n")
    : `  Estimate: $${repairCost?.toLocaleString()}`;

  const msg =
    `\n${ratingEmoji} MAX DEAL ANALYSIS — ${rating}\n` +
    `Seller: ${approval.contact_name}\n` +
    `Address: ${approval.address}\n\n` +
    `💰 FINANCIAL BREAKDOWN:\n` +
    `ARV: $${arv?.toLocaleString() || "?"}\n` +
    `Repairs: $${repairCost?.toLocaleString() || "?"}\n` +
    `Closing costs (3%): $${closingCosts?.toLocaleString()}\n` +
    `Holding costs (2%): $${holdingCosts?.toLocaleString()}\n\n` +
    `📊 OFFER TIERS:\n` +
    `60%: $${mao60?.toLocaleString()} → fee ~$${analysis.fee60?.toLocaleString()}\n` +
    `65%: $${mao65?.toLocaleString()} → fee ~$${analysis.fee65?.toLocaleString()}\n` +
    `70%: $${mao70?.toLocaleString()} → fee ~$${analysis.fee70?.toLocaleString()}\n\n` +
    (askingPrice ? `Seller asking: $${askingPrice?.toLocaleString()}\n\n` : "") +
    `🔧 REPAIRS:\n${repairs}\n\n` +
    `🔍 VERDICT: ${ratingReason}\n` +
    (repairBreakdown?.deal_notes ? `\n📌 ${repairBreakdown.deal_notes}` : "");

  await telegram(msg);
}

// ── Save deal analysis to Supabase ─────────────────────────────────────────────
async function saveDealAnalysis(approval, analysis) {
  try {
    await sb.from("deal_analysis").insert({
      approval_id:    approval.id,
      contact_id:     approval.contact_id,
      contact_name:   approval.contact_name,
      address:        approval.address,
      arv:            analysis.arv,
      repair_cost:    analysis.repairCost,
      closing_costs:  analysis.closingCosts,
      holding_costs:  analysis.holdingCosts,
      true_mao:       analysis.trueMao,
      mao_60:         analysis.mao60,
      mao_65:         analysis.mao65,
      mao_70:         analysis.mao70,
      rating:         analysis.rating,
      rating_reason:  analysis.ratingReason,
      asking_price:   analysis.askingPrice,
      repair_breakdown: analysis.repairBreakdown,
    });
  } catch (e) {
    if (!e.message?.includes("does not exist")) console.warn("[Max] DB save failed:", e.message);
  }
}

// ── Check for unanalyzed hot leads ─────────────────────────────────────────────
async function checkForNewHotLeads() {
  try {
    // Get pending approvals that haven't been analyzed yet
    const { data: approvals } = await sb
      .from("david_pending_approvals")
      .select("*")
      .in("status", ["pending", "approved_60pct", "approved_65pct", "approved_70pct", "approved_novation"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (!approvals?.length) return;

    for (const approval of approvals) {
      console.log(`[Max] Analyzing deal: ${approval.contact_name} | ${approval.address}`);
      const analysis = await analyzeDeal(approval);
      await sendMaxReport(approval, analysis);
      await saveDealAnalysis(approval, analysis);
      // Mark as analyzed so we never reprocess it
      try {
        await sb.from("david_pending_approvals").update({ status: "max_analyzed" }).eq("id", approval.id);
      } catch {}
      await sleep(1000);
    }
  } catch (e) {
    console.error("[Max] Error:", e.message);
  }
}

// ── Startup ────────────────────────────────────────────────────────────────────
(async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║       MAX — Deal Analyzer Agent          ║");
  console.log("╚══════════════════════════════════════════╝");

  // Check table
  const { error } = await sb.from("deal_analysis").select("id").limit(1);
  if (error) {
    console.log("[Max] ⚠️  deal_analysis table missing. Create in Supabase:");
    console.log(`CREATE TABLE IF NOT EXISTS deal_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id TEXT,
  contact_id TEXT,
  contact_name TEXT,
  address TEXT,
  arv NUMERIC,
  repair_cost NUMERIC,
  closing_costs NUMERIC,
  holding_costs NUMERIC,
  true_mao NUMERIC,
  mao_60 NUMERIC,
  mao_65 NUMERIC,
  mao_70 NUMERIC,
  rating TEXT,
  rating_reason TEXT,
  asking_price NUMERIC,
  repair_breakdown JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);`);
  } else {
    console.log("[Max] ✅ deal_analysis table ready");
  }

  // Poll every 2 minutes for new hot leads
  cron.schedule("*/2 * * * *", () => checkForNewHotLeads().catch(console.error));
  console.log("[Max] Polling every 2 minutes for new hot leads");

  if (process.argv.includes("--now")) {
    await checkForNewHotLeads();
  }
})();
