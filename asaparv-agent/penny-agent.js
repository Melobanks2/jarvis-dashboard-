#!/usr/bin/env node
// penny-agent.js — Revenue & Cost Tracker Agent
// Runs every Sunday at 8pm, tracks all revenue and costs for the week

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_PIPELINE = "o4kqU2y8DYjA73aKUxNu";
const GHL_API      = "https://services.leadconnectorhq.com";
const GHL_HEADERS  = { "Authorization": `Bearer ${GHL_TOKEN}`, "Content-Type": "application/json", "Version": "2021-07-28" };
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

// Monthly fixed costs (prorated weekly)
const MONTHLY_COSTS = {
  "Hostinger VPS":    12.00,
  "Telnyx (base)":    10.00,
  "ElevenLabs":       22.00,
  "Cloudflare":        0.00, // free tier
};

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

// ── Get week range ─────────────────────────────────────────────────────────────
function getWeekRange() {
  const now   = new Date();
  const end   = new Date(now);
  const start = new Date(now);
  start.setDate(now.getDate() - 7);
  return {
    start: start.toISOString().split("T")[0],
    end:   end.toISOString().split("T")[0],
    startIso: start.toISOString(),
    endIso:   end.toISOString(),
  };
}

// ── Revenue: check GHL for closed deals ───────────────────────────────────────
async function getWeeklyRevenue(week) {
  let totalRevenue = 0;
  const deals = [];

  try {
    // Look for Contract Sent / Under Contract opportunities updated this week
    const closedStages = ["Under Contract", "Contract Sent"];
    for (const stageName of closedStages) {
      const pData = await ghl("GET", `/opportunities/pipelines?locationId=${GHL_LOCATION}`);
      const pipeline = (pData.pipelines || []).find(p => p.id === GHL_PIPELINE);
      const stage = (pipeline?.stages || []).find(s => s.name === stageName);
      if (!stage) continue;

      const data = await ghl("GET", `/opportunities/search?pipeline_id=${GHL_PIPELINE}&location_id=${GHL_LOCATION}&pipeline_stage_id=${stage.id}&limit=50`);
      for (const opp of (data.opportunities || [])) {
        const updatedAt = opp.updatedAt || opp.dateUpdated || "";
        if (updatedAt >= week.startIso) {
          const fee = opp.monetaryValue || 0;
          totalRevenue += fee;
          deals.push({
            name: opp.contact?.name || opp.name,
            stage: stageName,
            fee,
          });
        }
      }
    }
  } catch {}

  return { totalRevenue, deals };
}

// ── Call metrics from Supabase ─────────────────────────────────────────────────
async function getCallMetrics(week) {
  try {
    const { data: calls, count } = await sb
      .from("jarvis_calls")
      .select("*", { count: "exact" })
      .gte("called_at", week.startIso)
      .lte("called_at", week.endIso);

    const total          = calls?.length || 0;
    const realConversations = (calls || []).filter(c => (c.transcript_full || "").includes("Seller:")).length;
    const hotLeads       = (calls || []).filter(c => c.stage_after === "Hot Follow Up").length;
    const appointments   = (calls || []).filter(c => c.stage_after === "Decision Pending").length;
    const totalDuration  = (calls || []).reduce((sum, c) => sum + (c.call_duration || 0), 0);
    const avgDuration    = total > 0 ? Math.round(totalDuration / total) : 0;

    return { total, realConversations, hotLeads, appointments, avgDuration };
  } catch { return { total: 0, realConversations: 0, hotLeads: 0, appointments: 0, avgDuration: 0 }; }
}

// ── Anthropic API cost estimate ────────────────────────────────────────────────
async function getAnthropicCost(week) {
  try {
    const { data: calls } = await sb
      .from("jarvis_calls")
      .select("call_duration, transcript_full")
      .gte("called_at", week.startIso)
      .lte("called_at", week.endIso);

    // Rough estimate: each call turn ~200 tokens input + 100 output
    // Haiku: $0.25/1M input, $1.25/1M output
    let totalCost = 0;
    for (const c of (calls || [])) {
      const turns = (c.transcript_full || "").split("\n").length;
      const inputTokens  = turns * 200 + 500; // 500 for system prompt
      const outputTokens = turns * 100;
      totalCost += (inputTokens / 1_000_000) * 0.25 + (outputTokens / 1_000_000) * 1.25;
    }
    return Math.round(totalCost * 100) / 100;
  } catch { return 0; }
}

// ── Telnyx cost estimate ───────────────────────────────────────────────────────
async function getTelnyxCost(week) {
  try {
    // Estimate from call duration — Telnyx outbound ~$0.013/min
    const { data: calls } = await sb
      .from("jarvis_calls")
      .select("call_duration")
      .gte("called_at", week.startIso)
      .lte("called_at", week.endIso);

    const totalSeconds = (calls || []).reduce((sum, c) => sum + (c.call_duration || 0), 0);
    const totalMinutes = totalSeconds / 60;
    return Math.round(totalMinutes * 0.013 * 100) / 100;
  } catch { return 0; }
}

// ── Main Penny run ─────────────────────────────────────────────────────────────
async function runPenny() {
  const week = getWeekRange();
  console.log(`\n[Penny] 💰 Weekly Revenue Report — ${week.start} to ${week.end}`);

  const [revenue, metrics, anthropicCost, telnyxCost] = await Promise.all([
    getWeeklyRevenue(week),
    getCallMetrics(week),
    getAnthropicCost(week),
    getTelnyxCost(week),
  ]);

  // Fixed costs (weekly portion)
  const weeklyFixed = Object.values(MONTHLY_COSTS).reduce((sum, v) => sum + v, 0) / 4.33;
  const totalCosts  = Math.round((anthropicCost + telnyxCost + weeklyFixed) * 100) / 100;
  const netProfit   = Math.round((revenue.totalRevenue - totalCosts) * 100) / 100;

  // Conversion rates
  const leadToConversation = metrics.total > 0 ? Math.round((metrics.realConversations / metrics.total) * 100) : 0;
  const convToAppointment  = metrics.realConversations > 0 ? Math.round((metrics.appointments / metrics.realConversations) * 100) : 0;
  const costPerLead        = metrics.total > 0 ? Math.round(totalCosts / metrics.total * 100) / 100 : 0;
  const costPerAppointment = metrics.appointments > 0 ? Math.round(totalCosts / metrics.appointments * 100) / 100 : 0;

  const report =
    `💰 PENNY WEEKLY REPORT — ${week.start} to ${week.end}\n\n` +
    `📈 REVENUE\n` +
    `Total Revenue: $${revenue.totalRevenue.toLocaleString()}\n` +
    (revenue.deals.length > 0 ? revenue.deals.map(d => `  • ${d.name}: $${d.fee.toLocaleString()} (${d.stage})`).join("\n") + "\n" : "  No closed deals this week\n") +
    `\n📉 COSTS\n` +
    `Anthropic API: ~$${anthropicCost}\n` +
    `Telnyx calls: ~$${telnyxCost}\n` +
    `ElevenLabs: ~$${(22/4.33).toFixed(2)}\n` +
    `Hostinger VPS: ~$${(12/4.33).toFixed(2)}\n` +
    `Total Costs: ~$${totalCosts}\n` +
    `\n💵 NET PROFIT: $${netProfit.toLocaleString()}\n\n` +
    `📊 ACTIVITY\n` +
    `Leads called: ${metrics.total}\n` +
    `Real conversations: ${metrics.realConversations} (${leadToConversation}%)\n` +
    `Hot leads: ${metrics.hotLeads}\n` +
    `Appointments set: ${metrics.appointments}\n` +
    `Conv → Appt rate: ${convToAppointment}%\n` +
    `Avg call duration: ${Math.floor(metrics.avgDuration / 60)}m ${metrics.avgDuration % 60}s\n\n` +
    `💡 UNIT ECONOMICS\n` +
    `Cost per lead called: $${costPerLead}\n` +
    `Cost per appointment: $${costPerAppointment || "—"}\n`;

  console.log(report);
  await telegram(report);

  // Save to Supabase
  try {
    await sb.from("revenue_tracking").insert({
      week_start:           week.start,
      week_end:             week.end,
      total_revenue:        revenue.totalRevenue,
      total_costs:          totalCosts,
      net_profit:           netProfit,
      anthropic_cost:       anthropicCost,
      telnyx_cost:          telnyxCost,
      deals_closed:         revenue.deals.length,
      leads_called:         metrics.total,
      real_conversations:   metrics.realConversations,
      appointments_set:     metrics.appointments,
      hot_leads:            metrics.hotLeads,
      cost_per_appointment: costPerAppointment || null,
    });
  } catch {}

  console.log("[Penny] ✅ Report sent");
}

// ── Startup ────────────────────────────────────────────────────────────────────
(async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║      PENNY — Revenue Tracker Agent       ║");
  console.log("╚══════════════════════════════════════════╝");

  const { error } = await sb.from("revenue_tracking").select("id").limit(1);
  if (error) {
    console.log("[Penny] ⚠️  revenue_tracking table missing. Create in Supabase:");
    console.log(`CREATE TABLE IF NOT EXISTS revenue_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE,
  week_end DATE,
  total_revenue NUMERIC DEFAULT 0,
  total_costs NUMERIC DEFAULT 0,
  net_profit NUMERIC DEFAULT 0,
  anthropic_cost NUMERIC DEFAULT 0,
  telnyx_cost NUMERIC DEFAULT 0,
  deals_closed INTEGER DEFAULT 0,
  leads_called INTEGER DEFAULT 0,
  real_conversations INTEGER DEFAULT 0,
  appointments_set INTEGER DEFAULT 0,
  hot_leads INTEGER DEFAULT 0,
  cost_per_appointment NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);`);
  } else {
    console.log("[Penny] ✅ revenue_tracking table ready");
  }

  // Sunday at 8pm EST
  cron.schedule("0 20 * * 0", () => runPenny().catch(console.error), { timezone: "America/New_York" });
  console.log("[Penny] Scheduled: Sunday 8pm EST");

  if (process.argv.includes("--now")) {
    await runPenny();
  }
})();
