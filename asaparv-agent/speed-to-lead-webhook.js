/**
 * speed-to-lead-webhook.js
 * Receives new PPL leads from Speed To Lead and pushes them into GHL
 * Pipeline: "i Speed To Lead🐆💥"  ID: VJwMSSMaP8KhiPiUfSG0
 * First stage: "♨️New i Speed Lead"  ID: c5a869e6-12c0-4afc-b06b-c9295aeaf0e2
 *
 * Speed To Lead sends a POST to /webhook/speed-to-lead with JSON lead data.
 * Optionally verify with SPEED_TO_LEAD_WEBHOOK_SECRET in Authorization header.
 *
 * PM2: pm2 start speed-to-lead-webhook.js --name speed-to-lead --autorestart
 */

require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app   = express();
const PORT  = process.env.STL_PORT || 3006;

// ── Config ────────────────────────────────────────────────────────────────────
const GHL_TOKEN    = process.env.GHL_API_TOKEN || "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_API      = "https://services.leadconnectorhq.com";
const STL_PIPELINE = "VJwMSSMaP8KhiPiUfSG0";
const STL_STAGE    = "c5a869e6-12c0-4afc-b06b-c9295aeaf0e2"; // ♨️New i Speed Lead

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || "8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID   || "8105811341";
const WEBHOOK_SECRET   = process.env.SPEED_TO_LEAD_WEBHOOK_SECRET || "";

// Contact-level custom field IDs
const CONTACT_CF = {
  motivation: "G5pRzYCCqoUPiRHR4zDV",
  timeline:   "r3CXuo6aNXETD59iCplA",
  condition:  "KTwE7WE69Qh3camwH4H5",
};

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const GHL_HEADERS = {
  "Authorization": `Bearer ${GHL_TOKEN}`,
  "Version":       "2021-07-28",
  "Content-Type":  "application/json",
};

// ── GHL helpers ───────────────────────────────────────────────────────────────
async function ghlGet(path) {
  const res = await fetch(`${GHL_API}${path}`, { headers: GHL_HEADERS });
  return res.json();
}

async function ghlPost(path, body) {
  const res = await fetch(`${GHL_API}${path}`, {
    method: "POST", headers: GHL_HEADERS, body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function ghlPut(path, body) {
  const res = await fetch(`${GHL_API}${path}`, {
    method: "PUT", headers: GHL_HEADERS, body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function findContact(phone) {
  try {
    const clean = phone.replace(/\D/g, "");
    const d1 = await ghlGet(`/contacts/search?locationId=${GHL_LOCATION}&phone=${encodeURIComponent(phone)}&limit=5`);
    const list1 = d1.contacts || d1.data?.contacts || [];
    if (list1.length) return list1[0].id;

    const d2 = await ghlGet(`/contacts/search?locationId=${GHL_LOCATION}&query=${clean}&limit=10`);
    const list2 = d2.contacts || d2.data?.contacts || [];
    const match = list2.find(c => (c.phone || "").replace(/\D/g, "") === clean);
    return match ? match.id : null;
  } catch { return null; }
}

async function findOpportunity(contactId) {
  try {
    const d = await ghlGet(`/opportunities/search?location_id=${GHL_LOCATION}&contact_id=${contactId}&pipeline_id=${STL_PIPELINE}&limit=5`);
    const opps = d.opportunities || d.data?.opportunities || [];
    return opps.find(o => o.status === "open") || null;
  } catch { return null; }
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function sendTelegram(msg) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("[Telegram] send error:", e.message);
  }
}

// ── Core lead processing ──────────────────────────────────────────────────────
async function processLead(raw) {
  // Normalize field names — Speed To Lead uses various formats
  const lead = {
    firstName:   raw.first_name   || raw.firstName  || (raw.name || "").split(" ")[0] || "Unknown",
    lastName:    raw.last_name    || raw.lastName   || (raw.name || "").split(" ").slice(1).join(" ") || "",
    fullName:    raw.name         || `${raw.first_name || ""} ${raw.last_name || ""}`.trim() || "Unknown",
    phone:       raw.phone        || raw.phone_number || raw.mobile || "",
    email:       raw.email        || "",
    address:     raw.address      || raw.property_address || raw.street || "",
    city:        raw.city         || "",
    state:       raw.state        || "",
    zip:         raw.zip          || raw.postal_code || raw.zipcode || "",
    motivation:  raw.motivation   || raw.seller_motivation || raw.reason || "",
    timeline:    raw.timeline     || raw.timeframe   || raw.closing_timeline || "",
    condition:   raw.condition    || raw.repair_scope || raw.property_condition || "",
    askingPrice: raw.asking_price || raw.price       || raw.list_price || "",
    compAmount:  raw.comp         || raw.comp_amount  || raw.arv || raw.estimated_value || "",
    orderCount:  raw.orders !== undefined ? raw.orders : (raw.order_count !== undefined ? raw.order_count : (raw.num_orders !== undefined ? raw.num_orders : "")),
    pricePaid:   raw.price_paid   || raw.lead_price   || raw.cost || "",
    aiSummary:   raw.summary      || raw.ai_summary   || raw.call_summary || raw.notes || "",
    source:      raw.source       || raw.lead_source  || "Speed To Lead",
    leadId:      raw.id           || raw.lead_id      || raw.record_id || "",
  };

  const fullAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
  const dateReceived = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

  console.log(`\n[STL] New lead: ${lead.fullName} | ${lead.phone} | ${fullAddress}`);

  // 1. Upsert GHL contact
  let contactId = null;
  if (lead.phone) {
    contactId = await findContact(lead.phone);
  }

    const tags = ["iSpeedToLead", "STL Lead", "🐆 i Speed Lead"];
  if (lead.motivation) {
    const mot = lead.motivation.toLowerCase();
    if (mot.includes("inherit"))                                  tags.push("🏃🏽‍♂️💨 Inherited");
    else if (mot.includes("tired") || mot.includes("landlord"))  tags.push("🏃🏽‍♂️💨 Tired Landlord");
    else if (mot.includes("foreclos") || mot.includes("behind")) tags.push("🏃🏽‍♂️💨 Financial Stress");
    else if (mot.includes("moving") || mot.includes("relocat"))  tags.push("🏃🏽‍♂️💨 Moving");
    else if (mot.includes("divorce"))                            tags.push("🏃🏽‍♂️💨 Divorce");
    else if (mot.includes("vacant"))                             tags.push("🏃🏽‍♂️💨 Vacant Property");
  }

  const contactPayload = {
    firstName:   lead.firstName,
    lastName:    lead.lastName,
    phone:       lead.phone,
    ...(lead.email  ? { email: lead.email }   : {}),
    address1:    lead.address,
    city:        lead.city,
    state:       lead.state,
    postalCode:  lead.zip,
    tags,
    source:      "Speed To Lead",
  };

  if (!contactId) {
    const { status, data } = await ghlPost("/contacts/", {
      locationId: GHL_LOCATION,
      ...contactPayload,
    });
    if (status === 200 || status === 201) {
      contactId = data.contact?.id;
      console.log(`  [GHL] Contact created: ${lead.fullName} (${contactId})`);
    } else if (data.meta?.contactId) {
      contactId = data.meta.contactId;
      await ghlPut(`/contacts/${contactId}`, contactPayload);
      console.log(`  [GHL] Contact updated: ${lead.fullName} (${contactId})`);
    } else {
      console.error("  [GHL] Contact create failed:", JSON.stringify(data));
    }
  } else {
    await ghlPut(`/contacts/${contactId}`, contactPayload);
    console.log(`  [GHL] Contact updated: ${lead.fullName} (${contactId})`);
  }

  if (!contactId) {
    console.error("  [GHL] No contactId — aborting");
    return null;
  }

  // 2. Write contact-level custom fields (motivation, timeline, condition)
  const contactFields = [
    lead.motivation && { id: CONTACT_CF.motivation, value: lead.motivation },
    lead.timeline   && { id: CONTACT_CF.timeline,   value: lead.timeline   },
    lead.condition  && { id: CONTACT_CF.condition,  value: lead.condition  },
  ].filter(Boolean);
  if (contactFields.length) {
    await ghlPut(`/contacts/${contactId}`, { customFields: contactFields });
    console.log(`  [GHL] Contact custom fields written (${contactFields.length})`);
  }

  // 3. Create / find opportunity
  let oppId = null;
  const existingOpp = await findOpportunity(contactId);

  if (existingOpp) {
    oppId = existingOpp.id;
    console.log(`  [GHL] Existing opp found: ${oppId}`);
  } else {
    const oppPayload = {
      pipelineId:      STL_PIPELINE,
      pipelineStageId: STL_STAGE,
      contactId,
      locationId:      GHL_LOCATION,
      name:            `${lead.fullName} — ${fullAddress || "No Address"}`,
      status:          "open",
      source:          "Speed To Lead",
      ...(lead.askingPrice ? { monetaryValue: parseFloat(String(lead.askingPrice).replace(/[^0-9.]/g, "")) || 0 } : {}),
    };
    const { status, data } = await ghlPost("/opportunities/", oppPayload);
    if (status === 200 || status === 201) {
      oppId = data.opportunity?.id;
      console.log(`  [GHL] Opportunity created: ${oppId}`);
    } else {
      console.error("  [GHL] Opp create failed:", JSON.stringify(data));
    }
  }

  // 4. Add formatted note
  const refundDeadline = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const noteBody = [
    `📋 iSpeedToLead Import — ${dateReceived}`,
    `─────────────────────────`,
    `👤 Seller: ${lead.fullName}`,
    `📍 Address: ${fullAddress || "—"}`,
    `📞 Phone: ${lead.phone || "—"}`,
    `💰 Comp Amount: ${lead.compAmount ? "$" + Number(lead.compAmount).toLocaleString() : "—"}`,
    `🔥 Motivation: ${lead.motivation || "—"}`,
    `⏰ Urgency: ${lead.timeline || "—"}`,
    `🏠 Condition: ${lead.condition || "—"}`,
    `📊 Orders at purchase: ${lead.orderCount !== "" ? lead.orderCount : "—"}`,
    `💵 Price paid for lead: ${lead.pricePaid ? "$" + Number(lead.pricePaid).toFixed(2) : "—"}`,
    `📅 Refund deadline: ${refundDeadline}`,
    `─────────────────────────`,
    `AI CALL SUMMARY:`,
    lead.aiSummary || "No summary available",
  ].join("\n");

  try {
    await ghlPost(`/contacts/${contactId}/notes`, { body: noteBody, userId: null });
    console.log(`  [GHL] Note added`);
  } catch (e) {
    console.error("  [GHL] Note error:", e.message);
  }

  // 5. Log to Supabase
  try {
    await sb.from("jarvis_log").insert({
      event:   "speed_to_lead_new",
      details: `New STL lead: ${lead.fullName} | ${lead.phone} | ${fullAddress}`,
      meta:    { contactId, oppId, leadId: lead.leadId, address: fullAddress },
    });
  } catch (e) {
    console.error("  [Supabase] Log error:", e.message);
  }

  // 6. Telegram alert
  const opener = buildOpener(lead, fullAddress);
  const tgMsg = [
    `🐆💥 <b>NEW STL LEAD — IMPORTED TO GHL</b>`,
    ``,
    `👤 <b>${lead.fullName}</b>`,
    `📞 ${lead.phone || "—"}`,
    `📍 ${fullAddress || "No address"}`,
    lead.compAmount  ? `💰 Comp: $${Number(lead.compAmount).toLocaleString()}` : null,
    lead.motivation  ? `🔥 Motivation: ${lead.motivation}`  : null,
    lead.timeline    ? `⏰ Urgency: ${lead.timeline}`        : null,
    lead.condition   ? `🏠 Condition: ${lead.condition}`     : null,
    lead.orderCount !== "" ? `📊 Orders: ${lead.orderCount}` : null,
    lead.pricePaid   ? `💵 Paid: $${Number(lead.pricePaid).toFixed(2)}` : null,
    `📅 Refund deadline: ${refundDeadline}`,
    ``,
    `🎯 <b>SUGGESTED OPENER:</b>`,
    opener,
    ``,
    `⚡ PPL LEAD — GOES COLD IN MINUTES`,
  ].filter(Boolean).join("\n");

  await sendTelegram(tgMsg);
  console.log(`  [Telegram] Alert sent`);

  return { contactId, oppId };
}

// ── Opener builder ────────────────────────────────────────────────────────────
function buildOpener(lead, address) {
  const fn = lead.firstName || "there";
  const mot = (lead.motivation || "").toLowerCase();

  if (mot.includes("foreclos") || mot.includes("behind")) {
    return `"Hey ${fn}, this is Chris with Want To Sell Now. I understand you've been dealing with some financial pressure on your property at ${address}. I wanted to reach out quickly — we may be able to help you avoid foreclosure and get cash fast. Do you have 2 minutes?"`;
  }
  if (mot.includes("inherit")) {
    return `"Hey ${fn}, this is Chris with Want To Sell Now. I saw you recently inherited a property at ${address} and were looking at your options. We buy inherited homes fast and handle everything — no repairs needed. Quick question — are you looking to sell outright or just exploring options?"`;
  }
  if (mot.includes("moving") || mot.includes("relocat")) {
    return `"Hey ${fn}, this is Chris with Want To Sell Now. Looks like you're making a move and need to sell your property at ${address}. We can close on your timeline so you're not dealing with two properties. Does that sound like it could work for you?"`;
  }
  return `"Hey ${fn}, this is Chris with Want To Sell Now. I got your info about your property at ${address} and just wanted to connect quickly. We're buying in your area right now. What's your situation — are you looking to sell soon?"`;
}

// ── Express routes ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", service: "speed-to-lead-webhook" }));

// Main webhook endpoint — Speed To Lead POSTs here
app.post("/webhook/speed-to-lead", async (req, res) => {
  // Optional secret verification
  if (WEBHOOK_SECRET) {
    const auth = req.headers["authorization"] || req.headers["x-webhook-secret"] || "";
    if (!auth.includes(WEBHOOK_SECRET)) {
      console.warn("[STL] Unauthorized webhook attempt");
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const body = req.body;
  console.log("[STL] Webhook received:", JSON.stringify(body).slice(0, 200));

  // Handle both single lead and array of leads
  const leads = Array.isArray(body) ? body : (body.leads || body.data || [body]);

  res.json({ received: true, count: leads.length }); // Respond quickly

  for (const lead of leads) {
    try {
      await processLead(lead);
    } catch (e) {
      console.error("[STL] Error processing lead:", e.message);
    }
  }
});

// Manual test endpoint — POST /test with a fake lead
app.post("/test", async (req, res) => {
  const fakeLead = req.body.lead || {
    first_name:  "Test",
    last_name:   "Seller",
    phone:       "+14075550000",
    address:     "123 Oak Street",
    city:        "Orlando",
    state:       "FL",
    zip:         "32801",
    motivation:  "Tired landlord wants out fast",
    timeline:    "ASAP",
    condition:   "Light repairs needed",
    asking_price: "225000",
    lead_id:     "TEST-001",
  };

  try {
    const result = await processLead(fakeLead);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐆 Speed To Lead Webhook — listening on port ${PORT}`);
  console.log(`   POST  http://localhost:${PORT}/webhook/speed-to-lead`);
  console.log(`   POST  http://localhost:${PORT}/test  (manual test)`);
  console.log(`   GET   http://localhost:${PORT}/health`);
  if (WEBHOOK_SECRET) {
    console.log(`   Auth: SPEED_TO_LEAD_WEBHOOK_SECRET is set ✅`);
  } else {
    console.log(`   Auth: No webhook secret — set SPEED_TO_LEAD_WEBHOOK_SECRET in .env to secure`);
  }
  console.log(`\n   GHL Pipeline: i Speed To Lead🐆💥  (${STL_PIPELINE})`);
  console.log(`   First Stage:  ♨️New i Speed Lead   (${STL_STAGE})\n`);
});
