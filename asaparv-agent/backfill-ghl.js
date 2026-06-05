#!/usr/bin/env node
// backfill-ghl.js — Push all jarvis_calls data to GHL contacts
// Updates: address, phone, custom fields, notes, recording URLs

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");

const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_API      = "https://services.leadconnectorhq.com";
const GHL_HEADERS  = {
  "Authorization": `Bearer ${GHL_TOKEN}`,
  "Content-Type":  "application/json",
  "Version":       "2021-07-28",
};

const sb     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tunnel base for permanent recordings
const TUNNEL_BASE = process.env.CLOUDFLARE_URL || "https://david.davidcaller.com";

async function ghl(method, urlPath, body) {
  const res = await fetch(`${GHL_API}${urlPath}`, {
    method,
    headers: GHL_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GHL ${method} ${urlPath} → ${res.status}: ${txt.substring(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

// Load custom field IDs
const GHL_FIELDS = {};
async function loadFields() {
  const data = await ghl("GET", `/locations/${GHL_LOCATION}/customFields`);
  const fields = data.customFields || data.fields || [];
  for (const f of fields) {
    const name = (f.name || "").toLowerCase().trim();
    if (name.includes("motivation"))                                  GHL_FIELDS.motivation       = f.id;
    else if (name.includes("asking"))                                 GHL_FIELDS.asking_price     = f.id;
    else if (name.includes("arv"))                                    GHL_FIELDS.arv              = f.id;
    else if (name.includes("mao"))                                    GHL_FIELDS.mao              = f.id;
    else if (name.includes("condition"))                              GHL_FIELDS.condition        = f.id;
    else if (name.includes("ocupancy") || name.includes("occupancy")) GHL_FIELDS.occupancy        = f.id;
    else if (name.includes("closing timeline") || name === "timeline") GHL_FIELDS.closing_timeline = f.id;
    else if (name.includes("mortgage payoff"))                        GHL_FIELDS.mortgage_payoff  = f.id;
    else if (name.includes("call outcome"))                           GHL_FIELDS.call_outcome     = f.id;
    else if (name.includes("call attempt") || name.includes("total call")) GHL_FIELDS.call_attempts = f.id;
    else if (name.includes("last called"))                            GHL_FIELDS.last_called_date = f.id;
    else if (name.includes("recording"))                              GHL_FIELDS.recording_url    = f.id;
  }
  console.log("Fields loaded:", Object.entries(GHL_FIELDS).filter(([,v])=>v).map(([k])=>k).join(", "));
}

async function analyzeTranscript(transcript, contactName, address) {
  try {
    const res = await claude.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system:     "You analyze real estate acquisition call transcripts. Return ONLY valid JSON.",
      messages: [{ role: "user", content:
        `Analyze this call transcript for ${contactName} about ${address}.\n\nTranscript:\n${transcript}\n\n` +
        `Return JSON:\n{\n` +
        `  "motivation_score": integer 1-10,\n` +
        `  "motivation_tag": "e.g. Divorce - High Motivation",\n` +
        `  "motivation_summary": "one sentence WHY they want to sell",\n` +
        `  "timeline_tag": "e.g. Under 30 Days",\n` +
        `  "asking_price": integer or null,\n` +
        `  "condition_tag": "e.g. Needs Work - Roof + Kitchen",\n` +
        `  "condition_summary": "brief condition description",\n` +
        `  "occupancy": "Occupied - Owner" or "Occupied - Tenant" or "Vacant" or null,\n` +
        `  "mortgage_payoff_range": integer or null,\n` +
        `  "summary": "one sentence outcome"\n` +
        `}`
      }],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/,"").replace(/```\s*$/,"");
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`  [Claude] Analysis failed: ${e.message}`);
    return null;
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function processContact(call, callCount, attemptCount) {
  const contactId = call.contact_id;
  if (!contactId) return;

  console.log(`\n[${call.id}] ${call.contact_name} | ${call.address} | ${call.stage_after}`);

  // Determine outcome
  const hasConversation = (call.transcript_full || "").includes("Seller:");
  const isVoicemail = (call.summary || "").toLowerCase().includes("voicemail");
  const outcome = hasConversation ? "Spoke" : isVoicemail ? "Voicemail" : "No Answer";

  // Get contact info
  let contactData = {};
  try {
    const cd = await ghl("GET", `/contacts/${contactId}`);
    contactData = cd.contact || cd || {};
  } catch (e) {
    console.warn(`  [GHL] Could not fetch contact: ${e.message}`);
  }

  // 1. Update contact address + phone if blank
  const contactUpdate = {};
  const streetOnly = (call.address || "").split(",")[0].trim();
  if (streetOnly && !contactData.address1) contactUpdate.address1 = streetOnly;
  if (call.phone && !contactData.phone) contactUpdate.phone = call.phone;
  if (Object.keys(contactUpdate).length > 0) {
    try {
      await ghl("PUT", `/contacts/${contactId}`, contactUpdate);
      console.log(`  ✅ Contact updated: ${Object.keys(contactUpdate).join(", ")}`);
    } catch (e) {
      console.warn(`  ❌ Contact update failed: ${e.message}`);
    }
    await sleep(300);
  }

  // 2. Custom fields
  const customFields = [];
  if (GHL_FIELDS.call_outcome)
    customFields.push({ id: GHL_FIELDS.call_outcome, value: outcome });
  if (GHL_FIELDS.last_called_date && call.called_at)
    customFields.push({ id: GHL_FIELDS.last_called_date, value: call.called_at });
  if (GHL_FIELDS.call_attempts && attemptCount > 0)
    customFields.push({ id: GHL_FIELDS.call_attempts, value: String(attemptCount) });

  // Analyze transcript if real conversation
  let analysis = null;
  if (hasConversation && call.transcript_full) {
    analysis = await analyzeTranscript(call.transcript_full, call.contact_name, call.address);
    await sleep(500);
    if (analysis) {
      if (GHL_FIELDS.motivation && (analysis.motivation_summary || analysis.motivation_tag))
        customFields.push({ id: GHL_FIELDS.motivation, value: analysis.motivation_summary || analysis.motivation_tag });
      if (GHL_FIELDS.condition && (analysis.condition_summary || analysis.condition_tag))
        customFields.push({ id: GHL_FIELDS.condition, value: analysis.condition_summary || analysis.condition_tag });
      if (GHL_FIELDS.asking_price && analysis.asking_price)
        customFields.push({ id: GHL_FIELDS.asking_price, value: String(analysis.asking_price) });
      if (GHL_FIELDS.closing_timeline && analysis.timeline_tag)
        customFields.push({ id: GHL_FIELDS.closing_timeline, value: analysis.timeline_tag });
      if (GHL_FIELDS.mortgage_payoff && analysis.mortgage_payoff_range)
        customFields.push({ id: GHL_FIELDS.mortgage_payoff, value: String(analysis.mortgage_payoff_range) });
      if (GHL_FIELDS.occupancy && analysis.occupancy)
        customFields.push({ id: GHL_FIELDS.occupancy, value: analysis.occupancy });
    }
  }

  if (customFields.length > 0) {
    try {
      await ghl("PUT", `/contacts/${contactId}`, { customFields });
      console.log(`  ✅ Custom fields written (${customFields.length})`);
    } catch (e) {
      console.warn(`  ❌ Custom fields failed: ${e.message}`);
    }
    await sleep(300);
  }

  // 3. Recording URL — check if permanent file exists, else use Telnyx URL
  const fs = require("fs");
  const path = require("path");
  const recDir = path.join(__dirname, "recordings");
  const callIdFile = path.join(recDir, `${call.twilio_call_sid}.mp3`);
  let recordingUrl = null;
  if (call.twilio_call_sid && fs.existsSync(callIdFile)) {
    recordingUrl = `${TUNNEL_BASE}/recordings/${call.twilio_call_sid}.mp3`;
  } else if (call.recording_url && !call.recording_url.includes("X-Amz-Expires=600")) {
    recordingUrl = call.recording_url;
  }
  // Telnyx URLs expire but we still link them with a note
  const recDisplay = recordingUrl
    ? `Recording: ${recordingUrl}`
    : call.recording_url
      ? `Recording (expired link): ${call.recording_url}`
      : `Recording: Not available`;

  if (recordingUrl && GHL_FIELDS.recording_url) {
    try {
      await ghl("PUT", `/contacts/${contactId}`, { customFields: [{ id: GHL_FIELDS.recording_url, value: recordingUrl }] });
    } catch {}
    await sleep(200);
  }

  // 4. Write GHL note
  const callDate = new Date(call.called_at).toLocaleString("en-US", { timeZone: "America/New_York" });
  const durationMin = call.call_duration
    ? `${Math.floor(call.call_duration / 60)}m ${call.call_duration % 60}s`
    : "—";
  const callTypeHeader = hasConversation
    ? `✅ QUALIFYING CALL`
    : isVoicemail ? `📵 VOICEMAIL LEFT` : `📵 NO ANSWER`;

  const noteBody =
    `${callTypeHeader}\n` +
    `Date: ${callDate}\n` +
    `Duration: ${durationMin}\n` +
    `${recDisplay}\n\n` +
    (hasConversation && analysis ? (
      `🧠 QUALIFYING INFO:\n` +
      `Motivation: ${analysis.motivation_summary || analysis.motivation_tag || "—"}\n` +
      `Timeline: ${analysis.timeline_tag || "—"}\n` +
      `Asking Price: ${analysis.asking_price ? `$${analysis.asking_price.toLocaleString()}` : "—"}\n` +
      `Condition: ${analysis.condition_summary || analysis.condition_tag || "—"}\n` +
      `Occupancy: ${analysis.occupancy || "—"}\n` +
      `Mortgage Payoff: ${analysis.mortgage_payoff_range ? `~$${analysis.mortgage_payoff_range.toLocaleString()}` : "—"}\n` +
      `Score: ${analysis.motivation_score || "—"}/10\n` +
      `Stage → ${call.stage_after}\n` +
      `Summary: ${analysis.summary || call.summary}\n\n`
    ) : (
      `Stage → ${call.stage_after}\n` +
      `Outcome: ${outcome}\n\n`
    )) +
    (call.transcript_full ? `📝 FULL TRANSCRIPT:\n${call.transcript_full}` : "");

  try {
    await ghl("POST", `/contacts/${contactId}/notes`, { body: noteBody, userId: null });
    console.log(`  ✅ Note written (${callTypeHeader})`);
  } catch (e) {
    console.warn(`  ❌ Note failed: ${e.message}`);
  }
  await sleep(400);
}

async function main() {
  await loadFields();

  // Get all calls from Supabase, ordered oldest first
  const { data: calls, error } = await sb
    .from("jarvis_calls")
    .select("*")
    .order("called_at", { ascending: true });

  if (error) { console.error("Supabase error:", error); process.exit(1); }
  console.log(`\nProcessing ${calls.length} calls...\n`);

  // Build per-contact counts for call attempts
  const attemptsByContact = {};
  for (const c of calls) {
    attemptsByContact[c.contact_id] = (attemptsByContact[c.contact_id] || 0) + 1;
  }

  // Group by contact — only process the LATEST call per contact for notes
  // But still write all attempts count
  const latestByContact = {};
  for (const c of calls) {
    latestByContact[c.contact_id] = c; // ordered asc so last wins = most recent
  }

  // Process each unique contact
  let i = 0;
  const uniqueCalls = Object.values(latestByContact);
  for (const call of uniqueCalls) {
    i++;
    process.stdout.write(`[${i}/${uniqueCalls.length}] `);
    const attemptCount = attemptsByContact[call.contact_id] || 1;
    await processContact(call, i, attemptCount);
    await sleep(600); // rate limit GHL
  }

  console.log("\n\n✅ Backfill complete!");
}

main().catch(console.error);
