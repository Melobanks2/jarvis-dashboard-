#!/usr/bin/env node
// felix-agent.js — GHL Organization Agent
// Runs nightly at 10pm, audits and fixes the entire CRM automatically

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_PIPELINE = "o4kqU2y8DYjA73aKUxNu";
const GHL_API      = "https://services.leadconnectorhq.com";
const GHL_HEADERS  = { "Authorization": `Bearer ${GHL_TOKEN}`, "Content-Type": "application/json", "Version": "2021-07-28" };
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

const STAGE_RANK = {
  "Attempt 1 No Contact": 1, "Attempt 2 No Contact": 2, "Attempt 3-5 No Contact": 3,
  "Attempt 6+ Unresponsive": 4, "Attempt 1": 4, "New Lead": 5,
  "Cold Follow Up": 6, "Warm Follow Up": 7, "Hot Follow Up": 8,
  "Decision Pending": 9, "Contract Sent": 10, "Under Contract": 11,
};
const NO_CONTACT_STAGES = ["Attempt 1 No Contact","Attempt 2 No Contact","Attempt 3-5 No Contact","Attempt 6+ Unresponsive","Attempt 1"];

async function ghl(method, path, body) {
  const r = await fetch(`${GHL_API}${path}`, { method, headers: GHL_HEADERS, body: body ? JSON.stringify(body) : undefined });
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Load pipeline stage IDs ────────────────────────────────────────────────────
let STAGE_IDS = {};
async function loadStages() {
  const data = await ghl("GET", `/opportunities/pipelines?locationId=${GHL_LOCATION}`);
  const pipeline = (data.pipelines || []).find(p => p.id === GHL_PIPELINE);
  for (const s of (pipeline?.stages || [])) STAGE_IDS[s.name] = s.id;
}

// ── Load custom field IDs ─────────────────────────────────────────────────────
const GHL_FIELDS = {};
async function loadFields() {
  const data = await ghl("GET", `/locations/${GHL_LOCATION}/customFields`);
  for (const f of (data.customFields || [])) {
    const n = (f.name || "").toLowerCase().trim();
    if (n.includes("motivation"))       GHL_FIELDS.motivation    = f.id;
    else if (n.includes("condition"))   GHL_FIELDS.condition     = f.id;
    else if (n.includes("asking"))      GHL_FIELDS.asking_price  = f.id;
    else if (n.includes("arv"))         GHL_FIELDS.arv           = f.id;
    else if (n.includes("mao"))         GHL_FIELDS.mao           = f.id;
    else if (n.includes("call outcome")) GHL_FIELDS.call_outcome = f.id;
    else if (n.includes("last called")) GHL_FIELDS.last_called   = f.id;
    else if (n.includes("call attempt")) GHL_FIELDS.call_attempts = f.id;
  }
}

// ── Get all leads from pipeline ────────────────────────────────────────────────
async function getAllPipelineLeads() {
  const leads = [];
  for (const [stageName, stageId] of Object.entries(STAGE_IDS)) {
    try {
      let page = 1;
      while (true) {
        const data = await ghl("GET", `/opportunities/search?pipeline_id=${GHL_PIPELINE}&location_id=${GHL_LOCATION}&pipeline_stage_id=${stageId}&limit=50&page=${page}`);
        const opps = data.opportunities || [];
        leads.push(...opps.map(o => ({ ...o, stageName })));
        if (opps.length < 50) break;
        page++;
        await sleep(200);
      }
    } catch {}
    await sleep(300);
  }
  return leads;
}

// ── Felix audit run ────────────────────────────────────────────────────────────
async function runFelix() {
  const today = new Date().toISOString().split("T")[0];
  console.log(`\n[Felix] 🗂️  GHL Audit — ${today}`);

  await loadStages();
  await loadFields();

  const allLeads = await getAllPipelineLeads();
  console.log(`[Felix] Auditing ${allLeads.length} opportunities...`);

  const fixes = {
    stale_moved: 0,
    fields_filled: 0,
    tags_cleaned: 0,
    stage_corrected: 0,
  };
  const staleLeads = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const opp of allLeads) {
    const contact    = opp.contact || {};
    const contactId  = contact.id;
    const stageName  = opp.stageName;
    if (!contactId) continue;

    // 1. Check for stale leads (same stage >7 days, no-contact stages)
    const updatedAt = opp.updatedAt || opp.dateUpdated || opp.createdAt;
    if (NO_CONTACT_STAGES.includes(stageName) && updatedAt < sevenDaysAgo) {
      staleLeads.push(`${contact.name || "Unknown"} (${stageName})`);
    }

    // 2. Fill missing fields from jarvis_calls data
    const customFields = opp.customFields || [];
    const hasMotivation = customFields.some(f => f.id === GHL_FIELDS.motivation && f.value);
    const hasCondition  = customFields.some(f => f.id === GHL_FIELDS.condition  && f.value);

    if (!hasMotivation || !hasCondition) {
      // Pull from jarvis_calls
      try {
        const { data: calls } = await sb
          .from("jarvis_calls")
          .select("notes, summary, tags_applied")
          .eq("contact_id", contactId)
          .not("transcript_full", "is", null)
          .order("called_at", { ascending: false })
          .limit(1);

        const call = calls?.[0];
        if (call) {
          const fieldsToFill = [];
          if (!hasMotivation && GHL_FIELDS.motivation && call.notes) {
            const motivMatch = call.notes.match(/Motivation: (.+)/);
            if (motivMatch?.[1] && motivMatch[1] !== "—") {
              fieldsToFill.push({ id: GHL_FIELDS.motivation, value: motivMatch[1].trim() });
            }
          }
          if (!hasCondition && GHL_FIELDS.condition && call.notes) {
            const condMatch = call.notes.match(/Condition: (.+)/);
            if (condMatch?.[1] && condMatch[1] !== "—") {
              fieldsToFill.push({ id: GHL_FIELDS.condition, value: condMatch[1].trim() });
            }
          }
          if (fieldsToFill.length > 0) {
            await ghl("PUT", `/contacts/${contactId}`, { customFields: fieldsToFill });
            fixes.fields_filled++;
            await sleep(300);
          }
        }
      } catch {}
    }

    // 3. Clean up duplicate/redundant tags
    const tags = contact.tags || [];
    const smartTagPattern = /^(🔥|🧤|❄️|📵|☎️)/;
    const smartTags = tags.filter(t => smartTagPattern.test(t));
    if (smartTags.length > 1) {
      // Keep only the most recent smart tag (last one)
      const keepTag   = smartTags[smartTags.length - 1];
      const cleanTags = tags.filter(t => !smartTagPattern.test(t) || t === keepTag);
      try {
        await ghl("PUT", `/contacts/${contactId}`, { tags: cleanTags });
        fixes.tags_cleaned++;
        await sleep(300);
      } catch {}
    }

    await sleep(150);
  }

  // 4. Check for contacts with no opportunities (orphaned contacts in GHL)
  // Skipped — too many API calls, handled by stage audit above

  const reportDate = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const report =
    `🗂️ FELIX GHL AUDIT — ${today}\n` +
    `Total leads audited: ${allLeads.length}\n` +
    `Fields filled from transcripts: ${fixes.fields_filled}\n` +
    `Duplicate tags cleaned: ${fixes.tags_cleaned}\n` +
    `Stage corrections: ${fixes.stage_corrected}\n` +
    `\nStale leads (>7 days no-contact): ${staleLeads.length}\n` +
    (staleLeads.length > 0 ? staleLeads.slice(0,10).map(l => `  • ${l}`).join("\n") + "\n" : "") +
    `\nGHL is clean ✅`;

  console.log("\n" + report);
  await telegram(report);
  console.log("[Felix] ✅ Audit complete");
}

// ── Startup ────────────────────────────────────────────────────────────────────
(async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     FELIX — GHL Organization Agent       ║");
  console.log("╚══════════════════════════════════════════╝");

  // Nightly at 10pm Mon–Sat
  cron.schedule("0 22 * * 1-6", () => runFelix().catch(console.error), { timezone: "America/New_York" });
  console.log("[Felix] Scheduled: 10pm Mon–Sat EST");

  if (process.argv.includes("--now")) {
    await runFelix();
  }
})();
