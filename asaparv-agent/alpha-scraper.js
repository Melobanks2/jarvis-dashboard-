require("dotenv").config();
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const { aiChat } = require("./ai-router");

// ── Config ────────────────────────────────────────────────────────────────────
const LOGIN_URL   = "https://alphaleads-va.vercel.app/login";
const ALPHA_EMAIL = "Azuallc2@gmail.com";
const ALPHA_PASS  = "Sports@098";

const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_API      = "https://services.leadconnectorhq.com";
const GHL_PIPELINE = "o4kqU2y8DYjA73aKUxNu";

// VA♦️Leads pipeline stages
const STAGES = {
  newLead:      "92d0031c-00f8-4692-bc9f-235a76fa3201", // ♨️New Lead
  attempt1:     "ccef1b7a-f245-4f1d-a5c6-5c9eef6bde74", // 📞Attempt 1
  coldFollowUp: "234e7689-663f-4191-8c6a-7bf73da1045c", // 🥶Cold Follow Up
  warmFollowUp: "47f767a6-24af-48f2-9df2-5d664f031bb7", // 🧤Warm Follow Up
  hotFollowUp:  "898845b3-7e76-42be-b8a7-cb8a85a0daa2", // 🔥Hot Follow Up
};

const TELEGRAM_TOKEN   = "8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const GHL_HEADERS = {
  "Authorization": `Bearer ${GHL_TOKEN}`,
  "Version":       "2021-07-28",
  "Content-Type":  "application/json"
};

// ── Tag builders ──────────────────────────────────────────────────────────────
function buildTags(lead) {
  const tags = ["alpha-leads"];
  const mot  = (lead.motivation || lead.notes || "").toLowerCase();

  if      (mot.includes("inherit"))                                  tags.push("🏃🏽‍♂️💨 Inherited");
  else if (mot.includes("tired") || mot.includes("landlord") || mot.includes("getting old")) tags.push("🏃🏽‍♂️💨 Tired Landlord");
  else if (mot.includes("moving") || mot.includes("relocat"))        tags.push("🏃🏽‍♂️💨 Moving");
  else if (mot.includes("financial") || mot.includes("foreclos") || mot.includes("behind")) tags.push("🏃🏽‍♂️💨 Financial Stress");
  else if (mot.includes("divorce") || mot.includes("separat"))       tags.push("🏃🏽‍♂️💨 Divorce");
  else if (mot.includes("vacant") || mot.includes("empty"))          tags.push("🏃🏽‍♂️💨 Vacant Property");

  const tl = (lead.timeline || "").toLowerCase();
  if      (tl.includes("asap") || tl.includes("immediately"))        tags.push("⏳ ASAP");
  else if (tl.includes("30"))                                        tags.push("⏳ 30 Days");
  else if (tl.includes("60") || tl.includes("90") || tl.includes("1-3")) tags.push("⏳ 60 to 90 Days");
  else if (tl.includes("3") || tl.includes("6 month") || tl.includes("3 to 6")) tags.push("⏳ 3 to 6 Months");
  else                                                               tags.push("⏳ No Timeline");

  const cond = (lead.condition || "").toLowerCase();
  if      (cond.includes("heavy"))   tags.push("🏚 Heavy Rehab");
  else if (cond.includes("medium"))  tags.push("🏚 Medium Rehab");
  else if (cond.includes("light"))   tags.push("🏚 Light Rehab");
  else if (cond.includes("turnkey")) tags.push("🏚 Turnkey");

  if      (lead.score === "hot")  tags.push("🔥 Hot Lead");
  else if (lead.score === "warm") tags.push("⚡ Warm Lead");

  return tags;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseNote(notes, key) {
  if (!notes) return null;
  const m = notes.match(new RegExp(`-?\\s*${key}\\s*:?\\s*([^\\n\\r-]+)`, "i"));
  return m ? m[1].trim() : null;
}

function scoreLead(lead) {
  const temp = (lead.temperature || "").toLowerCase();
  if (temp === "hot")  return "hot";
  if (temp === "cold") return "cold";
  if (temp === "warm") return "warm";

  let score = 0;
  const motivation = parseInt(parseNote(lead.notes, "Motivation sell Rate") || "0");
  if (motivation >= 7) score += 3;
  else if (motivation >= 4) score += 1;

  const tl = (parseNote(lead.notes, "Closing Timeline") || lead.timeline || "").toLowerCase();
  if (tl.includes("asap") || tl.includes("30 day") || tl.includes("immediately")) score += 3;
  else if (tl.includes("1-3") || tl.includes("60") || tl.includes("90")) score += 1;

  const cond = (lead.condition || "").toLowerCase();
  if (cond.includes("poor") || cond.includes("major")) score += 2;
  else if (cond.includes("fair") || cond.includes("light")) score += 1;

  return score >= 5 ? "hot" : score >= 2 ? "warm" : "cold";
}

// ── GHL helpers ───────────────────────────────────────────────────────────────
async function ghlGet(path) {
  const res = await fetch(`${GHL_API}${path}`, { headers: GHL_HEADERS });
  return res.json();
}

async function ghlPost(path, body) {
  const res = await fetch(`${GHL_API}${path}`, {
    method: "POST", headers: GHL_HEADERS, body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function ghlPut(path, body) {
  const res = await fetch(`${GHL_API}${path}`, {
    method: "PUT", headers: GHL_HEADERS, body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function ghlAddNote(contactId, body) {
  try {
    await ghlPost(`/contacts/${contactId}/notes`, { body, userId: null });
    console.log(`  [GHL] Note added to contact`);
  } catch (e) {
    console.error("  [GHL] Note error:", e.message);
  }
}

// CONTACT-level custom field IDs (written directly on contact record)
const CONTACT_CF = {
  motivation: "G5pRzYCCqoUPiRHR4zDV",
  timeline:   "r3CXuo6aNXETD59iCplA",
  condition:  "KTwE7WE69Qh3camwH4H5",
};

async function ghlWriteContactFields(contactId, lead) {
  const fields = [
    lead.motivation  && { id: CONTACT_CF.motivation, value: lead.motivation },
    lead.timeline    && { id: CONTACT_CF.timeline,   value: lead.timeline },
    lead.condition   && { id: CONTACT_CF.condition,  value: lead.condition },
  ].filter(Boolean);
  if (!fields.length) return;
  try {
    await ghlPut(`/contacts/${contactId}`, { customFields: fields });
    console.log(`  [GHL] Contact fields written (${fields.length} fields)`);
  } catch (e) { console.error("  [GHL] Contact field error:", e.message); }
}

// AI-generated opener for a lead
async function generateOpener(lead) {
  try {
    const context = [
      lead.motivation  && `Motivation: ${lead.motivation}`,
      lead.timeline    && `Timeline: ${lead.timeline}`,
      lead.askingPrice && lead.askingPrice !== "N/A" && `Asking: $${lead.askingPrice}`,
      lead.condition   && `Condition: ${lead.condition}`,
    ].filter(Boolean).join(". ");
    const res = await aiChat({
      system: "You are a wholesale real estate acquisitions coach. Write natural, conversational call openers.",
      messages: [{
        role: "user",
        content: `Write a specific 2-3 sentence opener for Chris calling ${lead.name || "this seller"} about ${lead.address || "their property"}. Context: ${context || "no extra context"}. Start with "Hey ${(lead.name || "there").split(" ")[0]}" and reference their SPECIFIC situation. No placeholder brackets.`,
      }],
      max_tokens: 120,
    });
    return res.text.trim();
  } catch {
    const fn = (lead.name || "there").split(" ")[0];
    return `Hey ${fn}, this is Chris. I saw you were looking to sell your property — tell me more about what's going on.`;
  }
}

// OPPORTUNITY-level custom field IDs
const CF = {
  motivation:   '8iQ5bTtag1FoawrSJunx',
  condition:    'Lji5u2shyhw8OJDJEY8b',
  timeline:     '4oI5ZS8uRSw2FtOFPE0K',
  mortgage:     'hsI5aCkN2rkKukwF7WVM',
  occupancy:    'saOCIAWeKyrHgdYndtxS',
  askingPrice:  'iTdV1YDnBY23ZstRHQ1Z',
  marketValue:  'nrf56A59NAxgmkNxfOye',
  rehabCost:    'YZjGRzhqk8CTMJhE1Yr0',
  arv:          'n0v6O9y0BkMoiW8AURtn',
  ownerName:    'iH4GqPMkAy5VnnQvL9Gz',
  address:      'SGJdYcttaxyiWDHydcc6',
};

async function ghlWriteCustomFields(oppId, lead) {
  const fields = [];
  if (lead.name)    fields.push({ id: CF.ownerName, value: lead.name });
  if (lead.address) fields.push({ id: CF.address,   value: lead.address }); // full: street, city, ST zip
  if (lead.motivation)  fields.push({ id: CF.motivation,  value: lead.motivation });
  if (lead.condition)   fields.push({ id: CF.condition,   value: lead.condition });
  if (lead.timeline)    fields.push({ id: CF.timeline,    value: lead.timeline });
  if (lead.mortgage)    fields.push({ id: CF.mortgage,    value: lead.mortgage });
  if (lead.occupancy)   fields.push({ id: CF.occupancy,   value: lead.occupancy });
  if (lead.askingPrice) fields.push({ id: CF.askingPrice, value: lead.askingPrice });
  if (lead.marketValue) fields.push({ id: CF.marketValue, value: lead.marketValue });
  if (lead.repairs)     fields.push({ id: CF.rehabCost,   value: lead.repairs });

  if (!fields.length) return;
  try {
    await ghlPut('/opportunities/' + oppId, { customFields: fields });
    console.log('  [GHL] Opportunity fields written (' + fields.length + ' fields)');
  } catch (e) {
    console.error('  [GHL] Opp field error:', e.message);
  }
}

// Check if contact exists by phone — returns contactId or null
async function ghlFindContact(phone) {
  try {
    const clean = phone.replace(/\D/g, "");
    // Try formatted phone
    const d1 = await ghlGet(`/contacts/search?locationId=${GHL_LOCATION}&phone=${encodeURIComponent(phone)}&limit=5`);
    const list1 = d1.contacts || d1.data?.contacts || [];
    if (list1.length > 0) return list1[0].id;

    // Try query search with raw digits
    const d2 = await ghlGet(`/contacts/search?locationId=${GHL_LOCATION}&query=${clean}&limit=10`);
    const list2 = d2.contacts || d2.data?.contacts || [];
    const match = list2.find(c => (c.phone || "").replace(/\D/g, "") === clean);
    return match ? match.id : null;
  } catch (e) {
    console.error("  [GHL] Search error:", e.message);
    return null;
  }
}

// Check if an open opportunity already exists for this contact in this pipeline
async function ghlFindOpportunity(contactId) {
  try {
    const d = await ghlGet(`/opportunities/search?location_id=${GHL_LOCATION}&contact_id=${contactId}&pipeline_id=${GHL_PIPELINE}&limit=5`);
    const opps = d.opportunities || d.data?.opportunities || [];
    return opps.find(o => o.status === "open") || null;
  } catch (e) {
    return null;
  }
}

function buildContactPayload(lead, tags) {
  const nameParts   = (lead.name || "Unknown").trim().split(/\s+/);
  const firstName   = nameParts[0] || "";
  const lastName    = nameParts.slice(1).join(" ") || "";
  // Address format: "123 Main St, City, ST 12345"
  const addrParts   = (lead.address || "").split(",").map(s => s.trim());
  const stateZipRaw = (addrParts[2] || "").trim().split(/\s+/);
  const stateToken  = stateZipRaw.length >= 2 ? stateZipRaw.slice(0, -1).join(" ") : stateZipRaw[0] || "";
  const zipToken    = stateZipRaw[stateZipRaw.length - 1] || "";
  return {
    firstName,
    lastName,
    phone:      lead.phone || "",
    ...(lead.email ? { email: lead.email } : {}),
    address1:   addrParts[0] || "",
    city:       addrParts[1] || "",
    state:      stateToken,
    postalCode: zipToken,
    tags,
    source:     "Alpha Leads",
  };
}

async function ghlCreateContact(lead, tags) {
  const payload = buildContactPayload(lead, tags);

  const { status, data } = await ghlPost("/contacts/", {
    locationId: GHL_LOCATION,
    ...payload,
  });

  if (status === 200 || status === 201) {
    console.log(`  [GHL] Contact created: ${lead.name} (${data.contact?.id})`);
    return { id: data.contact?.id, isNew: true };
  }

  // Contact already exists — update with correct full name + all fields
  if (data.meta?.contactId) {
    const contactId = data.meta.contactId;
    const { status: putStatus } = await ghlPut(`/contacts/${contactId}`, payload);
    if (putStatus === 200 || putStatus === 201) {
      console.log(`  [GHL] Contact updated: ${lead.name} (${contactId})`);
    } else {
      console.log(`  [GHL] Contact exists (update skipped): ${contactId}`);
    }
    return { id: contactId, isNew: false };
  }

  console.error(`  [GHL] Create error:`, JSON.stringify(data).substring(0, 150));
  return { id: null, isNew: false };
}

async function ghlCreateOpportunity(lead, contactId, stageId) {
  const askNum = parseFloat((lead.askingPrice || "").replace(/[^0-9.]/g, "")) || undefined;
  const { status, data } = await ghlPost("/opportunities/", {
    pipelineId:      GHL_PIPELINE,
    locationId:      GHL_LOCATION,
    name:            `${lead.name} - ${lead.address}`,
    pipelineStageId: stageId,
    status:          "open",
    contactId,
    source:          "Alpha Leads",
    ...(askNum ? { monetaryValue: askNum } : {}),
  });

  if (status === 200 || status === 201) {
    console.log(`  [GHL] Opportunity created → stage ${stageId.substring(0, 8)}… (${data.opportunity?.id})`);
    return data.opportunity?.id;
  }
  if (data.message?.includes("duplicate")) {
    console.log(`  [GHL] Opportunity already exists — skipping.`);
    return null;
  }
  console.error(`  [GHL] Opportunity error:`, JSON.stringify(data).substring(0, 150));
  return null;
}

// ── Supabase ──────────────────────────────────────────────────────────────────
async function supabaseLog(lead, tags) {
  try {
    await sb.from("jarvis_log").insert({
      type:         "lead",
      message:      JSON.stringify({
        name:           lead.name,
        phone:          lead.phone,
        email:          lead.email,
        address:        lead.address,
        score:          lead.score,
        temperature:    lead.temperature,
        condition:      lead.condition,
        timeline:       lead.timeline,
        motivation:     lead.motivation,
        motivationRate: lead.motivationRate,
        askingPrice:    lead.askingPrice,
        marketValue:    lead.marketValue,
        repairs:        lead.repairs,
        hvac:           lead.hvac,
        roofAge:        lead.roofAge,
        occupancy:      lead.occupancy,
        mortgage:       lead.mortgage,
        agentName:      lead.agentName,
        tags,
      }),
      contact_name: lead.name || null,
      source:       "alpha-leads",
      priority:     lead.score === "hot" ? "hot" : lead.score === "warm" ? "high" : "normal",
      pipeline:     "VA♦️ Leads",
      stage:        "New Lead"
    });
  } catch (e) {
    console.error("  [Supabase] Log error:", e.message);
  }
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  try {
    const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" })
    });
    const d = await res.json();
    if (!d.ok) console.error("  [Telegram] Error:", d.description);
    else        console.log("  [Telegram] Alert sent.");
  } catch (e) {
    console.error("  [Telegram] Error:", e.message);
  }
}

// ── Claim new leads before scraping ───────────────────────────────────────────
async function claimAvailableLeads(page) {
  console.log("[claim] Checking for unclaimed leads...");
  const claimed = [];

  // Look for notification badge or any "Claim" button
  const claimSelectors = [
    'button:has-text("Claim This Lead")',
    'button:has-text("Claim Lead")',
    'button:has-text("Claim")',
    '[data-testid*="claim"]',
    '.claim-btn',
  ];

  // Check notification badge count
  const badge = page.locator('.notification-badge, [class*="badge"], [class*="notification"]').first();
  const badgeText = await badge.isVisible().catch(() => false)
    ? await badge.innerText().catch(() => "")
    : "";
  if (badgeText) console.log(`[claim] Notification badge: "${badgeText}"`);

  // Try each claim selector
  for (const sel of claimSelectors) {
    const btns = page.locator(sel);
    const count = await btns.count().catch(() => 0);
    if (count === 0) continue;
    console.log(`[claim] Found ${count} claim button(s) via "${sel}"`);

    for (let i = 0; i < count; i++) {
      try {
        const btn = btns.nth(i);
        if (!await btn.isVisible()) continue;

        // Grab any visible lead info before clicking
        const container = btn.locator("xpath=ancestor::*[contains(@class,'card') or contains(@class,'row') or contains(@class,'lead')][1]");
        let preText = "";
        try { preText = await container.innerText(); } catch (_) {}

        console.log(`[claim] Clicking claim button #${i + 1}…`);
        await btn.click({ force: true });
        await page.waitForTimeout(3000);

        // Grab post-click content (modal or expanded card)
        let postText = "";
        const modal = page.locator('[role="dialog"], .modal, [class*="modal"]').first();
        if (await modal.isVisible().catch(() => false)) {
          postText = await modal.innerText().catch(() => "");
        } else {
          // Lead detail may expand inline — re-grab container
          try { postText = await container.innerText(); } catch (_) {}
        }

        const raw   = (postText || preText).split("\n").map(l => l.trim()).filter(Boolean);

        // ── Parse all available fields from claimed lead ──────────────────
        function nf(key) {
          const idx = raw.findIndex(l => l.toLowerCase() === `-${key.toLowerCase()}`);
          return idx >= 0 ? (raw[idx + 1] || "").trim() : null;
        }

        const name        = raw.find(l => l.length > 3 && !/^\d/.test(l) && !/(claim|button|close|skip|tour)/i.test(l)) || "Unknown";
        const phone       = raw.find(l => /\(\d{3}\)\s*\d{3}-\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/.test(l)) || "";
        const addr        = raw.find(l => /\d{5}/.test(l) && l.includes(",")) || raw.find(l => /\d+\s+\w+\s+(st|ave|dr|blvd|rd|ln|ct|way)/i.test(l)) || "";
        const temperature = (raw.find(l => /^(HOT|WARM|COLD)$/i.test(l)) || "").toLowerCase();
        const condition   = raw.find(l => /(light|medium|heavy) rehab|turnkey/i.test(l)) || nf("Condition Rating") || "";
        const timeline    = nf("Closing Timeline") || raw.find((l, idx) => idx > 3 && /(\d+-\d+\s*(month|day)|asap|immediately)/i.test(l)) || "";
        const motivation  = nf("Reason for Selling") || nf("Reason For Selling") || "";
        const askingPrice = nf("Asking Price") || "N/A";
        const marketValue = nf("Zillow Market Value") || nf("Redfin Market Value") || nf("Market Value") || "";
        const mortgage    = nf("Mortgage") || "";
        const occupancy   = nf("Occupancy") || "";
        const repairs     = nf("Repairs needed") || "";
        const hvac        = nf("Age of HVAC") || "";
        const roofAge     = nf("Age of Roof") || "";
        const callbackTime = nf("Callback Time") || "";
        const motivationRate = nf("Motivation to sell Rate") || nf("Motivation sell Rate") || "";
        const agentName   = nf("Agent Name") || "";
        const emailLine   = raw.find(l => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l)) || "";
        const email       = emailLine || nf("Email") || "";
        const generalIdx  = raw.findIndex(l => l.toUpperCase() === "GENERAL");
        const rawNotes    = generalIdx >= 0 ? raw.slice(generalIdx + 1).join("\n") : raw.join("\n");

        const claimLead = {
          name, phone, email, address: addr, condition, temperature,
          repairs, hvac, roofAge, occupancy, motivation, motivationRate,
          timeline, askingPrice, marketValue, mortgage, agentName, callbackTime,
          notes: rawNotes,
        };
        claimLead.score = scoreLead(claimLead);
        const claimTags = buildTags(claimLead).concat(["🐺 Alpha Lead"]);

        console.log(`[claim] ✅ Claimed: ${name} | ${phone} | ${addr}`);
        console.log(`[claim] Raw lines: ${JSON.stringify(raw.slice(0, 10))}`);

        // ── GHL: build contact payload ──────────────────────────────────────
        const nameParts  = name.trim().split(/\s+/);
        const firstName  = nameParts[0] || "";
        const lastName   = nameParts.slice(1).join(" ") || "";
        const addrParts  = addr.split(",").map(s => s.trim());
        const stateZip   = (addrParts[2] || "").trim().split(/\s+/);
        const state      = stateZip.length >= 2 ? stateZip.slice(0, -1).join(" ") : stateZip[0] || "";
        const postalCode = stateZip[stateZip.length - 1] || "";

        const contactPayload = {
          locationId: GHL_LOCATION,
          firstName,
          lastName,
          phone,
          ...(email ? { email } : {}),
          address1:   addrParts[0] || "",
          city:       addrParts[1] || "",
          state,
          postalCode,
          source:     "Alpha Leads",
          tags:       claimTags,
        };

        console.log(`[claim] → POST /contacts/ for ${name}…`);
        let contactId = null;
        const { status: cStatus, data: cData } = await ghlPost("/contacts/", contactPayload);

        if (cStatus === 200 || cStatus === 201) {
          contactId = cData.contact?.id;
          console.log(`[claim] ✅ GHL Contact created: ${contactId}`);
        } else if (cData.meta?.contactId) {
          contactId = cData.meta.contactId;
          const { locationId: _loc, ...putPayload } = contactPayload;
          const { status: pStatus } = await ghlPut(`/contacts/${contactId}`, putPayload);
          console.log(`[claim] ✅ GHL Contact updated (duplicate): ${contactId} — PUT ${pStatus}`);
        } else {
          console.error(`[claim] ❌ GHL Contact error (${cStatus}):`, JSON.stringify(cData).substring(0, 200));
        }

        // Write contact-level custom fields
        if (contactId) await ghlWriteContactFields(contactId, claimLead);

        // ── GHL: create opportunity ─────────────────────────────────────────
        let oppId = null;
        if (contactId) {
          const existingOpp = await ghlFindOpportunity(contactId);
          if (existingOpp) {
            oppId = existingOpp.id;
            console.log(`[claim] Open opportunity already exists: ${oppId}`);
          } else {
            console.log(`[claim] → POST /opportunities/ for ${name}…`);
            const askNum = parseFloat((askingPrice || "").replace(/[^0-9.]/g, "")) || undefined;
            const { status: oStatus, data: oData } = await ghlPost("/opportunities/", {
              pipelineId:      GHL_PIPELINE,
              locationId:      GHL_LOCATION,
              name:            `${name} - ${addr}`,
              pipelineStageId: STAGES.newLead,
              status:          "open",
              contactId,
              source:          "Alpha Leads",
              ...(askNum ? { monetaryValue: askNum } : {}),
            });
            if (oStatus === 200 || oStatus === 201) {
              oppId = oData.opportunity?.id;
              console.log(`[claim] ✅ GHL Opportunity created: ${oppId}`);
            } else {
              console.error(`[claim] ❌ GHL Opportunity error (${oStatus}):`, JSON.stringify(oData).substring(0, 200));
            }
          }

          // Write all custom fields to opportunity
          if (oppId) await ghlWriteCustomFields(oppId, claimLead);

          // Write full formatted note
          const claimNoteLines = [
            `📋 Alpha Lead Claim Notes`,
            ``,
            `👤 Name: ${name}`,
            `📞 Phone: ${phone}`,
            email          ? `📧 Email: ${email}` : null,
            `📍 Address: ${addr}`,
            ``,
            `🌡 Temperature: ${temperature?.toUpperCase() || "—"}`,
            `📊 Score: ${claimLead.score?.toUpperCase() || "—"}`,
            ``,
            `💡 Reason For Selling: ${motivation || "—"}`,
            `📈 Motivation Rate: ${motivationRate || "—"}`,
            `⏱ Timeline: ${timeline || "—"}`,
            `🏚 Condition: ${condition || "—"}`,
            `🔧 Repairs Needed: ${repairs || "—"}`,
            `❄️ HVAC Age: ${hvac || "—"}`,
            `🏠 Roof Age: ${roofAge || "—"}`,
            `🏡 Occupancy: ${occupancy || "—"}`,
            `💰 Asking Price: ${askingPrice || "—"}`,
            `📊 Market Value: ${marketValue || "—"}`,
            `🏦 Mortgage: ${mortgage || "—"}`,
            `📞 Callback Time: ${callbackTime || "—"}`,
            agentName      ? `👤 VA Agent: ${agentName}` : null,
          ].filter(l => l !== null).join("\n");
          await ghlAddNote(contactId, claimNoteLines);
        }

        claimed.push({ ...claimLead, contactId, oppId });

        // ── Telegram alert — rich with all fields + urgency + opener ───────
        const isUrgent = /asap|immediately|30 day/i.test(timeline) ||
                         (parseFloat((askingPrice || "").replace(/[^0-9.]/g, "")) > 0 && claimLead.score === "hot");
        const urgencyLabel = isUrgent
          ? "🚨 CALL IMMEDIATELY"
          : claimLead.score === "hot"  ? "🔥 HOT — call ASAP"
          : claimLead.score === "warm" ? "⚡ Warm — call within the hour"
          : "🐺 New lead claimed";

        let opener = "";
        try { opener = await generateOpener(claimLead); } catch (_) {}

        await sendTelegram(
          `🐺 <b>New Alpha Lead Claimed!</b>\n\n` +
          `👤 ${name}\n` +
          `📞 ${phone || "—"}\n` +
          (email ? `📧 ${email}\n` : "") +
          `📍 ${addr || "—"}\n` +
          `\n💡 <b>Motivation:</b> ${motivation || "—"}\n` +
          `⏱ <b>Timeline:</b> ${timeline || "—"}\n` +
          `💰 <b>Asking Price:</b> ${askingPrice && askingPrice !== "N/A" ? askingPrice : "—"}\n` +
          `🏚 <b>Condition:</b> ${condition || "—"}\n` +
          (occupancy    ? `🏡 Occupancy: ${occupancy}\n`         : "") +
          (callbackTime ? `📞 Best time: ${callbackTime}\n`      : "") +
          `\n<b>${urgencyLabel}</b>\n` +
          (opener ? `\n🎯 <b>Opener:</b>\n<i>${opener}</i>` : "") +
          `\n\nAdded to GHL ✅`
        );

        // ── Supabase log ────────────────────────────────────────────────────
        const sbPayload = {
          type:         "new_lead",
          message:      JSON.stringify({ ...claimLead, contactId, oppId, source: "alpha-claim" }),
          contact_name: name,
          source:       "alpha-leads",
          priority:     isUrgent ? "urgent" : claimLead.score === "hot" ? "hot" : "high",
          pipeline:     "VA♦️ Leads",
          stage:        "New Lead",
        };
        try {
          await sb.from("jarvis_log").insert(sbPayload);
        } catch (e) {
          console.error("[claim] Supabase log error:", e.message);
        }

        // Close modal if open
        const closeBtn = page.locator('[aria-label="Close"], button:has-text("Close"), button:has-text("×")').first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
        }
      } catch (e) {
        console.error(`[claim] Error on button #${i + 1}:`, e.message);
      }
    }
    break; // found the right selector — don't try others
  }

  if (claimed.length === 0) console.log("[claim] No unclaimed leads found.");
  return claimed;
}

// ── Scraper ───────────────────────────────────────────────────────────────────
async function scrapeLeads() {
  console.log("=== Alpha Leads Scraper Starting ===\n");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const page    = await browser.newPage();
  const leads   = [];

  try {
    console.log("[1] Logging in...");
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.fill('input[type="text"]',     ALPHA_EMAIL);
    await page.fill('input[type="password"]', ALPHA_PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(3000);
    console.log("    URL:", page.url());
    if (!page.url().includes('/member')) {
      console.log('[alpha-scraper] Login failed');
      return leads;
    }
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const skipBtn = page.locator('button:has-text("Skip")');
    if (await skipBtn.count() > 0) { await skipBtn.click(); await page.waitForTimeout(1000); }
    await page.evaluate(() => document.querySelector('#react-joyride-portal')?.remove());

    // ── Claim any available leads before scraping ──
    await claimAvailableLeads(page);
    await page.waitForTimeout(2000);

    const totalLeads = await page.locator("table tbody tr").count();
    console.log(`[2] Found ${totalLeads} leads.\n`);

    if (totalLeads === 0) {
      console.log("No new leads — exiting");
      return [];
    }

    for (let i = 0; i < totalLeads; i++) {
      const headerRow = page.locator("table tbody tr").nth(i);
      await headerRow.click({ force: true });
      await page.waitForTimeout(1500);

      const detailText = await page.locator("table tbody tr").nth(i + 1).innerText();
      const lines = detailText.split("\n").map(l => l.trim()).filter(Boolean);

      // Page structure (confirmed from raw scrape):
      // lines[0] = avatar initial (skip)
      // lines[1] = full name
      // lines[2] = phone (xxx) xxx-xxxx
      // lines[3] = address (has zip)
      // lines[4] = temperature (HOT/WARM/COLD)
      // lines[5] = condition (Light Rehab / Medium Rehab / Heavy Rehab / Turnkey)
      // lines[6] = timeline (1-3 Months / ASAP / 30 days / etc.)
      // then: Map, Street, RECORDING, AI SUMMARY, ...
      // after GENERAL: "-Field Name" then value on next line

      // Helper: look up a dash-prefixed field in the lines array
      function noteField(key) {
        const idx = lines.findIndex(l => l.toLowerCase() === `-${key.toLowerCase()}`);
        return idx >= 0 ? (lines[idx + 1] || "").trim() : null;
      }

      const name        = lines[1] || lines[0] || "Unknown";
      const phone       = (lines.find(l => l.match(/^\(\d{3}\)\s*\d{3}-\d{4}$/)) || "").trim();
      const address     = lines.find(l => l.match(/\d{5}/) && l.includes(",")) || "";
      const temperature = (lines.find(l => /^(HOT|WARM|COLD)$/i.test(l)) || "").toLowerCase();
      const condition   = lines.find(l => /(light|medium|heavy) rehab|turnkey/i.test(l)) || noteField("Condition Rating") || "";
      const timeline    = lines.find((l, idx) => idx > 3 && /(\d+-\d+\s*(month|day)|asap|immediately)/i.test(l)) || noteField("Closing Timeline") || "";

      // Build full notes from everything after "GENERAL"
      const generalIdx = lines.findIndex(l => l.toUpperCase() === "GENERAL");
      const rawNotes   = generalIdx >= 0 ? lines.slice(generalIdx + 1).join("\n") : lines.join("\n");

      // Email: look for @ pattern in any line
      const emailLine = lines.find(l => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l));
      const email     = emailLine || noteField("Email") || "";

      const lead = {
        name, phone, email, address, condition, temperature,
        repairs:        noteField("Repairs needed"),
        hvac:           noteField("Age of HVAC"),
        roofAge:        noteField("Age of Roof"),
        occupancy:      noteField("Occupancy"),
        motivation:     noteField("Reason for Selling") || noteField("Reason For Selling"),
        motivationRate: noteField("Motivation to sell Rate") || noteField("Motivation sell Rate"),
        timeline:       timeline || noteField("Closing Timeline"),
        askingPrice:    noteField("Asking Price") || "N/A",
        marketValue:    noteField("Zillow Market Value") || noteField("Redfin Market Value") || noteField("Market Value"),
        mortgage:       noteField("Mortgage"),
        listing:        noteField("Listing"),
        agentName:      noteField("Agent Name"),
        callbackTime:   noteField("Callback Time"),
        additionalNotes: noteField("Additional Note"),
        notes:          rawNotes,
      };
      lead.score = scoreLead(lead);
      leads.push(lead);

      // Print raw data for first lead so we can verify all fields are captured
      if (i === 0) {
        console.log("\n=== RAW SCRAPED DATA (lead #1) ===");
        console.log("  Lines from page:", JSON.stringify(lines, null, 2));
        console.log("  Parsed lead:", JSON.stringify(lead, null, 2));
        console.log("===================================\n");
      }

      console.log(`  [${i + 1}] ${lead.name} | ${lead.phone} | ${lead.email || "no email"} | ${lead.score.toUpperCase()} | ${lead.timeline || "—"}`);

      await headerRow.click({ force: true });
      await page.waitForTimeout(500);
    }
  } finally {
    await browser.close();
  }
  return leads;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const leads = await scrapeLeads();
  if (leads.length === 0) { console.log("No leads found."); return; }

  console.log(`\n=== Processing ${leads.length} leads ===\n`);

  const newContacts = [];
  const skipped     = [];

  for (const lead of leads) {
    console.log(`\n── ${lead.name} [${lead.score.toUpperCase()}] ──`);

    // 1. Check GHL for existing contact by phone
    let existingId = await ghlFindContact(lead.phone);

    // 2. Build tags
    const tags = buildTags(lead);
    // New contacts always start in New Lead — stage promotion happens after a real AI call
    console.log(`  Stage: ♨️ New Lead (forced)  |  Score: ${lead.score.toUpperCase()}  |  Tags: ${tags.join(", ")}`);

    // 3. Create or retrieve contact
    const { id: contactId, isNew } = await ghlCreateContact(lead, tags);
    if (!contactId) continue;

    // If contact existed before this run, still update fields but skip opportunity creation
    if (existingId && !isNew) {
      await ghlWriteContactFields(contactId, lead);
      const preExistOpp = await ghlFindOpportunity(contactId);
      if (preExistOpp) await ghlWriteCustomFields(preExistOpp.id, lead);
      console.log(`  [GHL] Contact was pre-existing — fields refreshed, skipping new opportunity.`);
      skipped.push(lead.name);
      continue;
    }

    // 4. Check if open opportunity already exists — still update its fields
    const existingOpp = await ghlFindOpportunity(contactId);
    if (existingOpp) {
      await ghlWriteCustomFields(existingOpp.id, lead);
      await ghlWriteContactFields(contactId, lead);
      console.log(`  [GHL] Open opportunity exists (${existingOpp.id}) — fields refreshed, skipping.`);
      skipped.push(lead.name);
      continue;
    }

    // 5. Create opportunity — always New Lead for first-time contacts
    const oppId = await ghlCreateOpportunity(lead, contactId, STAGES.newLead);

    // 5b. Trigger instant David call (fires and forgets — calling hours enforced on the caller side)
    fetch("http://localhost:3000/internal/new-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId, oppId,
        phone:   lead.phone,
        name:    lead.name,
        address: lead.address,
        source:  "alpha-scraper",
      }),
    }).catch(() => {}); // don't block if caller is down

    // 6. Add VA call notes to contact
    const noteLines = [
      `📋 Alpha Leads VA Call Notes`,
      ``,
      `👤 Name: ${lead.name}`,
      `📞 Phone: ${lead.phone}`,
      lead.email    ? `📧 Email: ${lead.email}` : null,
      `📍 Address: ${lead.address}`,
      ``,
      `🌡 Temperature: ${lead.temperature?.toUpperCase() || "—"}`,
      `📊 Score: ${lead.score?.toUpperCase() || "—"}`,
      ``,
      `💡 Reason For Selling: ${lead.motivation || "—"}`,
      `📈 Motivation Rate: ${lead.motivationRate || "—"}`,
      `⏱ Timeline: ${lead.timeline || "—"}`,
      `🏚 Condition: ${lead.condition || "—"}`,
      `🔧 Repairs Needed: ${lead.repairs || "—"}`,
      `❄️ HVAC Age: ${lead.hvac || "—"}`,
      `🏠 Roof Age: ${lead.roofAge || "—"}`,
      `🏡 Occupancy: ${lead.occupancy || "—"}`,
      `💰 Asking Price: ${lead.askingPrice || "—"}`,
      `📊 Market Value: ${lead.marketValue || "—"}`,
      `🏦 Mortgage: ${lead.mortgage || "—"}`,
      `📋 On Listing: ${lead.listing || "—"}`,
      `📞 Callback Time: ${lead.callbackTime || "—"}`,
      lead.agentName      ? `👤 VA Agent: ${lead.agentName}` : null,
      lead.additionalNotes ? `\n📝 Additional Notes:\n${lead.additionalNotes}` : null,
    ].filter(l => l !== null).join("\n");

    await ghlAddNote(contactId, noteLines);
    if (oppId) await ghlWriteCustomFields(oppId, lead);

    // Also write motivation/timeline/condition to CONTACT record (not just opportunity)
    await ghlWriteContactFields(contactId, lead);

    await supabaseLog(lead, tags);
    console.log(`  [Supabase] Logged.`);

    newContacts.push({ ...lead, tags, stageId: STAGES.newLead });
  }

  console.log(`\n=== Done: ${newContacts.length} new | ${skipped.length} skipped ===`);

  // 7. Per-lead rich Telegram alerts with AI-generated openers
  if (newContacts.length === 0) return;

  for (const lead of newContacts) {
    const emoji     = lead.score === "hot" ? "🔥" : lead.score === "warm" ? "⚡" : "🔵";
    const hotLabel  = lead.score === "hot"  ? "🔥 HOT LEAD — call immediately"
                    : lead.score === "warm" ? "⚡ Warm lead — call within the hour"
                    : "🔵 New lead added to pipeline";

    const opener = await generateOpener(lead);

    await sendTelegram(
      `${emoji} <b>New VA Lead: ${lead.name}</b>\n\n` +
      `📍 ${lead.address || "—"}\n` +
      `📞 ${lead.phone   || "—"}\n` +
      (lead.email ? `📧 ${lead.email}\n` : "") +
      `\n💡 <b>Motivation:</b> ${lead.motivation    || "—"}\n` +
      `⏱ <b>Timeline:</b> ${lead.timeline           || "—"}\n` +
      `💰 <b>Asking Price:</b> ${lead.askingPrice && lead.askingPrice !== "N/A" ? lead.askingPrice : "—"}\n` +
      `🏚 <b>Condition:</b> ${lead.condition         || "—"}\n` +
      (lead.occupancy    ? `🏡 <b>Occupancy:</b> ${lead.occupancy}\n`    : "") +
      (lead.mortgage     ? `🏦 <b>Mortgage:</b> ${lead.mortgage}\n`      : "") +
      (lead.callbackTime ? `📞 <b>Best time to call:</b> ${lead.callbackTime}\n` : "") +
      `\n<b>${hotLabel}</b>\n\n` +
      `🎯 <b>Suggested opener:</b>\n<i>${opener}</i>`
    );
  }
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
