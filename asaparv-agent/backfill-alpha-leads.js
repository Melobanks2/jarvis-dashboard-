/**
 * backfill-alpha-leads.js — One-time backfill of motivation/timeline/asking price
 *
 * Scans last 30 days of "New Alpha Lead Alert" emails.
 * For each email, parses lead fields and updates the GHL contact record:
 *   - Adds motivation/timeline/condition to contact custom fields
 *   - Adds a formatted note if one doesn't already exist
 *   - Logs what was updated
 *
 * Usage: node backfill-alpha-leads.js [--days 30] [--dry-run]
 *
 * Run once, then delete.
 */

require("dotenv").config();
const { google } = require("googleapis");
const fs   = require("fs");
const path = require("path");

const CREDENTIALS_PATH = path.join(__dirname, "gmail-credentials.json");
const TOKEN_PATH       = path.join(__dirname, "gmail-token.json");
const SUBJECT_FILTER   = "New Alpha Lead Alert";

const GHL_TOKEN    = process.env.GHL_API_TOKEN || "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_PIPELINE = "o4kqU2y8DYjA73aKUxNu";

const CONTACT_CF = {
  motivation: "G5pRzYCCqoUPiRHR4zDV",
  timeline:   "r3CXuo6aNXETD59iCplA",
  condition:  "KTwE7WE69Qh3camwH4H5",
};

// Opportunity-level CFs (same as alpha-scraper.js)
const OPP_CF = {
  motivation:  "8iQ5bTtag1FoawrSJunx",
  condition:   "Lji5u2shyhw8OJDJEY8b",
  timeline:    "4oI5ZS8uRSw2FtOFPE0K",
  askingPrice: "iTdV1YDnBY23ZstRHQ1Z",
  ownerName:   "iH4GqPMkAy5VnnQvL9Gz",
};

const GHL_HEADERS = {
  "Authorization": `Bearer ${GHL_TOKEN}`,
  "Version":       "2021-07-28",
  "Content-Type":  "application/json",
};

const DAYS    = parseInt(process.argv.find(a => a.startsWith("--days="))?.split("=")[1] || "30");
const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN) console.log("🔍 DRY RUN — no GHL writes will happen");

// ── Auth ─────────────────────────────────────────────────────────────────────

function buildAuth() {
  const { client_id, client_secret } = JSON.parse(fs.readFileSync(CREDENTIALS_PATH)).installed;
  const auth  = new google.auth.OAuth2(client_id, client_secret, "http://localhost");
  auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
  auth.on("tokens", updated => {
    const cur = JSON.parse(fs.readFileSync(TOKEN_PATH));
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...cur, ...updated }, null, 2));
  });
  return auth;
}

// ── Email parsing (same logic as gmail-watcher.js) ────────────────────────────

function decodeEmailBody(payload) {
  function extractPart(part) {
    if (!part) return "";
    if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64").toString("utf-8");
    if (part.mimeType === "text/html"  && part.body?.data) return Buffer.from(part.body.data, "base64").toString("utf-8");
    if (part.parts) { for (const p of part.parts) { const t = extractPart(p); if (t) return t; } }
    return "";
  }
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64").toString("utf-8");
  if (payload.parts) {
    for (const p of payload.parts) if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64").toString("utf-8");
    for (const p of payload.parts) { const t = extractPart(p); if (t) return t; }
  }
  return "";
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").split("\n").map(l => l.trim()).filter(Boolean).join("\n");
}

function parseLeadFromEmail(rawBody) {
  const body  = rawBody.includes("<") ? stripHtml(rawBody) : rawBody;
  const lines = body.split("\n").map(l => l.trim()).filter(Boolean);

  function extract(keys, fallbackPatterns) {
    for (const key of (Array.isArray(keys) ? keys : [keys])) {
      for (const line of lines) {
        const m = line.match(new RegExp(`^${key}\\s*[:\\-]\\s*(.+)$`, "i"));
        if (m) return m[1].trim();
      }
      const idx = lines.findIndex(l => new RegExp(`^${key}\\s*[:\\-]?\\s*$`, "i").test(l));
      if (idx >= 0 && lines[idx + 1]) return lines[idx + 1].trim();
    }
    for (const pat of (fallbackPatterns || [])) { const m = body.match(pat); if (m) return m[1].trim(); }
    return null;
  }

  return {
    name:        extract(["name", "seller name", "seller", "contact name", "homeowner"]),
    phone:       extract(["phone", "phone number", "cell", "mobile"], [/(?:phone|cell)[:\s]*(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/i])
                 || lines.find(l => /^\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}$/.test(l)) || "",
    email:       extract(["email", "email address"]) || lines.find(l => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l)) || "",
    address:     extract(["address", "property address", "property", "location"])
                 || lines.find(l => /\d{5}/.test(l) && l.includes(",")) || "",
    motivation:  extract(["motivation", "reason for selling", "reason", "why selling", "seller motivation", "notes", "va notes"]),
    timeline:    extract(["timeline", "closing timeline", "time frame", "timeframe", "when", "urgency"]),
    askingPrice: extract(["asking price", "price", "asking", "requested price"], [/(?:asking|price)[:\s]*\$?([\d,]+(?:k|K)?)/i]),
    condition:   extract(["condition", "property condition", "rehab"]) || lines.find(l => /(light|medium|heavy) rehab|turnkey/i.test(l)) || null,
    vaNotes:     (() => {
      const idx = lines.findIndex(l => /^(?:va notes?|conversation|call notes?)[:\-]?\s*$/i.test(l));
      return idx >= 0 ? lines.slice(idx + 1, idx + 6).join(" ") : null;
    })(),
  };
}

// ── GHL helpers ───────────────────────────────────────────────────────────────

async function ghl(method, path, body) {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method,
    headers: GHL_HEADERS,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json() };
}

async function findContactByPhone(phone) {
  try {
    const clean = (phone || "").replace(/\D/g, "");
    if (!clean || clean.length < 10) return null;
    const { data: d1 } = await ghl("GET", `/contacts/search?locationId=${GHL_LOCATION}&phone=${encodeURIComponent(phone)}&limit=5`);
    const list1 = d1.contacts || d1.data?.contacts || [];
    if (list1.length > 0) return list1[0];
    const { data: d2 } = await ghl("GET", `/contacts/search?locationId=${GHL_LOCATION}&query=${clean}&limit=10`);
    const list2 = d2.contacts || d2.data?.contacts || [];
    return list2.find(c => (c.phone || "").replace(/\D/g, "") === clean) || null;
  } catch { return null; }
}

async function updateContactFields(contactId, lead) {
  const fields = [
    lead.motivation && { id: CONTACT_CF.motivation, value: lead.motivation },
    lead.timeline   && { id: CONTACT_CF.timeline,   value: lead.timeline },
    lead.condition  && { id: CONTACT_CF.condition,  value: lead.condition },
  ].filter(Boolean);
  if (!fields.length) return false;
  const { status } = await ghl("PUT", `/contacts/${contactId}`, { customFields: fields });
  return status === 200 || status === 201;
}

async function updateOppFields(contactId, lead) {
  const { data } = await ghl("GET", `/opportunities/search?contact_id=${contactId}&location_id=${GHL_LOCATION}&pipeline_id=${GHL_PIPELINE}&limit=5`);
  const opp = (data.opportunities || []).find(o => o.status === "open");
  if (!opp) return false;

  const fields = [
    lead.motivation  && { id: OPP_CF.motivation,  value: lead.motivation },
    lead.timeline    && { id: OPP_CF.timeline,     value: lead.timeline },
    lead.condition   && { id: OPP_CF.condition,    value: lead.condition },
    lead.askingPrice && { id: OPP_CF.askingPrice,  value: lead.askingPrice },
  ].filter(Boolean);
  if (!fields.length) return false;

  const { status } = await ghl("PUT", `/opportunities/${opp.id}`, { customFields: fields });
  return status === 200 || status === 201;
}

async function addBackfillNote(contactId, lead) {
  // Check if note already exists with "Alpha Leads VA Call Notes"
  const { data } = await ghl("GET", `/contacts/${contactId}/notes`);
  const notes = data.notes || [];
  if (notes.some(n => n.body?.includes("Alpha Leads VA Call Notes"))) {
    console.log(`    [Note] Backfill note already exists — skipping`);
    return;
  }

  const body = [
    `📋 Alpha Leads VA Call Notes (Backfilled)`,
    ``,
    `👤 Name: ${lead.name || "—"}`,
    `📞 Phone: ${lead.phone || "—"}`,
    lead.email       ? `📧 Email: ${lead.email}` : null,
    `📍 Address: ${lead.address || "—"}`,
    ``,
    `💡 Motivation: ${lead.motivation || "—"}`,
    `⏱ Timeline: ${lead.timeline || "—"}`,
    `💰 Asking Price: ${lead.askingPrice || "—"}`,
    `🏚 Condition: ${lead.condition || "—"}`,
    lead.vaNotes ? `📝 VA Notes: ${lead.vaNotes}` : null,
  ].filter(l => l !== null).join("\n");

  const { status } = await ghl("POST", `/contacts/${contactId}/notes`, { body, userId: null });
  return status === 200 || status === 201;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const auth  = buildAuth();
  const gmail = google.gmail({ version: "v1", auth });

  const daysAgo = Math.floor(Date.now() / 1000) - (DAYS * 86400);

  console.log(`\n🔄 Backfilling Alpha Leads from last ${DAYS} days...\n`);

  // Fetch all matching emails (paginate)
  let allMessages = [];
  let pageToken;
  do {
    const res = await gmail.users.messages.list({
      userId:     "me",
      q:          `subject:"${SUBJECT_FILTER}" after:${daysAgo}`,
      maxResults: 50,
      ...(pageToken ? { pageToken } : {}),
    });
    allMessages.push(...(res.data.messages || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  console.log(`📧 Found ${allMessages.length} Alpha Lead emails to process\n`);

  let updated = 0, skipped = 0, noContact = 0, noParse = 0;

  for (let i = 0; i < allMessages.length; i++) {
    const msg = allMessages[i];
    try {
      const full    = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
      const rawBody = decodeEmailBody(full.data.payload);
      const lead    = parseLeadFromEmail(rawBody);

      if (!lead.phone && !lead.name) {
        console.log(`[${i + 1}/${allMessages.length}] ❓ Could not parse lead from email ${msg.id}`);
        noParse++;
        continue;
      }

      console.log(`[${i + 1}/${allMessages.length}] ${lead.name || "?"} | ${lead.phone || "?"} | ${lead.address || "?"}`);
      console.log(`    Motivation: ${lead.motivation || "—"} | Timeline: ${lead.timeline || "—"} | Asking: ${lead.askingPrice || "—"}`);

      if (!lead.phone) {
        console.log(`    ⚠️  No phone — cannot find GHL contact`);
        noParse++;
        continue;
      }

      const contact = await findContactByPhone(lead.phone);
      if (!contact) {
        console.log(`    ❌ No GHL contact found for ${lead.phone}`);
        noContact++;
        continue;
      }

      console.log(`    ✅ Found GHL contact: ${contact.id}`);

      if (DRY_RUN) {
        console.log(`    [DRY RUN] Would update: ${JSON.stringify({ motivation: lead.motivation, timeline: lead.timeline, condition: lead.condition, askingPrice: lead.askingPrice })}`);
        skipped++;
        continue;
      }

      const cfOk  = await updateContactFields(contact.id, lead);
      const oppOk = await updateOppFields(contact.id, lead);
      await addBackfillNote(contact.id, lead);

      console.log(`    [GHL] Contact fields: ${cfOk ? "✅" : "⚠️"}  Opp fields: ${oppOk ? "✅" : "—"}`);
      updated++;

    } catch (e) {
      console.error(`[${i + 1}] Error:`, e.message);
    }

    // Rate limit: 1 lead per 500ms
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n═══════════════════════════════`);
  console.log(`✅ Updated:    ${updated}`);
  console.log(`❌ No contact: ${noContact}`);
  console.log(`❓ No parse:   ${noParse}`);
  if (DRY_RUN) console.log(`⏭ Dry run:    ${skipped}`);
  console.log(`═══════════════════════════════\n`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
