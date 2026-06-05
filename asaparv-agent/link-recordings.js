#!/usr/bin/env node
// link-recordings.js — Match downloaded recordings to GHL notes and update them

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const fs   = require("fs");
const path = require("path");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const TUNNEL_BASE = process.env.CLOUDFLARE_URL || "https://david.davidcaller.com";
const REC_DIR     = path.join(__dirname, "recordings");
const GHL_TOKEN   = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_API     = "https://services.leadconnectorhq.com";
const GHL_HEADERS = {
  "Authorization": `Bearer ${GHL_TOKEN}`,
  "Content-Type":  "application/json",
  "Version":       "2021-07-28",
};

async function ghl(method, urlPath, body) {
  const res = await fetch(`${GHL_API}${urlPath}`, {
    method, headers: GHL_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({}));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const files = fs.readdirSync(REC_DIR).filter(f => f.endsWith(".mp3"));
  console.log(`Recordings on disk: ${files.length}`);

  // Get Telnyx recording list to map rec_id → call_control_id
  const telnyxRes = await fetch("https://api.telnyx.com/v2/recordings?page[size]=50", {
    headers: { "Authorization": `Bearer ${process.env.TELNYX_API_KEY}` }
  });
  const telnyxData = await telnyxRes.json();
  const recs = telnyxData.data || [];
  console.log(`Telnyx recordings: ${recs.length}`);

  const recToCallControlId = {};
  for (const r of recs) recToCallControlId[r.id] = r.call_control_id || r.call_leg_id;

  // Get all jarvis_calls
  const { data: calls } = await sb.from("jarvis_calls").select("*");
  const callsByCallControlId = {};
  for (const c of (calls || [])) {
    if (c.twilio_call_sid) callsByCallControlId[c.twilio_call_sid] = c;
  }

  let updated = 0;
  for (const fname of files) {
    const recId = fname.replace(".mp3", "");
    const permanentUrl = `${TUNNEL_BASE}/recordings/${fname}`;
    const cci  = recToCallControlId[recId];
    const call = cci ? callsByCallControlId[cci] : null;

    if (!call || !call.contact_id) {
      console.log(`  [Skip] No DB match for ${recId.substring(0, 8)}...`);
      continue;
    }

    // Update Supabase recording_url
    try {
      await sb.from("jarvis_calls").update({ recording_url: permanentUrl }).eq("twilio_call_sid", cci);
    } catch {}

    // Write a dedicated recording note
    const callDate = new Date(call.called_at).toLocaleString("en-US", { timeZone: "America/New_York" });
    const durationMin = call.call_duration
      ? `${Math.floor(call.call_duration / 60)}m ${call.call_duration % 60}s`
      : "—";
    const noteBody =
      `🎙️ CALL RECORDING\n` +
      `Date: ${callDate}\n` +
      `Duration: ${durationMin}\n` +
      `Recording: ${permanentUrl}\n` +
      `Stage: ${call.stage_after || "—"}`;
    await ghl("POST", `/contacts/${call.contact_id}/notes`, { body: noteBody, userId: null });
    console.log(`  ✅ ${call.contact_name} — recording note added`);
    updated++;
    await sleep(400);
  }

  console.log(`\n✅ Done — ${updated}/${files.length} GHL notes updated with recording links`);
}

main().catch(console.error);
