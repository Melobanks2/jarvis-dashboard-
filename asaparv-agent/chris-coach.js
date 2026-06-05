/**
 * chris-coach.js — Personal call coaching for Chris Lovera
 *
 * - Polls jarvis_calls every 2 minutes for new Chris calls (caller='chris')
 * - Within 5 min of call ending: sends full coaching breakdown via Telegram
 * - Sunday 7pm: weekly progress report
 * - Weekday 11am: accountability nudge if no calls logged yet
 * - 48h check: stronger nudge if no calls in 2 days
 * - Exposes coachChrisCall() so jarvis-telegram.js can trigger immediately on "log call"
 *
 * PM2: chris-coach — persistent, autorestart
 *
 * Supabase DDL (run in dashboard before starting):
 *   ALTER TABLE jarvis_calls ADD COLUMN IF NOT EXISTS caller TEXT DEFAULT 'david';
 *   ALTER TABLE jarvis_calls ADD COLUMN IF NOT EXISTS coached_at TIMESTAMPTZ;
 *   CREATE TABLE IF NOT EXISTS chris_scripts (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     title TEXT, content TEXT, created_at TIMESTAMPTZ DEFAULT now()
 *   );
 *   CREATE TABLE IF NOT EXISTS chris_coaching_log (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     call_id TEXT, call_date DATE, contact_name TEXT,
 *     assertiveness INT, empathy INT, motivation_digging INT, objection_handling INT, overall INT,
 *     grade TEXT, deal_probability INT, did_well TEXT[], improve TEXT[],
 *     focus_next TEXT, script_adherence INT, summary TEXT,
 *     created_at TIMESTAMPTZ DEFAULT now()
 *   );
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { aiChat }       = require("./ai-router");
const TelegramBot      = require("node-telegram-bot-api");

const sb      = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot     = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || "8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0", { polling: false });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "8105811341";
const CHRIS_PHONE = process.env.MY_PHONE || "+13479704969";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendTelegram(text) {
  try {
    await bot.sendMessage(CHAT_ID, text, { parse_mode: "Markdown" });
  } catch {
    try { await bot.sendMessage(CHAT_ID, text.replace(/[*_`[\]()~>#+=|{}.!-]/g, "\\$&")); } catch {}
  }
}

async function getLatestScript() {
  try {
    const { data } = await sb
      .from("chris_scripts")
      .select("title, content")
      .order("created_at", { ascending: false })
      .limit(1);
    return data?.[0] || null;
  } catch { return null; }
}

function gradeFromScore(score) {
  if (score >= 9) return "A+";
  if (score >= 8) return "A";
  if (score >= 7) return "B+";
  if (score >= 6) return "B";
  if (score >= 5) return "C+";
  if (score >= 4) return "C";
  return "D";
}

// ── Core: analyze one Chris call and send Telegram coaching ──────────────────

async function coachChrisCall(call) {
  const contactName = call.contact_name || "Seller";
  const address     = call.address     || "unknown property";
  const transcript  = call.transcript_full || call.notes || call.summary || "";
  const callTime    = call.called_at
    ? new Date(call.called_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })
    : "unknown time";

  // Fetch Chris's saved script for comparison
  const script = await getLatestScript();

  const systemPrompt = `You are a high-performance wholesale real estate sales coach.
Chris Lovera is learning to do acquisition calls himself. He targets distressed sellers in FL, offering cash at 60-70% ARV minus repairs.
David's scripts focus on: motivation discovery → commitment check → property basics → money talk → next steps.
Be direct, specific, and tough but encouraging. Real coaches don't sugarcoat.`;

  const hasTranscript = transcript.length > 80;
  const dataLabel     = hasTranscript ? "CALL TRANSCRIPT" : "CALL NOTES";

  const scriptSection = script
    ? `\n\nCHRIS'S SAVED SCRIPT (for comparison):\n${script.content.slice(0, 800)}`
    : "";

  const userMsg = `Coach Chris on this call with ${contactName} about ${address}.

${dataLabel}:
${transcript || "No details provided."}${scriptSection}

Respond in EXACTLY this JSON format (no extra text):
{
  "did_well": ["specific thing 1", "specific thing 2"],
  "lost_momentum_moment": "exact quote or moment where Chris lost control",
  "say_instead": "better alternative phrase",
  "assertiveness": 7,
  "empathy": 6,
  "motivation_digging": 5,
  "objection_handling": 6,
  "overall": 6,
  "focus_next": "one specific thing to improve on the very next call",
  "deal_probability": 45,
  "deal_status": "one sentence — is this lead still alive and what is the next move",
  "script_adherence": 70,
  "script_deviation": "where Chris went off script (or 'N/A' if no script saved)",
  "on_script_alternative": "how staying on script would have sounded (or 'N/A')"
}`;

  let analysis;
  try {
    const res = await aiChat({
      system:     systemPrompt,
      messages:   [{ role: "user", content: userMsg }],
      max_tokens: 700,
    });
    const raw = res.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    analysis = JSON.parse(raw);
  } catch (e) {
    console.error("[chris-coach] Analysis parse error:", e.message);
    // Send minimal coaching if Llama fails
    await sendTelegram(`🎯 *CALL COACHING — ${contactName}*\n\nCall logged at ${callTime}.\n_Analysis unavailable — check logs._`);
    return;
  }

  const grade   = gradeFromScore(analysis.overall);
  const scoreBar = (n) => "▓".repeat(Math.round(n)) + "░".repeat(10 - Math.round(n));

  const msg =
`🎯 *CALL COACHING — ${contactName} — ${callTime}*

✅ *What you did well:*
${(analysis.did_well || []).map(d => `• ${d}`).join("\n") || "• Keep recording more calls for better feedback"}

⚠️ *Where you lost momentum:*
${analysis.lost_momentum_moment || "Not identified"}

💬 *Say this instead:*
_"${analysis.say_instead || "N/A"}"_

📊 *Scores:*
Assertiveness:     ${analysis.assertiveness}/10  ${scoreBar(analysis.assertiveness)}
Empathy:           ${analysis.empathy}/10  ${scoreBar(analysis.empathy)}
Motivation digging:${analysis.motivation_digging}/10  ${scoreBar(analysis.motivation_digging)}
Objection handling:${analysis.objection_handling}/10  ${scoreBar(analysis.objection_handling)}
Overall:           ${analysis.overall}/10 — *${grade}*

🎯 *Focus on this next call:*
${analysis.focus_next}

💰 *Deal probability: ${analysis.deal_probability}%*
${analysis.deal_status}${script ? `

📋 *Script adherence: ${analysis.script_adherence}%*
Off script: ${analysis.script_deviation}
On script would sound like: _"${analysis.on_script_alternative}"_` : ""}`;

  await sendTelegram(msg);
  console.log(`[chris-coach] Coached: ${contactName} | Overall: ${analysis.overall}/10`);

  // Save to chris_coaching_log
  try {
    await sb.from("chris_coaching_log").insert({
      call_id:            String(call.id || "manual"),
      call_date:          new Date().toISOString().slice(0, 10),
      contact_name:       contactName,
      assertiveness:      analysis.assertiveness,
      empathy:            analysis.empathy,
      motivation_digging: analysis.motivation_digging,
      objection_handling: analysis.objection_handling,
      overall:            analysis.overall,
      grade,
      deal_probability:   analysis.deal_probability,
      did_well:           analysis.did_well || [],
      improve:            [analysis.lost_momentum_moment].filter(Boolean),
      focus_next:         analysis.focus_next,
      script_adherence:   analysis.script_adherence || null,
      summary:            analysis.deal_status,
    });
  } catch (e) { console.error("[chris-coach] Log insert:", e.message); }

  // Mark call as coached
  try {
    if (call.id) {
      await sb.from("jarvis_calls").update({ coached_at: new Date().toISOString() }).eq("id", call.id);
    }
  } catch {}
}

// ── Polling: detect new uncoached Chris calls ─────────────────────────────────

let pollingActive = false;

async function pollForChrisCalls() {
  if (pollingActive) return;
  pollingActive = true;
  try {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // last 15 min

    const { data: calls } = await sb
      .from("jarvis_calls")
      .select("*")
      .eq("caller", "chris")
      .is("coached_at", null)
      .gte("called_at", since)
      .order("called_at", { ascending: false });

    for (const call of calls || []) {
      console.log(`[chris-coach] New Chris call detected: ${call.contact_name}`);
      // Mark coached immediately to prevent re-processing
      await sb.from("jarvis_calls").update({ coached_at: new Date().toISOString() }).eq("id", call.id);
      await coachChrisCall(call);
    }
  } catch (e) {
    console.error("[chris-coach] Poll error:", e.message);
  } finally {
    pollingActive = false;
  }
}

// ── Weekly Sunday 7pm coaching report ────────────────────────────────────────

async function sendWeeklyCoachingReport() {
  console.log("[chris-coach] Generating weekly coaching report...");

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data: logs } = await sb
    .from("chris_coaching_log")
    .select("*")
    .gte("call_date", weekAgo)
    .order("created_at", { ascending: true });

  const calls = logs || [];
  if (calls.length === 0) {
    await sendTelegram("📊 *WEEKLY COACHING REPORT*\n\nNo Chris calls logged this week. Time to get on the phones.");
    return;
  }

  const avg = (key) => calls.length ? +(calls.reduce((s, c) => s + (c[key] || 0), 0) / calls.length).toFixed(1) : 0;

  const avgAssert = avg("assertiveness");
  const avgEmpathy = avg("empathy");
  const avgMotiv  = avg("motivation_digging");
  const avgObj    = avg("objection_handling");
  const avgOverall = avg("overall");

  const bestCall  = [...calls].sort((a, b) => (b.overall || 0) - (a.overall || 0))[0];
  const worstCall = [...calls].sort((a, b) => (a.overall || 0) - (b.overall || 0))[0];

  const scores = ["assertiveness", "empathy", "motivation_digging", "objection_handling"];
  const avgScores = scores.map(k => ({ key: k, avg: avg(k) }));
  const bestArea  = avgScores.sort((a, b) => b.avg - a.avg)[0];
  const weakArea  = [...avgScores].sort((a, b) => a.avg - b.avg)[0];

  const systemPrompt = `You are Chris Lovera's personal call coach. Be direct, specific, and tactical. Chris is building acquisition skills for wholesale real estate.`;

  const improvementData = calls.map(c => c.improve?.[0] || "").filter(Boolean).slice(0, 5).join("; ");
  const focusAreas = calls.map(c => c.focus_next || "").filter(Boolean).slice(0, 5).join("; ");

  const userMsg = `Generate Chris's weekly call coaching report.

DATA:
- Calls this week: ${calls.length}
- Avg assertiveness: ${avgAssert}/10 (prev benchmark ~6.5)
- Avg empathy: ${avgEmpathy}/10
- Avg motivation digging: ${avgMotiv}/10
- Avg objection handling: ${avgObj}/10
- Avg overall: ${avgOverall}/10
- Best call: ${bestCall?.contact_name || "?"} scored ${bestCall?.overall || "?"}/10
- Worst call: ${worstCall?.contact_name || "?"} scored ${worstCall?.overall || "?"}/10
- Common improvement moments: ${improvementData || "not tracked"}
- Recurring focus areas from coaching: ${focusAreas || "none"}

Generate a coaching report with:
1. Header with call count and weekly grade
2. Score trends for each metric (vs last week if you can estimate)
3. Most improved area this week with specific praise
4. Biggest weakness still — be specific and direct
5. Best call breakdown — what made it great
6. Worst call — specific thing to do differently
7. ONE specific drill to practice before next week (e.g., practice objection response out loud 10x)

Max 350 words. Be a real coach.`;

  try {
    const res = await aiChat({
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
      max_tokens: 700,
    });
    await sendTelegram(`📊 *WEEKLY COACHING REPORT*\n\n${res.text}`);
  } catch (e) {
    await sendTelegram(`📊 *WEEKLY COACHING — SUMMARY*\n\nCalls: ${calls.length}\nAvg score: ${avgOverall}/10\nBest: ${bestCall?.contact_name} (${bestCall?.overall}/10)\nWeakest area: ${weakArea.key.replace(/_/g, " ")}`);
  }
}

// ── Accountability nudge system ───────────────────────────────────────────────

async function checkAccountability() {
  const now = new Date();
  const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const estHour = estTime.getHours();
  const estMin  = estTime.getMinutes();
  const estDay  = estTime.getDay(); // 0=Sun, 6=Sat

  // Only on weekdays
  if (estDay === 0 || estDay === 6) return;

  // 11am check — no calls today yet
  if (estHour === 11 && estMin < 3) {
    const flagFile = `/tmp/acct_nudge_${estTime.toLocaleDateString("en-US").replace(/\//g, "-")}.flag`;
    const fs = require("fs");
    if (fs.existsSync(flagFile)) return;

    const todayStart = new Date(estTime); todayStart.setHours(0, 0, 0, 0);
    const { data: todayCalls } = await sb
      .from("jarvis_calls")
      .select("id")
      .eq("caller", "chris")
      .gte("called_at", todayStart.toISOString());

    if (todayCalls && todayCalls.length === 0) {
      fs.writeFileSync(flagFile, "1");

      // Get month progress for deal goal context
      const monthStart = new Date(estTime.getFullYear(), estTime.getMonth(), 1).toISOString();
      const { data: monthCalls } = await sb
        .from("jarvis_calls")
        .select("id, stage_after")
        .eq("caller", "chris")
        .gte("called_at", monthStart);

      const appts   = (monthCalls || []).filter(c => c.stage_after?.includes("Hot") || c.stage_after?.includes("Decision")).length;
      const dealsNeeded = Math.max(0, 4 - Math.floor(appts / 3));
      const callsNeeded = dealsNeeded * 30;

      await sendTelegram(
        `⏰ Hey Chris — it's 11am. No calls logged yet today.\n\n` +
        `Your target is *10 calls* today.\n` +
        `You need *~${callsNeeded} more calls* to hit your 4-deal goal this month.\n\n` +
        `Go make some calls. 📞`
      );
    }
  }

  // 2-day inactivity check (run at 9am)
  if (estHour === 9 && estMin < 3) {
    const flagFile = `/tmp/acct_2day_${estTime.toLocaleDateString("en-US").replace(/\//g, "-")}.flag`;
    const fs = require("fs");
    if (fs.existsSync(flagFile)) return;

    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const { data: recentCalls } = await sb
      .from("jarvis_calls")
      .select("id, called_at")
      .eq("caller", "chris")
      .gte("called_at", twoDaysAgo)
      .limit(1);

    if (!recentCalls || recentCalls.length === 0) {
      fs.writeFileSync(flagFile, "1");

      // Get highest priority lead
      const { data: hotLeads } = await sb
        .from("jarvis_calls")
        .select("contact_name, address, stage_after")
        .in("stage_after", ["Hot Follow Up", "Warm Follow Up", "Decision Pending"])
        .order("called_at", { ascending: false })
        .limit(1);

      const topLead = hotLeads?.[0];
      const monthStart = new Date(estTime.getFullYear(), estTime.getMonth(), 1).toISOString();
      const { count: monthCallCount } = await sb
        .from("jarvis_calls")
        .select("id", { count: "exact" })
        .eq("caller", "chris")
        .gte("called_at", monthStart);

      // How many calls/day needed to hit 4 deals?
      const daysLeftInMonth = new Date(estTime.getFullYear(), estTime.getMonth() + 1, 0).getDate() - estTime.getDate();
      const callsNeeded = Math.max(10, Math.ceil(120 / Math.max(1, daysLeftInMonth)));

      await sendTelegram(
        `🚨 *Chris — 2 days since your last call.*\n\n` +
        `At your current pace you will not hit your deal goal this month.\n` +
        `You need *${callsNeeded} calls today* to get back on track.\n\n` +
        (topLead ? `Your highest priority lead right now:\n📍 *${topLead.contact_name}* — ${topLead.address}\nCall them first. Right now.` :
          `Go to your pipeline and call the hottest lead first.`)
      );
    }
  }
}

// ── Cron-like scheduler ───────────────────────────────────────────────────────

function startScheduler() {
  // Poll for new Chris calls every 2 minutes
  setInterval(pollForChrisCalls, 2 * 60 * 1000);

  // Accountability + weekly report check every minute
  setInterval(async () => {
    try {
      const now   = new Date();
      const est   = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const hour  = est.getHours();
      const min   = est.getMinutes();
      const day   = est.getDay();

      // Sunday 7pm weekly report
      if (day === 0 && hour === 19 && min < 2) {
        const flag = `/tmp/coaching_weekly_${now.toISOString().slice(0,10)}.flag`;
        const fs   = require("fs");
        if (!fs.existsSync(flag)) {
          fs.writeFileSync(flag, "1");
          await sendWeeklyCoachingReport();
        }
      }

      // Accountability checks (11am nudge, 9am 2-day check)
      await checkAccountability();

    } catch (e) { console.error("[chris-coach] Scheduler error:", e.message); }
  }, 60 * 1000);

  console.log("[chris-coach] Scheduler started");
}

// ── Start (only when run directly, not when require()'d) ─────────────────────

if (require.main === module) (async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     CHRIS CALL COACH — Active            ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`[chris-coach] Watching for calls from ${CHRIS_PHONE}`);
  console.log("[chris-coach] Polling jarvis_calls every 2 min for caller='chris'");

  // Verify tables
  const { error: e1 } = await sb.from("chris_coaching_log").select("id").limit(1);
  const { error: e2 } = await sb.from("chris_scripts").select("id").limit(1);
  if (e1) console.warn("[chris-coach] ⚠️  chris_coaching_log table missing — create in Supabase");
  if (e2) console.warn("[chris-coach] ⚠️  chris_scripts table missing — create in Supabase");
  if (!e1) console.log("[chris-coach] ✅ chris_coaching_log ready");
  if (!e2) console.log("[chris-coach] ✅ chris_scripts ready");

  startScheduler();

  // Run once at start to catch any missed calls
  await pollForChrisCalls();

  if (process.argv.includes("--test")) {
    const testCall = {
      id: "test-001",
      contact_name: "John Smith",
      address: "123 Main St, Orlando FL",
      called_at: new Date().toISOString(),
      transcript_full: "",
      notes: "Called about house. Owner said they bought it 10 years ago, owes nothing. Wants full market value $280k. Said they're not in a rush but mentioned moving for a job in 3 months. I offered $180k, they said no. Got off topic talking about the neighborhood.",
    };
    console.log("[chris-coach] Running test coaching analysis...");
    await coachChrisCall(testCall);
    process.exit(0);
  }
})();

module.exports = { coachChrisCall }; // safe to require() — IIFE only runs when executed directly
