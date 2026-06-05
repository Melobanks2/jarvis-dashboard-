#!/usr/bin/env node
// download-recordings.js — Download all Telnyx recordings permanently + update GHL notes

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const fs   = require("fs");
const path = require("path");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const TELNYX_KEY  = process.env.TELNYX_API_KEY;
const TUNNEL_BASE = process.env.CLOUDFLARE_URL || "https://david.davidcaller.com";
const REC_DIR     = path.join(__dirname, "recordings");
const GHL_TOKEN   = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_API     = "https://services.leadconnectorhq.com";
const GHL_HEADERS = { "Authorization": `Bearer ${GHL_TOKEN}`, "Content-Type": "application/json", "Version": "2021-07-28" };

if (!fs.existsSync(REC_DIR)) fs.mkdirSync(REC_DIR, { recursive: true });

async function ghl(method, urlPath, body) {
  const res = await fetch(`${GHL_API}${urlPath}`, {
    method, headers: GHL_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({}));
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllTelnyxRecordings() {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.telnyx.com/v2/recordings?page[size]=50&page[number]=${page}`, {
      headers: { "Authorization": `Bearer ${TELNYX_KEY}` }
    });
    const data = await res.json();
    const items = data.data || [];
    all.push(...items);
    console.log(`  Fetched page ${page}: ${items.length} recordings`);
    if (items.length < 50) break;
    page++;
    await sleep(200);
  }
  return all;
}

async function main() {
  console.log("Fetching all Telnyx recordings...");
  const recordings = await fetchAllTelnyxRecordings();
  console.log(`Total Telnyx recordings: ${recordings.length}\n`);

  if (recordings.length === 0) {
    console.log("No recordings found on Telnyx.");
    return;
  }

  // Get all jarvis_calls with contact_id for matching
  const { data: calls } = await sb.from("jarvis_calls").select("*").order("called_at", { ascending: false });
  const callMap = {};
  for (const c of (calls || [])) {
    if (c.twilio_call_sid) callMap[c.twilio_call_sid] = c;
  }

  let downloaded = 0;
  let updated = 0;

  for (const rec of recordings) {
    const callControlId = rec.call_control_id || rec.call_leg_id || rec.id;
    const downloadUrl   = rec.download_urls?.mp3 || rec.public_recording_url || rec.url;
    if (!downloadUrl) { console.log(`  [Skip] No download URL for ${rec.id}`); continue; }

    // Use recording ID as filename
    const fname = `${rec.id}.mp3`;
    const fpath = path.join(REC_DIR, fname);
    const permanentUrl = `${TUNNEL_BASE}/recordings/${fname}`;

    // Skip if already downloaded
    if (fs.existsSync(fpath)) {
      console.log(`  [Skip] Already exists: ${fname}`);
    } else {
      try {
        const resp = await fetch(downloadUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(fpath, buf);
        console.log(`  ✅ Downloaded: ${fname} (${(buf.length/1024).toFixed(0)}KB)`);
        downloaded++;
      } catch (e) {
        console.warn(`  ❌ Download failed ${fname}: ${e.message}`);
        continue;
      }
      await sleep(300);
    }

    // Find matching call in Supabase by call_control_id
    const matchedCall = callMap[callControlId];

    // Update Supabase with permanent URL
    try {
      await sb.from("jarvis_calls")
        .update({ recording_url: permanentUrl })
        .eq("twilio_call_sid", callControlId);
    } catch {}

    // Update GHL note if we have contact info
    if (matchedCall?.contact_id) {
      // Get existing notes to find the call note
      try {
        const notesRes = await ghl("GET", `/contacts/${matchedCall.contact_id}/notes?limit=10`);
        const notes = notesRes.notes || [];
        // Find note that contains "Recording processing"
        const targetNote = notes.find(n => (n.body || "").includes("Recording processing"));
        if (targetNote) {
          const updatedBody = targetNote.body.replace(
            "Recording: Recording processing — will update shortly",
            `Recording: ${permanentUrl}`
          );
          await ghl("PUT", `/contacts/${matchedCall.contact_id}/notes/${targetNote.id}`, { body: updatedBody, userId: null });
          console.log(`    ✅ GHL note updated for ${matchedCall.contact_name}`);
          updated++;
        }
      } catch (e) {
        console.warn(`    ⚠️ GHL update failed: ${e.message}`);
      }
      await sleep(300);
    }
  }

  console.log(`\n✅ Done — Downloaded: ${downloaded}, GHL notes updated: ${updated}`);
  console.log(`All recordings served at: ${TUNNEL_BASE}/recordings/`);
}

main().catch(console.error);
