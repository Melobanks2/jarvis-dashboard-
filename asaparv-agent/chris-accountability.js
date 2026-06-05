/**
 * chris-accountability.js — Weekly accountability system for Chris Lovera
 *
 * Proactively holds Chris accountable to his weekly targets every single day.
 * Runs as a persistent PM2 daemon at zero AI cost (Llama via ai-router).
 *
 * Weekly targets:
 *   Calls: 50 (10/day × 5 days)
 *   Contact rate: 50%
 *   Offers: 3/week
 *   Appointments: 2/week
 *   Deals: 1/week
 *
 * Features:
 *   - 8am daily morning briefing with top 3 leads + opening lines
 *   - Real-time metric tracking (daily_metrics table)
 *   - Contact rate alert if < 40%
 *   - 1pm follow-up enforcement
 *   - 48h stale lead alerts
 *   - Wednesday no-offer alert
 *   - Accountability escalation (2-day, 3-day streaks)
 *   - Sunday 7pm full weekly report with pitch scores
 *
 * Supabase DDL (run in dashboard):
 *   CREATE TABLE IF NOT EXISTS daily_metrics (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     date DATE UNIQUE,
 *     calls_made INTEGER DEFAULT 0,
 *     contacts INTEGER DEFAULT 0,
 *     qualified INTEGER DEFAULT 0,
 *     offers_made INTEGER DEFAULT 0,
 *     appointments_set INTEGER DEFAULT 0,
 *     deals_closed INTEGER DEFAULT 0,
 *     revenue NUMERIC DEFAULT 0,
 *     refunds_requested INTEGER DEFAULT 0,
 *     created_at TIMESTAMPTZ DEFAULT now()
 *   );
 *   CREATE TABLE IF NOT EXISTS offers_log (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     contact_name TEXT,
 *     address TEXT,
 *     offer_amount NUMERIC,
 *     arv NUMERIC,
 *     rehab_estimate NUMERIC,
 *     seller_response TEXT,
 *     outcome TEXT DEFAULT 'pending',
 *     notes TEXT,
 *     created_at TIMESTAMPTZ DEFAULT now()
 *   );
 *   CREATE TABLE IF NOT EXISTS weekly_metrics (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     week_start DATE UNIQUE,
 *     total_calls INTEGER DEFAULT 0,
 *     total_contacts INTEGER DEFAULT 0,
 *     contact_rate NUMERIC DEFAULT 0,
 *     qualification_rate NUMERIC DEFAULT 0,
 *     offers_made INTEGER DEFAULT 0,
 *     appointments_set INTEGER DEFAULT 0,
 *     deals_closed INTEGER DEFAULT 0,
 *     revenue NUMERIC DEFAULT 0,
 *     avg_pitch_score NUMERIC DEFAULT 0,
 *     best_lead_source TEXT,
 *     best_county TEXT,
 *     created_at TIMESTAMPTZ DEFAULT now()
 *   );
 *
 * Exports: logCallMetric(), logOffer(), getThisWeekMetrics()
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { aiChat }       = require("./ai-router");
const TelegramBot      = require("node-telegram-bot-api");
const fs               = require("fs");

const sb      = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot     = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || "8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0", { polling: false });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

const GHL_TOKEN    = process.env.GHL_API_TOKEN || "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_PIPELINE = "o4kqU2y8DYjA73aKUxNu";

const TARGETS = {
  calls:        50,
  contactRate:  0.50,
  offers:       3,
  appointments: 2,
  deals:        1,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendTelegram(text) {
  try {
    await bot.sendMessage(CHAT_ID, text, { parse_mode: "Markdown" });
  } catch {
    try { await bot.sendMessage(CHAT_ID, text.replace(/[*_`[\]()~>#+=|{}.!-]/g, "\\$&")); } catch {}
  }
}

function getEST() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function isoDateEST(d) {
  const est = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${est.getFullYear()}-${String(est.getMonth() + 1).padStart(2, "0")}-${String(est.getDate()).padStart(2, "0")}`;
}

function getMondayOfWeek(d) {
  const day  = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(d);
  mon.setDate(d.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function flag(name)    { return `/tmp/acct_${name}.flag`; }
function hasFlag(name) { return fs.existsSync(flag(name)); }
function setFlag(name) { fs.writeFileSync(flag(name), Date.now().toString()); }

function pctIcon(val, tgt) { return val >= tgt ? "✅" : val >= tgt * 0.7 ? "⚠️" : "❌"; }

// ── GHL ───────────────────────────────────────────────────────────────────────

async function ghlFetch(path) {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    headers: {
      Authorization:  `Bearer ${GHL_TOKEN}`,
      Version:        "2021-07-28",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`GHL ${res.status} ${path}`);
  return res.json();
}

let _stageMap = null;
async function getStageMap() {
  if (_stageMap) return _stageMap;
  try {
    const data = await ghlFetch(`/opportunities/pipelines/${GHL_PIPELINE}?locationId=${GHL_LOCATION}`);
    _stageMap  = Object.fromEntries((data.stages || []).map(s => [s.name, s.id]));
  } catch { _stageMap = {}; }
  return _stageMap;
}

async function getTopLeads(limit = 3) {
  try {
    const stages  = await getStageMap();
    const priority = ["Hot Follow Up", "Decision Pending", "Contract Sent", "Warm Follow Up", "New Lead", "Attempt 1"];
    const leads   = [];

    for (const stageName of priority) {
      if (leads.length >= limit) break;
      const stageId = stages[stageName];
      if (!stageId) continue;

      const data = await ghlFetch(
        `/opportunities/search?location_id=${GHL_LOCATION}&pipeline_id=${GHL_PIPELINE}&pipeline_stage_id=${stageId}&limit=5`
      );
      for (const opp of data.opportunities || []) {
        if (leads.length >= limit) break;
        leads.push({
          name:    opp.contact?.name || "Unknown",
          address: opp.name || opp.contact?.address1 || "Unknown address",
          phone:   opp.contact?.phone || "",
          stage:   stageName,
          emoji:   stageName.includes("Hot") || stageName.includes("Decision") ? "🔥"
                 : stageName.includes("Warm") || stageName.includes("Contract") ? "⚡"
                 : "🔵",
        });
      }
    }
    return leads;
  } catch (e) {
    console.error("[accountability] getTopLeads:", e.message);
    return [];
  }
}

// ── Daily metrics ─────────────────────────────────────────────────────────────

async function getTodayMetrics() {
  const today = isoDateEST(new Date());
  const { data } = await sb.from("daily_metrics").select("*").eq("date", today).maybeSingle();
  if (data) return data;
  const { data: created } = await sb.from("daily_metrics").insert({ date: today }).select().single().catch(() => ({ data: null }));
  return created || { date: today, calls_made: 0, contacts: 0, qualified: 0, offers_made: 0, appointments_set: 0, deals_closed: 0, revenue: 0 };
}

async function incrementDailyMetrics(increments) {
  const today = isoDateEST(new Date());
  const { data: existing } = await sb.from("daily_metrics").select("*").eq("date", today).maybeSingle();

  if (existing) {
    const update = {};
    for (const [k, v] of Object.entries(increments)) {
      update[k] = (existing[k] || 0) + v;
    }
    const { data } = await sb.from("daily_metrics").update(update).eq("date", today).select().single();
    return data;
  } else {
    const { data } = await sb.from("daily_metrics").insert({ date: today, ...increments }).select().single().catch(() => ({ data: null }));
    return data;
  }
}

// ── Week metrics ──────────────────────────────────────────────────────────────

async function getThisWeekMetrics() {
  const est       = getEST();
  const monday    = getMondayOfWeek(est);
  const weekStart = isoDateEST(monday);

  const { data: rows } = await sb.from("daily_metrics").select("*").gte("date", weekStart);
  const totals = (rows || []).reduce((acc, r) => {
    acc.calls_made       += r.calls_made       || 0;
    acc.contacts         += r.contacts         || 0;
    acc.qualified        += r.qualified        || 0;
    acc.offers_made      += r.offers_made      || 0;
    acc.appointments_set += r.appointments_set || 0;
    acc.deals_closed     += r.deals_closed     || 0;
    acc.revenue          += r.revenue          || 0;
    return acc;
  }, { calls_made: 0, contacts: 0, qualified: 0, offers_made: 0, appointments_set: 0, deals_closed: 0, revenue: 0 });

  totals.contactRate  = totals.calls_made > 0 ? totals.contacts / totals.calls_made : 0;
  totals.qualifRate   = totals.contacts   > 0 ? totals.qualified / totals.contacts  : 0;
  totals.weekStart    = weekStart;

  return totals;
}

// ── 8am morning briefing ──────────────────────────────────────────────────────

async function sendMorningBriefing() {
  console.log("[accountability] Sending 8am morning briefing...");

  const [metrics, leads] = await Promise.all([getThisWeekMetrics(), getTopLeads(3)]);

  const est     = getEST();
  const dayNum  = est.getDay(); // 1=Mon ... 5=Fri
  const daysLeft = Math.max(1, 5 - (dayNum === 0 ? 5 : dayNum) + 1);
  const callsPerDay = Math.ceil(Math.max(0, TARGETS.calls - metrics.calls_made) / daysLeft);

  const cRate = Math.round(metrics.contactRate * 100);

  // AI opening lines for top leads
  let openingLines = "";
  if (leads.length > 0) {
    try {
      const leadInfo = leads.map((l, i) => `${i + 1}. ${l.name} | ${l.stage} | ${l.address}`).join("\n");
      const res = await aiChat({
        system: "You are a wholesale real estate acquisitions coach. Generate brief, natural cold call openers. 1-2 sentences max, casual tone, no corporate speak.",
        messages: [{ role: "user", content: `Write one suggested opening line for each lead (address them by first name):\n${leadInfo}\n\nFormat exactly:\n1. "opening line"\n2. "opening line"\n3. "opening line"` }],
        max_tokens: 200,
      });
      openingLines = res.text.trim();
    } catch {}
  }

  // AI daily focus tip
  let focusTip = "";
  try {
    const behind = [];
    if (metrics.calls_made < (TARGETS.calls / 5) * (dayNum - 1)) behind.push(`calls (${metrics.calls_made}/${TARGETS.calls})`);
    if (metrics.contactRate < TARGETS.contactRate) behind.push(`contact rate (${cRate}%)`);
    if (metrics.offers_made < 1 && dayNum >= 3) behind.push(`offers (${metrics.offers_made}/${TARGETS.offers})`);
    const focus = behind.length > 0 ? behind.join(" and ") : "closing more conversations";

    const res = await aiChat({
      system: "You are a wholesale real estate accountability coach. Give ONE specific, tactical tip. Max 2 sentences. Be direct.",
      messages: [{ role: "user", content: `Chris is behind on ${focus}. Give him one specific thing to do differently today.` }],
      max_tokens: 80,
    });
    focusTip = res.text.trim();
  } catch { focusTip = "Focus on getting to a conversation fast — skip the pitch until they engage."; }

  const leadSection = leads.length > 0
    ? `\n🎯 *TOP ${leads.length} LEADS TO CALL TODAY*\n─────────────────────────────\n` +
      leads.map((l, i) => `${i + 1}. ${l.emoji} *${l.name}* — ${l.address}`).join("\n") +
      (openingLines ? `\n\n*Suggested openings:*\n${openingLines}` : "")
    : "\n_(No GHL leads pulled — pipeline may be empty)_";

  const msg =
`🌅 Good morning Chris! Here's where you stand.

📊 *WEEK PROGRESS* (${metrics.weekStart})
─────────────────────────────
📞 Calls: *${metrics.calls_made}/${TARGETS.calls}* ${pctIcon(metrics.calls_made, TARGETS.calls)}
🗣 Contact rate: *${cRate}%/${Math.round(TARGETS.contactRate * 100)}%* ${pctIcon(cRate, Math.round(TARGETS.contactRate * 100))}
💰 Offers: *${metrics.offers_made}/${TARGETS.offers}* ${pctIcon(metrics.offers_made, TARGETS.offers)}
📅 Appointments: *${metrics.appointments_set}/${TARGETS.appointments}* ${pctIcon(metrics.appointments_set, TARGETS.appointments)}

📌 You need *${callsPerDay} calls today* to stay on track.
${leadSection}

💡 *ONE THING TO FOCUS ON TODAY*
─────────────────────────────
${focusTip}

Go make your calls. Let's get it. 📞`;

  await sendTelegram(msg);
}

// ── 1pm follow-up enforcement ─────────────────────────────────────────────────

async function sendFollowUpReminder() {
  console.log("[accountability] Sending 1pm follow-up reminder...");

  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Hot/warm leads not followed up in 48h
  const { data: stale } = await sb.from("jarvis_calls")
    .select("contact_name, address, stage_after, called_at")
    .in("stage_after", ["Hot Follow Up", "Decision Pending", "Warm Follow Up"])
    .lt("called_at", cutoff48h)
    .order("called_at", { ascending: true })
    .limit(10);

  // Leads followed up in last 48h (to filter out of stale)
  const { data: recent } = await sb.from("jarvis_calls")
    .select("contact_name")
    .in("stage_after", ["Hot Follow Up", "Decision Pending", "Warm Follow Up"])
    .gte("called_at", cutoff48h);

  const recentNames = new Set((recent || []).map(c => c.contact_name?.toLowerCase()));
  const needsFollowUp = (stale || []).filter(l => !recentNames.has(l.contact_name?.toLowerCase())).slice(0, 5);

  const today = await getTodayMetrics();

  let msg = `📋 *1pm FOLLOW-UP CHECK*\n─────────────────────────────\n`;

  if (needsFollowUp.length > 0) {
    msg += `These leads need a call today — sorted by priority:\n\n`;
    for (const lead of needsFollowUp) {
      const daysSince = Math.floor((Date.now() - new Date(lead.called_at).getTime()) / 86400000);
      const emoji = lead.stage_after?.includes("Hot") || lead.stage_after?.includes("Decision") ? "🔥"
                  : lead.stage_after?.includes("Warm") ? "⚡" : "🔵";
      msg += `${emoji} *${lead.contact_name}* — ${lead.address}\n_Last contact: ${daysSince}d ago_\n\n`;
    }
  } else {
    // Fallback to GHL priority leads
    const leads = await getTopLeads(3);
    if (leads.length > 0) {
      msg += `Priority leads for this afternoon:\n\n`;
      for (const l of leads) {
        msg += `${l.emoji} *${l.name}* — ${l.address} (${l.stage})\n`;
      }
      msg += "\n";
    } else {
      msg += "No urgent follow-ups. Keep adding leads to the pipeline.\n";
    }
  }

  msg += `\n📞 Calls logged today: *${today.calls_made || 0}*`;
  await sendTelegram(msg);
}

// ── 48h stale lead alerts ─────────────────────────────────────────────────────

async function checkStaleLeads() {
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: stale } = await sb.from("jarvis_calls")
    .select("contact_name, address, stage_after, called_at")
    .in("stage_after", ["Hot Follow Up", "Decision Pending"])
    .lt("called_at", cutoff48h)
    .order("called_at", { ascending: true })
    .limit(5);

  for (const lead of stale || []) {
    const daysSince = Math.floor((Date.now() - new Date(lead.called_at).getTime()) / 86400000);
    const flagKey   = `stale_${(lead.contact_name || "").replace(/\s+/g, "_")}_${Math.floor(Date.now() / 86400000)}`;
    if (hasFlag(flagKey)) continue;
    setFlag(flagKey);

    await sendTelegram(
      `⚠️ *GOING COLD — ${lead.contact_name}*\n\n` +
      `You haven't followed up with *${lead.contact_name}* in *${daysSince} days*.\n` +
      `📍 ${lead.address} | Stage: ${lead.stage_after}\n\n` +
      `They are going cold. Call them *right now*.`
    );
  }
}

// ── Wednesday no-offer alert ──────────────────────────────────────────────────

async function checkWednesdayOffer() {
  const est  = getEST();
  if (est.getDay() !== 3 || est.getHours() !== 10) return;

  const flagKey = `wed_offer_${isoDateEST(est)}`;
  if (hasFlag(flagKey)) return;

  const metrics = await getThisWeekMetrics();
  if (metrics.offers_made > 0) return;

  setFlag(flagKey);

  let topLead = "your hottest lead";
  try {
    const leads = await getTopLeads(1);
    if (leads[0]) topLead = `*${leads[0].name}* — ${leads[0].address}`;
  } catch {}

  await sendTelegram(
    `⚠️ *WEDNESDAY OFFER CHECK*\n\n` +
    `It's Wednesday and you have *0 offers* logged this week.\n\n` +
    `You need *3 offers per week* to hit your deal goal.\n` +
    `Halfway through the week with zero offers puts you at serious risk.\n\n` +
    `Closest to offer stage right now: ${topLead}\n\n` +
    `Which leads are ready for a number? Let's get offers out today.`
  );
}

// ── Contact rate alert (called after each logged call) ────────────────────────

async function checkContactRate() {
  const metrics = await getTodayMetrics();
  if ((metrics.calls_made || 0) < 5) return; // Need min sample size

  const rate = metrics.calls_made > 0 ? (metrics.contacts || 0) / metrics.calls_made : 0;
  if (rate >= 0.40) return;

  const flagKey = `low_rate_${isoDateEST(new Date())}_${Math.floor(Date.now() / 3600000)}`;
  if (hasFlag(flagKey)) return;
  setFlag(flagKey);

  await sendTelegram(
    `📉 *LOW CONTACT RATE — ${Math.round(rate * 100)}%*\n\n` +
    `Target is 50%. You're at ${Math.round(rate * 100)}% after ${metrics.calls_made} calls.\n\n` +
    `Try:\n` +
    `• Call 10–11am or 5–7pm — peak answer times\n` +
    `• Skip voicemails, move to next lead\n` +
    `• Verify numbers aren't disconnected\n` +
    `• Try a different area code if blocked`
  );
}

// ── Lead quality mini-report (every 10 calls) ─────────────────────────────────

async function checkLeadQuality() {
  const metrics = await getThisWeekMetrics();
  if (metrics.calls_made < 10 || metrics.calls_made % 10 !== 0) return;

  const flagKey = `quality_${isoDateEST(new Date())}_${metrics.calls_made}`;
  if (hasFlag(flagKey)) return;
  setFlag(flagKey);

  const weekStart = getMondayOfWeek(getEST());
  const { data: calls } = await sb.from("jarvis_calls")
    .select("stage_after, source, called_at")
    .gte("called_at", weekStart.toISOString())
    .not("stage_after", "is", null);

  if (!calls || calls.length < 5) return;

  // Group by source
  const bySource = {};
  for (const c of calls) {
    const src = c.source || "alpha-leads";
    if (!bySource[src]) bySource[src] = { calls: 0, contacts: 0, hot: 0 };
    bySource[src].calls++;
    if (!["Attempt 1", "Attempt 2", "Attempt 3", "Attempt 4", "Attempt 5", "Attempt 6+ Unresponsive"].includes(c.stage_after || "")) {
      bySource[src].contacts++;
    }
    if (["Hot Follow Up", "Decision Pending", "Contract Sent"].includes(c.stage_after || "")) {
      bySource[src].hot++;
    }
  }

  const lines = Object.entries(bySource)
    .sort((a, b) => (b[1].hot / Math.max(1, b[1].calls)) - (a[1].hot / Math.max(1, a[1].calls)))
    .slice(0, 4)
    .map(([src, d]) => `• *${src}*: ${d.calls} calls | ${Math.round(d.contacts / d.calls * 100)}% contact | ${d.hot} hot leads`);

  await sendTelegram(
    `📊 *LEAD QUALITY REPORT* (${metrics.calls_made} calls this week)\n\n` +
    `*By Source:*\n${lines.join("\n") || "Need more calls to show data."}\n\n` +
    `💡 Focus next calls on your highest-converting source.`
  );
}

// ── Consecutive days accountability escalation ────────────────────────────────

async function checkConsecutiveDays() {
  const est = getEST();
  const flagKey = `consec_${isoDateEST(est)}`;
  if (hasFlag(flagKey)) return;
  setFlag(flagKey);

  // Get the last 3 weekdays (not including today)
  const weekdays = [];
  let d = new Date(est);
  while (weekdays.length < 3) {
    d = new Date(d.getTime() - 86400000);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) weekdays.push(isoDateEST(d));
  }

  const { data: rows } = await sb.from("daily_metrics").select("date, calls_made").in("date", weekdays);
  const rowMap = Object.fromEntries((rows || []).map(r => [r.date, r.calls_made || 0]));

  // Count consecutive missed days (most recent first)
  let consecutive = 0;
  for (const day of weekdays) {
    if ((rowMap[day] || 0) === 0) consecutive++;
    else break;
  }

  if (consecutive < 2) return;

  const daysLeft = new Date(est.getFullYear(), est.getMonth() + 1, 0).getDate() - est.getDate();
  const callsNeededToday = Math.ceil(120 / Math.max(1, daysLeft));

  let topLead = "";
  try {
    const leads = await getTopLeads(1);
    if (leads[0]) topLead = `\n\nYour #1 priority right now: *${leads[0].name}* — ${leads[0].address}. Call them first.`;
  } catch {}

  if (consecutive === 2) {
    await sendTelegram(
      `🚨 *MISSED 2 DAYS IN A ROW*\n\n` +
      `Chris, you've missed your calling target 2 days in a row.\n\n` +
      `At this pace you will *not close a deal this week*.\n` +
      `You need *${Math.round(TARGETS.calls / 5 * 2)} calls today* to get back on track.` +
      topLead
    );
  } else {
    await sendTelegram(
      `🚨🚨 *DAY ${consecutive} — NO CALLS*\n\n` +
      `This is day ${consecutive} with no calls logged.\n` +
      `Your *monthly deal goal is at serious risk*.\n\n` +
      `The only way to fix this is to pick up the phone right now.\n` +
      `You need *${callsNeededToday} calls today* to start recovering.` +
      topLead +
      `\n\nSay "top leads" and I'll pull your priority list.`
    );
  }
}

// ── Sunday 7pm full weekly report ────────────────────────────────────────────

async function sendWeeklyReport() {
  console.log("[accountability] Generating Sunday weekly report...");

  const metrics   = await getThisWeekMetrics();
  const est       = getEST();
  const weekStart = getMondayOfWeek(est);

  // Pitch scores from chris_coaching_log
  const { data: coachLogs } = await sb.from("chris_coaching_log")
    .select("*")
    .gte("call_date", isoDateEST(weekStart))
    .catch(() => ({ data: [] }));

  const logs = coachLogs || [];
  const avg  = (key) => logs.length > 0
    ? +(logs.reduce((s, c) => s + (c[key] || 0), 0) / logs.length).toFixed(1)
    : null;

  // Map to 5 pitch areas
  const scores = {
    "Opening & Rapport":     avg("assertiveness") !== null && avg("empathy") !== null
                               ? +((avg("assertiveness") + avg("empathy")) / 2).toFixed(1) : null,
    "Motivation Digging":    avg("motivation_digging"),
    "Objection Handling":    avg("objection_handling"),
    "Offer Presentation":    avg("overall"),
    "Close Attempt":         avg("assertiveness"),
  };

  const hasScores = Object.values(scores).some(v => v !== null);

  // Offers this week
  const { data: offers } = await sb.from("offers_log")
    .select("*")
    .gte("created_at", weekStart.toISOString())
    .catch(() => ({ data: [] }));

  const cRate = Math.round(metrics.contactRate * 100);
  const qRate = Math.round(metrics.qualifRate  * 100);

  // AI analysis
  let aiInsight = "";
  try {
    const res = await aiChat({
      system: "You are a wholesale real estate accountability coach. Be direct, tactical, brief. Max 4 sentences total.",
      messages: [{
        role: "user",
        content:
          `Chris's week: ${metrics.calls_made} calls (target 50), ${cRate}% contact rate (target 50%), ` +
          `${metrics.offers_made} offers (target 3), ${metrics.appointments_set} appts (target 2), ` +
          `${metrics.deals_closed} deals. Avg pitch score: ${scores["Offer Presentation"] || "N/A"}/10.\n\n` +
          `Give: 1. Biggest win this week. 2. Biggest area to improve. 3. Specific action plan for next week.`,
      }],
      max_tokens: 250,
    });
    aiInsight = res.text.trim();
  } catch { aiInsight = "Keep logging every call so I can spot patterns and coach you better."; }

  const offerSection = (offers || []).length > 0
    ? (offers || []).map(o => `• $${(o.offer_amount || 0).toLocaleString()} — ${o.contact_name || "?"} (${o.outcome || "pending"})`).join("\n")
    : "No offers logged this week.";

  const scoreSection = hasScores
    ? `\n*PITCH SCORES (avg)*\n` +
      Object.entries(scores)
        .map(([label, val]) => val !== null ? `${label}: *${val}/10*` : null)
        .filter(Boolean).join("\n") + "\n"
    : "";

  // Projected deals
  const convRate    = metrics.calls_made > 0 ? metrics.deals_closed / metrics.calls_made : 0;
  const projDeals   = convRate > 0 ? `~${(convRate * TARGETS.calls).toFixed(1)} deals/wk at current rate` : "Need more data";

  const msg =
`📊 *WEEKLY REPORT — ${metrics.weekStart}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*METRICS*
📞 Calls: *${metrics.calls_made}/${TARGETS.calls}* ${pctIcon(metrics.calls_made, TARGETS.calls)}
🗣 Contact rate: *${cRate}%/50%* ${pctIcon(cRate, 50)}
📊 Qualification rate: *${qRate}%/35%* ${pctIcon(qRate, 35)}
💰 Offers: *${metrics.offers_made}/${TARGETS.offers}* ${pctIcon(metrics.offers_made, TARGETS.offers)}
📅 Appointments: *${metrics.appointments_set}/${TARGETS.appointments}* ${pctIcon(metrics.appointments_set, TARGETS.appointments)}
🤝 Deals: *${metrics.deals_closed}/${TARGETS.deals}* ${pctIcon(metrics.deals_closed, TARGETS.deals)}
💵 Revenue: *$${(metrics.revenue || 0).toLocaleString()}*
📈 Projection: ${projDeals}

*OFFERS MADE*
${offerSection}
${scoreSection}
*COACH'S ANALYSIS*
${aiInsight}

*NEXT WEEK TARGETS*
📞 ${TARGETS.calls / 5} calls/day | 💰 ${TARGETS.offers} offers | 📅 ${TARGETS.appointments} appointments`;

  await sendTelegram(msg);

  // Save to weekly_metrics
  try {
    await sb.from("weekly_metrics").upsert({
      week_start:         isoDateEST(weekStart),
      total_calls:        metrics.calls_made,
      total_contacts:     metrics.contacts,
      contact_rate:       metrics.contactRate,
      qualification_rate: metrics.qualifRate,
      offers_made:        metrics.offers_made,
      appointments_set:   metrics.appointments_set,
      deals_closed:       metrics.deals_closed,
      revenue:            metrics.revenue,
      avg_pitch_score:    scores["Offer Presentation"],
    }, { onConflict: "week_start" });
  } catch (e) { console.error("[accountability] weekly_metrics save:", e.message); }
}

// ── Exports: called from jarvis-telegram.js ───────────────────────────────────

/**
 * Called after Chris logs a call via "logged call [outcome] [notes]"
 * Parses the notes, updates daily_metrics, checks contact rate.
 */
async function logCallMetric(notes) {
  const lower = (notes || "").toLowerCase();

  const isContacted = /contact|spoke|talked|answered|picked up|motivated|interested|offer pending|appointment|scheduled|willing/.test(lower);
  const isNoContact = /no answer|voicemail|vm|hung up|disconnected|wrong number|not available/.test(lower);
  const isQualified  = /qualified|motivated|hot|interested|offer pending|appointment|moving|timeline|price/.test(lower);
  const isOffer      = /\$\d|offer (at|of|pending|sent|made)|made offer|sent offer/.test(lower);
  const isAppt       = /appointment|appt|meeting|scheduled|callback scheduled/.test(lower);
  const isDeal       = /\b(deal|contract|signed|closed|under contract)\b/.test(lower);

  const increments = { calls_made: 1 };
  if (isContacted && !isNoContact) increments.contacts    = 1;
  if (isQualified)                 increments.qualified   = 1;
  if (isOffer)                     increments.offers_made = 1;
  if (isAppt)                      increments.appointments_set = 1;
  if (isDeal)                      increments.deals_closed = 1;

  const updated = await incrementDailyMetrics(increments);

  // Check if contact rate < 40%
  await checkContactRate();

  // Lead quality mini-report at every 10th call
  await checkLeadQuality();

  // Check no calls by 11am
  await check11amNudge();

  return { increments, metrics: updated };
}

// ── 11am nudge (if no calls by 11am) ─────────────────────────────────────────

async function check11amNudge() {
  const est  = getEST();
  const hour = est.getHours();
  const day  = est.getDay();
  if (day === 0 || day === 6 || hour !== 11) return;

  const flagKey = `nudge_11am_${isoDateEST(est)}`;
  if (hasFlag(flagKey)) return;

  const today = await getTodayMetrics();
  if ((today.calls_made || 0) > 0) return; // Already called today

  setFlag(flagKey);

  const monthStart = new Date(est.getFullYear(), est.getMonth(), 1).toISOString();
  const { count: monthCount } = await sb.from("jarvis_calls")
    .select("id", { count: "exact" })
    .eq("caller", "chris")
    .gte("called_at", monthStart)
    .catch(() => ({ count: 0 }));

  const daysLeft     = new Date(est.getFullYear(), est.getMonth() + 1, 0).getDate() - est.getDate();
  const callsNeeded  = daysLeft > 0 ? Math.ceil(120 / daysLeft) : 20;

  await sendTelegram(
    `⏰ Hey Chris — it's 11am. *No calls logged yet today.*\n\n` +
    `Your target is *10 calls today*.\n` +
    `You need *~${callsNeeded} calls/day* to hit your monthly deal goal.\n\n` +
    `Go make your calls. 📞`
  );
}

/**
 * Called when Chris logs an offer via "logged offer $amount to [name] [address]"
 */
async function logOffer({ amount, contactName, address, arv, notes }) {
  const { data } = await sb.from("offers_log").insert({
    offer_amount: amount,
    contact_name: contactName,
    address,
    arv:          arv || null,
    notes:        notes || null,
    outcome:      "pending",
  }).select().single().catch(() => ({ data: null }));

  // Also increment offers in daily_metrics
  await incrementDailyMetrics({ offers_made: 1 });

  console.log(`[accountability] Offer logged: $${amount} to ${contactName} at ${address}`);
  return data;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startScheduler() {
  setInterval(async () => {
    try {
      const est      = getEST();
      const hour     = est.getHours();
      const min      = est.getMinutes();
      const day      = est.getDay();
      const isWeekday = day >= 1 && day <= 5;
      const dateKey   = isoDateEST(est);

      // 7am weekday pipeline audit
      if (isWeekday && hour === 7 && min < 2) {
        if (!hasFlag(`pipeline_audit_${dateKey}`)) {
          setFlag(`pipeline_audit_${dateKey}`);
          require("./ghl-intelligence").runDailyPipelineAudit()
            .catch(e => console.error("[accountability] pipeline audit error:", e.message));
        }
      }

      // 8am weekday morning briefing
      if (isWeekday && hour === 8 && min < 2) {
        if (!hasFlag(`briefing_${dateKey}`)) {
          setFlag(`briefing_${dateKey}`);
          await sendMorningBriefing();
        }
      }

      // 9am weekday: consecutive days check
      if (isWeekday && hour === 9 && min < 2) {
        await checkConsecutiveDays();
      }

      // 11am weekday: no-calls nudge
      if (isWeekday && hour === 11 && min < 2) {
        await check11amNudge();
      }

      // 10am Wednesday: no-offer alert
      if (day === 3 && hour === 10 && min < 2) {
        await checkWednesdayOffer();
      }

      // 1pm weekday: follow-up enforcement
      if (isWeekday && hour === 13 && min < 2) {
        if (!hasFlag(`followup_${dateKey}`)) {
          setFlag(`followup_${dateKey}`);
          await sendFollowUpReminder();
        }
      }

      // Every 4h on weekdays: stale lead check
      if (isWeekday && hour % 4 === 0 && min < 2) {
        await checkStaleLeads();
      }

      // Sunday 7pm weekly report
      if (day === 0 && hour === 19 && min < 2) {
        if (!hasFlag(`weekly_${dateKey}`)) {
          setFlag(`weekly_${dateKey}`);
          await sendWeeklyReport();
        }
      }

    } catch (e) { console.error("[accountability] Scheduler error:", e.message); }
  }, 60 * 1000);

  console.log("[accountability] Scheduler started — checking every minute");
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (require.main === module) (async () => {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   CHRIS ACCOUNTABILITY SYSTEM — Active       ║");
  console.log("╚══════════════════════════════════════════════╝");

  const tables = ["daily_metrics", "offers_log", "weekly_metrics"];
  for (const t of tables) {
    const { error } = await sb.from(t).select("id").limit(1);
    if (error) console.warn(`[accountability] ⚠️  Table '${t}' missing — create in Supabase dashboard`);
    else       console.log(`[accountability] ✅ ${t} ready`);
  }

  startScheduler();

  if (process.argv.includes("--test")) {
    console.log("[accountability] Running test morning briefing...");
    await sendMorningBriefing();
    process.exit(0);
  }

  if (process.argv.includes("--test-weekly")) {
    console.log("[accountability] Running test weekly report...");
    await sendWeeklyReport();
    process.exit(0);
  }

  if (process.argv.includes("--test-followup")) {
    console.log("[accountability] Running test follow-up reminder...");
    await sendFollowUpReminder();
    process.exit(0);
  }
})();

module.exports = { logCallMetric, logOffer, getThisWeekMetrics };
