#!/usr/bin/env node
// aria-agent.js — Appointment Prep Agent
// Monitors Google Calendar, fires 30min before seller appointments
// Sends Chris a full pre-call brief via Telegram

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");
const { google } = require("googleapis");
const cron = require("node-cron");
const fs   = require("fs");
const path = require("path");

const sb     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_PIPELINE = "o4kqU2y8DYjA73aKUxNu";
const GHL_API      = "https://services.leadconnectorhq.com";
const GHL_HEADERS  = { "Authorization": `Bearer ${GHL_TOKEN}`, "Content-Type": "application/json", "Version": "2021-07-28" };
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

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

// ── Google Calendar auth ───────────────────────────────────────────────────────
function getGoogleAuth() {
  const credsPath  = path.join(__dirname, "gmail-credentials.json");
  const tokenPath  = path.join(__dirname, "gmail-token.json");
  if (!fs.existsSync(credsPath) || !fs.existsSync(tokenPath)) return null;
  try {
    const creds  = JSON.parse(fs.readFileSync(credsPath));
    const token  = JSON.parse(fs.readFileSync(tokenPath));
    const { client_secret, client_id, redirect_uris } = creds.installed || creds.web;
    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(token);
    return auth;
  } catch { return null; }
}

// ── Get upcoming calendar events (next 60 min) ─────────────────────────────────
async function getUpcomingAppointments() {
  const auth = getGoogleAuth();
  if (!auth) { console.warn("[Aria] No Google auth — skipping calendar check"); return []; }

  const calendar = google.calendar({ version: "v3", auth });
  const now   = new Date();
  const in90m = new Date(now.getTime() + 90 * 60 * 1000);
  const in20m = new Date(now.getTime() + 20 * 60 * 1000);

  try {
    const res = await calendar.events.list({
      calendarId:   "primary",
      timeMin:      in20m.toISOString(),
      timeMax:      in90m.toISOString(),
      singleEvents: true,
      orderBy:      "startTime",
    });
    return (res.data.items || []).filter(e => {
      const title = (e.summary || "").toLowerCase();
      const desc  = (e.description || "").toLowerCase();
      // Only prep seller calls — look for address-like content or "seller" keyword
      return (
        title.includes("seller") ||
        title.includes("call") ||
        title.includes("appointment") ||
        desc.includes("address") ||
        /\d{3,5}\s+\w+/.test(e.summary || "") // address pattern
      );
    });
  } catch (e) {
    console.warn("[Aria] Calendar fetch failed:", e.message);
    return [];
  }
}

// ── Extract seller name and address from event ─────────────────────────────────
function parseEventDetails(event) {
  const title = event.summary || "";
  const desc  = event.description || "";
  const combined = `${title} ${desc}`;

  // Try to extract address (number + street name)
  const addressMatch = combined.match(/\d{2,5}\s+[A-Za-z\s]{3,30}(?:St|Ave|Blvd|Dr|Rd|Ln|Ct|Way|Circle|Drive|Street|Avenue|Road|Lane|Court)/i);
  const address = addressMatch ? addressMatch[0].trim() : null;

  // Extract name — assume first capitalized words before any address
  const nameMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
  const sellerName = nameMatch ? nameMatch[1] : title.split(/[-–|]/)[0].trim();

  return { sellerName, address, eventTitle: title, startTime: event.start?.dateTime || event.start?.date };
}

// ── Look up seller in GHL ──────────────────────────────────────────────────────
async function findSellerInGHL(sellerName, address) {
  // Search by name first
  try {
    const data = await ghl("GET", `/contacts/?locationId=${GHL_LOCATION}&query=${encodeURIComponent(sellerName)}&limit=5`);
    const contacts = data.contacts || [];
    if (contacts.length > 0) return contacts[0];
  } catch {}

  // Try address search if name fails
  if (address) {
    try {
      const data = await ghl("GET", `/contacts/?locationId=${GHL_LOCATION}&query=${encodeURIComponent(address.split(" ")[0])}&limit=5`);
      const contacts = data.contacts || [];
      const match = contacts.find(c => (c.address1 || "").toLowerCase().includes(address.toLowerCase().substring(0,10)));
      if (match) return match;
    } catch {}
  }
  return null;
}

// ── Get all intel for seller ───────────────────────────────────────────────────
async function getSellerIntel(contactId) {
  const [calls, approval, scout] = await Promise.all([
    sb.from("jarvis_calls").select("*").eq("contact_id", contactId).order("called_at", { ascending: false }).limit(3),
    sb.from("david_pending_approvals").select("*").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(1),
    sb.from("scout_reports").select("*").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(1),
  ]);
  return {
    calls:    calls.data  || [],
    approval: approval.data?.[0] || null,
    scout:    scout.data?.[0]   || null,
  };
}

// ── Generate pre-call brief ────────────────────────────────────────────────────
async function generateBrief(event, contact, intel) {
  const { calls, approval, scout } = intel;
  const topCall = calls[0];

  const callSummary = calls.length > 0
    ? calls.map(c => `${new Date(c.called_at).toLocaleDateString()}: ${c.summary || c.notes?.substring(0,200)}`).join("\n")
    : "No prior David calls logged.";

  const arvInfo = approval
    ? `ARV: $${approval.arv?.toLocaleString() || "?"} | Repairs: $${approval.repair_cost?.toLocaleString() || "?"} | 60%: $${approval.offer_60?.toLocaleString() || "?"} | 65%: $${approval.offer_65?.toLocaleString() || "?"} | 70%: $${approval.offer_70?.toLocaleString() || "?"}`
    : "No ARV data available.";

  try {
    const res = await claude.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system:     "You are Aria, an appointment prep assistant for a wholesale real estate investor named Chris. Be concise and actionable.",
      messages: [{
        role: "user",
        content:
          `Prepare a pre-call brief for Chris's upcoming seller appointment.\n\n` +
          `Seller: ${contact?.name || event.sellerName}\n` +
          `Address: ${event.address || contact?.address1}\n` +
          `ARV/Offer data: ${arvInfo}\n` +
          `David's call history:\n${callSummary}\n` +
          `Scout intelligence: ${scout?.summary || "None"}\n\n` +
          `Generate a brief with:\n` +
          `1. suggested_opener: specific first line Chris should say\n` +
          `2. three_objections: array of 3 likely objections based on prior conversation\n` +
          `3. offer_strategy: cash or novation, at what range, how to justify\n` +
          `4. key_rapport_points: things David learned that Chris should reference\n` +
          `5. watch_out: any red flags or sensitivities to avoid\n\n` +
          `Return JSON with those exact keys.`
      }],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/,"").replace(/```\s*$/,"");
    return JSON.parse(raw);
  } catch { return null; }
}

// ── Send Aria brief to Telegram ────────────────────────────────────────────────
async function sendBrief(event, contact, intel, brief) {
  const { calls, approval, scout } = intel;
  const startTime = new Date(event.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const topCall = calls[0];

  const msg =
    `📋 ARIA — PRE-CALL BRIEF\n` +
    `Appointment in ~30 minutes: ${startTime}\n\n` +
    `👤 Seller: ${contact?.name || event.sellerName}\n` +
    `🏠 Property: ${event.address || contact?.address1 || "—"}\n` +
    `📊 Motivation Score: ${scout?.estimated_motivation || topCall?.summary?.match(/score\s*(\d)/i)?.[1] || "—"}/10\n\n` +
    (approval ? (
      `💰 NUMBERS:\n` +
      `ARV: $${approval.arv?.toLocaleString() || "?"}\n` +
      `Repairs: $${approval.repair_cost?.toLocaleString() || "?"}\n` +
      `Offer range: $${approval.offer_60?.toLocaleString()} – $${approval.offer_70?.toLocaleString()}\n\n`
    ) : "") +
    (topCall?.notes ? `📝 David's Notes:\n${topCall.notes.substring(0, 400)}\n\n` : "") +
    (brief ? (
      `🎯 SUGGESTED OPENER:\n"${brief.suggested_opener}"\n\n` +
      `⚠️ LIKELY OBJECTIONS:\n${(brief.three_objections || []).map(o => `• ${o}`).join("\n")}\n\n` +
      `💼 OFFER STRATEGY:\n${brief.offer_strategy}\n\n` +
      `🔑 RAPPORT POINTS:\n${(brief.key_rapport_points || []).map(p => `• ${p}`).join("\n")}\n\n` +
      (brief.watch_out ? `🚨 WATCH OUT: ${brief.watch_out}\n` : "")
    ) : "No AI brief generated.\n") +
    `\nGood luck Chris! 💪`;

  await telegram(msg);
  console.log(`[Aria] ✅ Brief sent for ${contact?.name || event.sellerName}`);
}

// ── Track which events we've already prepped ───────────────────────────────────
const preppedEvents = new Set();

// ── Main check ────────────────────────────────────────────────────────────────
async function checkCalendar() {
  const appointments = await getUpcomingAppointments();
  if (appointments.length === 0) return;

  for (const event of appointments) {
    if (preppedEvents.has(event.id)) continue;
    preppedEvents.add(event.id);

    const { sellerName, address, startTime } = parseEventDetails(event);
    console.log(`[Aria] Prepping appointment: ${sellerName} | ${startTime}`);

    const contact = await findSellerInGHL(sellerName, address);
    const intel   = contact ? await getSellerIntel(contact.id) : { calls: [], approval: null, scout: null };
    const brief   = await generateBrief({ sellerName, address, startTime }, contact, intel);

    await sendBrief({ sellerName, address, startTime }, contact, intel, brief);
  }
}

// ── Startup ────────────────────────────────────────────────────────────────────
(async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     ARIA — Appointment Prep Agent        ║");
  console.log("╚══════════════════════════════════════════╝");

  const auth = getGoogleAuth();
  if (auth) console.log("[Aria] ✅ Google Calendar connected");
  else      console.log("[Aria] ⚠️  Google Calendar not connected — check gmail-credentials.json");

  // Check every 5 minutes for upcoming appointments
  cron.schedule("*/5 8-20 * * *", () => checkCalendar().catch(console.error));
  console.log("[Aria] Checking calendar every 5min (8am–8pm daily)");

  if (process.argv.includes("--now")) {
    await checkCalendar();
  }
})();
