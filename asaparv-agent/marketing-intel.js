/**
 * marketing-intel.js — Marketing Intelligence System
 *
 * Parts 1, 5, 6, 7 of the Marketing Intelligence System
 *
 * - Part 1:  GHL webhook → Llama lead analysis → Telegram card within 60s
 * - Part 5:  Daily 7am Telegram briefing (Llama-powered)
 * - Part 6:  Weekly Sunday 6pm ROI report (Llama-powered)
 * - Part 7:  Coupon Club optimizer (auto-runs after 30+ leads)
 *
 * PM2: marketing-intel — persistent, autorestart
 * Port: 3005 (configure GHL webhook → MARKETING_WEBHOOK_URL/new-lead)
 */

require("dotenv").config();
const express        = require("express");
const { createClient } = require("@supabase/supabase-js");
const TelegramBot    = require("node-telegram-bot-api");
const { aiChat }     = require("./ai-router");

const sb      = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot     = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || "8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0", { polling: false });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

const GHL_TOKEN    = process.env.GHL_API_TOKEN || "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const LOCATION_ID  = "AymErWPrH9U1ddRouslC";
const GHL_HDR      = { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-07-28", "Content-Type": "application/json" };

const FL_COUNTIES = ["Orange", "Osceola", "Seminole", "Lake", "Volusia", "Brevard", "Polk", "Hillsborough", "Pinellas", "Broward", "Miami-Dade"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectCounty(address = "") {
  const a = address.toLowerCase();
  for (const c of FL_COUNTIES) {
    if (a.includes(c.toLowerCase())) return c;
  }
  // rough ZIP-based county detection for Orlando area
  const zipMatch = a.match(/\b3([24]\d{3})\b/);
  if (zipMatch) {
    const zip = parseInt("3" + zipMatch[1]);
    if (zip >= 32789 && zip <= 32836) return "Orange";
    if (zip >= 34741 && zip <= 34759) return "Osceola";
    if (zip >= 32701 && zip <= 32773) return "Seminole";
  }
  return "Unknown";
}

function extractSource(tags = [], source = "") {
  const combined = [...tags, source].join(" ").toLowerCase();
  if (combined.includes("google"))   return "Google";
  if (combined.includes("facebook") || combined.includes("fb")) return "Facebook";
  if (combined.includes("sms") || combined.includes("text"))    return "Text Campaign";
  if (combined.includes("cold call") || combined.includes("alpha")) return "Cold Call";
  if (combined.includes("speed") || combined.includes("spl") || combined.includes("ppl")) return "Speed To Lead";
  if (combined.includes("county") || combined.includes("lis pendens")) return "County";
  return "Unknown";
}

function hoursAgo(dateStr) {
  if (!dateStr) return null;
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 3600000);
}

async function upsertMarketingMetric(leadId, fields) {
  const { error } = await sb
    .from("marketing_metrics")
    .upsert({ lead_id: leadId, ...fields }, { onConflict: "lead_id" });
  if (error) console.error("[marketing] upsert error:", error.message);
}

async function sendTelegram(text) {
  try {
    await bot.sendMessage(CHAT_ID, text, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("[marketing] Telegram error:", e.message);
    // retry without markdown
    try { await bot.sendMessage(CHAT_ID, text.replace(/[*_`]/g, "")); } catch {}
  }
}

// ── Part 1: Analyze new lead with Llama ──────────────────────────────────────

async function analyzeNewLead(lead) {
  const {
    id, name, address, phone, source, tags = [],
    county, leadAgeHours, motivation, timeline, askingPrice,
  } = lead;

  const systemPrompt = `You are Jarvis, Chris Lovera's wholesale real estate AI.
Chris buys distressed properties in FL for cash, typically 60-70% ARV minus repairs.
His target markets: Orange, Osceola, Seminole counties in Orlando FL.
He uses AI caller David to qualify leads. Speed-to-lead is critical — call within 5 minutes.`;

  const userMsg = `Analyze this new Speed To Lead inbound lead and rate it 1-10.

Lead: ${name || "Unknown"}
Address: ${address || "N/A"}
Phone: ${phone || "N/A"}
Source: ${source || "Unknown"}
County: ${county || "Unknown"}
Age: ${leadAgeHours !== null ? `${leadAgeHours} hours old` : "Just arrived"}
Motivation: ${motivation || "Not stated"}
Timeline: ${timeline || "Not stated"}
Asking Price: ${askingPrice || "Not stated"}
Tags: ${tags.join(", ") || "none"}

Give me EXACTLY this format (no extra text):
SCORE: [1-10]
OPENING LINE: [specific opening line based on their motivation — 1 sentence]
BEST TIME TO CALL: [time recommendation for this area/lead type]
WATCH OUT: [one sentence on seller type risk]
PRIORITY: [CALL NOW / CALL TODAY / CALL THIS WEEK]`;

  try {
    const res = await aiChat({
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
      max_tokens: 300,
    });
    return parseLeadAnalysis(res.text);
  } catch (e) {
    console.error("[marketing] Llama analysis error:", e.message);
    return null;
  }
}

function parseLeadAnalysis(text) {
  const score    = (text.match(/SCORE:\s*(\d+)/i)    || [])[1] || "?";
  const opening  = (text.match(/OPENING LINE:\s*(.+)/i) || [])[1]?.trim() || "Hey, we received your info — do you still need a cash offer?";
  const bestTime = (text.match(/BEST TIME TO CALL:\s*(.+)/i) || [])[1]?.trim() || "9am-12pm EST";
  const watchOut = (text.match(/WATCH OUT:\s*(.+)/i) || [])[1]?.trim() || "Verify motivation is genuine.";
  const priority = (text.match(/PRIORITY:\s*(.+)/i)  || [])[1]?.trim() || "CALL TODAY";
  return { score: parseInt(score) || 5, opening, bestTime, watchOut, priority };
}

async function handleNewLead(payload) {
  // Normalize GHL webhook payload (ContactCreate or custom)
  const contact     = payload.contact || payload;
  const customFields = payload.customFields || payload.custom_fields || [];

  const getField = (keys) => {
    for (const key of keys) {
      const f = customFields.find(f => (f.name || f.key || "").toLowerCase().includes(key));
      if (f) return f.fieldValue || f.value || "";
    }
    return "";
  };

  const leadId    = contact.id || contact.contactId || `ghl_${Date.now()}`;
  const name      = contact.name || `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Unknown";
  const address   = contact.address1 || contact.address || getField(["address"]);
  const phone     = contact.phone || contact.phoneRaw || "";
  const source    = contact.source || contact.leadSource || "";
  const tags      = contact.tags || [];
  const createdAt = contact.dateAdded || contact.createdAt || new Date().toISOString();
  const county    = detectCounty(address + " " + (contact.city || "") + " " + (contact.state || ""));
  const srcLabel  = extractSource(tags, source);
  const ageHours  = hoursAgo(createdAt);

  const motivation  = getField(["motivation", "why"]);
  const timeline    = getField(["timeline", "timeframe"]);
  const askingPrice = getField(["asking", "price"]);

  const lead = { id: leadId, name, address, phone, source: srcLabel, tags, county, leadAgeHours: ageHours, motivation, timeline, askingPrice };

  console.log(`[marketing] New lead: ${name} | ${srcLabel} | ${county} | ${ageHours}h old`);

  // Insert into marketing_metrics
  await upsertMarketingMetric(leadId, {
    source: srcLabel,
    county,
    lead_age_hours: ageHours,
    cost: 0, // will be updated when Chris records spend
    contacted: false,
    qualified: false,
    appointment_set: false,
    deal_closed: false,
    revenue: 0,
    notes: `${name} | ${address} | ${phone}`,
  });

  // Analyze with Llama
  const analysis = await analyzeNewLead(lead);
  if (!analysis) {
    await sendTelegram(`⚡ *NEW LEAD* — ${name}\n📍 ${address}\n📞 ${phone}\n🏷 ${srcLabel} | ${county}\n⏱ ${ageHours !== null ? `${ageHours}h old` : "Just arrived"}\n\n_Analysis unavailable — call now_`);
    return;
  }

  const scoreEmoji = analysis.score >= 8 ? "🔥" : analysis.score >= 6 ? "🟡" : "🔵";
  const priorityEmoji = analysis.priority === "CALL NOW" ? "🚨" : analysis.priority === "CALL TODAY" ? "📞" : "📋";

  const msg = `${priorityEmoji} *NEW SPEED TO LEAD — ${analysis.priority}*

👤 *${name}*
📍 ${address || "N/A"}
📞 ${phone || "N/A"}
🏷 ${srcLabel} · ${county} County
⏱ ${ageHours !== null ? `${ageHours}h old` : "Just arrived"}

${scoreEmoji} *Quality Score: ${analysis.score}/10*

💬 *Opening Line:*
_"${analysis.opening}"_

🕐 *Best Time to Call:* ${analysis.bestTime}
⚠️ *Watch Out:* ${analysis.watchOut}`;

  await sendTelegram(msg);
  console.log(`[marketing] Sent lead card — score ${analysis.score}/10`);
}

// ── Part 5: Daily 7am Briefing ────────────────────────────────────────────────

async function sendDailyBriefing() {
  console.log("[marketing] Generating daily briefing...");

  // Fetch overnight leads (last 12 hours)
  const since = new Date(Date.now() - 12 * 3600000).toISOString();
  const { data: newLeads } = await sb
    .from("marketing_metrics")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  // Fetch this month's metrics
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const { data: monthMetrics } = await sb
    .from("marketing_metrics")
    .select("*")
    .gte("created_at", monthStart.toISOString());

  const totalLeads    = monthMetrics?.length || 0;
  const totalSpend    = monthMetrics?.reduce((s, r) => s + (r.cost || 0), 0) || 0;
  const contacted     = monthMetrics?.filter(r => r.contacted).length || 0;
  const qualified     = monthMetrics?.filter(r => r.qualified).length || 0;
  const appts         = monthMetrics?.filter(r => r.appointment_set).length || 0;
  const deals         = monthMetrics?.filter(r => r.deal_closed).length || 0;
  const revenue       = monthMetrics?.reduce((s, r) => s + (r.revenue || 0), 0) || 0;
  const roi           = totalSpend > 0 ? Math.round(((revenue - totalSpend) / totalSpend) * 100) : 0;

  const newLeadsSummary = (newLeads || []).slice(0, 5).map(l =>
    `• ${l.notes?.split("|")[0]?.trim() || "Lead"} — ${l.source || "Unknown"} (${l.county || "?"})`
  ).join("\n");

  const systemPrompt = `You are Jarvis, Chris Lovera's wholesale real estate AI chief of staff.
Be direct, tactical, and specific. Chris is an active investor in Orlando FL targeting 4 deals/month at $30K total.`;

  const userMsg = `Generate Chris's daily morning briefing. Use this live data:

OVERNIGHT LEADS (${newLeads?.length || 0} new):
${newLeadsSummary || "None overnight"}

MONTH-TO-DATE METRICS:
- Total leads: ${totalLeads}
- Total spend: $${totalSpend.toFixed(0)}
- Contacted: ${contacted} (${totalLeads ? Math.round(contacted/totalLeads*100) : 0}%)
- Qualified: ${qualified}
- Appointments: ${appts}
- Deals closed: ${deals}
- Revenue: $${revenue.toFixed(0)}
- ROI: ${roi}%

Format the briefing with:
1. "Good morning Chris — [date]" header
2. NEW LEADS section: score and prioritize overnight leads, tell him which to call first and why
3. MONTH STATUS: spend + ROI summary in 2 sentences
4. TODAY'S MOVE: one specific action to take today
5. INSIGHT: one data-driven observation about what's working or not

Keep it under 350 words. Be a real business partner, not generic.`;

  try {
    const res = await aiChat({
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
      max_tokens: 600,
    });
    await sendTelegram(`☀️ *DAILY BRIEFING*\n\n${res.text}`);
    console.log("[marketing] Daily briefing sent");
  } catch (e) {
    console.error("[marketing] Daily briefing error:", e.message);
  }
}

// ── Part 6: Weekly Sunday Report ─────────────────────────────────────────────

async function sendWeeklyReport() {
  console.log("[marketing] Generating weekly ROI report...");

  const weekStart = new Date(Date.now() - 7 * 86400000).toISOString();
  const prevWeekStart = new Date(Date.now() - 14 * 86400000).toISOString();

  const [{ data: weekData }, { data: prevData }] = await Promise.all([
    sb.from("marketing_metrics").select("*").gte("created_at", weekStart),
    sb.from("marketing_metrics").select("*").gte("created_at", prevWeekStart).lt("created_at", weekStart),
  ]);

  const calc = (data) => ({
    leads:    data?.length || 0,
    spend:    data?.reduce((s, r) => s + (r.cost || 0), 0) || 0,
    contacted: data?.filter(r => r.contacted).length || 0,
    qualified: data?.filter(r => r.qualified).length || 0,
    appts:    data?.filter(r => r.appointment_set).length || 0,
    deals:    data?.filter(r => r.deal_closed).length || 0,
    revenue:  data?.reduce((s, r) => s + (r.revenue || 0), 0) || 0,
  });

  const cur  = calc(weekData);
  const prev = calc(prevData);

  // Source breakdown this week
  const srcMap = {};
  for (const r of weekData || []) {
    const s = r.source || "Unknown";
    if (!srcMap[s]) srcMap[s] = { leads: 0, qualified: 0, deals: 0, spend: 0 };
    srcMap[s].leads++;
    if (r.qualified) srcMap[s].qualified++;
    if (r.deal_closed) srcMap[s].deals++;
    srcMap[s].spend += r.cost || 0;
  }

  const srcSummary = Object.entries(srcMap)
    .sort((a, b) => b[1].leads - a[1].leads)
    .map(([src, d]) => `${src}: ${d.leads} leads, ${d.qualified} qualified, ${d.deals} deals, $${d.spend.toFixed(0)} spent`)
    .join("\n");

  // County breakdown
  const countyMap = {};
  for (const r of weekData || []) {
    const c = r.county || "Unknown";
    if (!countyMap[c]) countyMap[c] = { leads: 0, qualified: 0, deals: 0 };
    countyMap[c].leads++;
    if (r.qualified) countyMap[c].qualified++;
    if (r.deal_closed) countyMap[c].deals++;
  }

  const countySummary = Object.entries(countyMap)
    .sort((a, b) => b[1].leads - a[1].leads)
    .map(([c, d]) => `${c}: ${d.leads} leads, ${d.qualified} qualified, ${d.deals} deals`)
    .join("\n");

  const curROI  = cur.spend > 0 ? Math.round(((cur.revenue - cur.spend) / cur.spend) * 100) : 0;
  const prevROI = prev.spend > 0 ? Math.round(((prev.revenue - prev.spend) / prev.spend) * 100) : 0;

  const systemPrompt = `You are Jarvis, Chris Lovera's wholesale real estate AI. Generate a sharp weekly report with real analysis and specific recommendations. Be a business partner, not a bot.`;

  const userMsg = `Generate Chris's weekly marketing ROI report. Use this data:

THIS WEEK:
- Leads purchased: ${cur.leads}
- Total spent: $${cur.spend.toFixed(0)}
- Contacted: ${cur.contacted}
- Qualified: ${cur.qualified}
- Appointments: ${cur.appts}
- Deals closed: ${cur.deals}
- Revenue generated: $${cur.revenue.toFixed(0)}
- ROI: ${curROI}%

LAST WEEK (comparison):
- Leads: ${prev.leads}, Spend: $${prev.spend.toFixed(0)}, Deals: ${prev.deals}, ROI: ${prevROI}%

SOURCE BREAKDOWN:
${srcSummary || "No source data yet"}

COUNTY BREAKDOWN:
${countySummary || "No county data yet"}

Structure the report:
1. Weekly scorecard header with key numbers
2. vs last week comparison (better/worse on each metric)
3. Best performing lead types and why (specific)
4. Worst performing lead types and why
5. Budget recommendation for next week (specific dollar amounts and sources)
6. Projected deals next week if trends continue
7. One strategic recommendation

Max 500 words. Be direct and data-driven.`;

  try {
    const res = await aiChat({
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
      max_tokens: 800,
    });
    await sendTelegram(`📊 *WEEKLY ROI REPORT*\n\n${res.text}`);
    console.log("[marketing] Weekly report sent");
  } catch (e) {
    console.error("[marketing] Weekly report error:", e.message);
  }
}

// ── Part 7: Coupon Club Optimizer (runs after 30+ leads) ─────────────────────

async function runCouponClubOptimizer() {
  const { data: leads, count } = await sb
    .from("marketing_metrics")
    .select("*", { count: "exact" });

  if (!count || count < 30) {
    console.log(`[marketing] Coupon Club optimizer: only ${count} leads, need 30`);
    return;
  }

  // Analyze by age bucket
  const ageBuckets = { "<6h": [], "6-24h": [], "24-48h": [], ">48h": [] };
  for (const r of leads || []) {
    const age = r.lead_age_hours;
    if (age == null) continue;
    if (age < 6)       ageBuckets["<6h"].push(r);
    else if (age < 24) ageBuckets["6-24h"].push(r);
    else if (age < 48) ageBuckets["24-48h"].push(r);
    else               ageBuckets[">48h"].push(r);
  }

  const bucketStats = Object.entries(ageBuckets).map(([bucket, rows]) => {
    const total     = rows.length;
    const qualified = rows.filter(r => r.qualified).length;
    const deals     = rows.filter(r => r.deal_closed).length;
    const convRate  = total > 0 ? Math.round(qualified / total * 100) : 0;
    return `${bucket}: ${total} leads, ${convRate}% qual rate, ${deals} deals`;
  }).join("\n");

  // Analyze by source × age combination
  const sourceAge = {};
  for (const r of leads || []) {
    const key = `${r.source || "Unknown"}_${r.lead_age_hours < 24 ? "fresh" : "stale"}`;
    if (!sourceAge[key]) sourceAge[key] = { leads: 0, qualified: 0, deals: 0, spend: 0 };
    sourceAge[key].leads++;
    if (r.qualified) sourceAge[key].qualified++;
    if (r.deal_closed) sourceAge[key].deals++;
    sourceAge[key].spend += r.cost || 0;
  }

  const sourceAgeSummary = Object.entries(sourceAge)
    .map(([k, d]) => {
      const cpl = d.qualified > 0 ? (d.spend / d.qualified).toFixed(0) : "N/A";
      return `${k}: ${d.leads} leads, ${d.qualified} qual, ${d.deals} deals, CPQ $${cpl}`;
    })
    .join("\n");

  const systemPrompt = `You are Jarvis, Chris's wholesale real estate AI. Analyze Coupon Club (PPL) lead data and give a specific buying recommendation.`;

  const userMsg = `Analyze ${count} Coupon Club leads and find the optimal buying strategy.

PERFORMANCE BY LEAD AGE:
${bucketStats}

PERFORMANCE BY SOURCE × FRESHNESS:
${sourceAgeSummary}

Give a specific, data-backed recommendation:
1. Which age of lead converts best → specific cutoff in hours
2. Which source × age combination has best ROI
3. Exact buying recommendation: "Buy leads under X hours from [source] in [county]. Skip leads over Y hours from [source]."
4. Estimated CPD (cost per deal) for optimal vs. worst segments
5. What filter changes to request from Speed To Lead

Be blunt and specific. No fluff.`;

  try {
    const res = await aiChat({
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
      max_tokens: 500,
    });
    await sendTelegram(`🎯 *COUPON CLUB OPTIMIZER* (${count} leads analyzed)\n\n${res.text}`);
    console.log("[marketing] Coupon Club optimizer sent");
  } catch (e) {
    console.error("[marketing] Optimizer error:", e.message);
  }
}

// ── Internal cron scheduler ───────────────────────────────────────────────────

function startCrons() {
  setInterval(async () => {
    const now = new Date();
    const estHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
    const estMin  = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getMinutes();
    const estDay  = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay(); // 0=Sun

    // 7:00am daily → morning briefing
    if (estHour === 7 && estMin < 2) {
      const flagFile = `/tmp/mktg_morning_${now.toLocaleDateString("en-US", { timeZone: "America/New_York" }).replace(/\//g, "-")}.flag`;
      const fs = require("fs");
      if (!fs.existsSync(flagFile)) {
        fs.writeFileSync(flagFile, "1");
        await sendDailyBriefing();
      }
    }

    // Sunday 6:00pm → weekly report
    if (estDay === 0 && estHour === 18 && estMin < 2) {
      const flagFile = `/tmp/mktg_weekly_${now.toISOString().slice(0,10)}.flag`;
      const fs = require("fs");
      if (!fs.existsSync(flagFile)) {
        fs.writeFileSync(flagFile, "1");
        await sendWeeklyReport();
      }
    }

    // Every Sunday 6:05pm → Coupon Club optimizer (after weekly report)
    if (estDay === 0 && estHour === 18 && estMin >= 5 && estMin < 7) {
      const flagFile = `/tmp/mktg_coupon_${now.toISOString().slice(0,10)}.flag`;
      const fs = require("fs");
      if (!fs.existsSync(flagFile)) {
        fs.writeFileSync(flagFile, "1");
        await runCouponClubOptimizer();
      }
    }

  }, 60 * 1000); // check every minute

  console.log("[marketing] Crons started (7am briefing, Sun 6pm weekly + optimizer)");
}

// ── Express webhook server ────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// GHL webhook: new Speed To Lead contact
app.post("/new-lead", async (req, res) => {
  res.sendStatus(200); // ACK immediately
  console.log("[marketing] GHL webhook received:", JSON.stringify(req.body).slice(0, 200));
  try {
    await handleNewLead(req.body);
  } catch (e) {
    console.error("[marketing] handleNewLead error:", e.message);
  }
});

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", service: "marketing-intel" }));

// Manual triggers (for testing)
app.post("/trigger/briefing", async (req, res) => {
  res.json({ ok: true });
  await sendDailyBriefing();
});

app.post("/trigger/weekly", async (req, res) => {
  res.json({ ok: true });
  await sendWeeklyReport();
});

app.post("/trigger/optimizer", async (req, res) => {
  res.json({ ok: true });
  await runCouponClubOptimizer();
});

// Update lead outcome from jarvis-caller or manually
app.post("/update-lead", async (req, res) => {
  const { leadId, contacted, qualified, appointmentSet, dealClosed, revenue, notes } = req.body;
  if (!leadId) return res.status(400).json({ error: "leadId required" });

  const fields = {};
  if (contacted      != null) fields.contacted       = contacted;
  if (qualified      != null) fields.qualified        = qualified;
  if (appointmentSet != null) fields.appointment_set  = appointmentSet;
  if (dealClosed     != null) fields.deal_closed      = dealClosed;
  if (revenue        != null) fields.revenue          = revenue;
  if (notes          != null) fields.notes            = notes;

  await upsertMarketingMetric(leadId, fields);
  res.json({ ok: true });
});

const PORT = process.env.MARKETING_PORT || 3005;
app.listen(PORT, () => {
  console.log(`[marketing] Server running on port ${PORT}`);
  console.log(`[marketing] GHL webhook URL: <your-tunnel>:${PORT}/new-lead`);
  startCrons();
});

module.exports = { handleNewLead, analyzeNewLead, sendDailyBriefing, sendWeeklyReport, runCouponClubOptimizer };
