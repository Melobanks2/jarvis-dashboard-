#!/usr/bin/env node
// scout-agent.js — Lead Intelligence Agent
// Runs 30min before each calling session, enriches leads with property data
// David reads scout_reports before every call

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");
const cron = require("node-cron");

const sb     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_PIPELINE = "o4kqU2y8DYjA73aKUxNu";
const GHL_API      = "https://services.leadconnectorhq.com";
const GHL_HEADERS  = { "Authorization": `Bearer ${GHL_TOKEN}`, "Content-Type": "application/json", "Version": "2021-07-28" };
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

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

// ── Fetch leads queued for next calling session ────────────────────────────────
async function fetchUpcomingLeads() {
  const callableStages = [
    "New Lead", "Attempt 1", "Attempt 1 No Contact", "Attempt 2 No Contact",
    "Attempt 3-5 No Contact", "Hot Follow Up", "Warm Follow Up", "Cold Follow Up",
  ];
  const leads = [];
  for (const stageName of callableStages) {
    try {
      // Get stage ID
      const pData = await ghl("GET", `/opportunities/pipelines?locationId=${GHL_LOCATION}`);
      const pipeline = (pData.pipelines || []).find(p => p.id === GHL_PIPELINE);
      const stage = (pipeline?.stages || []).find(s => s.name === stageName);
      if (!stage) continue;

      const data = await ghl("GET", `/opportunities/search?pipeline_id=${GHL_PIPELINE}&location_id=${GHL_LOCATION}&pipeline_stage_id=${stage.id}&limit=20`);
      for (const opp of (data.opportunities || [])) {
        const contact = opp.contact || {};
        let address = contact.address1 || "";
        if (address && contact.city) address += `, ${contact.city}, ${contact.state || ""} ${contact.postalCode || ""}`;
        leads.push({
          contactId: contact.id,
          oppId:     opp.id,
          name:      contact.name || opp.name,
          phone:     contact.phone,
          address:   address.trim(),
          stage:     stageName,
        });
      }
    } catch {}
    await sleep(200);
  }
  return leads;
}

// ── Pull property data from ASAP ARV tables ────────────────────────────────────
async function getAsapData(address) {
  if (!address) return null;
  const street = address.split(",")[0].trim().toLowerCase();
  try {
    // Check asap_sold_properties for comps near this address
    const { data: comps } = await sb
      .from("asap_sold_properties")
      .select("address, sale_price, beds, baths, sqft, year_built, sold_date")
      .ilike("address", `%${street.substring(0, 15)}%`)
      .limit(5);
    return comps?.length ? comps : null;
  } catch { return null; }
}

// ── Check if property is likely listed on MLS ──────────────────────────────────
async function checkMlsListing(address) {
  if (!address) return false;
  // Check david_pending_approvals — if ARV data exists, property was already analyzed
  try {
    const { data } = await sb
      .from("david_pending_approvals")
      .select("novation_qualified, arv")
      .ilike("address", `%${address.split(",")[0].substring(0, 15)}%`)
      .limit(1);
    return data?.[0]?.novation_qualified || false;
  } catch { return false; }
}

// ── Get prior call history for this contact ────────────────────────────────────
async function getPriorCallHistory(contactId) {
  try {
    const { data } = await sb
      .from("jarvis_calls")
      .select("called_at, stage_after, summary, notes, call_duration, transcript_full")
      .eq("contact_id", contactId)
      .order("called_at", { ascending: false })
      .limit(3);
    return data || [];
  } catch { return []; }
}

// ── Generate scout report using Claude ────────────────────────────────────────
async function generateScoutReport(lead, priorCalls, asapData, isMlsLikely) {
  const priorSummary = priorCalls.length > 0
    ? priorCalls.map(c => `${new Date(c.called_at).toLocaleDateString()} — Stage: ${c.stage_after} — ${c.summary || c.notes?.substring(0,200)}`).join("\n")
    : "No prior calls.";

  const compSummary = asapData?.length
    ? asapData.map(c => `${c.address}: $${c.sale_price?.toLocaleString()} (${c.beds}bd/${c.baths}ba, ${c.sqft}sqft, sold ${c.sold_date})`).join("\n")
    : "No comp data available.";

  try {
    const res = await claude.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system:     "You are Scout, a lead intelligence agent for a wholesale real estate company. Return ONLY valid JSON.",
      messages: [{
        role: "user",
        content:
          `Analyze this lead and generate a pre-call intelligence report.\n\n` +
          `Lead: ${lead.name}\nAddress: ${lead.address}\nStage: ${lead.stage}\n` +
          `Prior call history:\n${priorSummary}\n` +
          `Nearby comps:\n${compSummary}\n` +
          `MLS/Novation candidate: ${isMlsLikely}\n\n` +
          `Return JSON:\n{\n` +
          `  "estimated_motivation": 1-10,\n` +
          `  "motivation_reasoning": "why you scored it this way",\n` +
          `  "estimated_equity_pct": estimated equity percentage or null,\n` +
          `  "novation_flag": true/false,\n` +
          `  "suggested_opening": "specific opening line David should use referencing prior context",\n` +
          `  "key_talking_points": ["point1", "point2", "point3"],\n` +
          `  "likely_objections": ["objection1", "objection2"],\n` +
          `  "red_flags": ["any red flags or empty array"],\n` +
          `  "summary": "one sentence intel summary"\n` +
          `}`
      }],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/,"").replace(/```\s*$/,"");
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`  [Scout] Claude failed for ${lead.name}: ${e.message}`);
    return {
      estimated_motivation: 5,
      motivation_reasoning: "No prior data",
      novation_flag: isMlsLikely,
      suggested_opening: null,
      key_talking_points: [],
      likely_objections: [],
      red_flags: [],
      summary: "No prior call history. Fresh lead.",
    };
  }
}

// ── Check if scout report already exists and is recent (<24h) ─────────────────
async function reportExistsRecently(contactId) {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await sb
      .from("scout_reports")
      .select("id")
      .eq("contact_id", contactId)
      .gte("created_at", cutoff)
      .limit(1);
    return (data?.length || 0) > 0;
  } catch { return false; }
}

// ── Main scout run ─────────────────────────────────────────────────────────────
async function runScout() {
  console.log(`\n[Scout] 🔍 Scouting leads — ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);

  const leads = await fetchUpcomingLeads();
  console.log(`[Scout] Found ${leads.length} leads in calling queue`);
  if (leads.length === 0) return;

  let scouted = 0, skipped = 0;

  for (const lead of leads.slice(0, 30)) { // cap at 30 per run
    if (!lead.contactId) continue;

    const alreadyScouted = await reportExistsRecently(lead.contactId);
    if (alreadyScouted) { skipped++; continue; }

    console.log(`  → Scouting: ${lead.name} | ${lead.address}`);

    const [priorCalls, asapData, isMlsLikely] = await Promise.all([
      getPriorCallHistory(lead.contactId),
      getAsapData(lead.address),
      checkMlsListing(lead.address),
    ]);

    const report = await generateScoutReport(lead, priorCalls, asapData, isMlsLikely);
    await sleep(500);

    // Save to scout_reports
    try {
      await sb.from("scout_reports").insert({
        contact_id:           lead.contactId,
        opp_id:               lead.oppId,
        contact_name:         lead.name,
        address:              lead.address,
        stage:                lead.stage,
        estimated_motivation: report.estimated_motivation,
        motivation_reasoning: report.motivation_reasoning,
        estimated_equity_pct: report.estimated_equity_pct,
        novation_flag:        report.novation_flag,
        suggested_opening:    report.suggested_opening,
        key_talking_points:   report.key_talking_points,
        likely_objections:    report.likely_objections,
        red_flags:            report.red_flags,
        summary:              report.summary,
        prior_call_count:     priorCalls.length,
        has_comp_data:        !!asapData?.length,
      });
      scouted++;
      console.log(`    ✅ Report saved (motivation: ${report.estimated_motivation}/10)`);
    } catch (e) {
      console.warn(`    ❌ Save failed: ${e.message}`);
    }
    await sleep(400);
  }

  console.log(`[Scout] Done — ${scouted} scouted, ${skipped} already current`);
}

// ── Startup ────────────────────────────────────────────────────────────────────
(async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     SCOUT — Lead Intelligence Agent      ║");
  console.log("╚══════════════════════════════════════════╝");

  // Verify scout_reports table exists
  const { error } = await sb.from("scout_reports").select("id").limit(1);
  if (error) {
    console.log("[Scout] ⚠️  scout_reports table missing — create it in Supabase:");
    console.log(`CREATE TABLE IF NOT EXISTS scout_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id TEXT,
  opp_id TEXT,
  contact_name TEXT,
  address TEXT,
  stage TEXT,
  estimated_motivation INTEGER,
  motivation_reasoning TEXT,
  estimated_equity_pct NUMERIC,
  novation_flag BOOLEAN DEFAULT false,
  suggested_opening TEXT,
  key_talking_points JSONB,
  likely_objections JSONB,
  red_flags JSONB,
  summary TEXT,
  prior_call_count INTEGER DEFAULT 0,
  has_comp_data BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);`);
  } else {
    console.log("[Scout] ✅ scout_reports table ready");
  }

  // Run 30min before each calling session: 8:30am, 12:30pm, 5:00pm Mon-Sat
  cron.schedule("30 8 * * 1-6",  () => runScout().catch(console.error), { timezone: "America/New_York" });
  cron.schedule("30 12 * * 1-6", () => runScout().catch(console.error), { timezone: "America/New_York" });
  cron.schedule("0 17 * * 1-6",  () => runScout().catch(console.error), { timezone: "America/New_York" });

  console.log("[Scout] Scheduled: 8:30am, 12:30pm, 5:00pm Mon–Sat EST");

  if (process.argv.includes("--now")) {
    await runScout();
  }
})();
