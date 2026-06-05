/**
 * ghl-intelligence.js — Automatic GHL event intelligence for Jarvis
 *
 * Receives GHL webhook events (via jarvis-telegram.js port 3001 /ghl/webhook)
 * and sends automatic proactive coaching + deal analysis to Chris via Telegram.
 *
 * Events handled:
 *   OpportunityStageUpdate → stage-specific coaching (Decision Pending, Hot, Contract Sent, Dead)
 *   NoteCreate             → offer detection, keyword coaching
 *   OpportunityCreate      → new lead alert
 *   AppointmentCreate      → appointment confirmation
 *   TaskComplete           → task confirmation
 *
 * Also exports: runDailyPipelineAudit() — called at 7am by chris-accountability.js
 *
 * GHL webhook setup:
 *   GHL → Settings → Integrations → Webhooks → Add Webhook
 *   URL: https://[CLOUDFLARE_URL]/ghl/webhook
 *   Events: Contact Stage Changed, Note Added, Opportunity Created,
 *           Opportunity Stage Changed, Appointment Scheduled, Task Completed
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { aiChat }       = require("./ai-router");
const TelegramBot      = require("node-telegram-bot-api");

const sb      = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot     = new TelegramBot(
  process.env.TELEGRAM_BOT_TOKEN || "8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0",
  { polling: false }
);
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

const GHL_TOKEN    = process.env.GHL_API_TOKEN || "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_PIPELINE = "o4kqU2y8DYjA73aKUxNu";

// Stage IDs — hardcoded from jarvis-caller.js (null = loaded at runtime)
const STAGE_IDS = {
  "Hot Follow Up":          "898845b3-7e76-42be-b8a7-cb8a85a0daa2",
  "Warm Follow Up":         "47f767a6-24af-48f2-9df2-5d664f031bb7",
  "Cold Follow Up":         "234e7689-663f-4191-8c6a-7bf73da1045c",
  "New Lead":               "92d0031c-00f8-4692-bc9f-235a76fa3201",
  "Attempt 1":              "ccef1b7a-f245-4f1d-a5c6-5c9eef6bde74",
  "Attempt 2 No Contact":   "1ffda1af-d8aa-48e7-a573-0493ab042212",
  "Attempt 3-5 No Contact": "659159ac-34e8-46c2-a821-98389a0934aa",
  "Attempt 6+ Unresponsive":"fc67a2e4-8099-4789-a092-96c717a0461e",
  "Decision Pending":       null,
  "Contract Sent":          null,
};

let stageIdToName = {}; // reverse map: id → name
let stageIdsLoaded = false;

// GHL custom field IDs (loaded at first use)
let GHL_FIELDS = {
  motivation: null, asking_price: null, arv: null, mao: null,
  condition: null, occupancy: null, closing_timeline: null,
  mortgage_payoff: null, call_outcome: null, last_called_date: null, recording_url: null,
};
let fieldsLoaded = false;

// Dedup: skip duplicate webhook events (same opp+stage within 60s)
const recentEvents = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendTelegram(text) {
  try {
    await bot.sendMessage(CHAT_ID, text, { parse_mode: "Markdown" });
  } catch {
    try { await bot.sendMessage(CHAT_ID, text.replace(/[*_`[\]()~>#+=|{}.!-]/g, "\\$&")); } catch {}
  }
}

async function ghlGet(path) {
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

async function loadStageIds() {
  if (stageIdsLoaded) return;
  try {
    const data = await ghlGet(`/opportunities/pipelines?locationId=${GHL_LOCATION}`);
    const pipeline = (data.pipelines || []).find(p => p.id === GHL_PIPELINE);
    if (pipeline) {
      for (const stage of (pipeline.stages || [])) {
        if (stage.name === "Decision Pending") STAGE_IDS["Decision Pending"] = stage.id;
        if (stage.name === "Contract Sent")    STAGE_IDS["Contract Sent"]    = stage.id;
        stageIdToName[stage.id] = stage.name;
      }
    }
    // Also populate from hardcoded entries
    for (const [name, id] of Object.entries(STAGE_IDS)) {
      if (id) stageIdToName[id] = name;
    }
    stageIdsLoaded = true;
    console.log("[GHL Intel] Stage IDs loaded. Decision Pending:", STAGE_IDS["Decision Pending"]);
  } catch (e) {
    console.error("[GHL Intel] loadStageIds:", e.message);
  }
}

async function loadFieldIds() {
  if (fieldsLoaded) return;
  try {
    const data = await ghlGet(`/locations/${GHL_LOCATION}/customFields`);
    const fields = data.customFields || data.fields || [];
    for (const f of fields) {
      const name = (f.name || "").toLowerCase().trim();
      if (name.includes("motivation"))                                  GHL_FIELDS.motivation       = f.id;
      else if (name.includes("asking"))                                 GHL_FIELDS.asking_price     = f.id;
      else if (name.includes("arv"))                                    GHL_FIELDS.arv              = f.id;
      else if (name.includes("mao"))                                    GHL_FIELDS.mao              = f.id;
      else if (name.includes("condition"))                              GHL_FIELDS.condition        = f.id;
      else if (name.includes("ocupancy") || name.includes("occupancy")) GHL_FIELDS.occupancy        = f.id;
      else if (name.includes("closing timeline") || (name.includes("timeline") && !name.includes("call"))) GHL_FIELDS.closing_timeline = f.id;
      else if (name.includes("mortgage payoff") || name.includes("mortgage payoff")) GHL_FIELDS.mortgage_payoff = f.id;
      else if (name.includes("call outcome"))                           GHL_FIELDS.call_outcome     = f.id;
      else if (name.includes("last called") || name.includes("last call date"))      GHL_FIELDS.last_called_date = f.id;
      else if (name.includes("recording"))                              GHL_FIELDS.recording_url    = f.id;
    }
    fieldsLoaded = true;
  } catch (e) {
    console.error("[GHL Intel] loadFieldIds:", e.message);
  }
}

// Extract a custom field value from a contact/opp's customFields array
function getField(customFields, fieldId) {
  if (!fieldId || !customFields) return null;
  const f = customFields.find(cf => cf.id === fieldId);
  return f?.value || null;
}

// ── GHL Data Fetchers ─────────────────────────────────────────────────────────

async function getContact(contactId) {
  try {
    const data = await ghlGet(`/contacts/${contactId}`);
    return data.contact || data;
  } catch (e) {
    console.error("[GHL Intel] getContact:", e.message);
    return null;
  }
}

async function getContactNotes(contactId) {
  try {
    const data = await ghlGet(`/contacts/${contactId}/notes`);
    return (data.notes || []).sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
  } catch { return []; }
}

async function getOpp(oppId) {
  try {
    const data = await ghlGet(`/opportunities/${oppId}`);
    return data.opportunity || data;
  } catch { return null; }
}

async function getContactOpps(contactId) {
  try {
    const data = await ghlGet(`/opportunities/search?contact_id=${contactId}&location_id=${GHL_LOCATION}&limit=5`);
    return data.opportunities || [];
  } catch { return []; }
}

// Get all opps in a stage (paginated)
async function getOppsByStage(stageId, limit = 25) {
  const opps = [];
  let page = 1;
  while (opps.length < limit) {
    try {
      const data = await ghlGet(
        `/opportunities/search?pipeline_id=${GHL_PIPELINE}&location_id=${GHL_LOCATION}&pipeline_stage_id=${stageId}&limit=20&page=${page}`
      );
      const batch = data.opportunities || [];
      opps.push(...batch);
      if (batch.length < 20) break;
      page++;
    } catch { break; }
  }
  return opps.slice(0, limit);
}

// Extract human-readable info from a contact record
function summarizeContact(contact, customFields) {
  const cf = customFields || contact?.customFields || [];
  return {
    name:       contact?.firstName ? `${contact.firstName} ${contact.lastName || ""}`.trim() : contact?.fullName || "Unknown",
    firstName:  contact?.firstName || contact?.fullName?.split(" ")[0] || "Seller",
    address:    contact?.address1 ? `${contact.address1}, ${contact.city || ""} ${contact.state || ""}`.trim() : null,
    phone:      contact?.phone || null,
    tags:       (contact?.tags || []).join(", "),
    motivation: getField(cf, GHL_FIELDS.motivation),
    asking:     getField(cf, GHL_FIELDS.asking_price),
    condition:  getField(cf, GHL_FIELDS.condition),
    timeline:   getField(cf, GHL_FIELDS.closing_timeline),
    mortgage:   getField(cf, GHL_FIELDS.mortgage_payoff),
    occupancy:  getField(cf, GHL_FIELDS.occupancy),
    arv:        getField(cf, GHL_FIELDS.arv),
    lastCalled: getField(cf, GHL_FIELDS.last_called_date),
  };
}

// ── Offer Detection ───────────────────────────────────────────────────────────

function detectOffer(text) {
  if (!text) return null;
  // Match $185k, $185,000, 185k in context of offer/price/asking
  const patterns = [
    /offer(?:ed|ing)?\s+(?:at|of|them)?\s*\$?\s*([\d,]+\.?\d*)k?\b/i,
    /\$\s*([\d,]+\.?\d*)k\b/i,
    /\$\s*([\d]{3,}(?:,\d{3})+)\b/,   // $185,000
    /\b([\d,]+)k\b(?=.*(?:offer|asking|price|mad[e]))/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const raw     = m[1].replace(/,/g, "");
      const isK     = m[0].toLowerCase().includes("k") && !m[0].includes(",");
      const amount  = parseFloat(raw) * (isK && parseFloat(raw) < 5000 ? 1000 : 1);
      if (amount >= 20000 && amount <= 5000000) return { amount, raw: m[0] };
    }
  }
  return null;
}

// Save offer to offers_log and update daily_metrics
async function saveOfferToLog({ amount, contactName, address, notes }) {
  try {
    await sb.from("offers_log").insert({
      offer_amount: amount,
      contact_name: contactName,
      address:      address || null,
      notes:        notes   || null,
      outcome:      "pending",
    });
    // Also increment offers in daily_metrics
    const today = new Date().toISOString().slice(0, 10);
    const { data: row } = await sb.from("daily_metrics").select("offers_made").eq("date", today).maybeSingle();
    if (row) await sb.from("daily_metrics").update({ offers_made: (row.offers_made || 0) + 1 }).eq("date", today);
    else      await sb.from("daily_metrics").insert({ date: today, offers_made: 1 });
  } catch (e) { console.error("[GHL Intel] saveOfferToLog:", e.message); }
}

// ── Stage Change Handlers ─────────────────────────────────────────────────────

async function handleDecisionPending(contact, opp) {
  const info = summarizeContact(contact);
  const address = info.address || opp?.name || "address unknown";

  // Build context string
  const context = [
    info.motivation && `Motivation: ${info.motivation}`,
    info.asking     && `Asking price: $${Number(info.asking).toLocaleString()}`,
    info.condition  && `Condition: ${info.condition}`,
    info.timeline   && `Timeline: ${info.timeline}`,
    info.mortgage   && `Mortgage payoff: ~$${info.mortgage}`,
  ].filter(Boolean).join(" | ");

  // Get ARV from Supabase cache (don't block on live scrape)
  let arvLine = "";
  try {
    const { data: arvCache } = await sb.from("asap_sold_properties")
      .select("arv, offer_65, offer_70")
      .ilike("address", `%${address.split(",")[0].trim()}%`)
      .limit(1);
    if (arvCache?.[0]?.arv) {
      const arv = arvCache[0].arv;
      const off65 = arvCache[0].offer_65 || Math.round(arv * 0.65);
      arvLine = `\n\nASAP ARV: *$${Number(arv).toLocaleString()}* | 65% offer: *$${Number(off65).toLocaleString()}*`;
    }
  } catch {}

  // AI opening for offer conversation
  const aiRes = await aiChat({
    system: "You are a wholesale real estate acquisitions coach. Be concise and tactical.",
    messages: [{
      role: "user",
      content: `Chris just moved ${info.firstName} to Decision Pending. Address: ${address}. Context: ${context || "minimal info"}. Give Chris 2 specific sentences to open the offer conversation. Address them by first name. Be natural, not scripted.`,
    }],
    max_tokens: 120,
  });

  const askLine = info.asking ? `\n💬 Asking: *$${Number(info.asking).toLocaleString()}*` : "";

  await sendTelegram(
    `🎯 *DECISION PENDING — ${info.name}*\n\n` +
    `📍 ${address}` + askLine + (context ? `\n📋 ${context}` : "") + arvLine + "\n\n" +
    `*How to open the offer:*\n${aiRes.text}\n\n` +
    `Reply "deal analysis" to get full breakdown.`
  );
}

async function handleHotFollowUp(contact, opp) {
  const info = summarizeContact(contact);
  const address = info.address || opp?.name || "";

  // Get recent notes
  const notes  = await getContactNotes(contact.id);
  const lastNote = notes?.[0]?.body?.slice(0, 200) || "No recent notes";

  const aiRes = await aiChat({
    system: "You are a wholesale real estate coach. Be direct and tactical.",
    messages: [{
      role: "user",
      content: `${info.firstName} just moved to Hot Follow Up. Address: ${address}. Last note: "${lastNote}". Motivation: ${info.motivation || "unknown"}. Give Chris one specific call opener (2 sentences max). They are warm — lead with momentum, don't restart cold.`,
    }],
    max_tokens: 100,
  });

  const context = [
    info.motivation && `Motivation: ${info.motivation}`,
    info.asking     && `Asking: $${Number(info.asking).toLocaleString()}`,
    info.timeline   && `Timeline: ${info.timeline}`,
  ].filter(Boolean).join(" | ");

  await sendTelegram(
    `🔥 *HOT — ${info.name} just went Hot*\n\n` +
    `📍 ${address}\n` +
    (context ? `📋 ${context}\n` : "") +
    `📝 Last note: _${lastNote}_\n\n` +
    `*Call opener:*\n${aiRes.text}\n\n` +
    `⚡ Call within the hour while they're warm.`
  );
}

async function handleContractSent(contact, opp) {
  const info = summarizeContact(contact);
  const address = info.address || opp?.name || "";

  const followUpScript = await aiChat({
    system: "You are a real estate coach. Be brief.",
    messages: [{
      role: "user",
      content: `Contract sent to ${info.firstName} at ${address}. Give Chris: 1 sentence follow-up to send if no response in 24h. Keep it casual, no pressure.`,
    }],
    max_tokens: 80,
  });

  await sendTelegram(
    `📄 *CONTRACT SENT — ${info.name}*\n\n` +
    `📍 ${address}\n\n` +
    `I'll flag you in 24 hours if no response.\n\n` +
    `*If they go quiet, say:*\n_${followUpScript.text}_`
  );
}

async function handleDeadLead(contact, opp, stageName) {
  const info   = summarizeContact(contact);
  const address = info.address || opp?.name || "";

  const notes  = await getContactNotes(contact.id);
  const noteHistory = notes.slice(0, 3).map(n => n.body?.slice(0, 150)).join(" | ");

  const analysis = await aiChat({
    system: "You are a wholesale real estate coach analyzing a lost lead. Be specific and constructive.",
    messages: [{
      role: "user",
      content: `${info.name} (${address}) just moved to ${stageName}. Note history: "${noteHistory}". Asking was: ${info.asking || "unknown"}. Give: 1. What likely happened / why it died (2 sentences). 2. What to do differently next time (1 sentence). Be direct.`,
    }],
    max_tokens: 150,
  });

  await sendTelegram(
    `💀 *LEAD LOST — ${info.name}*\n\n` +
    `📍 ${address}\n\n` +
    `*Post-mortem:*\n${analysis.text}`
  );
}

// ── Note Analysis ─────────────────────────────────────────────────────────────

async function handleNoteAdded(payload) {
  const contactId  = payload.contactId || payload.data?.contactId;
  const noteBody   = payload.data?.body || payload.body || "";

  if (!contactId || !noteBody || noteBody.length < 10) return;

  // Debounce — skip if same note processed in last 60s
  const dedupeKey = `note_${contactId}_${noteBody.slice(0, 30)}`;
  if (recentEvents.has(dedupeKey)) return;
  recentEvents.set(dedupeKey, Date.now());
  setTimeout(() => recentEvents.delete(dedupeKey), 60000);

  // Check if note is from Jarvis/David (skip)
  const noteUser = payload.data?.user || payload.data?.addedBy || "";
  if (typeof noteUser === "string" && (noteUser.toLowerCase().includes("jarvis") || noteUser.toLowerCase().includes("david"))) return;

  // Detect offer amount
  const offerMatch = detectOffer(noteBody);

  const contact = await getContact(contactId);
  await loadFieldIds();
  const info = contact ? summarizeContact(contact) : { name: "Unknown", firstName: "Seller", address: null };
  const address = info.address || "";

  if (offerMatch) {
    // Auto-save offer and send analysis
    await saveOfferToLog({ amount: offerMatch.amount, contactName: info.name, address, notes: noteBody });

    // Check ARV for deal rating
    let arvText = "";
    let dealRating = "🟡 Yellow"; // default
    try {
      const { data: arvCache } = await sb.from("asap_sold_properties")
        .select("arv, offer_65, offer_70")
        .ilike("address", `%${address.split(",")[0].trim()}%`)
        .limit(1);
      if (arvCache?.[0]?.arv) {
        const arv = arvCache[0].arv;
        const pct = Math.round((offerMatch.amount / arv) * 100);
        const profit = Math.round(arv * 0.65 - offerMatch.amount);
        arvText = `\nARV: *$${Number(arv).toLocaleString()}* | Offer at *${pct}%* of ARV | Est. profit: *$${profit.toLocaleString()}*`;
        dealRating = pct <= 65 ? "🟢 Green" : pct <= 72 ? "🟡 Yellow" : "🔴 Red";
      }
    } catch {}

    const pushbackLine = await aiChat({
      system: "You are a real estate negotiation coach.",
      messages: [{ role: "user", content: `Chris offered $${offerMatch.amount.toLocaleString()} to ${info.firstName}. Give him one specific thing to say if they push back on price. 2 sentences max.` }],
      max_tokens: 80,
    }).then(r => r.text).catch(() => "Walk them through the ARV math — numbers don't lie.");

    await sendTelegram(
      `💰 *OFFER DETECTED — ${info.name}*\n\n` +
      `I see you made an offer of *$${offerMatch.amount.toLocaleString()}* to *${info.name}*.\n` +
      (address ? `📍 ${address}\n` : "") +
      arvText + `\n\n*Deal rating: ${dealRating}*\n\n` +
      `*If they push back on price:*\n_"${pushbackLine}"_`
    );
    return;
  }

  // Check for significant keywords → send coaching feedback
  const significant = /motivated|timeline|condition|asking|price|offer|counter|deal|contract|signed|declined|not intereste|callback|follow.?up|appointment|phone back/i.test(noteBody);
  if (!significant) return;

  // Coaching feedback on the note content
  const coaching = await aiChat({
    system: "You are a wholesale real estate coaching assistant. Analyze call notes and give tactical next-step advice.",
    messages: [{
      role: "user",
      content: `Chris logged this note for ${info.name} (${address || "unknown address"}):\n\n"${noteBody}"\n\nGive: 1. What this tells you about the deal (1 sentence). 2. Exact next step Chris should take (1 sentence). Be direct.`,
    }],
    max_tokens: 120,
  });

  await sendTelegram(
    `📝 *NOTE COACHING — ${info.name}*\n\n` +
    `_"${noteBody.slice(0, 200)}${noteBody.length > 200 ? "..." : ""}"_\n\n` +
    `🎯 ${coaching.text}`
  );
}

// ── New Opportunity Created ───────────────────────────────────────────────────

async function handleOpportunityCreated(payload) {
  const oppId     = payload.opportunityId || payload.data?.id;
  const contactId = payload.contactId     || payload.data?.contactId;

  if (!contactId) return;

  const contact = await getContact(contactId);
  const info    = contact ? summarizeContact(contact) : { name: "New Lead", address: null };
  const address  = info.address || (oppId ? (await getOpp(oppId))?.name : null) || "unknown address";

  const tags = contact?.tags || [];
  const source = tags.find(t => t.includes("alpha") || t.includes("county") || t.includes("STL") || t.includes("DealMachine")) || "unknown source";

  await sendTelegram(
    `🆕 *NEW LEAD — ${info.name}*\n\n` +
    `📍 ${address}\n` +
    `📌 Source: ${source}\n\n` +
    `Call within 5 minutes for 4x higher contact rate. 📞`
  );
}

// ── Appointment Scheduled ────────────────────────────────────────────────────

async function handleAppointmentCreated(payload) {
  const contactId = payload.contactId || payload.data?.contactId;
  const apptTitle = payload.data?.title || "Appointment";
  const apptTime  = payload.data?.startTime;

  const contact = contactId ? await getContact(contactId) : null;
  const name    = contact
    ? `${contact.firstName || ""} ${contact.lastName || ""}`.trim()
    : "Unknown";

  const timeStr = apptTime
    ? new Date(apptTime).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", weekday: "short", month: "short", day: "numeric" })
    : "time unknown";

  await sendTelegram(
    `📅 *APPOINTMENT SCHEDULED*\n\n` +
    `${apptTitle}\n` +
    `With: *${name}*\n` +
    `When: *${timeStr} EST*\n\n` +
    `I'll remind you 30 minutes before.`
  );
}

// ── Task Completed ────────────────────────────────────────────────────────────

async function handleTaskCompleted(payload) {
  const taskTitle = payload.data?.title || payload.title || "Task";
  const contactId = payload.contactId || payload.data?.contactId;
  const contact   = contactId ? await getContact(contactId) : null;
  const name      = contact ? `${contact.firstName || ""} ${contact.lastName || ""}`.trim() : null;

  await sendTelegram(
    `✅ *TASK COMPLETE*\n\n` +
    `"${taskTitle}"${name ? ` — *${name}*` : ""}\n\n` +
    `Good. What's the next step with this lead?`
  );
}

// ── Call Recording Analysis ───────────────────────────────────────────────────

async function analyzeCallRecording(contactId, contactName) {
  // Look for recent jarvis_calls entry with this contact
  const { data: calls } = await sb.from("jarvis_calls")
    .select("*")
    .or(`contact_name.ilike.%${contactName || ""}%,contact_id.eq.${contactId}`)
    .order("called_at", { ascending: false })
    .limit(1);

  const call = calls?.[0];
  if (!call) return;

  const transcript = call.transcript_full || call.notes || call.summary || "";
  if (transcript.length < 50) return;

  // Skip if already coached
  if (call.coached_at) return;

  const analysis = await aiChat({
    system: "You are a wholesale real estate sales coach. Score calls and give specific feedback.",
    messages: [{
      role: "user",
      content: `Analyze this call with ${contactName}:\n\n"${transcript.slice(0, 800)}"\n\nGive JSON: {"did_well": ["x","y"], "lost_momentum": "...", "say_instead": "...", "opening": 7, "motivation_digging": 6, "objection_handling": 6, "offer_presentation": 5, "close_attempt": 6, "overall": 6, "deal_probability": 40, "next_step": "..."}`,
    }],
    max_tokens: 400,
  });

  let a = {};
  try {
    const raw = analysis.text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    a = JSON.parse(raw);
  } catch { return; }

  const bar = (n) => "▓".repeat(Math.max(0, Math.round(n || 0))) + "░".repeat(Math.max(0, 10 - Math.round(n || 0)));

  await sendTelegram(
    `📞 *CALL ANALYSIS — ${contactName}*\n\n` +
    `✅ *Well done:*\n${(a.did_well || []).map(d => `• ${d}`).join("\n") || "• Good effort"}\n\n` +
    `⚠️ *Lost momentum:* ${a.lost_momentum || "N/A"}\n` +
    `💬 *Say instead:* _"${a.say_instead || "N/A"}"_\n\n` +
    `📊 *Pitch scores:*\n` +
    `Opening & Rapport:  ${a.opening || "?"}/10  ${bar(a.opening)}\n` +
    `Motivation Digging: ${a.motivation_digging || "?"}/10  ${bar(a.motivation_digging)}\n` +
    `Objection Handling: ${a.objection_handling || "?"}/10  ${bar(a.objection_handling)}\n` +
    `Offer Presentation: ${a.offer_presentation || "?"}/10  ${bar(a.offer_presentation)}\n` +
    `Close Attempt:      ${a.close_attempt || "?"}/10  ${bar(a.close_attempt)}\n` +
    `Overall:            ${a.overall || "?"}/10\n\n` +
    `💰 *Deal probability: ${a.deal_probability || "?"}%*\n` +
    `🎯 *Next step:* ${a.next_step || "Follow up"}`
  );

  // Mark coached
  await sb.from("jarvis_calls").update({ coached_at: new Date().toISOString() }).eq("id", call.id).catch(() => {});
}

// ── Daily 7am Pipeline Audit ──────────────────────────────────────────────────

async function runDailyPipelineAudit() {
  console.log("[GHL Intel] Running daily 7am pipeline audit...");

  await loadStageIds();

  const now    = Date.now();
  const h24    = 24 * 60 * 60 * 1000;
  const h48    = 48 * 60 * 60 * 1000;
  const h72    = 72 * 60 * 60 * 1000;
  const today  = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));

  const urgentAlerts = [];   // things to say immediately
  const pipelineCounts = {}; // stage → count

  // Fetch key stages in parallel
  const stageKeys = [
    ["Hot Follow Up",    STAGE_IDS["Hot Follow Up"]],
    ["Decision Pending", STAGE_IDS["Decision Pending"]],
    ["Contract Sent",    STAGE_IDS["Contract Sent"]],
    ["Warm Follow Up",   STAGE_IDS["Warm Follow Up"]],
    ["New Lead",         STAGE_IDS["New Lead"]],
  ];

  const stageFetches = await Promise.all(
    stageKeys.map(([name, id]) => id ? getOppsByStage(id, 25).then(opps => ({ name, opps })) : Promise.resolve({ name, opps: [] }))
  );

  for (const { name, opps } of stageFetches) {
    pipelineCounts[name] = opps.length;

    for (const opp of opps) {
      const updated    = new Date(opp.dateUpdated || opp.updatedAt || 0).getTime();
      const created    = new Date(opp.dateAdded   || opp.createdAt || 0).getTime();
      const daysSince  = Math.floor((now - updated) / h24);
      const hoursSince = Math.floor((now - updated) / 3600000);
      const contactName = opp.contact?.name || opp.name || "Unknown";
      const address     = opp.name || opp.contact?.address1 || "unknown address";

      // Hot leads not touched in 3+ days
      if (name === "Hot Follow Up" && updated < now - h72) {
        urgentAlerts.push({
          priority: 1,
          msg: `🔥 *${contactName}* — Hot, NOT contacted in *${daysSince} days*. Call them NOW.\n   📍 ${address}`,
        });
      }

      // Decision Pending with no response for 48h+
      if (name === "Decision Pending" && updated < now - h48) {
        urgentAlerts.push({
          priority: 2,
          msg: `🎯 *${contactName}* — Offer pending, no response for *${Math.floor((now - updated) / h24)}d*. Follow up TODAY.\n   📍 ${address}`,
        });
      }

      // New leads in from last 2 hours
      if (name === "New Lead" && created > now - 2 * 3600000) {
        urgentAlerts.push({
          priority: 0,
          msg: `⚡ *${contactName}* — Brand new lead, just came in ${Math.floor((now - created) / 60000)}min ago — call immediately.\n   📍 ${address}`,
        });
      }

      // Contract Sent 48h+ ago with no update
      if (name === "Contract Sent" && updated < now - h48) {
        urgentAlerts.push({
          priority: 3,
          msg: `📄 *${contactName}* — Contract sent ${daysSince}d ago with no update. Follow up on signature.\n   📍 ${address}`,
        });
      }
    }
  }

  // Sort by priority
  urgentAlerts.sort((a, b) => a.priority - b.priority);

  // Build the briefing
  const pipelineSummary =
    `🔥 Hot: *${pipelineCounts["Hot Follow Up"] || 0}*  ` +
    `🎯 Decision Pending: *${pipelineCounts["Decision Pending"] || 0}*  ` +
    `📄 Contract: *${pipelineCounts["Contract Sent"] || 0}*  ` +
    `⚡ Warm: *${pipelineCounts["Warm Follow Up"] || 0}*  ` +
    `🆕 New: *${pipelineCounts["New Lead"] || 0}*`;

  let alertSection = "";
  if (urgentAlerts.length > 0) {
    alertSection = "\n\n🚨 *NEEDS ATTENTION TODAY*\n" +
      urgentAlerts.slice(0, 5).map((a, i) => `${i + 1}. ${a.msg}`).join("\n\n");
  } else {
    alertSection = "\n\n✅ No urgent follow-ups flagged.";
  }

  // AI adds one strategic point
  let strategicNote = "";
  try {
    const hot   = pipelineCounts["Hot Follow Up"] || 0;
    const dp    = pipelineCounts["Decision Pending"] || 0;
    const newL  = pipelineCounts["New Lead"] || 0;
    const res   = await aiChat({
      system: "You are a wholesale real estate pipeline coach. Be direct, 1 sentence only.",
      messages: [{ role: "user", content: `Pipeline: ${hot} hot leads, ${dp} decision pending, ${newL} new leads. What is Chris's single most important focus today?` }],
      max_tokens: 60,
    });
    strategicNote = `\n\n💡 *Today's focus:* ${res.text}`;
  } catch {}

  const today_est = today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  await sendTelegram(
    `☀️ *7am PIPELINE AUDIT — ${today_est}*\n\n` +
    pipelineSummary +
    alertSection +
    strategicNote +
    `\n\nGo make your calls. 📞`
  );
}

// ── Main webhook dispatcher ───────────────────────────────────────────────────

async function handleGHLWebhook(payload) {
  const eventType = payload.type || payload.event || payload.eventType || "";
  const contactId = payload.contactId || payload.data?.contactId || payload.data?.id;
  const oppId     = payload.opportunityId || payload.data?.id;

  console.log(`[GHL Intel] Event: ${eventType} | contact: ${contactId} | opp: ${oppId}`);

  await loadStageIds();
  await loadFieldIds();

  // Dedup identical events within 30s
  const eventKey = `${eventType}_${oppId || contactId}_${Date.now() - (Date.now() % 30000)}`;
  if (recentEvents.has(eventKey)) {
    console.log("[GHL Intel] Dedup skip:", eventKey);
    return;
  }
  recentEvents.set(eventKey, true);
  setTimeout(() => recentEvents.delete(eventKey), 30000);

  try {
    switch (eventType) {
      case "OpportunityStageUpdate":
      case "opportunity_stage_changed":
      case "OpportunityUpdate": {
        const stageId  = payload.data?.pipelineStageId || payload.pipelineStageId;
        const stageName = stageId ? (stageIdToName[stageId] || stageId) : (payload.data?.pipelineStage || "");

        if (!stageName) { console.log("[GHL Intel] No stage name for event"); return; }

        const contact  = contactId ? await getContact(contactId) : null;
        const opp      = oppId     ? await getOpp(oppId)         : null;

        if (!contact && !opp) return;

        switch (stageName) {
          case "Decision Pending": return handleDecisionPending(contact, opp);
          case "Hot Follow Up":    return handleHotFollowUp(contact, opp);
          case "Contract Sent":    return handleContractSent(contact, opp);
          case "Dead":
          case "Lost":
          case "Closed Lost":      return handleDeadLead(contact, opp, stageName);
        }
        break;
      }

      case "NoteCreate":
      case "note_created":
      case "ContactNoteAdded":
        await handleNoteAdded(payload);
        break;

      case "OpportunityCreate":
      case "opportunity_created":
        await handleOpportunityCreated(payload);
        break;

      case "AppointmentCreate":
      case "appointment_created":
      case "CalendarEventCreate":
        await handleAppointmentCreated(payload);
        break;

      case "TaskComplete":
      case "task_completed":
        await handleTaskCompleted(payload);
        break;

      default:
        // Log unknown events for debugging
        if (eventType && eventType !== "ContactCreate") {
          console.log(`[GHL Intel] Unhandled event type: "${eventType}"`);
        }
    }
  } catch (e) {
    console.error(`[GHL Intel] Handler error (${eventType}):`, e.message);
  }
}

module.exports = { handleGHLWebhook, runDailyPipelineAudit };
