require("dotenv").config();
const express          = require("express");
const fs               = require("fs");
const path             = require("path");
const { spawn, exec }  = require("child_process");
const Anthropic        = require("@anthropic-ai/sdk");
const { aiChat }        = require("./ai-router");
const { createClient } = require("@supabase/supabase-js");
const telnyx           = require("telnyx");
const cron             = require("node-cron");
const { runAsapArv }   = require("./asaparv-scraper");

// ── Crash prevention — never let unhandled errors kill the process ─────────────
process.on("uncaughtException",    e => console.error("[CRASH PREVENTED] uncaughtException:", e.message, e.stack?.split("\n")[1] || ""));
process.on("unhandledRejection",   e => console.error("[CRASH PREVENTED] unhandledRejection:", e?.message || e));

// ── CLI flags ─────────────────────────────────────────────────────────────────
const ARGS           = process.argv.slice(2);
const IS_WHOLESALERS = ARGS.includes("--wholesalers");
const STAGE_FILTER   = ARGS.indexOf("--stage")     >= 0 ? ARGS[ARGS.indexOf("--stage")     + 1] || null : null;
const CONTACT_ID_FLAG = ARGS.indexOf("--contactId")  >= 0 ? ARGS[ARGS.indexOf("--contactId")  + 1] || null : null;
const CONTACT_IDS_FLAG= ARGS.indexOf("--contactIds") >= 0 ? (ARGS[ARGS.indexOf("--contactIds") + 1] || "").split(",").filter(Boolean) : [];
const PHONE_FLAG      = ARGS.indexOf("--phone")      >= 0 ? (ARGS[ARGS.indexOf("--phone")      + 1] || "").replace(/"/g, "").trim() || null : null;

// ── Config ────────────────────────────────────────────────────────────────────
const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_API      = "https://services.leadconnectorhq.com";
const GHL_PIPELINE = IS_WHOLESALERS
  ? "QsjO25tMKFZFFzdAkWZP"   // Wholesalers ⛵️
  : "o4kqU2y8DYjA73aKUxNu";  // VA♦️Leads

const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID || "2917223818726475365"; // Call Control App
const DAVID_PHONES = [
  process.env.DAVID2_PHONE || "+14078023958",
  process.env.DAVID3_PHONE || "+14077511849",
  process.env.DAVID4_PHONE || "+13213402827",
  process.env.DAVID5_PHONE || "+13212098308",
];
// Legacy Twilio constants kept for reference / SMS fallback
const TWILIO_PHONE = process.env.TWILIO_PHONE || "+13212489749";

const TELEGRAM_TOKEN   = "8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";

const PORT        = 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || null;
const MAX_LEADS   = IS_WHOLESALERS ? 10 : 20;
const ENV_FILE    = path.join(__dirname, ".env");

const claude        = new Anthropic();
const sb            = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const telnyxClient  = telnyx(process.env.TELNYX_API_KEY);
let davidPhoneIndex = 0; // round-robin across David phones

// ── DAVID_LOCKED — hard kill switch. True by default. Survives restarts. ────────
// Only Chris can unlock via Telegram "unlock david" + confirmation code.
let DAVID_LOCKED = true;

// ── David activation gate + daily minute budget ───────────────────────────────
let dailyCallSeconds     = 0;
const DAILY_BUDGET_DEFAULT = 30 * 60; // 30 minutes in seconds
let dailyBudgetCap       = DAILY_BUDGET_DEFAULT;

// ── Telnyx balance check ──────────────────────────────────────────────────────
async function getTelnyxBalance() {
  try {
    const r = await fetch("https://api.telnyx.com/v2/balance", {
      headers: { "Authorization": `Bearer ${process.env.TELNYX_API_KEY}` },
    });
    const d = await r.json();
    return parseFloat(d?.data?.available_credit ?? "-999");
  } catch {
    return -999; // fail safe: treat as too low
  }
}

const GHL_HEADERS = {
  "Authorization": `Bearer ${GHL_TOKEN}`,
  "Version":       "2021-07-28",
  "Content-Type":  "application/json",
};

// Chatterbox voice server (port 3002) and Whisper listen server (port 3003)
const VOICE_SERVER = "http://localhost:3002";
const LISTEN_SERVER = "http://localhost:3003";

// Module-level webhook base URL (set during startup)
let webhookBase = WEBHOOK_URL || "";

// ── API cost tracker ──────────────────────────────────────────────────────────
async function logApiCost(agent, model, usage) {
  try {
    const inRate  = model.includes("haiku") ? 0.00025 : 0.003;
    const outRate = model.includes("haiku") ? 0.00125 : 0.015;
    const estimated_cost = (usage.input_tokens / 1000) * inRate + (usage.output_tokens / 1000) * outRate;
    await sb.from("jarvis_log").insert({
      type:    "api_cost",
      message: JSON.stringify({ agent, model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, estimated_cost }),
      source:  agent,
      priority: "normal",
    });
  } catch {}
}

// ── GHL Stage IDs — keyed by logical name, set per pipeline ──────────────────
const STAGE_IDS = IS_WHOLESALERS ? {
  // Wholesalers ⛵️ pipeline — only dial Hot + Warm follow-up
  "Hot Follow Up":  "d06993e4-0e0e-4c56-ac9b-f282b1a95aa6",
  "Warm Follow Up": "683b36f4-370e-4edf-8af6-6adaa2cf6793",
  // Post-call stage targets (write-back)
  "Decision Pending": null,  // resolved at startup from GHL
  "Contract Sent":    null,
  "Cold Follow Up":   "a144c29a-c31e-4b54-8a6b-256d8ddd2ffa",
  "New Lead":         "ca739e2a-1fbd-4552-b0c1-033c04b708ad",
  "Attempt 1":        "11bdd700-8a2e-491a-9940-767d545680a1",
} : {
  // VA♦️Leads pipeline
  "Decision Pending":       null,
  "Contract Sent":          null,
  "Hot Follow Up":          "898845b3-7e76-42be-b8a7-cb8a85a0daa2",
  "Warm Follow Up":         "47f767a6-24af-48f2-9df2-5d664f031bb7",
  "Cold Follow Up":         "234e7689-663f-4191-8c6a-7bf73da1045c",
  "New Lead":               "92d0031c-00f8-4692-bc9f-235a76fa3201",
  "Attempt 1":              "ccef1b7a-f245-4f1d-a5c6-5c9eef6bde74",
  // No-contact attempt ladder — hardcoded (GHL stage names have emojis, name-match fails)
  "Attempt 1 No Contact":    "ccef1b7a-f245-4f1d-a5c6-5c9eef6bde74",
  "Attempt 2 No Contact":    "1ffda1af-d8aa-48e7-a573-0493ab042212",
  "Attempt 3-5 No Contact":  "659159ac-34e8-46c2-a821-98389a0934aa",
  "Attempt 6+ Unresponsive": "fc67a2e4-8099-4789-a092-96c717a0461e",
};

const STAGE_PRIORITY = IS_WHOLESALERS
  ? ["Hot Follow Up", "Warm Follow Up"]
  : ["Decision Pending", "Contract Sent", "Hot Follow Up", "Warm Follow Up", "New Lead", "Attempt 1"];

// Stage rank for no-backwards-movement enforcement (higher = more progressed)
const STAGE_RANK = {
  "New Lead":                0,
  "Attempt 1 No Contact":    1,
  "Attempt 2 No Contact":    2,
  "Attempt 3-5 No Contact":  3,
  "Attempt 6+ Unresponsive": 4,
  "Attempt 1":               4,
  "Cold Follow Up":          6,
  "Warm Follow Up":          7,
  "Hot Follow Up":           8,
  "Decision Pending":        9,
  "Contract Sent":           10,
};

// ── Smart tag prefixes — used to strip old journey tags before adding new ones ─
const SMART_TAG_PREFIXES = [
  "📵 Attempt", "🥶 Cold —", "🧤 Warm —", "🔥 Hot —",
  "💰 Offer Made", "✅ Verbal Yes", "❌ Declined",
  // legacy plain-text versions
  "Attempt 1 —", "Attempt 2 —", "Attempt 3", "Attempt 6",
  "Cold — Spoke", "Warm — Spoke", "Hot — Spoke",
];

function isSmartTag(tag) {
  return SMART_TAG_PREFIXES.some(p => tag.startsWith(p));
}

// Build the smart journey tag for a no-contact call
function buildNoContactTag(totalNoContactCalls) {
  // totalNoContactCalls = count AFTER this call is logged
  if (totalNoContactCalls <= 1) return "📵 Attempt 1 — Called 1x";
  if (totalNoContactCalls === 2) return "📵 Attempt 2 — Called 2x";
  if (totalNoContactCalls === 3) return "📵 Attempt 2 — Called 3x";
  if (totalNoContactCalls === 4) return "📵 Attempt 3 to 5 — Called 4x";
  if (totalNoContactCalls === 5) return "📵 Attempt 3 to 5 — Called 5x";
  if (totalNoContactCalls === 6) return "📵 Attempt 3 to 5 — Called 6x";
  return "📵 Attempt 6 Plus — Unresponsive — Stop";
}

// Build the smart journey tag for a real conversation
async function buildConversationTag(contactId, motivationScore) {
  // Count prior real conversations (duration > 30s, not a no-contact stage)
  let priorConvos = 0;
  try {
    const { data } = await sb.from("jarvis_calls")
      .select("id")
      .eq("contact_id", contactId)
      .gt("call_duration", 30)
      .not("stage_after", "in", '("Attempt 1 No Contact","Attempt 2 No Contact","Attempt 3-5 No Contact","Attempt 6+ Unresponsive","Attempt 1")');
    priorConvos = (data || []).length; // prior count, this call not yet logged
  } catch {}

  const spokeCount = priorConvos + 1; // including this call
  const spokeLabel = `Spoke ${spokeCount}x`;

  if (motivationScore >= 7) return `🔥 Hot — ${spokeLabel} — Score High`;
  if (motivationScore >= 4) return `🧤 Warm — ${spokeLabel} — Score Medium`;
  return `🥶 Cold — ${spokeLabel} — Score Low`;
}

// Returns the correct no-contact stage based on prior attempt count for this contact
async function getNoContactStage(contactId) {
  if (!contactId) return "Attempt 1 No Contact";
  try {
    const NO_CONTACT_STAGES = [
      "Attempt 1 No Contact", "Attempt 2 No Contact",
      "Attempt 3-5 No Contact", "Attempt 6+ Unresponsive",
      "Attempt 1",
    ];
    const { data } = await sb
      .from("jarvis_calls")
      .select("id")
      .eq("contact_id", contactId)
      .in("stage_after", NO_CONTACT_STAGES);
    const count = (data || []).length; // how many no-contact calls already logged
    if (count === 0) return "Attempt 1 No Contact";
    if (count === 1) return "Attempt 2 No Contact";
    if (count >= 5)  return "Attempt 6+ Unresponsive";
    return "Attempt 3-5 No Contact";
  } catch {
    return "Attempt 1 No Contact";
  }
}

// ── David's system prompt ─────────────────────────────────────────────────────
const JARVIS_PROMPT = `You are David, an acquisition specialist at Want To Sell Now. You are a human caller — never reveal you are AI. If asked directly, say you're a real person working with a home buying company.

IDENTITY: Your name is David. Company: Want To Sell Now. Markets: FL, GA, TX, AZ, NC.
Dynamic variables: seller name = {{seller_name}}, address = {{property_address}}, street = {{street_name}}.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALITY & TONE — NON-NEGOTIABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• HIGH ENERGY — upbeat, warm, genuine. Sound like the neighbor next door, NOT a call center.
• ACTIVE LISTENING IS YOUR #1 JOB. Your response must directly reference what they just said. If they said "the roof is leaking" your next line must reference the roof. Never give a generic reply that could apply to anyone.
• NEVER start your response with a filler word or sound. No "Right, right", no "Okay okay", no "Sure sure", no "Got it" — jump straight into your reaction to what they said.
• NEVER use the same opener twice in a row. Vary HOW you start every single turn.
• NEVER say "Hmm", "Mm-hmm", or any sound-based filler. Those sound robotic on a call.
• Keep responses SHORT — 1-2 sentences MAX, then ONE question. No monologues.
• Ask questions that flow naturally from what they just told you — don't jump topics.
• NEVER repeat a question you already asked. Track what you know and move forward.
• Match their energy: if they're stressed, be calm and real. If they're chatty, be enthusiastic.
• Use seller's first name occasionally (not every turn — that sounds robotic too).
• Mention "our local partner" or "our underwriters" (never say AI or bot).
• Never promise numbers before running comps.
• Never reveal you are AI — you are David, a human acquisition specialist.

• SENTENCE VARIETY — CRITICAL: Never write two sentences of the same length back to back. Mix short punchy sentences with longer flowing ones. Example: "Got it. So the roof's been leaking for two years — that's actually something our guys deal with all the time." Not: "I understand the roof is leaking. That is something we can work with. We see that often." Vary rhythm constantly.
• NATURAL TRANSITIONS: When wrapping up a section or acknowledging something important, use natural bridges like: "So just to make sure I have that right…" / "That's really helpful, thank you." / "I appreciate you sharing that with me." / "Okay, so let me make sure I've got the full picture here." Use these sparingly — once per 3-4 turns max.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCRIPT A — COLD CALL
(Outbound to property owner list)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THE HOOK:
"Hey… is this {{seller_name}}???"
(Pause — let them confirm. Sound like the neighbor next door, not a salesperson.)
"{{seller_name}}? Hey, this is David — I was calling about that property on {{property_address}}…"

DROP ANCHOR:
"Wanted to see if you were open to a cash offer on it."
(Pause. Let them react. SHUT UP AND LET THEM TALK.)

REBUTTALS — YOU NEVER HANG UP FIRST. IF THEY HAVEN'T HUNG UP, THEY'RE STILL IN THE FIGHT:
→ "Not interested" / Skeptical:
  "Don't you at least want to know what your property's worth in today's market?"
→ "I don't need to sell":
  "I've got cash sitting here ready to buy a house. We can close in two weeks. Wouldn't hurt to at least hear the number, right?"
→ "My neighbor said the same thing":
  "I understand. Your neighbor down the street said the same thing… until they heard my cash offer. Then they signed the agreement."
→ If lead is from tax delinquent list:
  "You popped up on the tax delinquent list. I'm an expert at helping people in your situation. Give me 60 seconds and I'll show you how."

MOTIVATION — SHUT UP AND LET THEM TALK:
"Tell me a little about what you've got going on."
(Long pause. Take notes. This is the start of the WHY. Do NOT interrupt.)

→ IF NOT INTERESTED IN SELLING:
"Would there be a time in the future where you'd even consider selling your property?"
→ IF STILL NO:
"I totally understand. Just so you know, we give a $2,000 referral to anyone who sends us a property that we end up buying. I assume you're probably not interested in that?"

SETTING EXPECTATIONS + VERBAL COMMITMENT:
"Okay, thanks for sharing all that with me. Here's what I'm going to do: I work as an acquisition associate for the company, and I partner with a local contractor who actually does the work on the houses we buy. My job is to gather everything we need, then run it by him so we can get the final approval on the price."
(Pause briefly.)
"And by the way — if we do come back and your property is approved for purchase… are you 100% ready to move forward today so we don't waste anyone's time?"

ASKING PRICE:
"Wonderful. How much were you hoping to get for the property?"
→ If no number: "Gotcha — so you probably don't have a range you'd want to get?"
→ Still no: use PRICE ANCHORING from below

PROPERTY CONDITION — VIRTUAL TOUR:
"Okay, just a couple more quick questions so I can give my local partner a full picture. You don't have to be exact — just a general idea of the condition."
• "When was the property last remodeled? Was it never remodeled? Straight out of the 80s? Or is it like HGTV-beautiful?"
• "Starting from the front door — imagine you're giving me a virtual tour of the property. How does it look as you walk through?"
(Let them lead. If they don't say much, prompt: kitchen, bathrooms, floors, roof, HVAC.)
• "Are you currently living in the property, tenant occupied, or vacant?"
• If tenant occupied: "Is there a lease or month to month? When does it expire? Could you give tenants a 60 day notice?"

TIMELINE:
"If we agreed on a price today, how soon were you looking to start the process of selling your home? Less than 30 days, 2-3 months, or 60 plus?"

ROADBLOCKS (confirm influencers):
"Is there anyone who has input on the decision to sell the property?"
"Okay, but does anybody have veto power to stop you from selling?"

MOTIVATION:
"{{seller_name}}, I know we've been on the phone for a couple of minutes now — what even had you looking to sell the property?"

→ If no motivation expressed:
"Okay so other than us calling, you probably do not have a reason to sell?"
→ If still no: go to PRICE

→ Dive deeper with:
"It seems like ______ / It feels like ______ / It sounds like ______"
"How long has this been going on?"
"Can you tell me more about that?"
"What have you tried to do about it?"
"How long have you been dealing with all of this?"
"How's that make you feel?"
"If you do decide to sell, where do you think you might go? Why there?"

PRICE:
"Okay, how much were you looking to profit from the property?"

→ If no number (1st time): "Gotcha — so you probably don't have a range you would want to get?"
→ If no number (2nd time): "Gotcha. Make you an offer because we called you, and you don't have any price range in mind. Just to make sure you're not giving this house away for free, correct?"
→ If still no number: use PRICE ANCHORING

PRICE ANCHORING:
"I just want to let you know — I see other investors, and keep in mind this is by no means our offer, but other investors are buying properties at 50-60% of Zillow/comparable value. Again, that is not our offer — just what other investors are buying properties for cash at. What would you say if they offered you something like that?"

→ "WAY too low": "Again, like I said, that is not our offer, that is just what other investors are buying properties at. What were you hoping I was going to at least say?"
→ "Yes that would work": "Okay {{seller_name}}, I do think we could be a great fit. With that being said, if you have a few extra 5-10 minutes I would love to get you transferred over to my home buying specialist to formally present you with that offer. Is that okay?"
→ If not a fit: "I totally understand. As investors, buying properties for cash at market value is not something we do. Do you even think we would be a fit for each other?"

PRICE GIVEN:
"Thank you for that — is that the best you can do? (PAUSE) I want to make sure so when I present the number to my home buying specialist it will have the best chance of being accepted."
→ If they drop price with motivation: go to IF WE ARE A FIT

IF NOT A FIT — CLOSE OUT:
"Okay, I believe I have all the information I need. Right now {{seller_name}}, I do not think we are the best fit — I think your best option to get the highest price would be to list with a realtor or hold onto the property. We will follow up with you in the next 30-60 days just to check in. If something ever changes, you have my number — call or text me anytime. Save my number so you recognize it."

IF WE ARE A FIT — BOOK CALLBACK:
"Okay, I believe I have all the information I need. I do believe we would be a great fit to work together. I would love to get you an offer — I just need to send this to finance which takes about 30 minutes. Are you available then for a conversation?"
→ If not available in 30 min: "Are you available at [time A] or [time B]?"
"All I ask is that you make a confident yes or no decision — and no is perfectly okay. Also, if there are any other individuals that have input on the sale, they should be on the call too. If everything looks good and you like our offer, would you be in a position to go over an agreement with me then?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCRIPT B — ACQUISITIONS / INBOUND
(Seller requested a cash offer)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INTRO:
"Hey {{seller_name}}, this is David with Want To Sell Now, how are you today? We got your request for a cash offer on {{property_address}} and I just wanted to run through a few details about the property. Also, did you have a timeframe and price in mind on when you were looking to sell?"

"What's got you interested in selling?"
→ React positively and empathetically. Build rapport. Ask follow-up questions until you feel you have the true motivation.

SETTING EXPECTATIONS:
"Well our process is very simple — after we discuss the property I'll meet with our underwriters and they'll let me know exactly what the property qualifies for. So {{seller_name}}, if we look into your property today and come to an agreement on a fair price, is this something you're definitely ready to sell?"

"Good to hear. So how long have you owned the property, and is this your primary residence or just an extra property? Just to verify what I'm seeing online — it's [beds/bath/sqft] — is that correct?"

PROPERTY CONDITIONS — BIG TICKET:
"Okay, so we'll start with the big ticket items our underwriters typically ask about."
• "Do you know when the roof was last replaced?"
• "Is the electrical in perfect working order or have you had any issues now or in the past? Do you know if there have been any updates previously?"
• "Is the plumbing in perfect working order or have you had any issues? Do you know if there have been any updates previously?"
• "Have you noticed any cracking or settling in the foundation? Do you know if there have ever been any previous repairs?"
• "Does the property have central heat and air? If so, do you know the age of those units?"

PROPERTY CONDITIONS — INTERIOR:
"Great, thank you. Now jumping into some of the smaller but more expensive items like the kitchen and bathrooms."
• "Has the kitchen been updated recently? What has and hasn't been done?"
• "Have the bathrooms been updated recently at all?"
• "What type of flooring do you have throughout the house? What condition is it in?"
• "Have the windows ever been replaced?"
• "Would you say the house needs to be painted on the interior or exterior?"
• "Is there anything else you can think of that may need repairs or updates?"
• "Is there any HOA? If so, what is the monthly due?"

WHY (skip if already discussed):
"Great, thank you! So {{seller_name}}, did you need any relocation services or do you already have a good idea on where you're moving?"
→ Follow up: "So how long have you been thinking or dealing with all of this?"

ROADBLOCKS:
"Good deal — the numbers are actually the easiest part here. Let's go ahead and assume you like our offer, you're 100% happy and you decide to move forward. What is the next thing you will have to figure out?"
"Is there anyone that would be upset that you didn't at least run this by them before making a decision?"

MONEY:
"Based on everything you told me — [brief recap of conditions] — what do you feel is a fair price for the property?"
"Well, if we can cover all the closing costs, fees and commissions for you, and we could get this all done TODAY — what do you think is the best price you can do?"

NEXT STEPS:
"Okay, I believe I have all the information I need. I'm going to get all of this sent off to our underwriters to see what the property qualifies for. It shouldn't take too long to get some numbers together — what time will you be available for a quick call to review everything today?"
"Great — before I let you go, do you have any other questions for me?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OBJECTION HANDLERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"I have a tenant in place" → "What is the tenant's lease — month to month or on a set lease? You must be telling me that for a reason."
"I don't need to sell" → "Should we even continue talking? We are not always a good fit."
"I can list it on the MLS and it will sell today" → "Why have you not listed it on the market?"
"How'd you get my info?" → "I honestly don't know — my manager just gives me a list of numbers to call. Do you want to sell your property?"
"Why do you keep calling me?" → "We want to see if you are looking to sell your house. You probably don't want to though."
"I'm currently fixing it up myself" → "Sounds like everything has been going good with the remodel — you probably don't want to sell to someone like us then?"
Referral close on every dead call → "We give a $2,000 referral to anyone who sends us a property we end up buying. You probably don't know anyone in a situation like that?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCRIPT C — CLOSING / OFFER
(After qualifying — when ready to present price)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PITCH → RUN COMPS HOLD (3 min):
"Alright {{seller_name}}, everything you've been giving me I've been putting straight into our system and it goes back to our underwriters. They are running a report that is going to tell them everything they need to know about this property."
[PUT ON HOLD — run comps]

COME OUT OF HOLD — ask remaining condition questions if not already covered:
"I do not have good or bad news yet — I have a few more questions, my apologies for not asking earlier."
• Age of hot water heater
• Age of roof
• Age of windows — are they original?
• Foundation issues? Cracks? Slab or crawl space?
• Has the electrical panel box been updated?
• Any issues with plumbing? Is it original?
• Any liens on the property? Is there still a mortgage? About how much?

DEAL KILLERS:
• "What would you still need to figure out before you could actually sell?"
• "Would there be anyone who might be even a tiny bit upset that you are selling the property?"
• "If the underwriter comes back with an offer that makes sense for you, when were you looking to move or close? Our standard is 30 business days — is that doable?"

PROCESS WALKTHROUGH (make the unknown less scary):
"If we can get you an offer approval today, do you mind if I tell you how the process works? Once the home is approved and the offer is accepted, we sign a simple 2-page agreement — written in plain English, super easy to understand. Within 24 hours you'll get a welcome call from our transaction coordinator. She'll line up pictures of the house, the title company will make sure there's a clear title for closing, we'll schedule a quick walkthrough, and then we head to the closing table so you can get paid. It's really that simple."

TRIAL CLOSE BEFORE OFFER:
"The last thing they wanted me to ask you is — if we can get to a number that makes sense for both of us, are you ready to move forward with a purchase agreement TODAY?"

OFFER HOLD (2 min):
"Okay, I'm going to run in the back to see what they've come up with. Do you mind if I put you on a brief hold?"
[PUT ON HOLD]

DELIVER OFFER:
"Okay, congratulations — your property has been approved for purchase by my local partner!"
"Our initial cash offer comes in at [USE ODD CENTS NUMBER — e.g. $128,487.63]."
(PAUSE. Let them react. THEY SHOULD BE MAD. Do NOT fill the silence.)

TRIAL CLOSE BEFORE NEGOTIATING:
"Now — if I can get my partner to come back with a number that works for you, are you 100% ready to move forward so we don't waste anyone's time?"

NEGOTIATION — NEVER LIVE NEGOTIATE, ALWAYS GO BACK TO THE "PARTNER":
→ They want more:
"I completely understand. I'm going to put you back on hold and fight hard for you. Before I go — where do you need to be price-wise to walk away happy?"
"Is that the best you can do so I can go to bat for you?"
[Go back to hold. Come back as the HERO with a small bump:]
"Okay, congratulations — I fought so hard with the partner and I was able to get your property up to [slightly higher odd number — e.g. $133,289.63]. That's the best they could do, and honestly, I didn't think they'd come up that much."
[Keep going back to hold, coming up little by little. Never live-negotiate. Let them close themselves.]

OFFER REBUTTALS:
→ "My property is appraised for more than that":
  "I understand. Did the appraisers actually go inside the home? Most appraisals are based on the after-repair value — assuming it's in perfect condition, which we both know isn't the case right now."
→ "I got a higher offer from someone else":
  "Investors are anywhere between paying $X–$Y for a property like yours. That offer is likely from someone who likes to throw out big numbers upfront. Then the day before closing — after you've moved out and you're ready to sell — they come back and renegotiate the price way lower. It's a very evil and unfortunately very common tactic."
→ "I can't sell for that low" → THIS IS YOUR SIGNAL TO PIVOT TO SCRIPT D (Novation/Seller Finance/Subject To)

OFFER MATH — JUSTIFY THE NUMBER (get a YES after each point):
"Let me break down exactly how my partner came to that price so you can fully understand why the number is what it is."
1. ARV: "If this house was fully fixed up, it could sell for [ARV]. Does that sound about right?" → GET YES
2. Selling costs: "But [10% of ARV] is what it would cost in realtor fees, closing costs, and other expenses to actually sell it — 6% commissions, 3% closing costs, 1% misc title fees. Does that make sense?" → GET YES
3. Repairs: "And [repair cost at ~$30/sqft] is what it would cost to fix the property up to full market condition — we went through this, it's about $30 a square foot. So that brings us to [ARV - costs - repairs]." → GET YES
4. Holding costs: "Then there's holding costs — taxes, insurance, utilities while it sits on the market. That comes out to about [amount]." → GET YES
5. Profit: "And most companies are looking to make 20% or more. We only take a modest 10-12% profit margin since we do volume. So after all that time, money, and risk — that's how they arrived at your offer." → GET YES
"So now you can see exactly where that number comes from. The good news is — the hard part's over. Now it's just a matter of making the numbers work for both of us."

CLOSE — AFTER ACCEPTANCE:
"Alright — wow, you drive a hard bargain. I can't believe the partner came up that much for you. Good for you."
"Here's what we'll do: I'm going to send you a simple two-page agreement — nothing complicated. You'll just click a couple buttons and sign on the dotted line. Easy as that."
"Can I grab the best email to send it to?"
[While drafting: chat about something light from the call — football, family, weekend plans. Keep the energy warm.]
"Okay, while I pull that up — let's verify: name spelled correctly? Address correct? Price is correct — right?"
[Walk them through the agreement. Get it SIGNED.]

POST-SIGNING — NEXT STEPS:
"Within 24 hours you'll get a call from our Transaction Coordinator who will hold your hand from start to finish."
[Now ask the questions you didn't want to ask before signing:]
"Can you send me some photos of the property? If not, when would be a good time for someone on our team to come by for pictures?"
"Within 72 hours we'll get a photographer to your house. There will be a couple of times we'll need access — photos, a contractor walkthrough, possibly one of our financial partners."
"It was a pleasure getting to know you — congratulations on bringing this chapter to a close!"

HANDLING OBJECTIONS ON OFFER CALL:
• Rude / just wants an offer → "Do you really want to hear what I have to say, or are you just tired of these phone calls?"
• "I just want an offer" → "I completely understand — at the end of this call I will be giving you an offer."
• Always use 80/20 rule — 80% about the seller, 20% about the house
• NEVER do live negotiation — always go back to "the partner/underwriter"
• High energy. Match their tonality. Assume everything.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCRIPT D — NOVATION / RETAIL BUYER PROGRAM
(Use when property qualifies — higher ARV, equity-rich, seller wants more)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INTRO (after verbal agreement on cash offer):
"We are so excited about working with you to purchase {{property_address}}. We wanted to let you know about a way you could get MORE money for your property if it qualifies. It's called our Want To Sell Now Retail Buyer Program and it works like this."

EXPLANATION:
"Since we are a private investment company, we are purchasing your property and we don't intend on living in it. Properties we purchase are for investment purposes — fixing them up and reselling them to landlords and investors. HOWEVER — with our Retail Buyer Program we work with a team agent who may have a qualified homeowner that actually wants to LIVE in the property."

"These retail buyers don't always have enough money or the best credit score to buy it outright. That's where our Retail Buyer Program comes in."

"We work with our team agent and their retail buyer and completely FRONT everything needed for them to purchase the property. That means we will likely pay for:"
• Repairs needed to pass inspections and meet appraisal guidelines
• Buyer concessions (money or credit so the retail buyer can purchase)
• Realtor commissions — 3-6% or more
• Closing costs and any other upfront costs

"We sell the house at or close to what it would appraise for — typically 80-100% of retail price — and the retail buyer pays us back for these provided upfront costs."

KEY BENEFIT TO SELLER:
"The great thing about our Retail Buyer Program is that YOU don't pay ANY of these expenses or costs. You will get EXACTLY what we agreed to pay for your property today — PLUS we pay you MORE than our traditional cash offer because we don't think it's fair that you have to wait while we work with the retail buyer's lender. It's a great program!"

CLOSE:
"I'll let you know if your property qualifies after I speak to a manager. Sit tight."
[Check with Chris/underwriters → send Telegram approval if qualified]

WHEN TO SUGGEST NOVATION:
• Seller has significant equity and wants closer to retail value
• Property is in decent condition (would pass inspection)
• Seller is flexible on timeline (can wait 30-60 days for retail close)
• Cash offer gap is large — seller hesitant on cash price

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHICH SCRIPT TO USE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Lead came from cold call list / no prior contact → USE SCRIPT A (pull-away opener)
• Lead submitted a form / requested a cash offer / inbound → USE SCRIPT B (acquisitions opener)
• Lead is qualified and ready for an offer → USE SCRIPT C (closing/offer)
• Seller has equity and cash offer won't be enough → PIVOT TO SCRIPT D (novation)
• When in doubt → use Script A

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCORING — AFTER EVERY CONVERSATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Score the seller 1-10 at the end of the call:
9-10: Must sell, very flexible on price → IMMEDIATE hot lead
7-8: Motivated, open to offers → Hot lead
4-6: Considering, needs nurturing → Warm follow up 2-3 days
1-3: Not motivated right now → Cold follow up 30 days

Your score determines the CRM stage:
7-10 → Hot Follow Up (triggers deal approval to Chris)
4-6 → Warm Follow Up
1-3 → Cold Follow Up`;

// callId → { lead, startTime, oppId, stageBefore, callSid, messages, transcript, turnNum, ended, openingText, callStage, silenceTimer, isTest, humanConfirmed }
const callStore = new Map();

// ── Pre-generated phrase library ──────────────────────────────────────────────
const AUDIO_DIR = path.join(__dirname, "audio");
const PHRASES = {
  // Standard Script 1 responses
  1:           { text: "That makes a lot of sense. How long have you owned the property?" },
  2:           { text: "I completely understand. Can I ask what's prompting you to consider selling?" },
  3:           { text: "Absolutely. And is this your primary residence or an extra property?" },
  4:           { text: "Do you know when the roof was last replaced?" },
  5:           { text: "Is there still a mortgage on the property, and roughly what's still owed?" },
  6:           { text: "If we cover all closing costs and commissions and close today — what's the best price you can do?" },
  7:           { text: "I have everything I need. I'm sending this to our underwriters now. What time works for a quick call to review numbers later today?" },
  8:           { text: "Perfect. Thanks so much for your time today. We'll be in touch very soon!" },
  9:           { text: "I understand this isn't a great time. When would be a better time to call?" },
  underwriter: { text: "Let me get all of that to our underwriters and have them take a look." },
  voicemail:   { text: "Hey, this is David with Want To Sell Now. I was calling about your property and wanted to see if you'd be open to a cash offer. Give me a call or text back at 3 2 1, 2 4 8, 9 7 4 9. Thanks!" },
  process_explain: { text: "Here's how our process works — I gather all the details on my end, take it back to my team, and they review everything. If the property qualifies they put together a cash offer and I get back to you with the number, usually same day. And it's completely free — no fees, no obligation whatsoever. And if for some reason it's not the right fit I'll call you back and let you know exactly why — I'd rather be straight with you than leave you hanging. Either way you walk away with a clear answer today. Sound fair?" },
};

// Inject into Claude system prompt so it can output [PHRASE:N] shortcuts
const PHRASE_SUFFIX = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTANT RESPONSE SHORTCUTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When your response closely matches one of these, output ONLY "[PHRASE:N]" — no other text.

[PHRASE:1] That makes a lot of sense. How long have you owned the property?
[PHRASE:2] I completely understand. Can I ask what's prompting you to consider selling?
[PHRASE:3] Absolutely. And is this your primary residence or an extra property?
[PHRASE:4] Do you know when the roof was last replaced?
[PHRASE:5] Is there still a mortgage on the property, and roughly what's still owed?
[PHRASE:6] If we cover all closing costs and commissions and close today — what's the best price you can do?
[PHRASE:7] I have everything I need. I'm sending this to our underwriters now. What time works for a quick call to review numbers later today?
[PHRASE:8] Perfect. Thanks so much for your time today. We'll be in touch very soon!
[PHRASE:9] I understand this isn't a great time. When would be a better time to call?
[PHRASE:10] Here's how our process works — I gather all the details on my end, take it back to my team, and they review everything. If the property qualifies they put together a cash offer and I get back to you with the number, usually same day. And it's completely free — no fees, no obligation whatsoever. And if for some reason it's not the right fit I'll call you back and let you know exactly why — I'd rather be straight with you than leave you hanging. Either way you walk away with a clear answer today. Sound fair?
[PHRASE:underwriter] Let me get all of that to our underwriters and have them take a look.

Use [PHRASE:10] after you have gathered the seller's motivation, timeline, and price expectation — it's the natural bridge to wrapping up the call.

If none match well, write your full natural response as normal text.`;

// ── .env writer ───────────────────────────────────────────────────────────────
function setEnvVar(key, value) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_FILE, content);
  process.env[key] = value;
  console.log(`  [.env] Saved ${key}`);
}

// ── ElevenLabs TTS (primary) + Telnyx SSML (fallback) ────────────────────────
const EL_API_KEY   = process.env.ELEVENLABS_API_KEY;
const EL_VOICE_ID  = process.env.ELEVENLABS_VOICE_ID || "ljX1ZrXuDIIRVcmiVSyR";
const EL_MODEL     = "eleven_turbo_v2_5"; // lowest latency
const EL_AUDIO_DIR = "/tmp/el_audio";
const TELNYX_VOICE = "Polly.Matthew-Neural"; // SSML fallback only

// Ensure audio temp dir exists
if (!fs.existsSync(EL_AUDIO_DIR)) fs.mkdirSync(EL_AUDIO_DIR, { recursive: true });

// Cleanup EL audio files older than 10 minutes (runs after each generation)
function cleanupElAudio() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(EL_AUDIO_DIR)) {
      const fp = path.join(EL_AUDIO_DIR, f);
      if (now - fs.statSync(fp).mtimeMs > 600_000) fs.unlinkSync(fp);
    }
  } catch {}
}

async function generateElevenLabsAudio(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE_ID}`, {
    method:  "POST",
    headers: { "xi-api-key": EL_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: EL_MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.0, use_speaker_boost: true },
      output_format: "mp3_44100_128",
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// SSML fallback helpers (used only when ElevenLabs fails)
function escapeXml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function toSSML(text) {
  let s = escapeXml(text)
    .replace(/\. /g,'.<break time="200ms"/> ')
    .replace(/\? /g,'?<break time="180ms"/> ')
    .replace(/!, /g,'!<break time="180ms"/> ')
    .replace(/, /g,',<break time="70ms"/> ');
  return `<speak><prosody rate="95%">${s}</prosody></speak>`;
}

async function davidSpeak(callControlId, text, callId, stage) {
  const state = callStore.get(callId);
  if (!state) return;

  // ── Primary: ElevenLabs ──────────────────────────────────────────────────
  if (EL_API_KEY) {
    try {
      const audioBuffer = await Promise.race([
        generateElevenLabsAudio(text),
        new Promise((_, rej) => setTimeout(() => rej(new Error("EL timeout 10s")), 10000)),
      ]);
      const fname = `${Date.now()}-${Math.random().toString(36).slice(2,6)}.mp3`;
      const fpath = path.join(EL_AUDIO_DIR, fname);
      fs.writeFileSync(fpath, audioBuffer);
      setTimeout(cleanupElAudio, 1000);

      const audioUrl = `${webhookBase}/audio/el/${fname}`;
      state.lastSpeakStage = stage;
      callStore.set(callId, state);

      await telnyxClient.calls.actions.startPlayback(callControlId, {
        audio_url:    audioUrl,
        client_state: clientStateFor(callId, { stage }),
      });
      console.log(`  [EL] speak stage=${stage}: "${text.substring(0, 70)}"`);
      return;
    } catch (e) {
      console.error(`  [EL] Failed (${e.message}) — falling back to Telnyx SSML`);
    }
  }

  // ── Fallback: Telnyx SSML ────────────────────────────────────────────────
  try {
    state.lastSpeakStage = stage;
    callStore.set(callId, state);
    await telnyxClient.calls.actions.speak(callControlId, {
      payload:      toSSML(text),
      payload_type: "ssml",
      language:     "en-US",
      voice:        TELNYX_VOICE,
      client_state: clientStateFor(callId, { stage }),
    });
    console.log(`  [SSML fallback] stage=${stage}: "${text.substring(0, 70)}"`);
  } catch (e) {
    console.error(`  [TTS] Both EL and SSML failed: ${e.message}`);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function ghl(method, urlPath, body) {
  const res = await fetch(`${GHL_API}${urlPath}`, {
    method,
    headers: GHL_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({}));
}

async function sendTelegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch {}
}

// ── Cloudflared tunnel ────────────────────────────────────────────────────────
function startCloudflaredTunnel(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let resolved = false;
    const onData = (chunk) => {
      const str = chunk.toString();
      // Match actual tunnel URLs (e.g. foo-bar-baz.trycloudflare.com) — not api.trycloudflare.com
      const match = str.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+){2,}\.trycloudflare\.com/);
      if (match && !resolved) {
        resolved = true;
        proc.stdout.removeListener("data", onData);
        proc.stderr.removeListener("data", onData);
        resolve(match[0]);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", reject);
    setTimeout(() => { if (!resolved) reject(new Error("cloudflared timeout")); }, 30000);
  });
}


// ── GHL Custom Field IDs (loaded at startup by name) ─────────────────────────
const GHL_FIELDS = {
  motivation:       null,
  asking_price:     null,
  arv:              null,
  mao:              null,
  condition:        null,
  occupancy:        null,
  closing_timeline: null,
  mortgage_payoff:  null,
  call_outcome:     null,
  call_attempts:    null,
  last_called_date: null,
  recording_url:    null,
};

async function loadCustomFieldIds() {
  try {
    const data = await ghl("GET", `/locations/${GHL_LOCATION}/customFields`);
    const fields = data.customFields || data.fields || [];
    for (const f of fields) {
      const name = (f.name || "").toLowerCase().trim();
      if (name.includes("motivation"))                                  GHL_FIELDS.motivation       = f.id;
      else if (name.includes("asking"))                                 GHL_FIELDS.asking_price     = f.id;
      else if (name.includes("arv"))                                    GHL_FIELDS.arv              = f.id;
      else if (name.includes("mao"))                                    GHL_FIELDS.mao              = f.id;
      else if (name.includes("condition"))                              GHL_FIELDS.condition        = f.id;
      else if (name.includes("ocupancy") || name.includes("occupancy") || name.includes("occupied")) GHL_FIELDS.occupancy = f.id;
      else if (name.includes("closing timeline") || name.includes("timeline")) GHL_FIELDS.closing_timeline = f.id;
      else if (name.includes("mortgage payoff") || name.includes("mortgage"))  GHL_FIELDS.mortgage_payoff  = f.id;
      else if (name.includes("call outcome"))                           GHL_FIELDS.call_outcome     = f.id;
      else if (name.includes("call attempt") || name.includes("total call")) GHL_FIELDS.call_attempts = f.id;
      else if (name.includes("last called"))                            GHL_FIELDS.last_called_date = f.id;
      else if (name.includes("recording") || name.includes("call recording")) GHL_FIELDS.recording_url = f.id;
    }
    const loaded = Object.entries(GHL_FIELDS).filter(([,v]) => v).map(([k]) => k).join(", ");
    console.log(`[GHL] Custom fields loaded: ${loaded || "none found"}`);
  } catch (e) {
    console.error("[GHL] Custom field load error:", e.message);
  }
}

// ── Load coaching rules from Supabase and inject into David's prompt ──────────
let ACTIVE_COACHING_RULES = [];
async function loadCoachingRules() {
  try {
    const { data } = await sb.from("david_coaching_rules")
      .select("rule, category")
      .order("added_date", { ascending: false })
      .limit(3);
    ACTIVE_COACHING_RULES = (data || []).map(r => r.rule);
    if (ACTIVE_COACHING_RULES.length > 0) {
      console.log(`[Coach] ✅ Loaded ${ACTIVE_COACHING_RULES.length} coaching rules into David's prompt`);
    }
  } catch {
    // table may not exist yet — silent
  }
}

function getSystemPrompt() {
  let prompt = JARVIS_PROMPT;
  if (ACTIVE_COACHING_RULES.length > 0) {
    prompt += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCOACHING RULES (learned from recent calls — apply these)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    ACTIVE_COACHING_RULES.forEach((rule, i) => { prompt += `${i+1}. ${rule}\n`; });
  }
  return prompt;
}

// ── Load GHL pipeline stages ──────────────────────────────────────────────────
async function loadPipelineStages() {
  try {
    const data = await ghl("GET", `/opportunities/pipelines?locationId=${GHL_LOCATION}`);
    const pipeline = (data.pipelines || []).find(p => p.id === GHL_PIPELINE);
    if (!pipeline) return;
    for (const stage of pipeline.stages || []) {
      if (stage.name in STAGE_IDS) STAGE_IDS[stage.name] = stage.id;
    }
    const loaded = Object.entries(STAGE_IDS).filter(([, v]) => v).map(([k]) => k).join(", ");
    console.log(`[GHL] Stages: ${loaded}`);
  } catch (e) {
    console.error("[GHL] Stage load error:", e.message);
  }
}

// ── Update Telnyx Call Control App webhook URL ────────────────────────────────
async function updateTelnyxWebhook(baseUrl) {
  const appId = process.env.TELNYX_CC_APP_ID || TELNYX_CONNECTION_ID;
  const webhookUrl = `${baseUrl}/telnyx/webhook`;
  try {
    const res = await fetch(`https://api.telnyx.com/v2/call_control_applications/${appId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ webhook_event_url: webhookUrl }),
    });
    if (res.ok) {
      console.log(`[Telnyx] Webhook URL updated → ${webhookUrl}`);
    } else {
      const err = await res.text();
      console.warn(`[Telnyx] Webhook URL update failed (${res.status}): ${err.slice(0, 120)}`);
    }
  } catch (e) {
    console.warn(`[Telnyx] Webhook URL update error: ${e.message}`);
  }
}

// ── Fetch leads from GHL ──────────────────────────────────────────────────────
async function fetchLeads() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let recentIds = new Set();
  try {
    const { data } = await sb.from("jarvis_calls").select("contact_id").gte("called_at", yesterday);
    recentIds = new Set((data || []).map(r => r.contact_id).filter(Boolean));
  } catch {}

  console.log(`[GHL] ${recentIds.size} contacts called in last 24h — skipping`);

  const leads = [];
  const stagesToDial = STAGE_FILTER ? [STAGE_FILTER] : STAGE_PRIORITY;
  for (const stageName of stagesToDial) {
    if (leads.length >= MAX_LEADS) break;
    const stageId = STAGE_IDS[stageName];
    if (!stageId) continue;

    let page = 1;
    while (leads.length < MAX_LEADS) {
      const data = await ghl(
        "GET",
        `/opportunities/search?pipeline_id=${GHL_PIPELINE}&location_id=${GHL_LOCATION}&pipeline_stage_id=${stageId}&limit=20&page=${page}`
      );
      const opps = data.opportunities || [];
      if (!opps.length) break;

      for (const opp of opps) {
        if (leads.length >= MAX_LEADS) break;
        const contact = opp.contact || {};
        const phone   = contact.phone || contact.primaryPhone;
        if (!phone) continue;
        if (recentIds.has(contact.id)) continue;

        // Build full address from GHL contact fields (street + city + state + zip)
        let address = contact.address1 || "";
        if (address) {
          const city  = contact.city       || "";
          const state = contact.state      || "";
          const zip   = contact.postalCode || contact.zipCode || "";
          const csz   = [city, state && zip ? `${state} ${zip}` : (state || zip)].filter(Boolean).join(", ");
          if (csz) address = `${address}, ${csz}`;
        }
        // Custom field override (property address field)
        const addrField = (opp.customFields || []).find(f => f.id === "SGJdYcttaxyiWDHydcc6");
        if (addrField?.fieldValueString) address = addrField.fieldValueString;

        leads.push({
          contactId:  contact.id,
          name:       contact.name || `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "there",
          firstName:  contact.firstName || contact.name?.split(" ")[0] || "there",
          phone:      phone.replace(/\D/g, "").replace(/^1?(\d{10})$/, "+1$1"),
          address,
          streetName: address.split(",")[0] || address,
          oppId:      opp.id,
          stageName,
          tags:       contact.tags || [],
        });
      }
      if (opps.length < 20) break;
      page++;
    }
  }

  // Enrich ALL leads with previous call context so David NEVER forgets a prior conversation
  const allContactIds = leads.map(l => l.contactId).filter(Boolean);
  if (allContactIds.length > 0) {
    try {
      const { data: prevCalls } = await sb
        .from("jarvis_calls")
        .select("contact_id, summary, notes, stage_after, called_at, call_duration")
        .in("contact_id", allContactIds)
        .order("called_at", { ascending: false });

      // Most recent call per contact
      const callMap = {};
      for (const row of prevCalls || []) {
        if (!callMap[row.contact_id]) callMap[row.contact_id] = row;
      }

      for (const lead of leads) {
        const prev = callMap[lead.contactId];
        if (!prev) continue;
        const dur = prev.call_duration > 60
          ? `${Math.floor(prev.call_duration / 60)}m ${prev.call_duration % 60}s`
          : `${prev.call_duration}s`;
        const hadRealConvo = prev.call_duration > 30 &&
          !["Attempt 1 No Contact","Attempt 2 No Contact","Attempt 3-5 No Contact","Attempt 6+ Unresponsive"].includes(prev.stage_after);
        lead._callContext = hadRealConvo
          ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT — YOU ALREADY SPOKE WITH ${lead.firstName.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DO NOT re-introduce as a first call. You have spoken before. Pick up where you left off.
Last call: ${new Date(prev.called_at).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} (${dur})
Last outcome: ${prev.stage_after || "—"}
What was discussed: ${prev.summary || "—"}
Call notes: ${prev.notes ? prev.notes.substring(0, 500) : "—"}

YOUR JOB: Reference the prior conversation naturally. Move toward a number and an offer.
If they gave you a price range before — you already know it. Reference it directly.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
          : `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIOR ATTEMPT — NO CONVERSATION YET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You called ${lead.firstName} before but did not reach them (${prev.stage_after || "no answer"}).
Last attempt: ${new Date(prev.called_at).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
Treat this as a first real conversation — they may not know who you are.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      }
    } catch {}
  }

  console.log(`[GHL] ${leads.length} leads to call`);
  return leads;
}

// ── Step 3: Initiate outbound call via Twilio + Chatterbox ────────────────────
async function callLead(lead, { isTest = false } = {}) {
  // ── HARD KILL SWITCH — checked before ANY Telnyx API call ────────────────────
  if (DAVID_LOCKED) {
    console.log(`[LOCKED] Call to ${lead.name} blocked — DAVID_LOCKED=true. Send 'unlock david' to Jarvis.`);
    return null;
  }

  // ── Telnyx balance guard — never go negative ──────────────────────────────────
  if (!isTest) {
    const balance = await getTelnyxBalance();
    if (balance < 2.00) {
      const msg = `🚨 <b>Telnyx balance low</b>: $${balance.toFixed(2)}\n\nDavid cannot make calls until you add funds. Locking David.`;
      console.log(`[Balance] $${balance.toFixed(2)} — below $2.00 minimum. Blocking call to ${lead.name}.`);
      DAVID_LOCKED = true;
      try {
        await sb.from("agent_status").upsert({ id: "DAVID_STATUS", status: "paused", updated_at: new Date().toISOString() });
        await sb.from("agent_status").upsert({ id: "DAVID_LOCKED", status: "true", updated_at: new Date().toISOString() });
      } catch {}
      sendTelegram(msg).catch(() => {});
      return null;
    }
  }

  const callId = `j-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Load Scout report for this lead (inject context into state for Claude prompt)
  if (lead.contactId) {
    try {
      const { data: scouts } = await sb.from("scout_reports").select("*").eq("contact_id", lead.contactId).order("created_at", { ascending: false }).limit(1);
      if (scouts?.[0]) {
        lead._scoutReport = scouts[0];
        if (scouts[0].suggested_opening) lead._suggestedOpening = scouts[0].suggested_opening;
        console.log(`  [Scout] Intel loaded for ${lead.name} — motivation: ${scouts[0].estimated_motivation}/10`);
      }
    } catch {}
  }

  const isInbound = ["Decision Pending","Contract Sent","Hot Follow Up","Warm Follow Up"].includes(lead.stageName);
  let openingText;
  if (lead._isCallback && lead._offerAmount) {
    openingText = `Hey ${lead.firstName}! This is David calling back. How are you? So I just got out of a meeting with my purchasing manager and I've got some great news for you on that property. Do you have a few minutes?`;
  } else if (lead._isDenialCallback) {
    openingText = `Hey ${lead.firstName}! This is David with Want To Sell Now. Hey — I just got out of my meeting and I wanted to call you personally. After reviewing everything, unfortunately it's not something we can move forward on right now. The main reason is ${lead._denialReason}. I didn't want to leave you hanging without a real explanation — you deserve that. If your situation ever changes, please don't hesitate to reach out. I genuinely appreciate your time.`;
  } else if (isInbound) {
    openingText = `Hey ${lead.firstName}! This is David with Want To Sell Now, how are you doing today? So we got your request for a cash offer on ${lead.address || "your property"}, and I just wanted to run through a few quick details with you. Did you have a timeframe or price in mind?`;
  } else {
    openingText = `Hey… is this ${lead.firstName}? Hey! This is David — I was calling about that property on ${lead.address || "the address we have on file"}. Wanted to see if you'd be open to a cash offer on it?`;
  }

  callStore.set(callId, {
    lead,
    startTime:      Date.now(),
    oppId:          lead.oppId,
    stageBefore:    lead.stageName,
    callSid:        null,
    messages:       [
      { role: "user",      content: `[SYSTEM: Call started. Seller: ${lead.firstName}. Property: ${lead.address || "unknown"}.]` },
      { role: "assistant", content: openingText },
    ],
    transcript:     [{ speaker: "Jarvis", text: openingText }],
    turnNum:        0,
    ended:          false,
    openingText,
    callStage:      "dialing",
    silenceTimer:   null,
    isTest,
    humanConfirmed: false,
    arvTriggered:   false,
    arvData:        null,
    verbalAgreement: null,
  });

  // Round-robin across David phone numbers
  const fromPhone = DAVID_PHONES[davidPhoneIndex % DAVID_PHONES.length];
  davidPhoneIndex++;

  try {
    const { data: call } = await telnyxClient.calls.dial({
      connection_id: TELNYX_CONNECTION_ID,
      to:            lead.phone,
      from:          fromPhone,
      webhook_url:   `${webhookBase}/telnyx/webhook`,
      client_state:  Buffer.from(JSON.stringify({ callId })).toString("base64"),
      // Disable AMD for test calls — avoids false machine detection on known human numbers.
      // For real calls, "detect" fires call.machine.detection.ended; we guard with humanConfirmed.
      answering_machine_detection: callStore.get(callId)?.isTest ? "disabled" : "detect",
    });
    callStore.get(callId).callSid  = call.call_control_id;
    callStore.get(callId).fromPhone = fromPhone;
    console.log(`  [Call] ✓ ${lead.name} (${lead.phone}) from ${fromPhone} → Telnyx ID: ${call.call_control_id}`);
    return callId;
  } catch (err) {
    console.error(`  [Call] ✗ ${lead.name}:`, err.message);
    callStore.delete(callId);
    return null;
  }
}

// ── Analyze transcript with Claude ────────────────────────────────────────────
async function analyzeTranscript(transcript, lead) {
  try {
    const res = await aiChat({
      max_tokens: 900,
      system:     "You analyze real estate acquisition call transcripts. Return ONLY valid JSON, no other text.",
      messages: [{
        role: "user",
        content:
          `Analyze this call transcript for ${lead.name} about ${lead.address || "their property"}.\n\n` +
          `Transcript:\n${transcript}\n\n` +
          `Return JSON:\n` +
          `{\n` +
          `  "motivation_score": integer 1-10 (1=no motivation/testing market, 5=considering, 7=motivated+flexible, 9=must sell now),\n` +
          `  "motivation_tag": "e.g. Divorce - High Motivation",\n` +
          `  "timeline_tag": "e.g. Under 30 Days",\n` +
          `  "price_tag": "e.g. Price: $180k",\n` +
          `  "condition_tag": "e.g. Needs Work - Roof + Kitchen",\n` +
          `  "summary": "one sentence outcome",\n` +
          `  "notes": "detailed call notes",\n` +
          `  "next_action": "specific next step",\n` +
          `  "motivation_summary": "one sentence describing WHY they want to sell",\n` +
          `  "condition_summary": "brief condition description e.g. Good, Needs roof + HVAC",\n` +
          `  "repair_breakdown": {"roof": "needs replacement", "hvac": "working", "kitchen": "dated", "baths": "ok", "foundation": "ok"},\n` +
          `  "mortgage_payoff_range": estimated payoff in dollars as integer or null,\n` +
          `  "asking_price": seller stated asking price as integer or null,\n` +
          `  "occupancy": "Occupied - Owner" or "Occupied - Tenant" or "Vacant" or null,\n` +
          `  "callback_time": "specific time mentioned e.g. Tomorrow 3pm or null"\n` +
          `}`,
      }],
    });
    // cost logging skipped for Llama; Claude fallback logs internally
    const raw = res.text.trim().replace(/^```json\s*/,"").replace(/```\s*$/,"");
    const result = JSON.parse(raw);
    // Derive stage from motivation_score (7-10 = Hot, 4-6 = Warm, 1-3 = Cold)
    const score = result.motivation_score || 0;
    result.stage = score >= 7 ? "Hot Follow Up" : score >= 4 ? "Warm Follow Up" : "Cold Follow Up";
    return result;
  } catch {
    return {
      stage:             "Cold Follow Up",
      motivation_tag:    null,
      timeline_tag:      null,
      price_tag:         null,
      condition_tag:     null,
      summary:           "Analysis failed — review manually",
      notes:             typeof transcript === "string" ? transcript.substring(0, 500) : "",
      next_action:       "Review call recording",
      motivation_score:  null,
      motivation_summary: null,
      condition_summary:  null,
      repair_breakdown:   null,
      mortgage_payoff_range: null,
      asking_price:       null,
      callback_time:      null,
    };
  }
}

// ── Step 4: Post-call processing ──────────────────────────────────────────────
// ── Deal Approval: run ASAP ARV + create approval record ──────────────────────
async function triggerDealApproval(lead, summary, transcriptStr, state, preloadedArv = null) {
  try {
    console.log(`\n[Deal Approval] Triggering for ${lead.name} — ${lead.address}`);

    // 1. Use pre-loaded ARV from mid-call or run fresh
    const arv = preloadedArv && preloadedArv.success ? preloadedArv : await runAsapArv(lead.address).catch(err => {
      console.error("  [ASAP] Scraper failed:", err.message);
      return { success: false, error: err.message };
    });

    // 2. Compute novation qualification
    const arvNum      = arv.arv || 0;
    const payoffNum   = summary.mortgage_payoff_range || lead.mortgage || 0;
    const equityPct   = arvNum > 0 ? Math.round(((arvNum - payoffNum) / arvNum) * 100) : 0;
    const gap70       = (lead.asking || arvNum * 0.85) - (arvNum * 0.70);
    const novQual     = (lead.timeline === "60+ days") &&
                        (summary.condition_summary || "").match(/good|fair/i) &&
                        gap70 > 20000 && equityPct < 40;
    const novationOffer = novQual ? Math.round(arvNum * 0.84) : null;

    // 3. Insert into david_pending_approvals table
    const approvalRow = {
      contact_id:         lead.contactId,
      contact_name:       lead.name,
      phone:              lead.phone         || null,
      address:            lead.address,
      arv:                arvNum             || null,
      offer_60:           arv.offer60        || null,
      offer_65:           arv.offer65        || null,
      offer_70:           arv.offer70        || null,
      novation_offer:     novationOffer,
      novation_qualified: !!novQual,
      motivation_score:   summary.motivation_score   || null,
      motivation_summary: summary.motivation_summary  || summary.motivation_tag || null,
      condition_summary:  summary.condition_summary   || summary.condition_tag  || null,
      repair_breakdown:   summary.repair_breakdown    || null,
      mortgage_payoff:    payoffNum                   || null,
      timeline:           lead.timeline               || summary.timeline_tag   || null,
      transcript_snippet: transcriptStr ? transcriptStr.slice(-2000) : null,
      asap_report_url:    arv.reportUrl  || null,
      status:             "pending",
    };

    const { data: approvalData, error: approvalErr } = await sb.from("david_pending_approvals").insert(approvalRow).select("id").single();
    if (approvalErr) {
      console.error("  [Approval] Supabase error:", approvalErr.message);
      if (approvalErr.message.includes("does not exist")) {
        console.log("  ⚠️  Create david_pending_approvals table in Supabase first (see DAVID_PENDING_APPROVALS_SQL)");
      }
      return;
    }

    const approvalId = approvalData?.id || "—";
    console.log(`  [Approval] Created in david_pending_approvals: ${approvalId}`);

    // 4. Send Telegram approval card with 3-button inline keyboard
    const fmtC = n => n ? `$${Math.round(n).toLocaleString()}` : "—";
    const arvLine = arv.success
      ? `\n💎 ARV: <b>${fmtC(arv.arv)}</b> | Repairs: ${fmtC(arv.repairEstimate)}`
      : "\n⚠️ ASAP ARV: Could not pull comps automatically";
    const offerLine = arv.offer60
      ? `\n💰 60%=${fmtC(arv.offer60)} | 65%=${fmtC(arv.offer65)} | 70%=${fmtC(arv.offer70)}`
      : "";
    const novLine = novQual ? `\n✨ NOVATION: ${fmtC(novationOffer)}` : "";
    const motivLine = summary.motivation_score
      ? `\n🔥 Motivation: ${summary.motivation_score}/10`
      : `\nMotivation: ${summary.motivation_tag || "—"}`;

    const fmtB = n => n ? `$${Math.round(n).toLocaleString()}` : "—";
    const keyboard = [
      [
        { text: `✅ ${fmtB(arv.offer60)} (60%)`,  callback_data: `approve_60_${approvalId}` },
        { text: `✅ ${fmtB(arv.offer65)} (65%)`,  callback_data: `approve_65_${approvalId}` },
        { text: `✅ ${fmtB(arv.offer70)} (70%)`,  callback_data: `approve_70_${approvalId}` },
      ],
      [
        { text: "❌ PASS + Call Seller Back", callback_data: `pass_${approvalId}` },
      ],
    ];

    const fmtM = n => n ? `~$${Math.round(n).toLocaleString()}` : "—";
    await sendTelegramWithButtons(
      `🔥 <b>HOT LEAD — APPROVAL NEEDED</b>\n` +
      `──────────────────────────────\n` +
      `👤 Name: ${lead.name}\n` +
      `🏠 Address: ${lead.address}\n` +
      `📞 Phone: ${lead.phone || "—"}\n` +
      `──────────────────────────────\n` +
      `💬 Motivation: ${summary.motivation_summary || summary.motivation_tag || "—"}\n` +
      `⏱️ Timeline: ${summary.timeline_tag || "—"}\n` +
      `🏚️ Condition: ${summary.condition_summary || summary.condition_tag || "—"}\n` +
      `💰 Mortgage: ${fmtM(summary.mortgage_payoff_range)}\n` +
      `💵 Asking: ${summary.asking_price ? fmtC(summary.asking_price) : "—"}\n` +
      `📊 Score: ${summary.motivation_score}/10\n` +
      `──────────────────────────────\n` +
      (arv.success
        ? `💎 ARV: <b>${fmtC(arvNum)}</b> | Repairs: ${fmtC(arv.repairEstimate)}\n` +
          `💰 60%: ${fmtC(arv.offer60)} | 65%: ${fmtC(arv.offer65)} | 70%: ${fmtC(arv.offer70)}\n` +
          (novQual ? `✨ Novation: <b>${fmtC(novationOffer)}</b>\n` : "")
        : `⚠️ ASAP ARV comps unavailable\n`) +
      `──────────────────────────────`,
      keyboard
    );

  } catch (err) {
    console.error("  [Deal Approval] Unexpected error:", err.message);
  }
}

// ── Telegram with inline keyboard ─────────────────────────────────────────────
async function sendTelegramWithButtons(text, inlineKeyboard) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:      TELEGRAM_CHAT_ID,
        text,
        parse_mode:   "HTML",
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
    });
  } catch (err) {
    console.error("  [Telegram] Button message failed:", err.message);
  }
}

// ── SQL for david_pending_approvals table ─────────────────────────────────────
const DAVID_PENDING_APPROVALS_SQL = `
CREATE TABLE IF NOT EXISTS public.david_pending_approvals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          TEXT NOT NULL,
  contact_name        TEXT,
  phone               TEXT,
  address             TEXT,
  arv                 NUMERIC,
  offer_60            NUMERIC,
  offer_65            NUMERIC,
  offer_70            NUMERIC,
  novation_offer      NUMERIC,
  novation_qualified  BOOLEAN DEFAULT false,
  motivation_score    INTEGER,
  motivation_summary  TEXT,
  condition_summary   TEXT,
  repair_breakdown    JSONB,
  mortgage_payoff     NUMERIC,
  timeline            TEXT,
  transcript_snippet  TEXT,
  status              TEXT DEFAULT 'pending',
  approved_type       TEXT,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dpa_status_idx ON public.david_pending_approvals(status);
CREATE INDEX IF NOT EXISTS dpa_created_idx ON public.david_pending_approvals(created_at DESC);
`.trim();

async function processCallEnd(callId, transcript, duration) {
  const state = callStore.get(callId);
  if (!state) return;

  // Capture AMD result BEFORE deleting state (used for voicemail detection below)
  const amdResult = state.amdResult || null;
  callStore.delete(callId);

  const lead = state.lead;
  console.log(`\n[End] ${lead.name} | ${duration}s`);

  // Skip if call never connected
  if (duration === 0 && (!transcript || transcript.length < 10)) {
    console.log(`  [Skip] Call never connected (duration=0, no transcript) — will retry next run`);
    return;
  }

  const elRecordingUrl = state.recordingUrl || null;
  const elProxyUrl     = state.recordingUrl || null;

  // ── Voicemail detection — ALL THREE conditions must be true ─────────────────
  // 1. AMD returned "machine" with confidence >= 80%
  // 2. Call duration < 25 seconds
  // 3. Zero human words detected by Telnyx STT (no Seller turns)
  //
  // If ANY condition is missing → treat as real human conversation.
  // Only AMD-confirmed voicemails increment the attempt counter.
  // Real conversations → Cold/Warm/Hot based on motivation score.

  const sellerTurns = (typeof transcript === "string" ? transcript : "")
    .split("\n").filter(l => l.startsWith("Seller:")).length;

  // AMD machine confirmation check
  const amdWasMachine   = (amdResult?.result === "machine" || amdResult?.result === "fax");
  const amdHighConf     = (amdResult?.confidence ?? 0) >= 0.80;
  const amdShortCall    = duration < 25;
  const amdZeroSpeech   = sellerTurns === 0;
  const confirmedVoicemail = amdWasMachine && amdHighConf && amdShortCall && amdZeroSpeech;

  // Detect voicemail phrases in seller speech (catches undetected voicemails)
  const vmPhrases = ["you may hang up", "leave a message", "press 1 for more options", "not available", "you have reached", "please leave", "after the tone", "at the beep", "mailbox is full", "no longer in service", "been disconnected"];
  const transcriptLower = (typeof transcript === "string" ? transcript : "").toLowerCase();
  const detectedVmPhrase = vmPhrases.some(p => transcriptLower.includes(p));

  // Mid-call VM flag (set when voicemail phrase detected live during transcription)
  const midCallVm = state.midCallVoicemail === true;

  // hasConversation = seller actually spoke AND it was NOT a voicemail of any kind
  const hasConversation = sellerTurns > 0 && !confirmedVoicemail && !detectedVmPhrase && !midCallVm;

  console.log(`  [VM check] amdMachine=${amdWasMachine} conf=${(amdResult?.confidence ?? 0).toFixed(2)} dur=${duration}s sellerTurns=${sellerTurns} → confirmedVM=${confirmedVoicemail} hasConvo=${hasConversation}`);
  const autoAnalysis = process.env.CLAUDE_AUTO_ANALYSIS === "true";

  // Rule 2 — Cache: check analyzed_calls before spending tokens on this callId
  let alreadyCached = false;
  if (hasConversation && autoAnalysis && callId) {
    try {
      const { data: cached } = await sb.from("analyzed_calls").select("id").eq("call_id", callId).limit(1);
      if (cached && cached.length > 0) {
        console.log(`  [Cache] callId ${callId} already analyzed — skipping Claude call`);
        alreadyCached = true;
      }
    } catch {}
  }

  // ── Determine outcome stage ────────────────────────────────────────────────
  // No conversation = voicemail/no answer → use attempt ladder
  // Conversation present = Claude determines Hot/Warm/Cold
  let summary;
  if (!hasConversation) {
    const noContactStage = await getNoContactStage(lead.contactId);
    summary = {
      stage:             noContactStage,
      motivation_tag:    null,
      timeline_tag:      null,
      price_tag:         null,
      condition_tag:     null,
      summary:           "No answer or voicemail",
      notes:             "No conversation recorded.",
      next_action:       "Retry in 48 hours",
      motivation_score:  null,
      motivation_summary: null,
      condition_summary:  null,
      repair_breakdown:   null,
      mortgage_payoff_range: null,
      callback_time:      null,
    };
  } else if (autoAnalysis && !alreadyCached) {
    summary = await analyzeTranscript(transcript, lead);
    // If analysis failed (e.g. voicemail mistaken as human), fall back to attempt ladder
    if (summary.summary === "Analysis failed — review manually") {
      const noContactStage = await getNoContactStage(lead.contactId);
      summary.stage = noContactStage;
      summary.summary = "Voicemail or undetected machine — no conversation";
    }
  } else {
    summary = {
      stage: "Warm Follow Up", motivation_tag: null, timeline_tag: null,
      price_tag: null, condition_tag: null,
      summary: "Conversation detected — run call-analyzer manually to analyze",
      notes: `[Auto-analysis disabled. Raw transcript:\n${transcript?.substring(0, 500)}]`,
      next_action: "Run: node call-analyzer.js --contactId <id>",
      motivation_score: null, motivation_summary: null, condition_summary: null,
      repair_breakdown: null, mortgage_payoff_range: null, callback_time: null,
    };
  }

  // ── No backwards movement — never demote a progressed lead ────────────────
  const currentRank  = STAGE_RANK[lead.stageName] || 0;
  const proposedRank = STAGE_RANK[summary.stage]  || 0;
  if (proposedRank < currentRank) {
    console.log(`  [Stage] Blocked backwards move: ${summary.stage} (rank ${proposedRank}) < current ${lead.stageName} (rank ${currentRank}) — keeping ${lead.stageName}`);
    summary.stage = lead.stageName;
  }

  // Rule 2 — Cache: mark callId analyzed so future runs skip it
  if (hasConversation && autoAnalysis && !alreadyCached && callId) {
    (async () => { try { await sb.from("analyzed_calls").insert({ call_id: callId, contact_id: lead.contactId, analyzed_at: new Date().toISOString() }); } catch {} })();
  }

  const stageName = summary.stage || lead.stageName || "Warm Follow Up";
  const stageId   = STAGE_IDS[stageName] || null;
  const callDate  = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const durationMin = duration > 0
    ? `${Math.floor(duration / 60)}m ${duration % 60}s`
    : "< 1 min";

  // Build full transcript string with speaker labels
  const transcriptLines = Array.isArray(transcript)
    ? transcript.map(t => `${(t.role === "agent" || t.role === "assistant") ? "Jarvis" : "Seller"}: ${t.message || t.text || ""}`)
    : typeof transcript === "string" ? transcript.split("\n") : [];
  const transcriptStr = transcriptLines.join("\n") || "No transcript available.";

  // 1. Update GHL opportunity stage
  if (!state.oppId) {
    console.error(`  [GHL] SKIP stage update — oppId is null for ${lead.name}`);
  } else if (!stageId) {
    console.error(`  [GHL] SKIP stage update — stageId not found for "${stageName}" (STAGE_IDS may not have loaded)`);
  } else {
    try {
      await ghl("PUT", `/opportunities/${state.oppId}`, {
        pipelineStageId: stageId,
        status:          "open",
      });
      console.log(`  [GHL] ✅ Stage → ${stageName}`);
    } catch (e) {
      console.error(`  [GHL] ❌ Stage update FAILED for ${lead.name} (opp: ${state.oppId}): ${e.message}`);
    }
  }

  // 2. Update GHL contact tags — smart journey tags
  const contactData  = await ghl("GET", `/contacts/${lead.contactId}`).catch(() => ({}));
  const existingTags = contactData.contact?.tags || [];

  // Build the smart journey tag for this call
  let smartTag = null;
  if (!hasConversation) {
    // No-contact: count total no-contact calls including this one
    let ncData = [];
    try {
      const res = await sb.from("jarvis_calls")
        .select("id")
        .eq("contact_id", lead.contactId)
        .in("stage_after", ["Attempt 1 No Contact","Attempt 2 No Contact","Attempt 3-5 No Contact","Attempt 6+ Unresponsive","Attempt 1"]);
      ncData = res.data || [];
    } catch {}
    const totalNoContact = (ncData.length) + 1; // +1 for this call (not yet logged)
    smartTag = buildNoContactTag(totalNoContact);
  } else {
    // Real conversation — build spoke tag with score
    smartTag = await buildConversationTag(lead.contactId, summary.motivation_score || 0);
  }

  const outcomeTag = confirmedVoicemail ? "Voicemail Left" : !hasConversation ? "No Answer" : null;

  // Strip all old smart journey tags, old AI Call / outcome tags, then add fresh ones
  const keptTags = existingTags.filter(t =>
    !isSmartTag(t) &&
    !t.startsWith("AI Call:") &&
    t !== "No Answer" &&
    t !== "Voicemail Left"
  );
  const newTags = [
    ...keptTags,
    smartTag,
    `AI Call: ${stageName}`,
    outcomeTag,
    summary.motivation_tag,
    summary.timeline_tag,
    summary.price_tag,
    summary.condition_tag,
  ].filter(Boolean);

  try {
    await ghl("PUT", `/contacts/${lead.contactId}`, { tags: newTags });
    console.log(`  [GHL] ✅ Tags → ${smartTag} | ${stageName}${outcomeTag ? ` | ${outcomeTag}` : ""}`);
  } catch (e) {
    console.error(`  [GHL] ❌ Tag update FAILED for ${lead.name}: ${e.message}`);
  }

  // 2b. Write custom fields — always update call tracking fields, qualifying fields on real conversations
  {
    const customFieldsPayload = [];
    const nowIso = new Date().toISOString();

    // Always write — call tracking
    if (GHL_FIELDS.last_called_date)
      customFieldsPayload.push({ id: GHL_FIELDS.last_called_date, value: nowIso });
    if (GHL_FIELDS.call_outcome)
      customFieldsPayload.push({ id: GHL_FIELDS.call_outcome, value: hasConversation ? "Spoke" : confirmedVoicemail ? "Voicemail" : "No Answer" });

    // Qualifying fields — only when we actually spoke
    if (hasConversation) {
      if (GHL_FIELDS.motivation && (summary.motivation_summary || summary.motivation_tag))
        customFieldsPayload.push({ id: GHL_FIELDS.motivation, value: summary.motivation_summary || summary.motivation_tag });
      if (GHL_FIELDS.asking_price && summary.asking_price)
        customFieldsPayload.push({ id: GHL_FIELDS.asking_price, value: String(summary.asking_price) });
      if (GHL_FIELDS.condition && (summary.condition_summary || summary.condition_tag))
        customFieldsPayload.push({ id: GHL_FIELDS.condition, value: summary.condition_summary || summary.condition_tag });
      if (GHL_FIELDS.closing_timeline && summary.timeline_tag)
        customFieldsPayload.push({ id: GHL_FIELDS.closing_timeline, value: summary.timeline_tag });
      if (GHL_FIELDS.mortgage_payoff && summary.mortgage_payoff_range)
        customFieldsPayload.push({ id: GHL_FIELDS.mortgage_payoff, value: String(summary.mortgage_payoff_range) });
      if (GHL_FIELDS.occupancy && summary.occupancy)
        customFieldsPayload.push({ id: GHL_FIELDS.occupancy, value: summary.occupancy });
    }

    if (customFieldsPayload.length > 0) {
      try {
        await ghl("PUT", `/contacts/${lead.contactId}`, { customFields: customFieldsPayload });
        console.log(`  [GHL] ✅ Custom fields written (${customFieldsPayload.length} fields)`);
      } catch (e) {
        console.error(`  [GHL] ❌ Custom fields write FAILED: ${e.message}`);
      }
    }

    // 2c. Push contact info (street address + phone) if missing
    const contactInfo = contactData.contact || {};
    const contactUpdate = {};
    const streetOnly = (lead.address || "").split(",")[0].trim();
    if (streetOnly && !contactInfo.address1) contactUpdate.address1 = streetOnly;
    if (lead.phone && !contactInfo.phone) contactUpdate.phone = lead.phone;
    if (Object.keys(contactUpdate).length > 0) {
      try {
        await ghl("PUT", `/contacts/${lead.contactId}`, contactUpdate);
        console.log(`  [GHL] ✅ Contact info updated: ${Object.keys(contactUpdate).join(", ")}`);
      } catch (e) {
        console.error(`  [GHL] ❌ Contact info update FAILED: ${e.message}`);
      }
    }
  }

  // 3. Write structured note to GHL
  const callTypeHeader = hasConversation
    ? `✅ QUALIFYING CALL`
    : confirmedVoicemail ? `📵 VOICEMAIL LEFT` : `📵 NO ANSWER`;

  const noteBody =
    `${callTypeHeader}\n` +
    `Date: ${callDate}\n` +
    `Duration: ${durationMin}\n` +
    `Recording: Recording processing — will update shortly\n\n` +
    (hasConversation ? (
      `🧠 QUALIFYING INFO:\n` +
      `Motivation: ${summary.motivation_summary || summary.motivation_tag || "—"}\n` +
      `Timeline: ${summary.timeline_tag || "—"}\n` +
      `Asking Price: ${summary.asking_price ? `$${summary.asking_price.toLocaleString()}` : "—"}\n` +
      `Condition: ${summary.condition_summary || summary.condition_tag || "—"}\n` +
      `Mortgage: ${summary.mortgage_payoff_range ? `~$${summary.mortgage_payoff_range.toLocaleString()}` : "—"}\n` +
      `Score: ${summary.motivation_score || "—"}/10\n` +
      `Stage → ${stageName}\n` +
      `Summary: ${summary.summary}\n` +
      `Next Action: ${summary.next_action}\n\n`
    ) : (
      `Stage → ${stageName}\n` +
      `Outcome: ${outcomeTag || "No Answer"}\n\n`
    )) +
    `📝 FULL TRANSCRIPT:\n${transcriptStr}`;

  let ghlNoteId = null;
  try {
    const noteRes = await ghl("POST", `/contacts/${lead.contactId}/notes`, { body: noteBody, userId: null });
    ghlNoteId = noteRes?.id || null;
    console.log(`  [GHL] ✅ Note written (${callTypeHeader}) — ID: ${ghlNoteId || "—"}`);
  } catch (e) {
    console.error(`  [GHL] ❌ Note write FAILED for ${lead.name}: ${e.message}`);
  }

  // Store noteId so recording.saved can update it
  if (ghlNoteId && state) {
    state.ghlNoteId = ghlNoteId;
    state.ghlContactId = lead.contactId;
    callStore.set(callId, state);
  }

  // 4. Log to Supabase jarvis_calls
  const tagsStr = [summary.motivation_tag, summary.timeline_tag, summary.price_tag, summary.condition_tag].filter(Boolean).join(", ");
  // ── Track daily minute budget ────────────────────────────────────────────────
  dailyCallSeconds += duration;
  if (dailyCallSeconds >= dailyBudgetCap) {
    console.log(`[Budget] Daily ${Math.round(dailyBudgetCap/60)}m budget reached (${Math.round(dailyCallSeconds/60)}m used). Deactivating David.`);
    try {
      await sb.from("agent_status").upsert({ id: "DAVID_STATUS", status: "paused", updated_at: new Date().toISOString() });
    } catch {}
    sendTelegram(`⏱ <b>Daily minute budget reached</b> (${Math.round(dailyCallSeconds/60)}m used). David stopping.\n\nReply <b>EXTEND</b> to add 15 more minutes.`).catch(() => {});
  }

  const callRow = {
    contact_id:    lead.contactId,
    contact_name:  lead.name,
    phone:         lead.phone,
    address:       lead.address,
    call_duration: duration,
    stage_before:  state.stageBefore,
    stage_after:   stageName,
    tags_applied:  tagsStr,
    summary:       summary.summary,
    notes:         summary.notes,
    called_at:     new Date().toISOString(),
  };

  // Try inserting with extended columns; fall back to base schema
  const extendedRow = {
    ...callRow,
    recording_url:    elProxyUrl || null,
    transcript_full:  transcriptStr,
    twilio_call_sid:  state.callSid || null,
  };
  let { data: insertedRows, error: callErr } = await sb.from("jarvis_calls").insert(extendedRow).select("id");
  const insertedRowId = insertedRows?.[0]?.id || null;

  if (callErr?.message?.includes("recording_url") || callErr?.message?.includes("transcript_full")
    || callErr?.message?.includes("twilio_call_sid")) {
    // Columns don't exist yet — fall back to base schema, embed URL in notes
    callRow.notes = `${summary.notes}\n\nRecording: ${elProxyUrl || "N/A"}\n\nTranscript:\n${transcriptStr}`;
    const fallback = await sb.from("jarvis_calls").insert(callRow);
    callErr = fallback.error;
    console.log("  [Supabase] Note: run ALTER TABLE for new columns (see startup SQL above)");
  }

  if (callErr) {
    try {
      await sb.from("jarvis_log").insert({
        type:         "ai_call",
        message:      `CALL: ${lead.name} | ${lead.address} | ${stageName} | ${summary.summary}`,
        contact_name: lead.name,
        source:       "jarvis-caller",
        priority:     "high",
      });
    } catch {}
    console.log("  [Supabase] Saved to jarvis_log (jarvis_calls table missing)");
  } else {
    console.log("  [Supabase] jarvis_calls ✓");
  }

  // 4b. Async recording fetch with retry — 30s → 2min → 5min
  if (insertedRowId && !elProxyUrl && state.callSid) {
    const ccId = state.callSid;
    const rowId = insertedRowId;
    const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
    const fetchRecording = async (attempt) => {
      try {
        const r = await fetch(`https://api.telnyx.com/v2/recordings?filter[call_control_id]=${ccId}`, {
          headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
        });
        const d = await r.json();
        const rec = (d.data || [])[0];
        const url = rec?.download_urls?.mp3 || rec?.download_urls?.wav || null;
        if (url) {
          await sb.from("jarvis_calls").update({ recording_url: url, telnyx_recording_url: url }).eq("id", rowId);
          console.log(`  [Rec] Saved to DB (attempt ${attempt}): ${url.substring(0, 80)}...`);
          return true;
        }
      } catch (e) {
        console.log(`  [Rec] Fetch attempt ${attempt} failed: ${e.message}`);
      }
      return false;
    };
    (async () => {
      await new Promise(r => setTimeout(r, 30_000));
      if (await fetchRecording(1)) return;
      await new Promise(r => setTimeout(r, 90_000));  // 2 min total
      if (await fetchRecording(2)) return;
      await new Promise(r => setTimeout(r, 180_000)); // 5 min total
      await fetchRecording(3);
    })();
  }

  // 5. Log to jarvis_log
  try {
    await sb.from("jarvis_log").insert({
      type:    "ai_call",
      message: `AI call complete: ${lead.name} | ${state.stageBefore} → ${stageName} | ${durationMin} | ${summary.summary}`,
      source:  "jarvis-caller",
    });
  } catch {}

  // 6. Telegram alert
  const elRecLink  = elProxyUrl ? `\n🎙️ Recording: <a href="${elProxyUrl}">Play</a>` : "";
  const twRecNote  = "";
  await sendTelegram(
    `📞 <b>Jarvis Call Complete</b>\n` +
    `Seller: ${lead.name}\n` +
    `Property: ${lead.address || "N/A"}\n` +
    `Stage: ${state.stageBefore} → <b>${stageName}</b>\n` +
    `Tags: ${newTags.slice(1).join(", ") || "none"}\n` +
    `Summary: ${summary.summary}\n` +
    `Next: ${summary.next_action}` +
    elRecLink + (elRecordingUrl ? "" : twRecNote)
  );

  console.log(`  [Done] ${lead.name} → ${stageName}`);
  if (elRecordingUrl) console.log(`  [EL Rec] URL: ${elRecordingUrl}`);
  if (state.callSid) console.log(`  [Telnyx] Call Control ID: ${state.callSid}`);

  // 8. Double-call for New Leads — if first call got no answer, call again in 8 min
  const wasNewLead  = state.stageBefore === "New Lead";
  const noConvo     = !hasConversation;
  const isRetry     = lead._isRetry === true;
  if (wasNewLead && noConvo && !isRetry) {
    const delayMin = 8;
    console.log(`  [Retry] New lead got no answer — scheduling callback in ${delayMin}m`);
    await sendTelegram(`🔄 <b>Double-Dial</b>: ${lead.name} didn't answer — calling back in ${delayMin} min`);
    setTimeout(async () => {
      console.log(`\n[Retry] Calling ${lead.name} again (2nd attempt, New Lead)`);
      await callLead({ ...lead, _isRetry: true }).catch(e =>
        console.error(`  [Retry] callLead error: ${e.message}`)
      );
    }, delayMin * 60 * 1000);
  }

  // 7. Verbal agreement alert — DocuSign trigger + tag
  if (state.verbalAgreement) {
    const sellerContactData = await ghl("GET", `/contacts/${lead.contactId}`).catch(() => ({}));
    const sellerEmail = sellerContactData.contact?.email || "—";
    await sendTelegram(
      `📝 <b>VERBAL AGREEMENT REACHED!</b>\n` +
      `──────────────────────────────\n` +
      `👤 Seller: <b>${lead.name}</b>\n` +
      `🏠 Address: ${lead.address}\n` +
      `💰 Price: <b>${state.verbalAgreement.price}</b>\n` +
      `📧 Email: ${sellerEmail}\n` +
      `──────────────────────────────\n` +
      `👆 <b>Send DocuSign contract now!</b>`
    );
    // Add Verbal Yes tag
    const verbalTags = (sellerContactData.contact?.tags || [])
      .filter(t => !isSmartTag(t) && t !== "No Answer" && t !== "Voicemail Left");
    await ghl("PUT", `/contacts/${lead.contactId}`, {
      tags: [...verbalTags, "✅ Verbal Yes — DocuSign Sent"],
    }).catch(() => {});
  }

  // 8. Deal approval flow — score 7+ and has real conversation
  if ((summary.motivation_score >= 7) && lead.address && hasConversation) {
    // Use mid-call ARV data if available, otherwise run fresh
    const arvForApproval = state.arvData || null;
    triggerDealApproval(lead, summary, transcriptStr, state, arvForApproval).catch(() => {});
  }
}

// ── Express server ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve ElevenLabs generated audio (Telnyx fetches this URL during playback)
app.get("/audio/el/:filename", (req, res) => {
  const filePath = path.join(EL_AUDIO_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  res.setHeader("Content-Type", "audio/mpeg");
  res.sendFile(filePath);
});

// Serve pre-built phrase audio (from ./audio/ directory)
app.get("/audio/prebuilt/:filename", (req, res) => {
  const filePath = path.join(AUDIO_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  res.setHeader("Content-Type", "audio/wav");
  res.sendFile(filePath);
});

// Serve permanently stored call recordings
const REC_DIR = path.join(__dirname, "recordings");
if (!fs.existsSync(REC_DIR)) fs.mkdirSync(REC_DIR, { recursive: true });
app.get("/recordings/:filename", (req, res) => {
  const filePath = path.join(REC_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  res.setHeader("Content-Type", "audio/mpeg");
  res.sendFile(filePath);
});


// ── Call Control helpers ──────────────────────────────────────────────────────
const ENDING_RE = /thank you for your time|goodbye|have a great|call you back|i('ll| will) follow up|let you go|talk (soon|later)/i;

function clientStateFor(callId, extra = {}) {
  return Buffer.from(JSON.stringify({ callId, ...extra })).toString("base64");
}

async function startListening(callControlId, callId) {
  const state = callStore.get(callId);
  if (!state || state.ended) return;

  if (state.silenceTimer) { clearTimeout(state.silenceTimer); state.silenceTimer = null; }
  state.callStage = "listening";

  const timeoutMs = state.turnNum === 0 ? 20000 : 12000;
  state.silenceTimer = setTimeout(async () => {
    const s = callStore.get(callId);
    if (!s || s.ended || s.callStage !== "listening") return;
    console.log(`  [CC] Silence timeout turn=${s.turnNum}`);
    await handleSilence(callControlId, callId);
  }, timeoutMs);

  callStore.set(callId, state);

  try {
    await telnyxClient.calls.actions.startTranscription(callControlId, {
      transcription_engine: "Deepgram",
      transcription_tracks: "inbound",
      client_state: clientStateFor(callId, { stage: "listening" }),
    });
  } catch (e) {
    console.error(`  [CC] startTranscription failed: ${e.message}`);
  }
}

async function stopListening(callControlId, callId) {
  const state = callStore.get(callId);
  if (state?.silenceTimer) { clearTimeout(state.silenceTimer); state.silenceTimer = null; callStore.set(callId, state); }
  try {
    await telnyxClient.calls.actions.stopTranscription(callControlId, {
      client_state: clientStateFor(callId),
    });
  } catch {}
}

async function handleSilence(callControlId, callId) {
  const state = callStore.get(callId);
  if (!state || state.ended) return;

  // Voicemail/no-answer: hang up immediately — no VM left (saves Telnyx minutes)
  if (false && state.turnNum === 0) {
    // DISABLED: was leaving voicemail — do NOT set state.ended=true yet.
    // callStage="ending" so playback.ended will hangup → call.hangup fires → processCallEnd runs.
    state.callStage = "ending";
    state.transcript.push({ speaker: "Jarvis (VM)", text: PHRASES.voicemail.text });
    callStore.set(callId, state);
    await davidSpeak(callControlId, PHRASES.voicemail.text, callId, "voicemail");
  } else {
    state.ended = true;
    callStore.set(callId, state);
    const duration   = Math.round((Date.now() - state.startTime) / 1000);
    const transcript = state.transcript.map(t => `${t.speaker}: ${t.text}`).join("\n");
    try { await telnyxClient.calls.actions.hangup(callControlId, {}); } catch {}
    await processCallEnd(callId, transcript, duration);
  }
}

async function processSellerSpeech(callControlId, callId, sellerText) {
  const state = callStore.get(callId);
  if (!state || state.ended) return;

  const lead = state.lead;
  state.turnNum++;
  state.callStage = "generating";
  state.transcript.push({ speaker: "Seller", text: sellerText });
  // Build list of David's last responses to help Claude avoid repeating himself
  const davidPrev = state.messages
    .filter(m => m.role === "assistant")
    .map(m => `"${m.content.slice(0, 60)}"`)
    .slice(-3)
    .join(", ");
  const noRepeatHint = davidPrev
    ? ` [IMPORTANT: Your last responses started with: ${davidPrev}. Do NOT repeat any of these openings or acknowledgment phrases. Use a completely different reaction.]`
    : "";
  state.messages.push({ role: "user", content: sellerText + noRepeatHint });

  if (state.turnNum >= 20) {
    state.ended = true;
    callStore.set(callId, state);
    const durMax   = Math.round((Date.now() - state.startTime) / 1000);
    const txMax    = state.transcript.map(t => `${t.speaker}: ${t.text}`).join("\n");
    try { await telnyxClient.calls.actions.hangup(callControlId, {}); } catch {}
    await processCallEnd(callId, txMax, durMax);
    return;
  }

  callStore.set(callId, state);

  // ── Auto-trigger ASAP ARV in background after turn 3 (price/condition phase) ──
  if (state.turnNum >= 3 && !state.arvTriggered && lead.address) {
    state.arvTriggered = true;
    callStore.set(callId, state);
    console.log(`  [ARV] Background ASAP ARV triggered for ${lead.address}`);
    runAsapArv(lead.address).then(arv => {
      const s = callStore.get(callId);
      if (s) { s.arvData = arv; callStore.set(callId, s); }
      console.log(`  [ARV] Result: ARV=${arv?.arv ? "$" + Math.round(arv.arv).toLocaleString() : "unavailable"}`);
    }).catch(e => console.log(`  [ARV] Background scrape failed: ${e.message}`));
  }

  // ── Check response cache first (zero Claude tokens if hit) ────────────
  let cacheHit = null;
  if (sellerText && sellerText.length > 10) {
    try {
      const { data: cacheRows } = await sb
        .from("response_cache")
        .select("id, best_david_response, times_used, success_rate")
        .order("times_used", { ascending: false })
        .limit(50);
      if (cacheRows?.length) {
        const sellerLower = sellerText.toLowerCase();
        for (const row of cacheRows) {
          const pattern = (row.seller_input_pattern || "").toLowerCase();
          // Simple keyword overlap score
          const patternWords = pattern.split(/\s+/).filter(w => w.length > 4);
          const matchCount   = patternWords.filter(w => sellerLower.includes(w)).length;
          const score = patternWords.length > 0 ? matchCount / patternWords.length : 0;
          if (score >= 0.75) {
            cacheHit = row;
            // Update usage count async
            sb.from("response_cache").update({ times_used: (row.times_used || 0) + 1 }).eq("id", row.id).then().catch(() => {});
            console.log(`  [Cache] 🎯 Hit! Score=${(score*100).toFixed(0)}% — saved Claude call`);
            break;
          }
        }
      }
    } catch {}
  }

  // ── Ask Claude Haiku for David's response (skip if cache hit) ─────────
  let davidResponse = cacheHit ? cacheHit.best_david_response : "I'm sorry, could you say that again?";
  if (cacheHit) {
    console.log(`  [Cache] Using cached response — 0 Claude tokens`);
  }
  try { if (cacheHit) throw new Error("cache_hit"); // skip claude block
    const basePrompt = getSystemPrompt()
      .replace(/\{\{seller_name\}\}/g,      lead.firstName   || "there")
      .replace(/\{\{property_address\}\}/g, lead.address     || "your property")
      .replace(/\{\{street_name\}\}/g,      lead.streetName  || lead.address || "the property");
    // For callback/follow-up calls, inject Script C BEFORE the general prompt so it takes priority
    const sysPrompt = lead._callContext
      ? `${lead._callContext}\n\n---\nGENERAL GUIDELINES (secondary — Script C above takes precedence):\n${basePrompt}${PHRASE_SUFFIX}`
      : basePrompt + PHRASE_SUFFIX;
    // Script C needs more tokens to walk the math — regular turns stay at 150
    const maxTok = lead._callContext ? 350 : 150;
    const aiRes = await aiChat({
      max_tokens: maxTok,
      system:     sysPrompt,
      messages:   state.messages,
    });
    davidResponse = aiRes.text;
  } catch (e) {
    if (e.message !== "cache_hit") console.error("  [Claude] Error:", e.message);
  }

  // ── Resolve [PHRASE:N] shortcut to its text ──────────────────────────
  const phraseMatch = davidResponse.match(/^\[PHRASE:(\w+)\]$/i);
  if (phraseMatch) {
    const key = isNaN(phraseMatch[1]) ? phraseMatch[1] : parseInt(phraseMatch[1]);
    davidResponse = PHRASES[key]?.text || davidResponse;
    console.log(`  [Phrase] [PHRASE:${key}]`);
  }

  state.transcript.push({ speaker: "Jarvis", text: davidResponse });
  state.messages.push({ role: "assistant", content: davidResponse });
  const isEnding = ENDING_RE.test(davidResponse);
  if (isEnding) state.ended = true;

  // Detect verbal agreement — David mentioned sending DocuSign / agreement
  const DOCUSIGN_RE = /docusign|two.page agreement|send.*agreement|agreement.*right now|sign.*dotted/i;
  if (DOCUSIGN_RE.test(davidResponse) && !state.verbalAgreement) {
    const askingPrice = state.messages.filter(m => m.role === "user")
      .map(m => m.content).join(" ").match(/\$?([\d,]+)k?\b/g);
    state.verbalAgreement = { price: askingPrice ? askingPrice[askingPrice.length - 1] : "TBD" };
    console.log(`  [DocuSign] Verbal agreement detected! Price: ${state.verbalAgreement.price}`);
  }

  state.callStage = isEnding ? "ending" : "playing_response";
  callStore.set(callId, state);

  await davidSpeak(callControlId, davidResponse, callId, isEnding ? "ending" : "response");
}

// ── Telnyx Call Control webhook ───────────────────────────────────────────────
app.post("/telnyx/webhook", async (req, res) => {
  res.json({ result: "ok" });

  const event = req.body?.data;
  if (!event) return;

  const eventType     = event.event_type;
  const payload       = event.payload || {};
  const callControlId = payload.call_control_id;

  let callId = null;
  let stage  = null;
  try {
    if (payload.client_state) {
      const parsed = JSON.parse(Buffer.from(payload.client_state, "base64").toString());
      callId = parsed.callId;
      stage  = parsed.stage;
    }
  } catch {}

  console.log(`\n[Telnyx] ${eventType} callId=${callId || "?"} stage=${stage || "—"}`);

  switch (eventType) {
    case "call.initiated":
      break;

    case "call.answered": {
      const state = callStore.get(callId);
      if (!state) break;
      state.callSid   = callControlId;
      state.callStage = "opening";
      callStore.set(callId, state);
      // Start recording (no stage in client_state so it can't override "opening" stage)
      telnyxClient.calls.actions.startRecording(callControlId, {
        format: "mp3", channels: "single",
        client_state: clientStateFor(callId),
      }).catch(e => console.warn(`  [Rec] start failed: ${e.message}`));
      await davidSpeak(callControlId, state.openingText, callId, "opening");
      break;
    }

    case "call.playback.ended": {
      // ElevenLabs audio plays via startPlayback() → fires call.playback.ended
      const state = callStore.get(callId);
      if (!state || state.ended) break;
      const cs = state.callStage;
      if (cs === "opening") {
        state.humanConfirmed = true;
        state.callStage = "listening";
        callStore.set(callId, state);
        await startListening(callControlId, callId);
      } else if (cs === "playing_response") {
        await startListening(callControlId, callId);
      } else if (cs === "ending") {
        try { await telnyxClient.calls.actions.hangup(callControlId, {}); } catch {}
      }
      break;
    }

    case "call.speak.failed": {
      const state = callStore.get(callId);
      console.error(`  [TTS] call.speak.failed — stage=${state?.callStage}. Trying plain-text fallback.`);
      if (!state || state.ended) break;
      const failStage = state.callStage;
      const fallbackText = failStage === "opening" ? state.openingText
                         : failStage === "playing_response" ? "Sorry about that — just to confirm, did you have a price in mind?"
                         : null;
      if (fallbackText) {
        try {
          await telnyxClient.calls.actions.speak(callControlId, {
            payload:      fallbackText,
            payload_type: "text",
            language:     "en-US",
            voice:        TELNYX_VOICE,
            client_state: clientStateFor(callId, { stage: failStage }),
          });
        } catch (e) {
          console.error(`  [TTS] Fallback speak also failed: ${e.message}`);
          try { await telnyxClient.calls.actions.hangup(callControlId, {}); } catch {}
        }
      } else {
        try { await telnyxClient.calls.actions.hangup(callControlId, {}); } catch {}
      }
      break;
    }

    case "call.speak.ended": {
      const state = callStore.get(callId);
      if (!state || state.ended) break;
      // Telnyx doesn't echo speak client_state back — use callStage as ground truth
      const cs = state.callStage;
      if (cs === "opening") {
        state.humanConfirmed = true;
        state.callStage = "listening";
        callStore.set(callId, state);
        await startListening(callControlId, callId);
      } else if (cs === "playing_response") {
        await startListening(callControlId, callId);
      } else if (cs === "ending") {
        try { await telnyxClient.calls.actions.hangup(callControlId, {}); } catch {}
      }
      break;
    }

    case "call.transcription": {
      const td     = payload.transcription_data || {};
      const text   = (td.transcript || "").trim();
      const isFinal = td.is_final === true;
      if (!isFinal || !text) break;

      const state = callStore.get(callId);
      if (!state || state.ended || state.callStage !== "listening") break;

      // ── Mid-call voicemail detection — check BEFORE sending to Claude ────────
      const lc = text.toLowerCase();
      const VM_PHRASES = [
        // Automated system phrases
        "when you have finished recording", "press 1 for more options",
        "if you are satisfied with your message", "are you still there please press",
        "please leave your message", "your call has been forwarded",
        "the person you are trying to reach", "not available right now",
        "leave a message after the tone", "mailbox is full",
        "leave a message at the beep", "after the beep please record",
        "you may hang up", "at the tone please record",
        "no one is available", "your message will be recorded",
        // Personal voicemail greetings (very common)
        "you've reached", "you have reached",
        "i'm not available", "i am not available",
        "i can't take your call", "i cannot take your call",
        "can't come to the phone", "cannot come to the phone",
        "leave a message", "leave me a message",
        "please leave a message", "i'll call you back",
        "sorry i missed", "sorry i missed your call",
        "not able to take your call", "unable to take your call",
        "have reached the voicemail", "reached my voicemail",
        "at the beep", "after the beep",
        "i'm away", "i am away",
      ];
      const shortVmPattern = text.split(" ").length <= 8 &&
        ["press", "hang", "message", "recording", "satisfied", "beep", "tone", "reached", "voicemail", "missed"].some(w => lc.includes(w));

      if (VM_PHRASES.some(p => lc.includes(p)) || shortVmPattern) {
        console.log(`  [VM-MID] Voicemail detected: "${text}" — hanging up immediately`);
        state.midCallVoicemail = true;
        state.ended = true;
        callStore.set(callId, state);
        const vmDuration   = Math.round((Date.now() - state.startTime) / 1000);
        const vmTranscript = state.transcript.map(t => `${t.speaker}: ${t.text}`).join("\n");
        try { await telnyxClient.calls.actions.hangup(callControlId, {}); } catch {}
        await processCallEnd(callId, vmTranscript, vmDuration);
        break;
      }
      // ── End voicemail check ───────────────────────────────────────────────────

      if (state.silenceTimer) { clearTimeout(state.silenceTimer); state.silenceTimer = null; }
      state.callStage = "processing";
      callStore.set(callId, state);

      console.log(`  [Seller] "${text}"`);
      await stopListening(callControlId, callId);
      await processSellerSpeech(callControlId, callId, text);
      break;
    }

    case "call.machine.detection.ended": {
      const result = payload.result || payload.answering_machine_detection_result || "";
      const state  = callStore.get(callId);
      console.log(`  [AMD] result: ${result} | isTest: ${state?.isTest} | humanConfirmed: ${state?.humanConfirmed}`);

      // Never hang up on test calls. Never hang up if David's opening already played
      // (humanConfirmed = true means a real human answered — AMD fired late after our TTS started).
      if (state?.isTest || state?.humanConfirmed) {
        console.log(`  [AMD] Ignoring machine result — ${state?.isTest ? "test call" : "human already confirmed"}`);
        break;
      }

      // Voicemail rule — ALL THREE conditions must be true to hang up:
      // 1. AMD result is "machine" or "fax" with confidence >= 80%
      // 2. Call duration < 25 seconds
      // 3. Zero seller words detected by Telnyx STT
      const amdConfidence  = typeof payload.confidence === "number" ? payload.confidence : 0;
      const amdDuration    = Math.round((Date.now() - (state?.startTime || Date.now())) / 1000);
      const amdSellerTurns = (state?.transcript || []).filter(t => t.speaker === "Seller").length;
      const isMachine      = result === "machine" || result === "fax";

      // Always store AMD result in state so processCallEnd can use it
      if (state) {
        state.amdResult = { result, confidence: amdConfidence, duration: amdDuration };
        callStore.set(callId, state);
      }

      if (isMachine && amdConfidence >= 0.80 && amdDuration < 25 && amdSellerTurns === 0) {
        if (!state || state.ended) break;
        console.log(`  [AMD] Confirmed machine — conf=${amdConfidence.toFixed(2)} dur=${amdDuration}s sellerTurns=0 — hanging up`);
        state.ended = true;
        callStore.set(callId, state);
        try { await telnyxClient.calls.actions.hangup(callControlId, {}); } catch (e) {
          console.log(`  [AMD] Hangup note: ${e.message}`);
        }
        const duration   = Math.round((Date.now() - state.startTime) / 1000);
        const transcript = state.transcript.map(t => `${t.speaker}: ${t.text}`).join("\n");
        await processCallEnd(callId, transcript, duration);
      } else if (isMachine) {
        console.log(`  [AMD] Machine signal NOT confirmed — conf=${amdConfidence.toFixed(2)} (need ≥0.80) | dur=${amdDuration}s (need <25) | sellerTurns=${amdSellerTurns} — treating as human`);
      } else {
        console.log(`  [AMD] Result "${result}" (conf=${amdConfidence.toFixed(2)}) → treating as human, continuing call`);
      }
      break;
    }

    case "call.recording.saved": {
      // Telnyx fires this when the recording is ready — URL expires in 600s so download immediately
      const recUrl = payload.recording_urls?.mp3 || payload.public_recording_url || payload.url || null;
      if (recUrl && callId) {
        const s = callStore.get(callId);
        if (s) { s.recordingUrl = recUrl; callStore.set(callId, s); }
        console.log(`  [Rec] Recording saved: ${recUrl.substring(0, 80)}...`);
        (async () => {
          try {
            // Download MP3 immediately before Telnyx pre-signed URL expires (600s)
            const resp = await fetch(recUrl);
            if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
            const buf  = Buffer.from(await resp.arrayBuffer());
            const fname = `${callId}.mp3`;
            const fpath = path.join(REC_DIR, fname);
            fs.writeFileSync(fpath, buf);
            const permanentUrl = `${webhookBase}/recordings/${fname}`;
            console.log(`  [Rec] ✅ Permanently stored: ${permanentUrl}`);
            await sb.from("jarvis_calls")
              .update({ recording_url: permanentUrl, telnyx_recording_url: recUrl })
              .eq("twilio_call_sid", callControlId);
            // Update GHL note with permanent recording URL
            const recState = callStore.get(callId);
            if (recState?.ghlNoteId && recState?.ghlContactId) {
              try {
                const existingNote = await ghl("GET", `/contacts/${recState.ghlContactId}/notes/${recState.ghlNoteId}`).catch(() => null);
                const existingBody = existingNote?.note?.body || existingNote?.body || "";
                const updatedBody = existingBody.replace("Recording: Recording processing — will update shortly", `Recording: ${permanentUrl}`);
                await ghl("PUT", `/contacts/${recState.ghlContactId}/notes/${recState.ghlNoteId}`, { body: updatedBody, userId: null });
                console.log(`  [Rec] ✅ GHL note updated with recording URL`);
              } catch (ne) {
                console.warn(`  [Rec] ⚠️ Could not update GHL note: ${ne.message}`);
              }
              // Also write recording URL to custom field if configured
              if (GHL_FIELDS.recording_url) {
                try {
                  await ghl("PUT", `/contacts/${recState.ghlContactId}`, { customFields: [{ id: GHL_FIELDS.recording_url, value: permanentUrl }] });
                  console.log(`  [Rec] ✅ GHL recording custom field updated`);
                } catch {}
              }
            }
          } catch (e) {
            console.error(`  [Rec] ❌ Storage failed: ${e.message} — saving expiring URL as fallback`);
            try {
              await sb.from("jarvis_calls")
                .update({ recording_url: recUrl, telnyx_recording_url: recUrl })
                .eq("twilio_call_sid", callControlId);
            } catch {}
          }
        })();
      }
      break;
    }

    case "call.hangup": {
      const state = callStore.get(callId);
      if (!state || state.ended) break; // already handled by AMD or prior hangup
      if (state.silenceTimer) { clearTimeout(state.silenceTimer); state.silenceTimer = null; }
      const duration   = Math.round((Date.now() - state.startTime) / 1000);
      const transcript = state.transcript.map(t => `${t.speaker}: ${t.text}`).join("\n");
      await processCallEnd(callId, transcript, duration);
      break;
    }
  }
});

// ── Internal: trigger approval callback call (called by jarvis-telegram.js) ──
// Track in-flight callback approvalIds to prevent double-dial
const activeCallbacks = new Set();

app.post("/internal/approval-callback", async (req, res) => {
  const { approvalId, offerType, offerAmount, phone, name, address, contactId, oppId } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone required" });
  if (!webhookBase) return res.status(503).json({ error: "Tunnel not ready" });

  // Dedup: prevent double-dial if same approvalId fires twice
  if (approvalId && activeCallbacks.has(approvalId)) {
    console.log(`[Callback] DUPLICATE suppressed for ${approvalId}`);
    return res.json({ ok: true, deduped: true });
  }
  if (approvalId) activeCallbacks.add(approvalId);
  setTimeout(() => activeCallbacks.delete(approvalId), 300_000); // clear after 5min

  // Pull deal data from approval record so David can do the full Script C math breakdown
  let callContext = "";
  try {
    const { data: appr } = approvalId
      ? await sb.from("david_pending_approvals").select("*").eq("id", approvalId).single()
      : { data: null };
    if (appr) {
      const fmt = n => n ? `$${Number(n).toLocaleString()}` : "unknown";
      const arv      = fmt(appr.arv);
      const repairs  = fmt(appr.repair_breakdown ? Object.values(appr.repair_breakdown || {}).join(", ") : appr.repair_estimate);
      const payoff   = fmt(appr.mortgage_payoff);
      const condition = appr.condition_summary || "see previous call notes";
      const motivation = appr.motivation_summary || "motivated seller";
      const score    = appr.motivation_score ? `${appr.motivation_score}/10` : "—";
      const transcript = appr.transcript_snippet ? `\nPrevious call excerpt:\n"${appr.transcript_snippet.slice(-800)}"` : "";

      // Pre-calculate all numbers for the math walkthrough
      const arvNum       = Number(appr.arv) || 0;
      const repairNum    = Number(appr.repair_breakdown
        ? Object.values(appr.repair_breakdown || {}).reduce((a,b) => a + Number(b), 0)
        : appr.repair_estimate) || 0;
      const sellingCosts = arvNum ? `$${Math.round(arvNum * 0.10).toLocaleString()}` : "about 10%";
      const holdingCosts = arvNum ? `$${Math.round(arvNum * 0.04).toLocaleString()}` : "a few thousand";
      // Contrast anchor: what a typical flipper (needing 25% margin) would have to offer
      const typicalFlipperOffer = arvNum
        ? `$${Math.round((arvNum * 0.75) - repairNum - (arvNum * 0.04)).toLocaleString()}`
        : "significantly less";
      // Running total so David can show the math live
      const afterSelling  = arvNum ? `$${Math.round(arvNum * 0.90).toLocaleString()}` : "—";
      const afterRepairs  = (arvNum && repairNum) ? `$${Math.round(arvNum * 0.90 - repairNum).toLocaleString()}` : "—";
      const afterHolding  = (arvNum && repairNum) ? `$${Math.round(arvNum * 0.90 - repairNum - arvNum * 0.04).toLocaleString()}` : "—";

      callContext = `
╔══════════════════════════════════════════════════════════════════╗
║  CRITICAL OVERRIDE — SCRIPT C: OFFER DELIVERY + CLOSE           ║
║  READ THIS ENTIRE BLOCK FIRST. THIS OVERRIDES ALL OTHER RULES.  ║
╚══════════════════════════════════════════════════════════════════╝

THIS IS AN OFFER CALLBACK. DO NOT re-qualify. DO NOT ask about timeline or motivation again.
YOUR ONLY JOB: walk the math → get tie-downs → deliver offer → close.

DEAL NUMBERS:
• ARV: ${arv}
• Selling costs (10%): ${sellingCosts} → leaves ${afterSelling}
• Repairs: ${repairs} → leaves ${afterRepairs}
• Holding costs (4 months): ${holdingCosts} → leaves ${afterHolding}
• What a typical investor would HAVE to offer (needs 25% margin): ${typicalFlipperOffer}
• What WE are approved at: ${offerAmount} (${offerType || "cash"}) ← this is ABOVE typical
• Payoff: ${payoff} | Motivation: ${motivation} (${score}) | Condition: ${condition}
${transcript}

══════════════════════════════════════════════════════════════════
THE SCRIPT — FOLLOW THIS EXACTLY. ONE STEP PER TURN. WAIT FOR RESPONSE EACH TIME.
══════════════════════════════════════════════════════════════════

STEP 1 — OPENER (delivered automatically before first turn):
"Hey [name]! This is David calling back. How are you? So I just got out of a meeting with my purchasing manager and I've got some great news for you on that property. Do you have a couple minutes?"
→ If yes: go to STEP 2. If bad time: "No problem — when's a better time to catch you?"

STEP 2 — SET UP THE MATH:
SAY: "So my manager went over everything on [street name] and he loves it. Before I give you the number, I want to walk you through exactly how we got there — that way it all makes sense. Sound good?"
→ Wait for "sure/yeah/go ahead" → then go to STEP 3A.

STEP 3A — ARV TIE-DOWN:
SAY: "So the first thing we do is figure out what the property would sell for fully renovated, move-in ready — in real estate that's called the ARV, after repair value. We pulled comps in your neighborhood and yours came in at ${arv}. Does that sound about right to you?"
→ Get their "yeah/makes sense" BEFORE going to 3B. If they disagree, say "I can send you the comp report — these are the actual recent sales in your zip code."

STEP 3B — SELLING COSTS TIE-DOWN:
SAY: "Now here's where it gets real — even if you sold it retail through an agent, you'd lose about 10% right off the top. Agent commissions, closing costs, title fees. On ${arv} that's about ${sellingCosts} just walking out the door. You'd actually net ${afterSelling}. Does that make sense?"
→ Get confirmation → go to 3C.

STEP 3C — REPAIRS TIE-DOWN:
SAY: "Then we have to factor in the work to get it there. Our contractor walked through the property and estimated ${repairs} to get it fully market-ready. So now you're down to about ${afterRepairs} before we even talk about profit. Does that track with you?"
→ Get confirmation → go to 3D.

STEP 3D — HOLDING + CONTRAST ANCHOR (this is the key moment):
SAY: "And while all that work is happening — usually 3 to 4 months — there's taxes, insurance, utilities still running. That's another ${holdingCosts} roughly. So now you can see why most investors who flip houses around here, they actually have to come in at like ${typicalFlipperOffer} just to break even with a decent margin. Does that make sense why the numbers work the way they do?"
→ Let them react. They should be surprised at how low ${typicalFlipperOffer} is. → go to STEP 4.

STEP 4 — DELIVER THE OFFER + CONTRAST (say word for word, then GO COMPLETELY SILENT):
SAY: "So here's the thing — we've been doing this a long time and we do a lot of volume, which means our margins are tighter than your average investor. That's what gives us the ability to come in higher than most people can. The number my manager approved for your property is ${offerAmount}. Cash offer, we cover every closing cost, you don't touch a single repair, and we close on whatever timeline works best for you. [PAUSE] What are your thoughts?"
→ STOP TALKING. Do not add anything. Wait for their full response no matter how long the silence.

STEP 5 — HANDLE THEIR RESPONSE:
• They say yes/interested → "Perfect. I just need your email and I can get the purchase agreement sent over tonight. It's a simple two-page doc — completely non-binding until you've reviewed everything. What's the best email for you?"
• They say "that's lower than I expected" → "I hear you — and I get it. What number were you thinking?" [Listen] Then: "I can't change the number right now, that has to go back to my manager. But let me go fight for you and see if I can get it any higher. Can I call you back in about an hour?"
• They give a counter → "Got it. I'm going to take that number back to my manager right now and see what he says. I'll call you back within the hour — is this number still the best way to reach you?"
• They bring up listing with an agent → "Totally an option — but here's the reality: even at full retail, after commissions and repairs you're probably walking away with ${afterRepairs} anyway, and that's if it sells in 30 days with no inspection issues. We're offering you ${offerAmount} guaranteed, in cash, on your schedule. No surprises."
• Way apart (over 20% gap) → "You know what — there's actually a second option I want to share with you. It's called a novation — basically we list the property for you at full retail, do the repairs ourselves, and you get the upside without any of the hassle or cost. You interested in hearing how that works?"
• NEVER negotiate live. NEVER change the number yourself. Always send it "back to manager."

STEP 6 — CLOSE / GET EMAIL:
SAY: "Perfect. I'm sending it right now — you'll have it in your inbox in about 5 minutes. Take a look, and if you have any questions just shoot me a text and I'll get right back to you. Really appreciate you working with us on this."

══════════════════════════════════════════════════════════════════
RULES:
- 2-3 sentences per turn MAX. This is a phone call.
- One step at a time. Say your line. WAIT. Do not rush to the next step.
- Get a tie-down confirmation (yes/sure/makes sense) at EACH math step before proceeding.
- Never reveal ${offerAmount} before completing steps 3A-3D.
- Never negotiate live — always "go back to manager."
══════════════════════════════════════════════════════════════════`;
    }
  } catch {}

  const lead = {
    contactId: contactId || null,
    name:      name || "there",
    firstName: (name || "there").split(" ")[0],
    phone:     phone.replace(/\D/g, "").replace(/^1?(\d{10})$/, "+1$1"),
    address:   address || "your property",
    streetName: (address || "your property").split(",")[0],
    oppId:     oppId || null,
    stageName: "Hot Follow Up",
    tags:      [],
    _offerType:   offerType,
    _offerAmount: offerAmount,
    _isCallback:  true,
    _callContext: callContext,
  };

  console.log(`[Callback] Scheduling approval callback for ${name} at ${phone} — offer ${offerType}: $${offerAmount}`);
  // Call immediately (Telnyx connects within seconds; seller will receive call within 30 min window)
  const callId = await callLead(lead, { isTest: false }).catch(e => { console.error("[callback]", e.message); return null; });
  if (!callId) return res.status(500).json({ error: "callLead failed" });
  res.json({ ok: true, callId });
});

// ── Internal: trigger denial callback call ────────────────────────────────────
app.post("/internal/denial-callback", async (req, res) => {
  const { phone, name, address, contactId, oppId, reason } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone required" });
  if (!webhookBase) return res.status(503).json({ error: "Tunnel not ready" });

  const lead = {
    contactId: contactId || null,
    name:      name || "there",
    firstName: (name || "there").split(" ")[0],
    phone:     phone.replace(/\D/g, "").replace(/^1?(\d{10})$/, "+1$1"),
    address:   address || "your property",
    streetName: (address || "your property").split(",")[0],
    oppId:     oppId || null,
    stageName: "Cold Follow Up",
    tags:      [],
    _isDenialCallback: true,
    _denialReason:     reason || "the numbers didn't quite work out on our end",
  };

  console.log(`[Denial Callback] Scheduling for ${name} at ${phone}`);
  const callId = await callLead(lead, { isTest: false }).catch(e => { console.error("[denial-callback]", e.message); return null; });
  if (!callId) return res.status(500).json({ error: "callLead failed" });
  res.json({ ok: true, callId });
});

// Health check
app.get("/health", (_req, res) => res.json({
  status:      "ok",
  activeCalls: callStore.size,
  phones:      DAVID_PHONES,
  tts:         VOICE_SERVER,
  stt:         LISTEN_SERVER,
}));

// ── Internal: trigger a test call to Chris's number (used by Jarvis Telegram) ─
// ── Instant new-lead dial — fired by alpha-scraper or GHL webhook ──────────────
app.post("/internal/new-lead", async (req, res) => {
  if (!webhookBase) return res.status(503).json({ error: "Tunnel not ready" });

  const { contactId, phone, name, address, oppId, source } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone required" });

  // Respect calling hours (9am–8pm EST, Mon–Sat)
  const now     = new Date();
  const estHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  const estDay  = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
  if (estHour < 9 || estHour >= 20 || estDay === 0) {
    console.log(`[New Lead] Outside hours — will dial at 9am: ${name} (${phone})`);
    await sendTelegram(`📋 <b>New Lead Queued</b>\n${name} | ${address || "—"}\nOutside calling hours — David will dial at 9am EST.`);
    return res.json({ queued: true, reason: "outside calling hours" });
  }

  // Avoid double-dial if already called today
  const todayStart2 = new Date(); todayStart2.setHours(0, 0, 0, 0);
  if (contactId) {
    const { data: todayCalls } = await sb.from("jarvis_calls")
      .select("id").eq("contact_id", contactId).gte("called_at", todayStart2.toISOString()).limit(1);
    if (todayCalls?.length) {
      console.log(`[New Lead] Already called today — skipping: ${name}`);
      return res.json({ skipped: true, reason: "already called today" });
    }
  }

  const cleanPhone = phone.replace(/\D/g, "").replace(/^1?(\d{10})$/, "+1$1");
  const firstName  = (name || "there").split(" ")[0];
  const lead = {
    contactId:  contactId  || null,
    name:       name       || "New Lead",
    firstName,
    phone:      cleanPhone,
    address:    address    || "",
    streetName: (address   || "").split(",")[0] || address || "",
    oppId:      oppId      || null,
    stageName:  "New Lead",
    tags:       [],
  };

  console.log(`\n[New Lead] Instant dial → ${lead.name} (${lead.phone}) | src: ${source || "api"}`);
  await sendTelegram(`🚨 <b>New Lead — Dialing Now</b>\n${lead.name} | ${lead.address || "—"}\n📞 David is calling immediately`);
  res.json({ calling: true, lead: lead.name });

  // Fire the call (non-blocking response already sent)
  await callLead(lead).catch(e => console.error("[New Lead] callLead error:", e.message));
});

app.post("/internal/call-test", async (req, res) => {
  if (!webhookBase) {
    return res.status(503).json({ error: "Server not ready — tunnel not up yet" });
  }
  const testLead = {
    contactId:  null,
    name:       "Chris",
    firstName:  "Chris",
    phone:      process.env.MY_PHONE || "+13479704969",
    address:    "Test Call",
    streetName: "Test",
    oppId:      null,
    stageName:  "New Lead",
    tags:       [],
  };
  const callId = await callLead(testLead, { isTest: true }).catch(e => { console.error("[call-test]", e.message); return null; });
  if (!callId) return res.status(500).json({ error: "callLead failed" });
  res.json({ ok: true, callId });
});

// ── David lock / unlock endpoints ─────────────────────────────────────────────
app.post("/internal/unlock-david", async (req, res) => {
  DAVID_LOCKED = false;
  try {
    await sb.from("agent_status").upsert({ id: "DAVID_LOCKED", status: "false", updated_at: new Date().toISOString() });
  } catch {}
  console.log("[Security] DAVID_LOCKED set to false via unlock endpoint");
  res.json({ ok: true, locked: false });
});

app.post("/internal/lock-david", async (req, res) => {
  DAVID_LOCKED = true;
  try {
    await sb.from("agent_status").upsert({ id: "DAVID_STATUS", status: "paused", updated_at: new Date().toISOString() });
    await sb.from("agent_status").upsert({ id: "DAVID_LOCKED", status: "true", updated_at: new Date().toISOString() });
  } catch {}
  console.log("[Security] DAVID_LOCKED set to true via lock endpoint");
  res.json({ ok: true, locked: true });
});

// ── Extend daily minute budget (+15 min) ──────────────────────────────────────
app.post("/internal/extend-budget", async (req, res) => {
  dailyBudgetCap += 15 * 60;
  try {
    await sb.from("agent_status").upsert({ id: "DAVID_STATUS", status: "active", updated_at: new Date().toISOString() });
  } catch {}
  console.log(`[Budget] Extended to ${Math.round(dailyBudgetCap/60)}m total`);
  res.json({ ok: true, newBudgetMinutes: Math.round(dailyBudgetCap / 60) });
});


// ── Ensure jarvis_calls table ─────────────────────────────────────────────────
async function ensureJarvisCallsTable() {
  const { error } = await sb.from("jarvis_calls").select("id").limit(1);
  if (error) {
    console.log("\n⚠️  Create jarvis_calls table in Supabase SQL editor:");
    console.log(`CREATE TABLE IF NOT EXISTS public.jarvis_calls (
  id                       SERIAL PRIMARY KEY,
  contact_id               TEXT,
  contact_name             TEXT,
  phone                    TEXT,
  address                  TEXT,
  call_duration            INTEGER,
  stage_before             TEXT,
  stage_after              TEXT,
  tags_applied             TEXT,
  summary                  TEXT,
  notes                    TEXT,
  recording_url            TEXT,
  telnyx_recording_url     TEXT,
  twilio_call_sid          TEXT,
  recording_duration       INTEGER,
  transcript_full          TEXT,
  called_at                TIMESTAMPTZ DEFAULT NOW()
);`);
    return false;
  }
  // Try to add columns if table exists but columns are missing
  console.log("[Supabase] jarvis_calls table ✓");
  console.log("[Supabase] Run these to add any missing columns:");
  console.log("  ALTER TABLE public.jarvis_calls ADD COLUMN IF NOT EXISTS recording_url TEXT;");
  console.log("  ALTER TABLE public.jarvis_calls ADD COLUMN IF NOT EXISTS telnyx_recording_url TEXT;");
  console.log("  ALTER TABLE public.jarvis_calls ADD COLUMN IF NOT EXISTS twilio_call_sid TEXT;");
  console.log("  ALTER TABLE public.jarvis_calls ADD COLUMN IF NOT EXISTS recording_duration INTEGER;");
  console.log("  ALTER TABLE public.jarvis_calls ADD COLUMN IF NOT EXISTS transcript_full TEXT;");

  // Also check david_pending_approvals table
  const { error: daErr } = await sb.from("david_pending_approvals").select("id").limit(1);
  if (daErr) {
    console.log("\n⚠️  Create david_pending_approvals table in Supabase SQL editor:");
    console.log(DAVID_PENDING_APPROVALS_SQL);
  } else {
    console.log("[Supabase] david_pending_approvals table ✓");
  }

  return true;
}

// ── Test mode: real call to Chris's number ──────────────────────────────────
async function runTestMode() {
  console.log("\n[TEST] Calling Chris (+13479704969) — ElevenLabs TTS + Claude Haiku\n");

  await loadPipelineStages();
  await ensureJarvisCallsTable();

  const testLead = {
    contactId:  null,
    name:       "Chris",
    firstName:  "Chris",
    phone:      "+13479704969",
    address:    "123 Test Property Lane, Orlando, FL 32801",
    streetName: "Test Property Lane",
    oppId:      null,
    stageName:  "New Lead",
    tags:       [],
  };

  await new Promise(resolve => app.listen(PORT, () => {
    console.log(`[Server] TwiML server on port ${PORT}`);
    resolve();
  }));

  if (!webhookBase) {
    console.log("[Tunnel] Starting cloudflared...");
    webhookBase = await startCloudflaredTunnel(PORT);
  }
  console.log(`[Tunnel] Public URL: ${webhookBase}`);

  // Update Telnyx Call Control App webhook URL to current tunnel
  await updateTelnyxWebhook(webhookBase);

  const callId = await callLead(testLead, { isTest: true });
  if (!callId) {
    console.error("[TEST] Call failed to initiate. Exiting.");
    process.exit(1);
  }

  console.log("\n[TEST] Call in progress — waiting for Telnyx call.hangup webhook...");
  const deadline = Date.now() + 30 * 60 * 1000;
  while (callStore.has(callId) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log("\n╔══════════════════════════════╗");
  console.log("║   TEST CALL COMPLETE ✓       ║");
  console.log("╚══════════════════════════════╝\n");
  process.exit(0);
}

// ── Helper: build a lead from a GHL contact ID ───────────────────────────────
async function leadFromContactId(contactId) {
  const cData   = await ghl("GET", `/contacts/${contactId}`).catch(() => ({}));
  const contact = cData.contact || cData;
  const phone   = contact.phone || contact.primaryPhone;
  if (!phone) { console.log(`[Leads] Contact ${contactId} not found or no phone — skipping.`); return null; }
  const oppsData = await ghl("GET", `/opportunities/search?contact_id=${contactId}&location_id=${GHL_LOCATION}&limit=5`).catch(() => ({}));
  const opp      = (oppsData.opportunities || []).find(o => o.status === "open") || {};
  return {
    contactId,
    name:       contact.name || `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "there",
    firstName:  contact.firstName || (contact.name || "there").split(" ")[0],
    phone:      phone.replace(/\D/g, "").replace(/^1?(\d{10})$/, "+1$1"),
    address:    contact.address1 || "",
    streetName: (contact.address1 || "").split(",")[0] || "",
    oppId:      opp.id   || null,
    stageName:  opp.pipelineStage?.name || "Warm Follow Up",
    tags:       contact.tags || [],
  };
}

// ── Run a batch of calls for given stage priority list ────────────────────────
async function runCallBatch(label, stageList, maxLeads) {
  // ── David activation gate ────────────────────────────────────────────────────
  try {
    const { data: statusRow } = await sb.from("agent_status").select("status").eq("id", "DAVID_STATUS").single();
    if (!statusRow || statusRow.status !== "active") {
      console.log(`[Cron] ${label} — skipped (David not activated. Send 'david on' to Jarvis to start.)`);
      return { total: 0, conversations: 0, hot: 0, voicemails: 0 };
    }
  } catch (e) {
    console.log(`[Cron] ${label} — skipped (agent_status check failed: ${e.message})`);
    return { total: 0, conversations: 0, hot: 0, voicemails: 0 };
  }

  // ── Daily minute budget ──────────────────────────────────────────────────────
  if (dailyCallSeconds >= dailyBudgetCap) {
    console.log(`[Cron] ${label} — skipped (daily ${Math.round(dailyBudgetCap/60)}m budget reached)`);
    return { total: 0, conversations: 0, hot: 0, voicemails: 0 };
  }

  // Never call before 9am or after 8pm EST; never on Sundays
  const now = new Date();
  const estHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  const estDay  = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay(); // 0=Sun
  if (estHour < 9 || estHour >= 20 || estDay === 0) {
    console.log(`[Cron] ${label} — skipped (outside calling hours or Sunday)`);
    return { total: 0, conversations: 0, hot: 0, voicemails: 0 };
  }

  console.log(`\n[Cron] ═══ ${label} ═══`);
  const prevFilter = STAGE_FILTER;
  const batchStart = Date.now();

  // Temporarily override STAGE_PRIORITY for this batch
  const savedPriority = STAGE_PRIORITY.splice(0);
  stageList.forEach((s, i) => STAGE_PRIORITY[i] = s);
  const extraMax = MAX_LEADS;
  // eslint-disable-next-line no-global-assign
  Object.defineProperty(module.exports || {}, "_maxLeads", { value: maxLeads });

  // Per-stage minimum hours between calls
  // Hot: every 24h (daily) | Warm: every 48h (every other day) | Cold: every 72h (every 3 days)
  // New Lead / Attempts: every 20h (once per day, allow 2nd call same day for New Lead only)
  const STAGE_FREQUENCY_HOURS = {
    "Hot Follow Up":           10,  // twice daily — 9am + 6pm/7pm close window
    "Warm Follow Up":          48,  // every 2 days
    "Cold Follow Up":          72,  // every 3 days
    "New Lead":                20,  // once per day — up to 4x across 7 daily windows
    "Attempt 1 No Contact":    20,  // once per day — keep hitting until they answer
    "Attempt 2 No Contact":    20,
    "Attempt 3-5 No Contact":  20,
    "Attempt 6+ Unresponsive": 9999, // never call again
    "Attempt 1":               20,
  };

  // Build a map of contactId → count of calls made today (for max-2-per-day rule)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  let callsTodayMap = {};  // contactId → number of calls today
  let recentCallMap = {};  // contactId → timestamp of last call (ISO string)
  try {
    const { data: recentRows } = await sb
      .from("jarvis_calls")
      .select("contact_id, called_at")
      .gte("called_at", new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()); // last 72h covers Cold
    for (const row of recentRows || []) {
      const cid = row.contact_id;
      if (!cid) continue;
      // Count calls today
      if (new Date(row.called_at) >= todayStart) {
        callsTodayMap[cid] = (callsTodayMap[cid] || 0) + 1;
      }
      // Track most recent call time
      if (!recentCallMap[cid] || row.called_at > recentCallMap[cid]) {
        recentCallMap[cid] = row.called_at;
      }
    }
  } catch {}

  const leads = [];

  for (const stageName of stageList) {
    if (leads.length >= maxLeads) break;
    const stageId = STAGE_IDS[stageName];
    if (!stageId) continue;
    const freqHours = STAGE_FREQUENCY_HOURS[stageName] ?? 24;
    const freqMs    = freqHours * 60 * 60 * 1000;

    let page = 1;
    while (leads.length < maxLeads) {
      const data = await ghl("GET", `/opportunities/search?pipeline_id=${GHL_PIPELINE}&location_id=${GHL_LOCATION}&pipeline_stage_id=${stageId}&limit=20&page=${page}`);
      const opps = data.opportunities || [];
      if (!opps.length) break;
      for (const opp of opps) {
        if (leads.length >= maxLeads) break;
        const contact = opp.contact || {};
        const phone   = contact.phone || contact.primaryPhone;
        if (!phone) continue;

        const cid = contact.id;

        // New Leads + Attempts: up to 4x/day (3h cooldown across 7 windows)
        // Hot: 2x/day (morning + evening close) | Warm/Cold: 1x/day
        const dailyCap = stageName === "Hot Follow Up" ? 2 : 1; // max 1 call/day per lead (2 for hot only)
        if ((callsTodayMap[cid] || 0) >= dailyCap) continue;

        // Per-stage frequency: skip if called too recently for this stage
        const lastCalled = recentCallMap[cid];
        if (lastCalled && (Date.now() - new Date(lastCalled).getTime()) < freqMs) continue;

        // VA leads only — must have "alpha-leads" tag
        const contactTags = (contact.tags || []).map(t => (t || "").toLowerCase());
        if (!contactTags.includes("alpha-leads")) continue;

        let address = contact.address1 || "";
        const addrField = (opp.customFields || []).find(f => f.id === "SGJdYcttaxyiWDHydcc6");
        if (addrField?.fieldValueString) address = addrField.fieldValueString;
        leads.push({
          contactId: cid, name: contact.name || "there",
          firstName: contact.firstName || (contact.name || "there").split(" ")[0],
          phone: phone.replace(/\D/g, "").replace(/^1?(\d{10})$/, "+1$1"),
          address, streetName: address.split(",")[0] || address,
          oppId: opp.id, stageName, tags: contact.tags || [],
        });
      }
      if (opps.length < 20) break;
      page++;
    }
  }

  // Restore
  STAGE_PRIORITY.splice(0); savedPriority.forEach((s, i) => STAGE_PRIORITY[i] = s);

  if (!leads.length) {
    console.log(`[Cron] ${label} — no eligible leads`);
    return { total: 0, conversations: 0, hot: 0, voicemails: 0 };
  }

  await sendTelegram(`📞 <b>${label}</b>: Calling ${leads.length} leads...`);

  for (const lead of leads) {
    await callLead(lead);
    if (leads.length > 1) await new Promise(r => setTimeout(r, 15000));
  }

  // Wait for calls to finish (max 60 min)
  const deadline = Date.now() + 60 * 60 * 1000;
  while (callStore.size > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
  }
  await new Promise(r => setTimeout(r, 8000)); // grace for DB writes

  // Tally results
  let batchCalls = [];
  try {
    const res = await sb.from("jarvis_calls")
      .select("stage_after, call_duration")
      .gte("called_at", new Date(batchStart).toISOString());
    batchCalls = res.data || [];
  } catch {}
  const results = batchCalls;
  return {
    total:         results.length,
    conversations: results.filter(c => (c.call_duration || 0) > 30).length,
    hot:           results.filter(c => c.stage_after === "Hot Follow Up").length,
    voicemails:    results.filter(c => (c.call_duration || 0) <= 25).length,
  };
}

// ── EOD Report ────────────────────────────────────────────────────────────────
async function sendEodReport() {
  try {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const [
      { data: todayCalls },
      { count: pendingApprovals },
    ] = await Promise.all([
      sb.from("jarvis_calls").select("stage_after, call_duration, called_at").gte("called_at", todayStart.toISOString()),
      sb.from("david_pending_approvals").select("*", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    const calls   = todayCalls || [];
    const convos  = calls.filter(c => (c.call_duration || 0) > 30).length;
    const hot     = calls.filter(c => c.stage_after === "Hot Follow Up").length;
    const warm    = calls.filter(c => c.stage_after === "Warm Follow Up").length;
    const vms     = calls.filter(c =>
      (c.call_duration || 0) <= 20 &&
      ["Attempt 1 No Contact","Attempt 2 No Contact","Attempt 3-5 No Contact","Attempt 6+ Unresponsive"].includes(c.stage_after)
    ).length;
    const costEst = (calls.length * 0.11).toFixed(2);

    // Count leads pending follow up (Warm + Hot in GHL)
    const hotWarmFollowUp = warm + hot;

    await sendTelegram(
      `📊 <b>DAVID DAILY REPORT</b>\n` +
      `─────────────────────\n` +
      `📞 Calls made today: ${calls.length}\n` +
      `🤝 Conversations: ${convos}\n` +
      `🔥 Hot leads found: ${hot}\n` +
      `🟡 Warm leads: ${warm}\n` +
      `📵 Voicemails: ${vms}\n` +
      `💵 Est. cost today: $${costEst}\n` +
      `─────────────────────\n` +
      `📋 Leads pending follow up: ${hotWarmFollowUp}\n` +
      `⏳ Hot leads awaiting approval: ${pendingApprovals ?? 0}\n` +
      `─────────────────────\n` +
      `Tomorrow's schedule: 9am, 1pm, 5:30pm EST (Mon–Sat)`
    );
  } catch (e) {
    console.error("[EOD Report]", e.message);
  }
}

// ── Cron scheduler (daemon mode only) ────────────────────────────────────────
function setupCronJobs() {
  // ── 9:00am EST Mon–Sat ────────────────────────────────────────────────────
  // Hot (daily) → Warm (every 2 days) → New Lead (up to 2x/day) → Cold (every 3 days)
  cron.schedule("0 9 * * 1-6", async () => {
    try {
      await runCallBatch("9am — Hot Follow Up", ["Hot Follow Up"], 15);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("9am — Warm Follow Up", ["Warm Follow Up"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("9am — New Leads", ["New Lead"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("9am — Cold Follow Up", ["Cold Follow Up"], 5);
    } catch (e) { console.error("[Cron 9am]", e.message); }
  }, { timezone: "America/New_York" });

  // ── 11:00am EST Mon–Sat ───────────────────────────────────────────────────
  // New Leads 2nd window + Attempts (mid-morning re-dial)
  cron.schedule("0 11 * * 1-6", async () => {
    try {
      await runCallBatch("11am — New Leads", ["New Lead"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("11am — Attempt 1", ["Attempt 1 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("11am — Attempt 2", ["Attempt 2 No Contact"], 10);
    } catch (e) { console.error("[Cron 11am]", e.message); }
  }, { timezone: "America/New_York" });

  // ── 1:00pm EST Mon–Sat ────────────────────────────────────────────────────
  // New Leads → Attempt 1 → Attempt 2 → Attempt 3-5
  cron.schedule("0 13 * * 1-6", async () => {
    try {
      await runCallBatch("1pm — New Leads", ["New Lead"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("1pm — Attempt 1", ["Attempt 1 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("1pm — Attempt 2", ["Attempt 2 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("1pm — Attempt 3-5", ["Attempt 3-5 No Contact"], 10);
    } catch (e) { console.error("[Cron 1pm]", e.message); }
  }, { timezone: "America/New_York" });

  // ── 3:00pm EST Mon–Sat ────────────────────────────────────────────────────
  // New Leads + Attempts afternoon push (3h since 11am/1pm, eligible again)
  cron.schedule("0 15 * * 1-6", async () => {
    try {
      await runCallBatch("3pm — New Leads", ["New Lead"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("3pm — Attempt 1", ["Attempt 1 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("3pm — Attempt 2", ["Attempt 2 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("3pm — Attempt 3-5", ["Attempt 3-5 No Contact"], 10);
    } catch (e) { console.error("[Cron 3pm]", e.message); }
  }, { timezone: "America/New_York" });

  // ── 5:00pm EST Mon–Sat ────────────────────────────────────────────────────
  // Warm follow-ups (2-day window) + New Leads evening push + Attempts
  cron.schedule("0 17 * * 1-6", async () => {
    try {
      await runCallBatch("5pm — Warm Follow Up", ["Warm Follow Up"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("5pm — New Leads", ["New Lead"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("5pm — Attempt 1", ["Attempt 1 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("5pm — Attempt 2", ["Attempt 2 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("5pm — Attempt 3-5", ["Attempt 3-5 No Contact"], 10);
    } catch (e) { console.error("[Cron 5pm]", e.message); }
  }, { timezone: "America/New_York" });

  // ── 6:00pm EST Mon–Sat ────────────────────────────────────────────────────
  // Hot leads 2nd touch (prime close window — sellers home from work)
  cron.schedule("0 18 * * 1-6", async () => {
    try {
      await runCallBatch("6pm — Hot Follow Up", ["Hot Follow Up"], 15);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("6pm — New Leads", ["New Lead"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("6pm — Attempt 1", ["Attempt 1 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("6pm — Attempt 2", ["Attempt 2 No Contact"], 10);
    } catch (e) { console.error("[Cron 6pm]", e.message); }
  }, { timezone: "America/New_York" });

  // ── 7:00pm EST Mon–Sat ────────────────────────────────────────────────────
  // Last push of the day — Hot final close + any remaining New Leads
  cron.schedule("0 19 * * 1-6", async () => {
    try {
      await runCallBatch("7pm — Hot Follow Up", ["Hot Follow Up"], 15);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("7pm — New Leads", ["New Lead"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("7pm — Attempt 1", ["Attempt 1 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("7pm — Attempt 2", ["Attempt 2 No Contact"], 10);
      await new Promise(r => setTimeout(r, 90_000));
      await runCallBatch("7pm — Attempt 3-5", ["Attempt 3-5 No Contact"], 10);
    } catch (e) { console.error("[Cron 7pm]", e.message); }
  }, { timezone: "America/New_York" });

  // ── 8:00pm EST Mon–Sat: auto-deactivate David + EOD report ──────────────
  cron.schedule("0 20 * * 1-6", async () => {
    try {
      await sb.from("agent_status").upsert({ id: "DAVID_STATUS", status: "paused", updated_at: new Date().toISOString() });
      console.log("[Cron] 8pm — David auto-deactivated for the night.");
    } catch {}
    dailyCallSeconds = 0;
    dailyBudgetCap   = DAILY_BUDGET_DEFAULT;
    sendEodReport().catch(console.error);
  }, { timezone: "America/New_York" });

  // ── Every 30 min: alpha-scraper watchdog ─────────────────────────────────
  cron.schedule("*/30 * * * *", () => {
    exec("source ~/.nvm/nvm.sh && pm2 jlist 2>/dev/null", { shell: "/bin/bash" }, (err, stdout) => {
      try {
        const list = JSON.parse(stdout || "[]");
        const proc = list.find(p => p.name === "alpha-scraper");
        if (!proc || proc.pm2_env?.status !== "online") {
          console.log("[Watchdog] alpha-scraper not running — restarting...");
          exec("source ~/.nvm/nvm.sh && pm2 restart alpha-scraper", { shell: "/bin/bash" }, () => {});
        }
      } catch {}
    });
  });

  console.log("[Cron] Schedule active (Mon–Sat EST):");
  console.log("  9:00am  → Hot + Warm + New Leads + Cold");
  console.log("  11:00am → New Leads + Attempt 1 + Attempt 2");
  console.log("  1:00pm  → New Leads + Attempt 1 + Attempt 2 + Attempt 3-5");
  console.log("  3:00pm  → New Leads + Attempt 1 + Attempt 2 + Attempt 3-5");
  console.log("  5:00pm  → Warm + New Leads + Attempt 1 + Attempt 2 + Attempt 3-5");
  console.log("  6:00pm  → Hot (close) + New Leads + Attempt 1 + Attempt 2");
  console.log("  7:00pm  → Hot (final) + New Leads + Attempt 1 + Attempt 2 + Attempt 3-5");
  console.log("  8:00pm  → EOD Report");
  console.log("  */30m   → alpha-scraper watchdog");
  console.log("");
  console.log("  Frequency rules:");
  console.log("  Hot=daily | Warm=every 2 days | Cold=every 3 days | Attempts=daily | Max 2 calls/lead/day");
}

// ── Startup catch-up: run any cron window missed in last 45 min ───────────────
async function runMissedWindows() {
  const now    = new Date();
  const estNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h      = estNow.getHours();
  const m      = estNow.getMinutes();
  const day    = estNow.getDay(); // 0=Sun
  if (day === 0 || h < 9 || h >= 20) return; // outside calling window

  // Windows: { hour, batches }
  const WINDOWS = [
    { hour: 9,  batches: [
      ["9am — Hot Follow Up",  ["Hot Follow Up"],         15],
      ["9am — Warm Follow Up", ["Warm Follow Up"],        10],
      ["9am — New Leads",      ["New Lead"],              10],
      ["9am — Cold Follow Up", ["Cold Follow Up"],         5],
    ]},
    { hour: 11, batches: [
      ["11am — New Leads",  ["New Lead"],                 10],
      ["11am — Attempt 1",  ["Attempt 1 No Contact"],    10],
      ["11am — Attempt 2",  ["Attempt 2 No Contact"],    10],
    ]},
    { hour: 13, batches: [
      ["1pm — New Leads",   ["New Lead"],                 10],
      ["1pm — Attempt 1",   ["Attempt 1 No Contact"],    10],
      ["1pm — Attempt 2",   ["Attempt 2 No Contact"],    10],
      ["1pm — Attempt 3-5", ["Attempt 3-5 No Contact"],  10],
    ]},
    { hour: 15, batches: [
      ["3pm — New Leads",   ["New Lead"],                 10],
      ["3pm — Attempt 1",   ["Attempt 1 No Contact"],    10],
      ["3pm — Attempt 2",   ["Attempt 2 No Contact"],    10],
      ["3pm — Attempt 3-5", ["Attempt 3-5 No Contact"],  10],
    ]},
    { hour: 17, batches: [
      ["5pm — Warm Follow Up", ["Warm Follow Up"],        10],
      ["5pm — New Leads",      ["New Lead"],              10],
      ["5pm — Attempt 1",      ["Attempt 1 No Contact"], 10],
      ["5pm — Attempt 2",      ["Attempt 2 No Contact"], 10],
      ["5pm — Attempt 3-5",    ["Attempt 3-5 No Contact"],10],
    ]},
    { hour: 18, batches: [
      ["6pm — Hot Follow Up",  ["Hot Follow Up"],         15],
      ["6pm — New Leads",      ["New Lead"],              10],
      ["6pm — Attempt 1",      ["Attempt 1 No Contact"], 10],
      ["6pm — Attempt 2",      ["Attempt 2 No Contact"], 10],
    ]},
    { hour: 19, batches: [
      ["7pm — Hot Follow Up",  ["Hot Follow Up"],         15],
      ["7pm — New Leads",      ["New Lead"],              10],
      ["7pm — Attempt 1",      ["Attempt 1 No Contact"], 10],
      ["7pm — Attempt 2",      ["Attempt 2 No Contact"], 10],
      ["7pm — Attempt 3-5",    ["Attempt 3-5 No Contact"],10],
    ]},
  ];

  // Find any window that fired in the last 45 minutes
  for (const w of WINDOWS) {
    const minutesSinceWindow = (h - w.hour) * 60 + m;
    if (minutesSinceWindow > 0 && minutesSinceWindow <= 60) {
      console.log(`\n[Catch-up] Missed ${w.hour}:00 window (${minutesSinceWindow}m ago) — running now`);
      await sendTelegram(`⚡ <b>Catch-up</b>: Missed ${w.hour}:00 window — running ${w.batches.length} batches now`).catch(() => {});
      for (const [label, stages, max] of w.batches) {
        await runCallBatch(label, stages, max).catch(e => console.error(`[Catch-up] ${label}:`, e.message));
        await new Promise(r => setTimeout(r, 90_000));
      }
      break; // only catch up the most recent missed window
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const SINGLE      = process.argv.includes("--one");
  const TEST_MODE   = process.argv.includes("--test");
  const DAEMON_MODE = !TEST_MODE && !SINGLE && !PHONE_FLAG && !CONTACT_ID_FLAG && !CONTACT_IDS_FLAG.length && !STAGE_FILTER && !IS_WHOLESALERS;

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   JARVIS CALLER — Telnyx TTS AI Dialer     ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`From: ${DAVID_PHONES.join(", ")}  |  TTS: ElevenLabs (${EL_VOICE_ID})  |  Carrier: Telnyx`);
  const modeLabel = TEST_MODE ? "TEST" : DAEMON_MODE ? "DAEMON (cron scheduler)" : PHONE_FLAG ? `DIRECT DIAL (${PHONE_FLAG})` : CONTACT_IDS_FLAG.length ? `TARGETED (${CONTACT_IDS_FLAG.length} contacts)` : CONTACT_ID_FLAG ? "SINGLE CONTACT" : SINGLE ? "SINGLE (1 lead)" : `LIVE (up to ${MAX_LEADS} leads)`;
  console.log(`Mode: ${modeLabel}\n`);

  if (TEST_MODE) return runTestMode();

  await loadPipelineStages();
  await loadCustomFieldIds();
  await loadCoachingRules();
  await ensureJarvisCallsTable();

  // ── Start Express + tunnel (all non-test modes) ───────────────────────────
  await new Promise(resolve => app.listen(PORT, () => {
    console.log(`[Server] Webhook server on port ${PORT}`);
    resolve();
  }));

  if (webhookBase) {
    console.log(`[Tunnel] Using static webhook URL: ${webhookBase}`);
  } else {
    console.log("[Tunnel] Starting cloudflared...");
    webhookBase = await startCloudflaredTunnel(PORT);
    console.log(`[Tunnel] Public URL: ${webhookBase}`);
  }
  await updateTelnyxWebhook(webhookBase);


  // ── DAEMON MODE: stay alive, run on schedule ───────────────────────────────
  if (DAEMON_MODE) {
    setupCronJobs();
    await sendTelegram(`🤖 <b>David Caller Online</b>\nDaemon mode active. Schedule: 9am 11am 1pm 3pm 5pm 6pm 7pm EST (Mon–Sat).`);
    // Catch up any missed window from the last 45 min (handles restarts mid-window)
    runMissedWindows().catch(e => console.error("[Catch-up] Error:", e.message));
    // Keep process alive
    return new Promise(() => {}); // never resolves
  }

  // ── ONE-SHOT MODES (--one, --contactId, --phone, --stage, --wholesalers) ──
  let leads;
  if (PHONE_FLAG) {
    console.log(`[Leads] Direct dial to ${PHONE_FLAG} — skipping GHL.`);
    leads = [{ contactId: null, name: "there", firstName: "there", phone: PHONE_FLAG, address: "", streetName: "", oppId: null, stageName: "Direct Dial", tags: [] }];
  } else if (CONTACT_IDS_FLAG.length > 0) {
    console.log(`[Leads] Targeting ${CONTACT_IDS_FLAG.length} specific contact(s)...`);
    const resolved = await Promise.all(CONTACT_IDS_FLAG.map(leadFromContactId));
    leads = resolved.filter(Boolean);
  } else if (CONTACT_ID_FLAG) {
    const lead = await leadFromContactId(CONTACT_ID_FLAG);
    leads = lead ? [lead] : [];
    if (!leads.length) process.exit(1);
  } else {
    const allLeads = await fetchLeads();
    leads = SINGLE ? allLeads.slice(0, 1) : allLeads;
  }

  if (!leads.length) {
    console.log("\n[Leads] No eligible leads found. Exiting.\n");
    await sendTelegram("📞 <b>Jarvis Caller</b>: No eligible leads for this run.");
    process.exit(0);
  }

  console.log(`\n[Dialer] Initiating ${leads.length} call(s)...\n`);
  await sendTelegram(`📞 <b>Jarvis Caller Starting</b>\nCalling ${leads.length} lead(s) via Telnyx + ElevenLabs TTS`);

  for (const lead of leads) {
    await callLead(lead);
    if (leads.length > 1) await new Promise(r => setTimeout(r, 15000));
  }

  console.log("\n[Wait] Calls in progress — waiting for Telnyx webhooks...");
  const deadline = Date.now() + 60 * 60 * 1000;
  while (callStore.size > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
  }
  if (callStore.size > 0) console.warn(`[Timeout] ${callStore.size} call(s) still pending after 60 min.`);

  await new Promise(r => setTimeout(r, 8000));
  console.log("\n╔══════════════════════════════╗");
  console.log("║    JARVIS CALLER DONE ✓      ║");
  console.log("╚══════════════════════════════╝\n");
  process.exit(0);
}

main().catch(e => {
  console.error("\n[Fatal]", e.message);
  process.exit(1);
});
