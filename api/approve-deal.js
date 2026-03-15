/**
 * POST /api/approve-deal
 * Body: { approvalId: string, action: "approve" | "pass" }
 *
 * - Updates deal_approvals.status in Supabase
 * - If approved: sends Telegram alert to David + moves GHL stage
 * - If passed: sends Telegram alert
 */

const { createClient } = require("@supabase/supabase-js");

const SB_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL  || "https://afwdfyofjcpbyydbxntr.supabase.co";
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M";

const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_API      = "https://services.leadconnectorhq.com";
const GHL_HEADERS  = {
  Authorization:  `Bearer ${GHL_TOKEN}`,
  Version:        "2021-07-28",
  "Content-Type": "application/json",
};

const TELEGRAM_TOKEN   = "8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0";
const TELEGRAM_CHAT_ID = "8105811341";
const DAVID_CHAT_ID    = process.env.DAVID_TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID; // same as Chris for now

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

async function findOpportunityByContactId(contactId) {
  try {
    const res = await fetch(
      `${GHL_API}/opportunities/search?location_id=${GHL_LOCATION}&contact_id=${contactId}&limit=5`,
      { headers: GHL_HEADERS }
    );
    const data = await res.json();
    return data.opportunities?.[0] || null;
  } catch { return null; }
}

async function getStageId(pipelineId, stageName) {
  try {
    const res = await fetch(`${GHL_API}/opportunities/pipelines/${pipelineId}`, { headers: GHL_HEADERS });
    const data = await res.json();
    const stage = data.pipeline?.stages?.find(s => s.name.toLowerCase().includes(stageName.toLowerCase()));
    return stage?.id || null;
  } catch { return null; }
}

function fmtCurrency(n) {
  if (!n) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { approvalId, action } = req.body || {};
  if (!approvalId || !["approve", "pass"].includes(action)) {
    return res.status(400).json({ error: "approvalId and action (approve|pass) required" });
  }

  const sb = createClient(SB_URL, SB_SERVICE);

  // Fetch the approval record
  const { data: approval, error: fetchErr } = await sb
    .from("deal_approvals")
    .select("*")
    .eq("id", approvalId)
    .single();

  if (fetchErr || !approval) {
    return res.status(404).json({ error: fetchErr?.message || "Approval not found" });
  }

  if (approval.status !== "pending") {
    return res.status(400).json({ error: `Already ${approval.status}` });
  }

  // Update status in Supabase
  const { error: updateErr } = await sb
    .from("deal_approvals")
    .update({ status: action === "approve" ? "approved" : "passed", decision_at: new Date().toISOString() })
    .eq("id", approvalId);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  if (action === "approve") {
    // Move GHL opportunity to "Offer Made" stage (or closest match)
    try {
      const opp = await findOpportunityByContactId(approval.contact_id);
      if (opp) {
        const stageId = await getStageId(opp.pipeline_id, "offer");
        if (stageId) {
          await fetch(`${GHL_API}/opportunities/${opp.id}`, {
            method:  "PUT",
            headers: GHL_HEADERS,
            body:    JSON.stringify({ pipelineStageId: stageId, status: "open" }),
          }).catch(() => {});
        }
      }
    } catch {}

    // Notify David via Telegram
    const offerLine = approval.offer_60
      ? `\n💰 Offer range: ${fmtCurrency(approval.offer_60)} – ${fmtCurrency(approval.offer_70)}\n🎯 Start at: <b>${fmtCurrency(approval.offer_60)}</b>`
      : "";

    await sendTelegram(
      DAVID_CHAT_ID,
      `✅ <b>DEAL APPROVED — Go Make the Offer</b>\n` +
      `\nSeller: ${approval.contact_name}\n` +
      `Property: ${approval.address}\n` +
      `ARV: ${fmtCurrency(approval.arv)} | Repairs: ${fmtCurrency(approval.repair_estimate)}` +
      offerLine + `\n\nCall them back now and lock it up. 🔒`
    );

    // Notify Chris
    await sendTelegram(
      TELEGRAM_CHAT_ID,
      `✅ <b>Deal Approved</b>\n${approval.contact_name} — ${approval.address}\nDavid has been notified to make the offer.`
    );

  } else {
    // Passed
    await sendTelegram(
      TELEGRAM_CHAT_ID,
      `👎 <b>Deal Passed</b>\n${approval.contact_name} — ${approval.address}\nARV: ${fmtCurrency(approval.arv)}`
    );
  }

  return res.status(200).json({ ok: true, status: action === "approve" ? "approved" : "passed" });
};
