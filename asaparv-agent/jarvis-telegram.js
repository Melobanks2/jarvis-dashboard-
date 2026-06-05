require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const { exec }  = require("child_process");
const path      = require("path");
const cron      = require("node-cron");
const { google } = require("googleapis");
const fs        = require("fs");

// ── Google Calendar auth ───────────────────────────────────────────────────────
const GCAL_ID        = "chrisnick098@gmail.com";
const GCAL_CREDS     = path.join(__dirname, "gmail-credentials.json");
const GCAL_TOKEN     = path.join(__dirname, "gmail-token.json");

function getGoogleAuth() {
  const { installed: c } = JSON.parse(fs.readFileSync(GCAL_CREDS));
  const auth = new google.auth.OAuth2(c.client_id, c.client_secret, "http://localhost");
  auth.setCredentials(JSON.parse(fs.readFileSync(GCAL_TOKEN)));
  // Auto-save refreshed tokens
  auth.on("tokens", tokens => {
    const current = JSON.parse(fs.readFileSync(GCAL_TOKEN));
    fs.writeFileSync(GCAL_TOKEN, JSON.stringify({ ...current, ...tokens }, null, 2));
  });
  return auth;
}

// Fetch events for a given day (date = JS Date object)
async function getCalendarEvents(date) {
  try {
    const auth = getGoogleAuth();
    const cal  = google.calendar({ version: "v3", auth });
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);
    const res = await cal.events.list({
      calendarId: GCAL_ID,
      timeMin:    start.toISOString(),
      timeMax:    end.toISOString(),
      singleEvents: true,
      orderBy:    "startTime",
    });
    return res.data.items || [];
  } catch (e) {
    console.error("[GCal] List error:", e.message);
    return [];
  }
}

// Format events list for Telegram
function formatEvents(events, label) {
  if (!events.length) return `📅 ${label}: Nothing scheduled.`;
  const lines = events.map(ev => {
    const start = ev.start?.dateTime
      ? new Date(ev.start.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      : "All day";
    return `• ${start} — ${ev.summary || "Untitled"}`;
  });
  return `📅 ${label}:\n${lines.join("\n")}`;
}

// Parse natural language time like "3pm", "2:30pm", "14:00"
function parseTime(timeStr, baseDate) {
  const d = new Date(baseDate);
  const t = timeStr.trim().toLowerCase();
  const m12 = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m12) {
    let h = parseInt(m12[1]);
    const min = parseInt(m12[2] || "0");
    if (m12[3] === "pm" && h !== 12) h += 12;
    if (m12[3] === "am" && h === 12) h = 0;
    d.setHours(h, min, 0, 0);
    return d;
  }
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) { d.setHours(parseInt(m24[1]), parseInt(m24[2]), 0, 0); return d; }
  return null;
}

// Add an event to Google Calendar
async function addCalendarEvent(summary, startTime, endTime) {
  try {
    const auth = getGoogleAuth();
    const cal  = google.calendar({ version: "v3", auth });
    const end  = endTime || new Date(startTime.getTime() + 60 * 60 * 1000); // default 1hr
    const res  = await cal.events.insert({
      calendarId: GCAL_ID,
      requestBody: {
        summary,
        start: { dateTime: startTime.toISOString() },
        end:   { dateTime: end.toISOString() },
      },
    });
    return res.data;
  } catch (e) {
    console.error("[GCal] Insert error:", e.message);
    return null;
  }
}

const bot = new TelegramBot("8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0", {
  polling: { interval: 300, autoStart: false, params: { timeout: 3 } }
});
// Graceful shutdown — stop polling before process exits so next restart
// doesn't get 409 Conflict from an in-flight long-poll request
process.once("SIGINT",  () => bot.stopPolling().finally(() => process.exit(0)));
process.once("SIGTERM", () => bot.stopPolling().finally(() => process.exit(0)));
// When the library gets a 409 it calls _unsetWebHook() then retries immediately,
// creating an infinite loop. Break the loop by stopping and restarting after 5s.
let _pollingRestarting = false;
bot.on("polling_error", (err) => {
  if (err.code === "ETELEGRAM" && err.message && err.message.includes("409") && !_pollingRestarting) {
    _pollingRestarting = true;
    bot.stopPolling().then(() => {
      setTimeout(() => { _pollingRestarting = false; bot.startPolling(); }, 5000);
    }).catch(() => {
      setTimeout(() => { _pollingRestarting = false; bot.startPolling(); }, 5000);
    });
  }
});
// Brief delay before starting polling so any in-flight request from the
// previous process instance has time to expire
setTimeout(() => bot.startPolling(), 3500);
const claude = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY});
const { aiChat } = require("./ai-router");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GHL_TOKEN   = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const LOCATION_ID = "AymErWPrH9U1ddRouslC";
const VA_PIPELINE = "o4kqU2y8DYjA73aKUxNu";
const WS_PIPELINE = "QsjO25tMKFZFFzdAkWZP";

// Stage IDs — mirrors jarvis-caller.js
const VA_STAGE_IDS = {
  "Hot Follow Up":  "898845b3-7e76-42be-b8a7-cb8a85a0daa2",
  "Warm Follow Up": "47f767a6-24af-48f2-9df2-5d664f031bb7",
  "New Lead":       "92d0031c-00f8-4692-bc9f-235a76fa3201",
};
const WS_STAGE_IDS = {
  "Hot Follow Up":  "d06993e4-0e0e-4c56-ac9b-f282b1a95aa6",
  "Warm Follow Up": "683b36f4-370e-4edf-8af6-6adaa2cf6793",
};

// ── Call session state ─────────────────────────────────────────────────────────
const pendingCallConfirm   = {}; // chatId → { callerArgs, label, count, sessionStart }
const pendingDavidActivate = {}; // chatId → true (awaiting YES to activate David)
const pendingUnlockCode    = {}; // chatId → { code: string, expires: number }
const knowledgeSessions    = {}; // chatId → { active, entries: [], startTime }
let activeCallerProc = null;     // track running process for "stop calling"

// Count open leads in a specific GHL stage
async function countLeadsInStage(pipelineId, stageId) {
  try {
    const r = await fetch(
      `https://services.leadconnectorhq.com/opportunities/search?pipeline_id=${pipelineId}&location_id=${LOCATION_ID}&pipeline_stage_id=${stageId}&status=open&limit=1`,
      { headers: { "Authorization": `Bearer ${GHL_TOKEN}`, "Version": "2021-07-28" } }
    );
    const d = await r.json();
    return d.meta?.total ?? (d.opportunities || []).length;
  } catch { return "?"; }
}

// ── GHL contact search helpers ────────────────────────────────────────────────

// Raw GHL search — returns up to `limit` contacts matching a query string
async function ghlQueryContacts(query, limit = 10) {
  try {
    const r = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(query)}&limit=${limit}`,
      { headers: { "Authorization": `Bearer ${GHL_TOKEN}`, "Version": "2021-07-28" } }
    );
    const d = await r.json();
    return d.contacts || [];
  } catch { return []; }
}

// Simple name similarity score (0–1). Higher = closer match.
function nameSimilarity(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const aWords = a.split(/\s+/);
  const bWords = b.split(/\s+/);
  const shared = aWords.filter(w => bWords.some(bw => bw.startsWith(w) || w.startsWith(bw)));
  return shared.length / Math.max(aWords.length, bWords.length);
}

function contactDisplayName(c) {
  return c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
}

/**
 * Search GHL contacts by name with 4-tier fallback:
 *   1. Full name (case-insensitive)
 *   2. First name only
 *   3. Last name only
 *   4. Suggest 3 closest matches from broad search
 *
 * Returns { contact: <best match or null>, suggestions: [<up to 3 contacts>] }
 */
async function searchGHLContact(name) {
  const parts     = name.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName  = parts.length > 1 ? parts[parts.length - 1] : null;
  const nameLower = name.toLowerCase();

  const pick = (contacts) => {
    // Prefer exact or near-exact match; otherwise highest similarity
    return contacts
      .map(c => ({ c, score: nameSimilarity(contactDisplayName(c), name) }))
      .sort((a, b) => b.score - a.score)
      .find(x => x.score > 0)?.c || null;
  };

  // Tier 1: full name query
  const r1 = await ghlQueryContacts(name);
  const m1 = r1.filter(c => contactDisplayName(c).toLowerCase().includes(nameLower.split(" ")[0]));
  if (m1.length) return { contact: pick(m1), suggestions: m1.slice(0, 3) };

  // Tier 2: first name only
  const r2 = await ghlQueryContacts(firstName);
  const m2 = r2.filter(c => contactDisplayName(c).toLowerCase().includes(firstName.toLowerCase()));
  if (m2.length) return { contact: pick(m2), suggestions: m2.slice(0, 3) };

  // Tier 3: last name only (if present)
  if (lastName) {
    const r3 = await ghlQueryContacts(lastName);
    const m3 = r3.filter(c => contactDisplayName(c).toLowerCase().includes(lastName.toLowerCase()));
    if (m3.length) return { contact: pick(m3), suggestions: m3.slice(0, 3) };
  }

  // Tier 4: no match — return 3 closest from broad search for suggestions
  const broad = await ghlQueryContacts(firstName, 20);
  const suggestions = broad
    .map(c => ({ c, score: nameSimilarity(contactDisplayName(c), name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.c);

  return { contact: null, suggestions };
}

// Detect if a string looks like a phone number (direct dial)
function isPhoneNumber(str) {
  return /^[\+\d\s\-\(\)\.]{7,16}$/.test(str.trim()) && /\d{7,}/.test(str.replace(/\D/g, ""));
}

function normalizePhone(str) {
  const digits = str.replace(/\D/g, "");
  if (digits.length === 10)                        return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1")   return `+${digits}`;
  return `+${digits}`;
}

// Caller command definitions
const CALL_COMMANDS = [
  {
    pattern:    /^call warm follow.?ups?$/i,
    args:       `--stage "Warm Follow Up"`,
    label:      "Warm Follow Up (VA♦️Leads)",
    pipelineId: VA_PIPELINE,
    stageId:    VA_STAGE_IDS["Warm Follow Up"],
  },
  {
    pattern:    /^call hot follow.?ups?$/i,
    args:       `--stage "Hot Follow Up"`,
    label:      "Hot Follow Up (VA♦️Leads)",
    pipelineId: VA_PIPELINE,
    stageId:    VA_STAGE_IDS["Hot Follow Up"],
  },
  {
    pattern:    /^call wholesalers warm$/i,
    args:       `--wholesalers --stage "Warm Follow Up"`,
    label:      "Warm Follow Up (Wholesalers ⛵️)",
    pipelineId: WS_PIPELINE,
    stageId:    WS_STAGE_IDS["Warm Follow Up"],
  },
  {
    pattern:    /^call wholesalers hot$/i,
    args:       `--wholesalers --stage "Hot Follow Up"`,
    label:      "Hot Follow Up (Wholesalers ⛵️)",
    pipelineId: WS_PIPELINE,
    stageId:    WS_STAGE_IDS["Hot Follow Up"],
  },
  {
    pattern:    /^call new leads$/i,
    args:       `--stage "New Lead"`,
    label:      "New Lead (VA♦️Leads)",
    pipelineId: VA_PIPELINE,
    stageId:    VA_STAGE_IDS["New Lead"],
  },
];

async function logApiCost(agent, model, usage) {
  try {
    const inRate  = model.includes("haiku") ? 0.00025 : 0.003;
    const outRate = model.includes("haiku") ? 0.00125 : 0.015;
    const estimated_cost = (usage.input_tokens / 1000) * inRate + (usage.output_tokens / 1000) * outRate;
    await sb.from("jarvis_log").insert({
      type:    "api_cost",
      message: JSON.stringify({ agent, model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, estimated_cost }),
      source:  agent,
      priority: "normal",
    });
  } catch {}
}

async function log(type, message, contact, source, priority, pipeline, stage) {
  try {
    await sb.from("jarvis_log").insert({ type, message, contact_name: contact||null, source: source||"jarvis", priority: priority||"normal", pipeline: pipeline||null, stage: stage||null });
  } catch(e) { console.error("Log error:", e.message); }
}

async function getGHLPipeline() {
  try {
    const r = await fetch(`https://services.leadconnectorhq.com/opportunities/search?location_id=${LOCATION_ID}&limit=100`, {
      headers: {"Authorization": `Bearer ${GHL_TOKEN}`, "Version": "2021-07-28"}
    });
    const data = await r.json();
    const opps = data.opportunities || [];
    const active = opps.filter(o => o.status === "open");
    const summary = active.slice(0,8).map(o => `${o.name}`).join(", ");
    return `LIVE GHL: ${active.length} active deals. Top contacts: ${summary}`;
  } catch(e) { return "GHL unavailable"; }
}

const SYSTEM = `You are Jarvis, Chris Lovera's personal AI chief of staff for his wholesale real estate business.

CHRIS'S GOALS:
- Wholesale: $30K/month, 4 deals/month
- ASAP ARV (asaparv.com): $1K MRR this quarter
- Personal: new car, move to Miami

CURRENT STATUS:
- Alpha Leads VA cold calling Mon-Fri 12-8pm, 12,000 records, target 1-2 leads/day
- Deal closing in ~10 days worth ~$5K → reinvesting into Speed To Lead PPL
- Phase 1: Work old lists + Alpha Leads VA
- Phase 2 (after $5K deal): $2,500 into Speed To Lead
- Phase 3: Proper Leads by county

PIPELINES IN GHL:
- VA♦️ Leads: New Lead → Attempts 1-6 → Cold/Warm/Hot Follow-ups → Decision Pending → Contract Sent → Under Contract → Closed
- Wholesalers ⛵️: New Lead → Contacted 1-3 → Cold/Warm/Hot Follow-up → Underwriting → Offer → Under Contract → Closed

YOUR JOB:
- Help Chris run his business daily
- When he mentions a lead or contact, log it and suggest next action
- When he asks about pipeline, pull GHL data
- Be direct, tactical, and brief
- Sign off as Jarvis
- Flag HOT leads immediately`;

// ── Persistent conversation memory (Supabase) ─────────────────────────────────
// Table: jarvis_conversations (id SERIAL PK, chat_id TEXT, role TEXT, content TEXT, created_at TIMESTAMPTZ)
// SQL: CREATE TABLE jarvis_conversations (id SERIAL PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
//      CREATE INDEX idx_jconv ON jarvis_conversations(chat_id, created_at DESC);

async function saveMessage(chatId, role, content) {
  try {
    await sb.from("jarvis_conversations").insert({
      chat_id: String(chatId),
      role,
      content,
    });
  } catch (e) {
    console.error("[Memory] Save error:", e.message);
  }
}

async function loadRecentMessages(chatId, limit = 10) {
  try {
    const { data, error } = await sb
      .from("jarvis_conversations")
      .select("role, content")
      .eq("chat_id", String(chatId))
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).reverse(); // oldest first for Claude
  } catch (e) {
    console.error("[Memory] Load error:", e.message);
    return [];
  }
}

function detectLogType(text) {
  const t = text.toLowerCase();
  if (t.includes("hot") || t.includes("motivated") || t.includes("urgent")) return { type: "hot", priority: "hot" };
  if (t.includes("closed") || t.includes("signed") || t.includes("under contract") || t.includes("deal")) return { type: "deal", priority: "high" };
  if (t.includes("follow up") || t.includes("called") || t.includes("texted") || t.includes("reached out")) return { type: "follow_up", priority: "normal" };
  if (t.includes("lead") || t.includes("new contact") || t.includes("came in")) return { type: "lead", priority: "normal" };
  if (t.includes("refund") || t.includes("dead lead") || t.includes("bad lead")) return { type: "refund", priority: "low" };
  return null;
}

function extractContact(text) {
  const match = text.match(/(?:called?|texted?|spoke(?:n)? (?:with|to)|contact(?:ed)?|follow(?:ing)? up (?:with|on))\s+([A-Z][a-z]+ ?[A-Z]?[a-z]*)/i);
  return match ? match[1] : null;
}

// ── Deal Approval: inline keyboard callback handler ───────────────────────────
bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat?.id;
  const data   = query.data || "";

  let action, approvalId, offerTier;
  if (data.startsWith("approve_60_")) {
    action = "approve_cash"; offerTier = "60";
    approvalId = data.replace("approve_60_", "");
  } else if (data.startsWith("approve_65_")) {
    action = "approve_cash"; offerTier = "65";
    approvalId = data.replace("approve_65_", "");
  } else if (data.startsWith("approve_70_")) {
    action = "approve_cash"; offerTier = "70";
    approvalId = data.replace("approve_70_", "");
  } else if (data.startsWith("approve_novation_")) {
    action = "approve_novation"; offerTier = "novation";
    approvalId = data.replace("approve_novation_", "");
  } else if (data.startsWith("pass_")) {
    action = "pass";
    approvalId = data.replace("pass_", "");
  } else {
    await bot.answerCallbackQuery(query.id, { text: "Unknown action" }).catch(() => {});
    return;
  }

  const ackText = action === "pass" ? "❌ Passed — David will call seller back." : `✅ Approved at ${offerTier}% — David calling now!`;
  await bot.answerCallbackQuery(query.id, { text: ackText }).catch(() => {});

  try {
    const { createClient } = require("@supabase/supabase-js");
    const sbClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    const { data: approval, error: fetchErr } = await sbClient
      .from("david_pending_approvals")
      .select("*")
      .eq("id", approvalId)
      .single();

    if (fetchErr || !approval) {
      await bot.sendMessage(chatId, `⚠️ Could not find approval: ${fetchErr?.message || "not found"}`);
      return;
    }

    if (approval.status !== "pending") {
      await bot.sendMessage(chatId, `ℹ️ Already ${approval.status}.`);
      return;
    }

    const newStatus = action === "pass" ? "passed" :
                      action === "approve_novation" ? "approved_novation" : `approved_${offerTier}pct`;
    await sbClient
      .from("david_pending_approvals")
      .update({ status: newStatus, approved_type: `${action}_${offerTier || ""}`, decided_at: new Date().toISOString() })
      .eq("id", approvalId);

    const fmtC = n => n ? `$${Math.round(n).toLocaleString()}` : "—";
    const CALLER_URL = "http://localhost:3000";

    if (action === "approve_cash") {
      // Pick exact offer amount based on tier
      const offerAmount = offerTier === "60" ? approval.offer_60
                        : offerTier === "65" ? approval.offer_65
                        : approval.offer_70;
      const fmtOffer = fmtC(offerAmount);

      // Trigger David to call back with the specific offer amount
      try {
        await fetch(`${CALLER_URL}/internal/approval-callback`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvalId, offerType: `${offerTier}%`, offerAmount: fmtOffer,
            phone: approval.phone, name: approval.contact_name,
            address: approval.address, contactId: approval.contact_id,
          }),
        });
        // Apply offer tag to GHL contact
        if (approval.contact_id) {
          try {
            const GHL_TOKEN = process.env.GHL_API_TOKEN || process.env.GHL_TOKEN;
            const cRes = await fetch(`https://services.leadconnectorhq.com/contacts/${approval.contact_id}`, {
              headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-07-28" }
            });
            const cData = await cRes.json();
            const existTags = (cData.contact?.tags || []).filter(t =>
              !t.startsWith("💰 Offer Made") && !t.startsWith("✅ Verbal") && !t.startsWith("❌ Declined")
            );
            await fetch(`https://services.leadconnectorhq.com/contacts/${approval.contact_id}`, {
              method: "PUT",
              headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-07-28", "Content-Type": "application/json" },
              body: JSON.stringify({ tags: [...existTags, `💰 Offer Made — ${offerTier}%`] }),
            });
          } catch {}
        }
        await bot.sendMessage(chatId,
          `✅ <b>Approved at ${offerTier}% — ${fmtOffer}</b>\n` +
          `David is calling ${approval.contact_name} now with that offer.`,
          { parse_mode: "HTML" }
        );
      } catch (e) {
        await bot.sendMessage(chatId, `⚠️ Could not trigger callback call: ${e.message}`);
      }

    } else if (action === "approve_novation") {
      const novOffer = fmtC(approval.novation_offer);
      try {
        await fetch(`${CALLER_URL}/internal/approval-callback`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvalId, offerType: "Novation", offerAmount: novOffer,
            phone: approval.phone, name: approval.contact_name,
            address: approval.address, contactId: approval.contact_id,
          }),
        });
        await bot.sendMessage(chatId, `✨ Novation approved at ${novOffer}. David calling now.`, { parse_mode: "HTML" });
      } catch (e) {
        await bot.sendMessage(chatId, `⚠️ Could not trigger callback call: ${e.message}`);
      }

    } else {
      // PASS — trigger denial callback
      try {
        await fetch(`${CALLER_URL}/internal/denial-callback`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: approval.phone, name: approval.contact_name,
            address: approval.address, contactId: approval.contact_id,
            reason: "the numbers didn't quite work out on our end this time",
          }),
        });
        await bot.sendMessage(chatId,
          `❌ <b>Passed</b> — David will call ${approval.contact_name} with a polite explanation.`,
          { parse_mode: "HTML" }
        );
      } catch (e) {
        await bot.sendMessage(chatId, `❌ Passed on ${approval.contact_name}. (Denial callback failed: ${e.message})`, { parse_mode: "HTML" });
      }
    }

    // Edit original message to show decision
    const label = action === "pass" ? "❌ PASSED" : `✅ APPROVED ${offerTier ? offerTier + "%" : "NOVATION"}`;
    await bot.editMessageText(
      `${label} — ${approval.contact_name} | ${approval.address}`,
      { chat_id: chatId, message_id: query.message.message_id }
    ).catch(() => {});

  } catch (err) {
    console.error("[Approval] Callback error:", err.message);
    await bot.sendMessage(chatId, `⚠️ Error: ${err.message}`).catch(() => {});
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;
  console.log(`Chris [${chatId}]:`, text);

  const lower = text.toLowerCase().trim();

  // ── "stop calling" ──────────────────────────────────────────────────────────
  if (lower === "stop calling") {
    if (activeCallerProc) {
      activeCallerProc.kill("SIGTERM");
      activeCallerProc = null;
      delete pendingCallConfirm[chatId];
      bot.sendMessage(chatId, "🛑 Calling session stopped.");
    } else {
      bot.sendMessage(chatId, "No active calling session running.");
    }
    return;
  }

  // ── David activation commands ────────────────────────────────────────────────
  if (lower === "david on" || lower === "start david" || lower === "call va hot") {
    pendingDavidActivate[chatId] = true;
    bot.sendMessage(chatId,
      "⚠️ Are you sure you want to activate David?\n\nHe will start making calls on schedule.\nReply <b>YES</b> to confirm.",
      { parse_mode: "HTML" }
    );
    return;
  }

  if (lower === "david off" || lower === "stop david") {
    try {
      await sb.from("agent_status").upsert({ id: "DAVID_STATUS", status: "paused", updated_at: new Date().toISOString() });
      // Also lock David via internal endpoint
      await fetch("http://localhost:3000/internal/lock-david", { method: "POST", signal: AbortSignal.timeout(3000) }).catch(() => {});
      bot.sendMessage(chatId, "🛑 David deactivated and locked. He will not make any calls until you send 'unlock david'.");
    } catch (e) {
      bot.sendMessage(chatId, `❌ Failed to deactivate David: ${e.message}`);
    }
    return;
  }

  // ── Unlock David (requires confirmation code) ─────────────────────────────────
  if (lower === "unlock david") {
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
    pendingUnlockCode[chatId] = { code, expires: Date.now() + 5 * 60 * 1000 }; // 5 min expiry
    bot.sendMessage(chatId,
      `🔐 <b>David Unlock Code</b>\n\nYour one-time unlock code is:\n\n<code>${code}</code>\n\nReply with this code to unlock David. Expires in 5 minutes.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ── Lock David immediately ────────────────────────────────────────────────────
  if (lower === "lock david") {
    try {
      await fetch("http://localhost:3000/internal/lock-david", { method: "POST", signal: AbortSignal.timeout(3000) });
      await sb.from("agent_status").upsert({ id: "DAVID_STATUS", status: "paused", updated_at: new Date().toISOString() });
      bot.sendMessage(chatId, "🔒 David locked. No calls possible until 'unlock david'.");
    } catch (e) {
      bot.sendMessage(chatId, `❌ Lock failed: ${e.message}`);
    }
    return;
  }

  // ── Pending unlock code entry ─────────────────────────────────────────────────
  if (pendingUnlockCode[chatId]) {
    const { code, expires } = pendingUnlockCode[chatId];
    if (Date.now() > expires) {
      delete pendingUnlockCode[chatId];
      bot.sendMessage(chatId, "⏰ Unlock code expired. Send 'unlock david' to get a new one.");
      return;
    }
    if (lower === code) {
      delete pendingUnlockCode[chatId];
      try {
        const r = await fetch("http://localhost:3000/internal/unlock-david", {
          method: "POST",
          signal: AbortSignal.timeout(5000),
        });
        const data = await r.json();
        if (data.ok) {
          bot.sendMessage(chatId,
            "🔓 <b>David unlocked.</b>\n\nNow send <b>david on</b> to activate calling for today.",
            { parse_mode: "HTML" }
          );
        } else {
          bot.sendMessage(chatId, "⚠️ Unlock endpoint failed. Is jarvis-caller running?");
        }
      } catch {
        bot.sendMessage(chatId, "⚠️ Could not reach jarvis-caller. Make sure it's running first.");
      }
      return;
    } else {
      bot.sendMessage(chatId, "❌ Wrong code. Try again or send 'unlock david' for a new code.");
      return;
    }
  }

  // ── EXTEND daily minute budget (+15 min) ─────────────────────────────────────
  if (lower === "extend") {
    try {
      const r = await fetch("http://localhost:3000/internal/extend-budget", {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      const data = await r.json();
      if (data.ok) {
        bot.sendMessage(chatId, `✅ Budget extended! David now has ${data.newBudgetMinutes} total minutes today. He's active again.`);
      } else {
        bot.sendMessage(chatId, "⚠️ Extend failed — David server may not be running.");
      }
    } catch {
      bot.sendMessage(chatId, "⚠️ Could not reach David server. Is jarvis-caller running?");
    }
    return;
  }

  // ── YES confirmation for David activation ────────────────────────────────────
  if (pendingDavidActivate[chatId] && /^yes$/i.test(lower)) {
    delete pendingDavidActivate[chatId];
    try {
      await sb.from("agent_status").upsert({ id: "DAVID_STATUS", status: "active", updated_at: new Date().toISOString() });
      bot.sendMessage(chatId,
        "✅ <b>David is now active.</b>\n\nHe will start calling on the next scheduled window (9am, 11am, 1pm, 3pm, 5pm, 6pm, 7pm EST).\n\n" +
        "Daily budget: 30 minutes. Send <b>david off</b> to stop him at any time.",
        { parse_mode: "HTML" }
      );
    } catch (e) {
      bot.sendMessage(chatId, `❌ Failed to activate David: ${e.message}`);
    }
    return;
  }
  if (pendingDavidActivate[chatId] && !/^yes$/i.test(lower)) {
    // Not YES — cancel the pending and fall through
    delete pendingDavidActivate[chatId];
  }

  // ── YES / NO confirmation for pending call session ───────────────────────────
  if (pendingCallConfirm[chatId]) {
    if (/^yes$/i.test(lower)) {
      const { callerArgs, label, count, sessionStart } = pendingCallConfirm[chatId];
      delete pendingCallConfirm[chatId];
      bot.sendMessage(chatId, `📞 Starting — ${label} (${count} leads)...`);

      const scriptPath = path.join(__dirname, "jarvis-caller.js");
      const cmd = `node ${scriptPath} ${callerArgs}`;
      console.log(`[Call] Launching: ${cmd}`);

      activeCallerProc = exec(cmd, { cwd: __dirname, env: process.env }, async (err, stdout, stderr) => {
        activeCallerProc = null;
        if (err) console.error("[Call] Error:", err.message);

        // Build summary from jarvis_calls entries during this session
        try {
          const { data: sessionCalls } = await sb.from("jarvis_calls")
            .select("stage_after")
            .gte("called_at", new Date(sessionStart).toISOString());
          const total = sessionCalls?.length || 0;
          const appts = (sessionCalls || []).filter(c =>
            ["Decision Pending", "Contract Sent"].includes(c.stage_after)
          ).length;
          const hot = (sessionCalls || []).filter(c =>
            c.stage_after === "Hot Follow Up"
          ).length;
          bot.sendMessage(chatId,
            `✅ Call session complete\nCalls made: ${total}\nAppointments set: ${appts}\nHot leads: ${hot}`
          );
        } catch (e) {
          bot.sendMessage(chatId, `✅ Call session complete.`);
        }
      });
      return;

    } else if (/^no$/i.test(lower)) {
      delete pendingCallConfirm[chatId];
      bot.sendMessage(chatId, "❌ Call session cancelled.");
      return;
    }
    // Not YES/NO — fall through to Claude
  }

  // ── Google Calendar commands ─────────────────────────────────────────────────
  if (/^what'?s? on my calendar today/.test(lower) || lower === "calendar today") {
    const events = await getCalendarEvents(new Date());
    bot.sendMessage(chatId, formatEvents(events, "Today"));
    return;
  }

  if (/^what'?s? on my calendar tomorrow/.test(lower) || lower === "calendar tomorrow") {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const events = await getCalendarEvents(tomorrow);
    bot.sendMessage(chatId, formatEvents(events, "Tomorrow"));
    return;
  }

  // "schedule [task] at [time]" or "add to calendar [event] at [time]"
  const scheduleMatch = lower.match(/^(?:schedule|add to calendar)\s+(.+?)\s+at\s+(.+)$/i);
  if (scheduleMatch) {
    const summary   = text.match(/^(?:schedule|add to calendar)\s+(.+?)\s+at\s+/i)?.[1] || scheduleMatch[1];
    const timeStr   = scheduleMatch[2].trim();
    const startTime = parseTime(timeStr, new Date());
    if (!startTime) {
      bot.sendMessage(chatId, `❌ Couldn't parse time "${timeStr}". Try "at 3pm" or "at 2:30pm".`);
      return;
    }
    const event = await addCalendarEvent(summary, startTime);
    if (event) {
      const timeFormatted = startTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      bot.sendMessage(chatId, `✅ Added to calendar: "${summary}" at ${timeFormatted}`);
    } else {
      bot.sendMessage(chatId, `❌ Failed to add event. Check Google Calendar API access.`);
    }
    return;
  }

  // "add to calendar [event]" without a time — add as all-day today
  const addCalMatch = lower.match(/^add to calendar (.+)$/i);
  if (addCalMatch) {
    const summary = text.match(/^add to calendar (.+)$/i)?.[1] || addCalMatch[1];
    const startTime = new Date(); startTime.setHours(9, 0, 0, 0);
    const event = await addCalendarEvent(summary, startTime);
    if (event) {
      bot.sendMessage(chatId, `✅ Added to calendar: "${summary}" (today at 9am)`);
    } else {
      bot.sendMessage(chatId, `❌ Failed to add event.`);
    }
    return;
  }

  // ── "call me" / "test david" — trigger real Telnyx call ───────────────────
  if (lower === "call me" || lower === "test david") {
    bot.sendMessage(chatId, "📞 David is calling you now...");
    const sessionStart = Date.now();

    // Try running caller first (if active cron session is in progress)
    let usedInternal = false;
    try {
      const r = await fetch("http://localhost:3000/internal/call-test", {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) usedInternal = true;
    } catch {}

    if (!usedInternal) {
      // Caller not running — spawn --test (port 3000 is free)
      if (activeCallerProc) {
        bot.sendMessage(chatId, "⚠️ Another call session is active. Try again in a moment.");
        return;
      }
      const scriptPath = path.join(__dirname, "jarvis-caller.js");
      activeCallerProc = exec(
        `node ${scriptPath} --test`,
        { cwd: __dirname, env: process.env },
        (err) => { activeCallerProc = null; }
      );
    }

    // Poll Supabase for call record (max 4 min)
    let saved = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 6000));
      const { data } = await sb.from("jarvis_calls")
        .select("call_duration,stage_after")
        .gte("called_at", new Date(sessionStart - 5000).toISOString())
        .order("called_at", { ascending: false })
        .limit(1);
      if (data?.[0]) { saved = data[0]; break; }
    }
    bot.sendMessage(chatId,
      saved ? `✅ Test call complete\nDuration: ${saved.call_duration}s\nStage: ${saved.stage_after}`
            : "✅ Test call complete."
    );
    return;
  }

  // ── Named call commands ─────────────────────────────────────────────────────
  const callCmd = CALL_COMMANDS.find(c => c.pattern.test(lower));
  if (callCmd) {
    const count = await countLeadsInStage(callCmd.pipelineId, callCmd.stageId);
    pendingCallConfirm[chatId] = {
      callerArgs:   callCmd.args,
      label:        callCmd.label,
      count,
      sessionStart: Date.now(),
    };
    bot.sendMessage(chatId,
      `📞 About to call ${count} leads in ${callCmd.label}.\nReply YES to confirm or NO to cancel.`
    );
    return;
  }

  // ── Session start / end ─────────────────────────────────────────────────────
  if (lower === "session start") {
    knowledgeSessions[chatId] = { active: true, entries: [], startTime: Date.now() };
    bot.sendMessage(chatId,
      "📚 Knowledge session started.\n\nPaste as many transcripts as you want. Send each one as:\n\nlearn [title] [content]\n\nSend <b>session end</b> when done.",
      { parse_mode: "HTML" }
    );
    return;
  }

  if (lower === "session end") {
    const session = knowledgeSessions[chatId];
    if (!session?.active) { bot.sendMessage(chatId, "No active session. Send <b>session start</b> to begin.", { parse_mode: "HTML" }); return; }
    const count = session.entries.length;
    if (count === 0) { bot.sendMessage(chatId, "Session ended — no entries were added."); delete knowledgeSessions[chatId]; return; }

    // Get total KB size
    const { count: totalKb } = await sb.from("knowledge_base").select("*", { count: "exact", head: true });

    // Aggregate all concepts from this session
    const allConcepts = session.entries.flatMap(e => e.key_concepts || []);
    const allPractices = session.entries.flatMap(e => e.best_practices || []);
    const topConcepts = [...new Set(allConcepts)].slice(0, 5);

    let summary = `✅ <b>Session Complete</b>\n\n`;
    summary += `📹 ${count} entr${count === 1 ? "y" : "ies"} processed\n`;
    summary += `📚 ${totalKb || "?"} total entries in knowledge base\n\n`;
    if (topConcepts.length > 0) {
      summary += `<b>Top concepts learned:</b>\n`;
      summary += topConcepts.map((c, i) => `${i + 1}. ${c}`).join("\n");
    }
    if (allPractices.length > 0) {
      summary += `\n\n<b>Best practices added:</b>\n`;
      summary += [...new Set(allPractices)].slice(0, 3).map((p, i) => `${i + 1}. ${p}`).join("\n");
    }

    bot.sendMessage(chatId, summary, { parse_mode: "HTML" });
    delete knowledgeSessions[chatId];
    return;
  }

  // ── What do you know about [topic] ──────────────────────────────────────────
  const knowMatch = lower.match(/^what do you know about\s+(.+)$/);
  if (knowMatch) {
    const topic = knowMatch[1].trim();
    bot.sendMessage(chatId, `🔍 Searching knowledge base for "${topic}"...`);
    try {
      const { data: rows } = await sb.from("knowledge_base")
        .select("title, summary, key_concepts, best_practices, things_to_avoid")
        .or(`title.ilike.%${topic}%,summary.ilike.%${topic}%,content.ilike.%${topic}%`)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!rows || rows.length === 0) {
        bot.sendMessage(chatId, `📭 I don't have any knowledge about "${topic}" yet. Teach me with:\n\nlearn [title] [content]`);
        return;
      }

      // Ask Haiku to synthesize
      const contextText = rows.map(r =>
        `Title: ${r.title}\nSummary: ${r.summary}\nConcepts: ${(r.key_concepts || []).join(", ")}\nBest practices: ${(r.best_practices || []).join(", ")}`
      ).join("\n\n---\n\n");

      const aiRes = await ai.messages.create({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages:   [{ role: "user", content: `You are a wholesale real estate expert. Based on this knowledge base content, summarize what is known about "${topic}". Be specific and actionable. Keep it under 300 words.\n\n${contextText}` }],
      });

      const answer = aiRes.content[0].text.trim();
      bot.sendMessage(chatId,
        `📚 <b>What I know about "${topic}"</b> (from ${rows.length} entr${rows.length === 1 ? "y" : "ies"}):\n\n${answer}`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      bot.sendMessage(chatId, `❌ Error searching knowledge base: ${e.message}`);
    }
    return;
  }

  // ── Knowledge Feed: /learn <url_or_text> or paste YouTube link anywhere ──────
  const youtubeMatch = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  const isLearnCmd   = /^\/learn\s+/i.test(text) || /^learn:/i.test(text) || /^learn\s+\S/i.test(text);

  if (youtubeMatch || isLearnCmd) {
    const content = isLearnCmd ? text.replace(/^(?:\/learn|learn:)\s*/i, "").trim() : text.trim();
    const ytId    = youtubeMatch ? youtubeMatch[1] : (content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/) || [])[1];

    bot.sendMessage(chatId, ytId
      ? `📚 Got it — fetching YouTube transcript for video ${ytId}...`
      : `📚 Got it — saving your notes to the knowledge base...`
    );

    try {
      let rawText = content;
      let sourceUrl = null;
      let videoTitle = null;

      // ── Fetch YouTube transcript ─────────────────────────────────────────────
      if (ytId) {
        sourceUrl = `https://www.youtube.com/watch?v=${ytId}`;

        // Get title from oEmbed (no API key needed)
        try {
          const meta = await fetch(`https://www.youtube.com/oembed?url=${sourceUrl}&format=json`).then(r => r.json());
          videoTitle = meta.title || null;
        } catch {}

        // Get transcript via Python youtube-transcript-api
        const { exec: execCb } = require("child_process");
        const { promisify }    = require("util");
        const execA            = promisify(execCb);

        const pyScript = `
from youtube_transcript_api import YouTubeTranscriptApi
api = YouTubeTranscriptApi()
t = api.fetch('${ytId}')
print(' '.join(s.text for s in t).replace('\\n', ' '))
`.trim();

        const { stdout } = await execA(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`, { timeout: 30000 });
        rawText = stdout.trim();

        if (!rawText || rawText.length < 50) {
          bot.sendMessage(chatId, "⚠️ This video doesn't have English captions. Try pasting the transcript text directly using:\n\nlearn: [paste transcript here]");
          return;
        }
      }

      // ── Summarize with Haiku ────────────────────────────────────────────────
      const aiRes = await ai.messages.create({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages:   [{
          role:    "user",
          content: `You are a wholesale real estate expert. Extract the most valuable insights from this content.

Content${videoTitle ? ` (from: "${videoTitle}")` : ""}:
${rawText.slice(0, 8000)}

Return JSON only:
{
  "title": "brief descriptive title for this knowledge entry",
  "keyInsights": ["insight 1", "insight 2", "insight 3", "insight 4", "insight 5"],
  "scriptSnippet": "any word-for-word script, formula, or key quote from the content",
  "systemIdea": "one specific idea to improve the David AI caller or Jarvis system based on what was learned",
  "summary": "2-3 sentence summary of the main point"
}`,
        }],
      });

      const json     = aiRes.content[0].text.match(/\{[\s\S]*\}/);
      const insights = json ? JSON.parse(json[0]) : null;

      if (!insights) throw new Error("Could not parse AI response");

      // ── Save to wholesale-knowledge.json ───────────────────────────────────
      const KB_FILE = path.join(__dirname, "wholesale-knowledge.json");
      let kb = { entries: [], lastTopicIndex: -1, totalRuns: 0 };
      try { kb = JSON.parse(fs.readFileSync(KB_FILE, "utf8")); } catch {}

      kb.entries.push({
        date:          new Date().toISOString().split("T")[0],
        topicId:       "user_feed",
        label:         insights.title,
        source:        sourceUrl || "manual_input",
        videoTitle:    videoTitle || null,
        keyInsights:   insights.keyInsights,
        scriptSnippet: insights.scriptSnippet,
        systemIdea:    insights.systemIdea,
        summary:       insights.summary,
      });
      fs.writeFileSync(KB_FILE, JSON.stringify(kb, null, 2));

      // ── Save to knowledge_base Supabase table ───────────────────────────────
      let kbEntry = null;
      try {
        // Extract title from message: "learn [title] [content]"
        // Extract title: first 1-5 words if followed by longer content
        const titleWords = content.split(' ');
        let entryTitle = videoTitle || insights.title;
        if (!videoTitle && titleWords.length > 2) {
          // Use first word(s) as title hint — up to 5 words if rest is long content
          const potentialTitle = titleWords.slice(0, Math.min(5, Math.floor(titleWords.length / 3))).join(' ');
          if (potentialTitle.length > 3 && potentialTitle.length < 60) entryTitle = potentialTitle;
        }
        const { data: kbRow } = await sb.from("knowledge_base").insert({
          title:           entryTitle,
          source:          "chris",
          content:         rawText.slice(0, 10000),
          summary:         insights.summary,
          key_concepts:    insights.keyInsights,
          best_practices:  insights.scriptSnippet ? [insights.scriptSnippet] : [],
          things_to_avoid: [],
          market_insights: insights.systemIdea ? { system_idea: insights.systemIdea } : {},
          category:        "wholesale",
        }).select().single();
        kbEntry = kbRow;

        // If in a session, track it
        if (knowledgeSessions[chatId]?.active && kbRow) {
          knowledgeSessions[chatId].entries.push({
            title:        entryTitle,
            key_concepts: insights.keyInsights,
            best_practices: insights.scriptSnippet ? [insights.scriptSnippet] : [],
          });
        }
      } catch {}

      // ── Save to jarvis_log ──────────────────────────────────────────────────
      try {
        await sb.from("jarvis_log").insert({
          type:    "knowledge_feed",
          source:  "jarvis-telegram",
          message: `[LEARNED] ${insights.title}: ${insights.keyInsights[0]}`,
        });
      } catch {}

      // ── Reply ───────────────────────────────────────────────────────────────
      const { count: kbTotal } = await sb.from("knowledge_base").select("*", { count: "exact", head: true }).catch(() => ({ count: kb.entries.length }));
      const conceptCount = insights.keyInsights.length;
      bot.sendMessage(chatId,
        `✅ <b>Knowledge saved: ${insights.title.slice(0, 80)}</b>\n\n` +
        `${insights.summary}\n\n` +
        `📌 ${conceptCount} concept${conceptCount !== 1 ? "s" : ""} extracted\n` +
        `📚 Knowledge base: ${kbTotal || kb.entries.length} total entries`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error("[Learn]", e.message);
      bot.sendMessage(chatId, `❌ Error absorbing content: ${e.message}`);
    }
    return;
  }

  // ── Ideas Board commands ─────────────────────────────────────────────────────
  if (/^new idea:/i.test(lower)) {
    const title = text.replace(/^new idea:\s*/i, "").trim();
    if (!title) { bot.sendMessage(chatId, "❌ Usage: new idea: [your idea title]"); return; }
    const { error } = await sb.from("jarvis_ideas").insert({ title, status: "new_idea" });
    if (error) { bot.sendMessage(chatId, `❌ Supabase error: ${error.message}`); return; }
    bot.sendMessage(chatId,
      `💡 Idea saved!\n\nTitle: ${title}\nStatus: New Idea\n\nSay 'my ideas' to see your full board.`
    );
    return;
  }

  if (lower === "my ideas") {
    const { data, error } = await sb.from("jarvis_ideas")
      .select("*")
      .neq("status", "archived")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) { bot.sendMessage(chatId, `❌ Supabase error: ${error.message}`); return; }
    if (!data || data.length === 0) { bot.sendMessage(chatId, "💡 No ideas yet. Say 'new idea: [title]' to add one."); return; }
    const statusEmoji = { new_idea: "💡", prompt_ready: "📋", in_progress: "🔨", done: "✅", archived: "📦" };
    const high   = data.filter(i => i.priority === "high");
    const others = data.filter(i => i.priority !== "high");
    const fmtIdea = i => `${statusEmoji[i.status] || "💡"} ${i.title} [${i.category || "—"}] — ${i.status.replace("_", " ")}`;
    let msg = `💡 JARVIS IDEAS BOARD\n─────────────────\n`;
    if (high.length)   msg += `🔴 HIGH PRIORITY:\n${high.map(fmtIdea).join("\n")}\n\n`;
    if (others.length) msg += `🟡 MEDIUM/LOW:\n${others.map(fmtIdea).join("\n")}\n`;
    msg += `─────────────────\nTotal ideas: ${data.length}`;
    bot.sendMessage(chatId, msg);
    return;
  }

  const ideaStatusMatch = lower.match(/^(idea done|working on|archive idea|prompt ready):\s*(.+)$/i);
  if (ideaStatusMatch) {
    const cmd     = ideaStatusMatch[1].toLowerCase().trim();
    const keyword = ideaStatusMatch[2].toLowerCase().trim();
    const statusMap = { "idea done": "done", "working on": "in_progress", "archive idea": "archived", "prompt ready": "prompt_ready" };
    const replyPfx  = { "idea done": "✅ Marked as done", "working on": "🔨 Marked as in progress", "archive idea": "📦 Archived", "prompt ready": "📋 Marked as prompt ready" };
    const newStatus = statusMap[cmd];
    const { data: rows } = await sb.from("jarvis_ideas").select("id, title").ilike("title", `%${keyword}%`).limit(1);
    if (!rows || rows.length === 0) { bot.sendMessage(chatId, `❌ No idea found matching "${keyword}"`); return; }
    await sb.from("jarvis_ideas").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", rows[0].id);
    bot.sendMessage(chatId, `${replyPfx[cmd]}: ${rows[0].title}`);
    return;
  }

  // ── "call [name or phone]" ───────────────────────────────────────────────────
  const callNameMatch = lower.match(/^call (.+)$/i);
  if (callNameMatch) {
    const input = callNameMatch[1].trim();

    // ── Direct dial: skip GHL entirely ────────────────────────────────────────
    if (isPhoneNumber(input)) {
      const phone = normalizePhone(input);
      pendingCallConfirm[chatId] = {
        callerArgs:   `--phone "${phone}"`,
        label:        `direct dial ${phone}`,
        count:        1,
        sessionStart: Date.now(),
      };
      bot.sendMessage(chatId,
        `📞 Direct dial to <b>${phone}</b> — no GHL lookup.\nReply YES to confirm or NO to cancel.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Name search with fallback chain ───────────────────────────────────────
    await bot.sendMessage(chatId, `🔍 Searching GHL for "<b>${input}</b>"...`, { parse_mode: "HTML" });

    const { contact, suggestions } = await searchGHLContact(input);

    if (!contact) {
      const suggLines = suggestions.length
        ? "\n\nDid you mean one of these?\n" +
          suggestions.map((c, i) => `${i + 1}. ${contactDisplayName(c)}${c.phone ? " · " + c.phone : ""}`).join("\n")
        : "";
      bot.sendMessage(chatId, `Found 0 results for "<b>${input}</b>".${suggLines}`, { parse_mode: "HTML" });
      return;
    }

    const displayName = contactDisplayName(contact);
    const callerArgs  = `--contactId ${contact.id}`;
    pendingCallConfirm[chatId] = {
      callerArgs,
      label:        `${displayName} (single call)`,
      count:        1,
      sessionStart: Date.now(),
    };
    bot.sendMessage(chatId,
      `📞 Found: <b>${displayName}</b>${contact.phone ? " · " + contact.phone : ""}.\nReply YES to confirm or NO to cancel.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ── ASAP ARV commands ────────────────────────────────────────────────────────
  if (lower === "asap status") {
    try {
      const [
        { count: totalProps },
        { count: totalPhotos },
        { data: cities },
      ] = await Promise.all([
        sb.from("asap_sold_properties").select("*", { count: "exact", head: true }),
        sb.from("asap_sold_properties").select("*", { count: "exact", head: true }).eq("photos_collected", true),
        sb.from("asap_cities").select("*").order("id"),
      ]);

      const complete = (cities || []).filter(c => c.status === "complete").length;
      const total    = (cities || []).length;

      let msg = `🏠 ASAP ARV SCRAPER STATUS\n─────────────────────────\n`;
      msg += `Total properties: ${(totalProps || 0).toLocaleString()}\n`;
      msg += `With photos: ${(totalPhotos || 0).toLocaleString()}\n`;
      msg += `Cities complete: ${complete}/${total}\n\n`;

      for (const c of cities || []) {
        const scraped = c.scraped_count || 0;
        const photos  = c.photos_count  || 0;
        const pct     = scraped > 0 ? Math.round((photos / scraped) * 100) : 0;

        if (c.status === "in_progress" || c.status === "photos_pending") {
          const { data: cityProps } = await sb.from("asap_sold_properties").select("id, beds").eq("city", c.city).eq("state", c.state);
          const fullData = (cityProps || []).filter(p => p.beds).length;
          const fullPct  = scraped > 0 ? Math.round((fullData / scraped) * 100) : 0;
          msg += `${c.city} ${c.state}:\n`;
          msg += `  Scraped: ${scraped.toLocaleString()} properties\n`;
          msg += `  Photos: ${pct}%\n`;
          msg += `  Data complete: ${fullPct}%\n`;
          msg += `  Status: ${c.status}\n\n`;
        } else {
          msg += `${c.city} ${c.state}: ${c.status || "queued"}\n`;
        }
      }

      msg += `─────────────────────────\nSay 'asap start [city]' to begin scraping`;
      bot.sendMessage(chatId, msg);
    } catch(e) {
      bot.sendMessage(chatId, `❌ ASAP status error: ${e.message}`);
    }
    return;
  }

  const asapStartMatch = lower.match(/^asap start (.+)$/i);
  if (asapStartMatch) {
    const cityName = asapStartMatch[1].trim();
    bot.sendMessage(chatId, `🚀 Starting scraper for ${cityName}...\nRunning: pm2 start asap-scraper\nCheck progress with 'asap status'`);
    const scriptDir = path.join(__dirname);
    exec(`source ~/.nvm/nvm.sh && pm2 start asap-scraper`, { cwd: scriptDir, shell: "/bin/bash" }, (err, stdout, stderr) => {
      if (err) {
        bot.sendMessage(chatId, `⚠️ PM2 start result: ${err.message}`);
      } else {
        bot.sendMessage(chatId, `✅ asap-scraper started. Check 'asap logs' for output.`);
      }
    });
    return;
  }

  if (lower === "asap stop") {
    exec(`source ~/.nvm/nvm.sh && pm2 stop asap-scraper`, { shell: "/bin/bash" }, (err, stdout) => {
      if (err) {
        bot.sendMessage(chatId, `⚠️ PM2 stop: ${err.message}`);
      } else {
        bot.sendMessage(chatId, `🛑 asap-scraper stopped.`);
      }
    });
    return;
  }

  if (lower === "asap logs") {
    exec(`source ~/.nvm/nvm.sh && pm2 logs asap-scraper --nostream --lines 20 2>&1`, { shell: "/bin/bash" }, (err, stdout, stderr) => {
      const output = (stdout || stderr || "No output").slice(-3000);
      bot.sendMessage(chatId, `📋 ASAP Scraper logs (last 20 lines):\n\`\`\`\n${output}\n\`\`\``);
    });
    return;
  }

  // ── David call status — direct Supabase query, zero Claude tokens ─────────────
  if (lower === "status" || lower === "david status" || lower === "call status") {
    try {
      const now       = new Date();
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7);

      const [
        { data: todayCalls },
        { data: weekCalls },
        { data: lastCallRows },
      ] = await Promise.all([
        sb.from("jarvis_calls").select("id").gte("called_at", todayStart.toISOString()),
        sb.from("jarvis_calls").select("id").gte("called_at", weekStart.toISOString()),
        sb.from("jarvis_calls")
          .select("contact_name, called_at, stage_after")
          .order("called_at", { ascending: false })
          .limit(1),
      ]);

      const last = lastCallRows?.[0];
      const OUTCOME_LABEL = {
        "Hot Follow Up":           "🔥 hot",
        "Warm Follow Up":          "🟡 warm",
        "Cold Follow Up":          "🔵 cold",
        "Attempt 1 No Contact":    "📵 voicemail",
        "Attempt 2 No Contact":    "📵 voicemail",
        "Attempt 3-5 No Contact":  "📵 voicemail",
        "Attempt 6+ Unresponsive": "📵 voicemail",
      };
      const outcomeLabel = OUTCOME_LABEL[last?.stage_after] || last?.stage_after || "—";
      const lastTime = last?.called_at
        ? new Date(last.called_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })
        : "—";

      const callerStatus = await new Promise(resolve => {
        exec("source ~/.nvm/nvm.sh && pm2 jlist 2>/dev/null", { shell: "/bin/bash" }, (err, stdout) => {
          try {
            const list = JSON.parse(stdout || "[]");
            const proc = list.find(p => p.name === "jarvis-caller");
            resolve(proc?.pm2_env?.status === "online" ? "🟢 active" : "🟡 standby");
          } catch { resolve("🟡 standby"); }
        });
      });

      await bot.sendMessage(chatId,
        `📞 DAVID CALL STATUS\n` +
        `─────────────────────\n` +
        `Calls today: ${todayCalls?.length || 0}\n` +
        `Calls this week: ${weekCalls?.length || 0}\n` +
        `Last call: ${last?.contact_name || "none yet"} at ${lastTime}\n` +
        `Last outcome: ${outcomeLabel}\n` +
        `Currently: ${callerStatus}`
      );
      return;
    } catch (e) {
      await bot.sendMessage(chatId, `❌ Status error: ${e.message}`);
      return;
    }
  }

  // ── "log call" / "logged call" — log Chris personal call + trigger coaching ────
  const isLogCall = lower.startsWith("log call ") || lower.startsWith("log call:")
                 || lower.startsWith("logged call ") || lower.startsWith("logged call:");
  if (isLogCall) {
    const prefixLen = lower.startsWith("logged call:") ? 12
                    : lower.startsWith("logged call ") ? 12
                    : lower.startsWith("log call:")    ? 9
                    : 9;
    const notes = text.slice(prefixLen).trim();
    if (!notes) {
      bot.sendMessage(chatId, "Usage: logged call [outcome and notes]\nExample: logged call contacted motivated seller asked $220k offer pending");
      return;
    }
    const nameMatch   = notes.match(/(?:with|called?)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i);
    const contactName = nameMatch ? nameMatch[1] : "Unknown Seller";

    const { data: inserted } = await sb.from("jarvis_calls").insert({
      contact_name: contactName,
      caller:       "chris",
      called_at:    new Date().toISOString(),
      notes,
      summary:      notes.slice(0, 200),
    }).select().single().catch(() => ({ data: null }));

    bot.sendMessage(chatId, `📞 Call logged. Running coaching analysis now...`);

    // Trigger coaching (non-blocking)
    try {
      const { coachChrisCall } = require("./chris-coach");
      const callObj = inserted || { contact_name: contactName, notes, called_at: new Date().toISOString() };
      coachChrisCall(callObj).catch(e => console.error("[coaching] Error:", e.message));
    } catch (e) { console.error("[coaching] require error:", e.message); }

    // Update daily_metrics + check contact rate (non-blocking)
    try {
      require("./chris-accountability").logCallMetric(notes).catch(e => console.error("[acct] logCallMetric:", e.message));
    } catch {}

    return;
  }

  // ── "logged offer $amount to [name] [address]" ───────────────────────────────
  if (lower.startsWith("logged offer") || lower.startsWith("log offer")) {
    // Format: logged offer $185k to Maria Rodriguez 123 Main St Orlando
    const offerMatch = text.match(/log(?:ged)?\s+offer\s+\$?([\d,.kKmM]+)\s+to\s+(.+)/i);
    if (!offerMatch) {
      bot.sendMessage(chatId, "Usage: logged offer $185k to Maria Rodriguez 123 Main St Orlando");
      return;
    }

    // Parse amount (supports 185k, 185,000, 185000)
    const rawAmt   = offerMatch[1].replace(/,/g, "").replace(/k$/i, "000").replace(/m$/i, "000000");
    const amount   = parseFloat(rawAmt);
    const rest     = offerMatch[2].trim();

    // Split "Maria Rodriguez 123 Main St Orlando" → name vs address
    // Name = first 2-3 words if they look like a name (Title Case), rest = address
    const nameParts = rest.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\s+(\d.+)$/);
    const contactName = nameParts ? nameParts[1] : rest.split(/\s+/).slice(0, 2).join(" ");
    const address     = nameParts ? nameParts[2] : rest.split(/\s+/).slice(2).join(" ") || "Unknown";

    bot.sendMessage(chatId, `💰 Offer logged: $${amount.toLocaleString()} to ${contactName} at ${address}`);

    try {
      await require("./chris-accountability").logOffer({ amount, contactName, address });
    } catch (e) { console.error("[acct] logOffer:", e.message); }

    return;
  }

  // ── "my script [content]" — save Chris's sales script for comparison ──────────
  if (lower.startsWith("my script ") || lower.startsWith("my script:") || lower === "my script") {
    if (lower === "my script") {
      // Show current script
      const { data } = await sb.from("chris_scripts").select("title, content, created_at").order("created_at", { ascending: false }).limit(1);
      if (data?.[0]) {
        const saved = data[0];
        const savedDate = new Date(saved.created_at).toLocaleDateString("en-US");
        bot.sendMessage(chatId, `📋 Your saved script (${savedDate}):\n\n${saved.content.slice(0, 1000)}${saved.content.length > 1000 ? "\n..." : ""}`);
      } else {
        bot.sendMessage(chatId, `No script saved yet. Send: my script [your script text]`);
      }
      return;
    }
    const scriptContent = text.slice(lower.startsWith("my script:") ? 10 : 10).trim();
    await sb.from("chris_scripts").insert({ title: "Chris Script", content: scriptContent });
    bot.sendMessage(chatId, `✅ Script saved. I'll compare it against your future calls automatically.`);
    return;
  }

  // Auto-detect and log activity
  const logInfo     = detectLogType(text);
  const logContact  = extractContact(text);
  if (logInfo) {
    await log(logInfo.type, text, logContact, "telegram", logInfo.priority);
    console.log(`Auto-logged: ${logInfo.type} — ${logContact || 'no contact'}`);
  }

  let context = "";
  if (lower.includes("pipeline") || lower.includes("deal") || lower.includes("lead") || lower.includes("ghl") || lower.includes("status") || lower.includes("how many") || lower.includes("what's going")) {
    context = await getGHLPipeline();
  }

  const userMessage = context ? `${text}\n\n[LIVE DATA]: ${context}` : text;
  await saveMessage(chatId, "user", userMessage);
  const messages = await loadRecentMessages(chatId, 10);

  try {
    const response = await aiChat({
      max_tokens: 500,
      system: SYSTEM,
      messages,
    });
    const reply = response.text;
    await saveMessage(chatId, "assistant", reply);

    // Log Jarvis responses about deals/hot leads
    if (reply.toLowerCase().includes("hot") || reply.toLowerCase().includes("priority") || reply.toLowerCase().includes("close")) {
      await log("system", `Jarvis: ${reply.slice(0,150)}`, null, "jarvis_response", "normal");
    }

    bot.sendMessage(chatId, reply);
    console.log("Jarvis:", reply.slice(0,100));
  } catch(e) {
    console.error("Error:", e.message);
    bot.sendMessage(chatId, "Error: " + e.message);
  }
});

// ── GHL/Twilio webhook server (port 3001) ─────────────────────────────────────
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;

const webhookApp = express();
webhookApp.use(express.json());
webhookApp.use(express.urlencoded({ extended: false })); // Twilio sends urlencoded

webhookApp.post("/ghl-call-webhook", (req, res) => {
  // Acknowledge GHL immediately
  res.sendStatus(200);

  const payload   = req.body;
  const contactId = payload.contactId || payload.contact_id
    || payload.data?.contactId || payload.data?.contact_id;
  const callId    = payload.callId || payload.call_id
    || payload.data?.id || payload.data?.messageId || payload.data?.callId;

  if (!contactId) {
    console.log("[GHL Webhook] Missing contactId:", JSON.stringify(payload).substring(0, 200));
    return;
  }

  const scriptPath = path.join(__dirname, "call-analyzer.js");
  const args = callId
    ? `--callId ${callId} --contactId ${contactId}`
    : `--contactId ${contactId}`;
  const cmd = `node ${scriptPath} ${args}`;

  console.log(`[GHL Webhook] Triggering: ${cmd}`);
  exec(cmd, { cwd: __dirname, env: process.env }, (err, stdout, stderr) => {
    if (err)    console.error("[GHL Webhook] Analyzer error:", err.message);
    if (stdout) console.log("[GHL Webhook] Output:", stdout.substring(0, 500));
    if (stderr) console.error("[GHL Webhook] Stderr:", stderr.substring(0, 200));
  });
});


// ── ElevenLabs recording proxy ───────────────────────────────────────────────
webhookApp.get("/elevenlabs-recording/:conversationId", async (req, res) => {
  const { conversationId } = req.params;
  const elKey = process.env.ELEVENLABS_API_KEY;
  if (!elKey) return res.status(500).send("ElevenLabs API key not configured");
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}/audio`,
      { headers: { "xi-api-key": elKey } }
    );
    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).send(body);
    }
    res.setHeader("Content-Type", upstream.headers.get("Content-Type") || "audio/mpeg");
    res.setHeader("Content-Disposition", `inline; filename="${conversationId}.mp3"`);
    upstream.body.pipe(res);
  } catch (e) {
    console.error("[EL Recording Proxy] Error:", e.message);
    res.status(500).send("Proxy error");
  }
});


// ── GHL Intelligence webhook — stage changes, notes, opportunities ─────────────
webhookApp.post("/ghl/webhook", (req, res) => {
  res.sendStatus(200); // acknowledge immediately
  try {
    require("./ghl-intelligence").handleGHLWebhook(req.body)
      .catch(e => console.error("[GHL Intel] webhook error:", e.message));
  } catch (e) { console.error("[GHL Intel] require error:", e.message); }
});

const WEBHOOK_PORT = 3001;
webhookApp.listen(WEBHOOK_PORT, () => {
  const tunnelBase = process.env.WEBHOOK_URL || process.env.CLOUDFLARE_URL || `http://localhost:${WEBHOOK_PORT}`;
  console.log(`[GHL Webhook] Server on port ${WEBHOOK_PORT}`);
  console.log(`[GHL Webhook] GHL call webhook: ${tunnelBase}/ghl-call-webhook`);
  console.log(`[GHL Intelligence] GHL events webhook: ${tunnelBase}/ghl/webhook`);
  console.log(`[GHL Intel] Setup: GHL → Settings → Integrations → Webhooks → Add → ${tunnelBase}/ghl/webhook`);
  console.log(`[GHL Intel] Events: OpportunityStageUpdate, NoteCreate, OpportunityCreate, AppointmentCreate, TaskComplete`);

});

// ── Nightly cost report (11pm daily) ─────────────────────────────────────────
async function sendDailyCostReport() {
  try {
    // Use local midnight (Mac timezone = EST) so counts match the business day
    const tsStart = new Date(); tsStart.setHours(0, 0, 0, 0);
    const tsEnd   = new Date(); tsEnd.setHours(23, 59, 59, 999);
    const todayStart = tsStart.toISOString();
    const todayEnd   = tsEnd.toISOString();
    const today      = tsStart.toLocaleDateString("en-CA"); // YYYY-MM-DD for display

    const { data: costLogs }    = await sb.from("jarvis_log").select("*").eq("type", "api_cost").gte("created_at", todayStart).lte("created_at", todayEnd);
    const { data: callsToday }  = await sb.from("jarvis_calls").select("id,stage_after").gte("called_at", todayStart).lte("called_at", todayEnd);
    const { data: leadsToday }  = await sb.from("jarvis_log").select("id").in("type", ["lead", "new_lead"]).gte("created_at", todayStart).lte("created_at", todayEnd);
    const { data: analyzedToday } = await sb.from("jarvis_log").select("id").eq("type", "followup").gte("created_at", todayStart).lte("created_at", todayEnd);

    let totalCost = 0, totalTokens = 0;
    for (const entry of costLogs || []) {
      try {
        const d = JSON.parse(entry.message);
        totalCost   += d.estimated_cost || 0;
        totalTokens += (d.input_tokens || 0) + (d.output_tokens || 0);
      } catch {}
    }

    const apiCallCount     = costLogs?.length || 0;
    const projectedMonthly = totalCost * 30;
    const davidCalls       = callsToday?.length || 0;
    const hotToday         = (callsToday || []).filter(c => c.stage_after === "Hot Follow Up").length;
    const warmToday        = (callsToday || []).filter(c => c.stage_after === "Warm Follow Up").length;
    const twilioEstimate   = davidCalls * 0.045 * 30;
    const totalMonthlyBurn = projectedMonthly + twilioEstimate;

    const report =
      `📊 Daily Cost Report — ${today}\n` +
      `─────────────────\n` +
      `📞 David Calls Today: ${davidCalls}\n` +
      `   🔥 Hot: ${hotToday}  🟡 Warm: ${warmToday}\n` +
      `🏠 New leads scraped: ${leadsToday?.length || 0}\n` +
      `📋 Leads analyzed: ${analyzedToday?.length || 0}\n` +
      `─────────────────\n` +
      `🤖 Claude API\n` +
      `API calls today: ${apiCallCount}\n` +
      `Tokens used: ${totalTokens.toLocaleString()}\n` +
      `Cost today: $${totalCost.toFixed(4)}\n` +
      `Projected monthly: $${projectedMonthly.toFixed(2)}\n` +
      `─────────────────\n` +
      `💰 Est. total monthly burn: $${totalMonthlyBurn.toFixed(2)}`;

    const CHAT_ID = "8105811341";
    await fetch(`https://api.telegram.org/bot8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: CHAT_ID, text: report }),
    });
    console.log("[Cron] Nightly cost report sent.");
  } catch (e) {
    console.error("[Cron] Cost report error:", e.message);
  }
}

cron.schedule("0 23 * * *", sendDailyCostReport);
console.log("[Cron] Nightly cost report scheduled at 11pm daily.");

// ── Shared GHL helpers for daily briefings ────────────────────────────────────
const BOT_TOKEN = "8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0";
const CHAT_ID   = "8105811341";

async function tgSend(text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
  });
}

// Fetch all open leads in a stage across one or both pipelines
async function getHotLeads() {
  const results = [];
  const stages = [
    { pipelineId: VA_PIPELINE, stageId: VA_STAGE_IDS["Hot Follow Up"], label: "VA" },
    { pipelineId: WS_PIPELINE, stageId: WS_STAGE_IDS["Hot Follow Up"], label: "WS" },
  ];
  for (const { pipelineId, stageId, label } of stages) {
    try {
      const r = await fetch(
        `https://services.leadconnectorhq.com/opportunities/search?pipeline_id=${pipelineId}&location_id=${LOCATION_ID}&pipeline_stage_id=${stageId}&status=open&limit=20`,
        { headers: { "Authorization": `Bearer ${GHL_TOKEN}`, "Version": "2021-07-28" } }
      );
      const d = await r.json();
      for (const opp of d.opportunities || []) {
        const contact = opp.contact || {};
        const createdAt = new Date(opp.createdAt || opp.created_at || Date.now());
        const daysInStage = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
        results.push({
          name:        contact.name || `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Unknown",
          phone:       contact.phone || contact.primaryPhone || "No phone",
          daysInStage,
          pipeline:    label,
        });
      }
    } catch {}
  }
  return results;
}

async function getPipelineSnapshot() {
  const counts = {};
  const queries = [
    { key: "VA Hot Follow Up",   pipelineId: VA_PIPELINE, stageId: VA_STAGE_IDS["Hot Follow Up"]  },
    { key: "VA Warm Follow Up",  pipelineId: VA_PIPELINE, stageId: VA_STAGE_IDS["Warm Follow Up"] },
    { key: "VA New Lead",        pipelineId: VA_PIPELINE, stageId: VA_STAGE_IDS["New Lead"]       },
    { key: "WS Hot Follow Up",   pipelineId: WS_PIPELINE, stageId: WS_STAGE_IDS["Hot Follow Up"]  },
    { key: "WS Warm Follow Up",  pipelineId: WS_PIPELINE, stageId: WS_STAGE_IDS["Warm Follow Up"] },
  ];
  // Decision Pending (VA) — fetch dynamically
  try {
    const r = await fetch(
      `https://services.leadconnectorhq.com/opportunities/search?pipeline_id=${VA_PIPELINE}&location_id=${LOCATION_ID}&status=open&limit=100`,
      { headers: { "Authorization": `Bearer ${GHL_TOKEN}`, "Version": "2021-07-28" } }
    );
    const d = await r.json();
    const opps = d.opportunities || [];
    counts["VA Decision Pending"] = opps.filter(o => o.pipelineStage?.name === "Decision Pending").length;
  } catch { counts["VA Decision Pending"] = "?"; }

  for (const { key, pipelineId, stageId } of queries) {
    counts[key] = await countLeadsInStage(pipelineId, stageId);
  }
  return counts;
}

async function getMonthlyDealCount() {
  try {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`;
    const { data } = await sb.from("jarvis_log").select("id").in("type", ["deal", "closed"]).gte("created_at", monthStart);
    return data?.length || 0;
  } catch { return 0; }
}

// ── TASK 1: Morning Briefing (7:30am Mon-Fri) ─────────────────────────────────
async function sendMorningBriefing() {
  try {
    const now   = new Date();
    const days  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const months= ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dayName = days[now.getDay()];
    const dateStr = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
    const isAsapDay = [1, 3, 5].includes(now.getDay()); // Mon/Wed/Fri

    const [hotLeads, snapshot, dealCount, calEvents] = await Promise.all([
      getHotLeads(),
      getPipelineSnapshot(),
      getMonthlyDealCount(),
      getCalendarEvents(new Date()),
    ]);

    const hotLeadLines = hotLeads.length
      ? hotLeads.map(l =>
          `🔥 ${l.name} — ${l.phone} (${l.daysInStage}d in stage, ${l.pipeline})`
        ).join("\n")
      : "None right now — keep pushing!";

    const msg =
      `☀️ Good morning Chris! Let's get it.\n` +
      `📅 ${dayName}, ${dateStr}\n` +
      `─────────────────\n` +
      `🔥 HOT LEADS — Call these yourself today:\n` +
      `${hotLeadLines}\n\n` +
      `📞 PIPELINE SNAPSHOT\n` +
      `Hot Follow Up (VA): ${snapshot["VA Hot Follow Up"]}\n` +
      `Hot Follow Up (WS): ${snapshot["WS Hot Follow Up"]}\n` +
      `Warm Follow Up (VA): ${snapshot["VA Warm Follow Up"]}\n` +
      `Decision Pending: ${snapshot["VA Decision Pending"]}\n` +
      `New Leads: ${snapshot["VA New Lead"]}\n\n` +
      `🗓 TODAY'S CALENDAR\n` +
      (calEvents.length
        ? calEvents.map(ev => {
            const t = ev.start?.dateTime
              ? new Date(ev.start.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
              : "All day";
            return `• ${t} — ${ev.summary || "Untitled"}`;
          }).join("\n")
        : "Nothing scheduled") +
      `\n\n` +
      `📋 TODAY'S FOCUS\n` +
      `✅ 7:00am — Gym\n` +
      `✅ 8:00am — Review this briefing\n` +
      `✅ 9:00am — Call hot leads personally\n` +
      (isAsapDay ? `✅ 11:00am — ASAP ARV work\n` : `✅ 11:00am — Pipeline follow-ups\n`) +
      `✅ 4:00pm — CRM cleanup\n\n` +
      `💰 GOAL TRACKER\n` +
      `Deals this month: ${dealCount}\n` +
      `Target: $30,000\n` +
      `─────────────────\n` +
      `🤖 <b>DAVID STATUS</b>: Paused. Send <b>david on</b> to activate him today or ignore to keep paused.\n` +
      `─────────────────\n` +
      `Reply 'status' anytime for a live update.`;

    await tgSend(msg);
    console.log("[Cron] Morning briefing sent.");
  } catch (e) {
    console.error("[Cron] Morning briefing error:", e.message);
  }
}

// ── TASK 2: Midday Check-in (12:30pm Mon-Fri) ─────────────────────────────────
async function sendMiddayCheckin() {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: calledToday } = await sb.from("jarvis_calls")
      .select("contact_id, contact_name")
      .gte("called_at", todayStart.toISOString());
    const calledIds = new Set((calledToday || []).map(c => c.contact_id).filter(Boolean));

    const hotLeads = await getHotLeads();
    const notYetCalled = hotLeads.filter(l => !calledIds.has(l.contactId));

    const listLines = notYetCalled.length
      ? notYetCalled.map(l => `🔥 ${l.name} — ${l.phone}`).join("\n")
      : "All hot leads have been called today. 💪";

    const msg =
      `⚡️ Midday check-in Chris\n` +
      `─────────────────\n` +
      `Have you called your hot leads yet today?\n` +
      `David is making calls right now.\n\n` +
      `🔥 Still needs your personal call:\n` +
      `${listLines}\n\n` +
      `Reply 'yes done' or 'call [name]' to trigger David.`;

    await tgSend(msg);
    console.log("[Cron] Midday check-in sent.");
  } catch (e) {
    console.error("[Cron] Midday check-in error:", e.message);
  }
}

// ── TASK 3: End of Day Wrap (5pm Mon-Fri) ─────────────────────────────────────
async function sendEndOfDayWrap() {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    const now   = new Date();
    const months= ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dateStr = `${months[now.getMonth()]} ${now.getDate()}`;

    const [
      { data: callsToday },
      { data: leadsToday },
    ] = await Promise.all([
      sb.from("jarvis_calls").select("stage_after, contact_id").gte("called_at", todayStartIso),
      sb.from("jarvis_log").select("id").in("type", ["lead", "new_lead"]).gte("created_at", todayStartIso),
    ]);

    const callCount  = callsToday?.length || 0;
    const hotReached = (callsToday || []).filter(c =>
      ["Hot Follow Up", "Decision Pending", "Contract Sent"].includes(c.stage_after)
    ).length;
    const appts = (callsToday || []).filter(c =>
      ["Decision Pending", "Contract Sent"].includes(c.stage_after)
    ).length;
    const newLeads = leadsToday?.length || 0;

    // Tomorrow's hot leads
    const hotLeads   = await getHotLeads();
    const tomorrowList = hotLeads.length
      ? hotLeads.map(l => `🔥 ${l.name} — ${l.phone}`).join("\n")
      : "Check back tomorrow morning.";

    const msg =
      `🌆 End of day wrap — ${dateStr}\n` +
      `─────────────────\n` +
      `📞 Calls made today: ${callCount}\n` +
      `🔥 Hot leads reached: ${hotReached}\n` +
      `📋 New leads added: ${newLeads}\n` +
      `💰 Appointments set: ${appts}\n\n` +
      `Tomorrow's hot leads to call:\n` +
      `${tomorrowList}\n\n` +
      `Great work today. Rest up. 💪`;

    await tgSend(msg);
    console.log("[Cron] End of day wrap sent.");
  } catch (e) {
    console.error("[Cron] End of day wrap error:", e.message);
  }
}

cron.schedule("30 7 * * 1-5",  sendMorningBriefing);
cron.schedule("30 12 * * 1-5", sendMiddayCheckin);
cron.schedule("0 17 * * 1-5",  sendEndOfDayWrap);
console.log("[Cron] Morning briefing (7:30am), midday check-in (12:30pm), EOD wrap (5pm) scheduled Mon-Fri.");

console.log("Jarvis ONLINE — GHL + Supabase logging active!");
