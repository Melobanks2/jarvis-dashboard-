/**
 * JARVIS WATCHDOG — Self-healing supervisor
 * Runs every 5 minutes via PM2 cron.
 * Checks all critical processes, auto-heals failures, alerts via Telegram.
 */
require("dotenv").config();
const { exec }         = require("child_process");
const { createClient } = require("@supabase/supabase-js");
const { promisify }    = require("util");
const execAsync        = promisify(exec);
const fs               = require("fs");

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT  = process.env.TELEGRAM_CHAT_ID;
const sb             = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── Process definitions ────────────────────────────────────────────────────────
// type: "daemon" = must always be online
//       "cron"   = expected to be stopped between runs (stops after each run)
const PROCESSES = [
  { name: "Jarvis",          type: "daemon", critical: true  },
  { name: "jarvis-caller",   type: "daemon", critical: true  },
  { name: "gmail-watcher",   type: "daemon", critical: false },
  { name: "asap-scraper",    type: "daemon", critical: false },
  { name: "asap-worker-1",   type: "daemon", critical: false },
  { name: "asap-worker-2",   type: "daemon", critical: false },
  { name: "listen-server",   type: "daemon", critical: false },
  { name: "alpha-scraper",   type: "cron",   critical: true  },  // cron — stops after each run
  { name: "call-analyzer",   type: "cron",   critical: false },  // cron — stops after each run
  { name: "county-scraper",  type: "cron",   critical: false },  // daily cron
];

// Max restart count before we escalate to Telegram alert (daemons only)
const MAX_RESTARTS_BEFORE_ALERT = 10;

async function sendTelegram(msg) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: "HTML" }),
    });
  } catch {}
}

async function getPm2List() {
  const { stdout } = await execAsync("source ~/.nvm/nvm.sh && pm2 jlist", { shell: "/bin/bash" });
  return JSON.parse(stdout || "[]");
}

async function restartProcess(name) {
  await execAsync(`source ~/.nvm/nvm.sh && pm2 restart ${name}`, { shell: "/bin/bash" });
}

async function checkAlphaScraperActivity() {
  // alpha-scraper should have run in the last 35 minutes (cron: every 30min)
  try {
    const cutoff = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    const { data } = await sb
      .from("jarvis_log")
      .select("created_at")
      .eq("source", "alpha-scraper")
      .gte("created_at", cutoff)
      .limit(1);
    return (data || []).length > 0;
  } catch { return null; } // unknown
}

async function checkDavidCalledToday() {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data } = await sb
      .from("jarvis_calls")
      .select("id")
      .gte("called_at", today.toISOString())
      .neq("phone", "+13479704969")
      .limit(1);
    return (data || []).length > 0;
  } catch { return null; }
}

async function checkJarvisOnline(list) {
  const proc = list.find(p => p.name === "Jarvis");
  return proc?.pm2_env?.status === "online";
}

// ── Main health check ─────────────────────────────────────────────────────────
async function runHealthCheck() {
  const now = new Date();
  const hour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();

  let list;
  try {
    list = await getPm2List();
  } catch (e) {
    console.error("[Watchdog] Failed to get PM2 list:", e.message);
    return;
  }

  const issues   = [];
  const healed   = [];
  const warnings = [];

  // ── Check each process ────────────────────────────────────────────────────
  for (const proc of PROCESSES) {
    const pm2 = list.find(p => p.name === proc.name);
    if (!pm2) {
      if (proc.critical) issues.push(`❌ ${proc.name} — NOT FOUND in PM2`);
      continue;
    }

    const status   = pm2.pm2_env?.status;
    const restarts = pm2.pm2_env?.restart_time || 0;

    if (proc.type === "daemon") {
      if (status !== "online") {
        console.log(`[Watchdog] ${proc.name} is ${status} — restarting...`);
        try {
          await restartProcess(proc.name);
          healed.push(`🔧 ${proc.name} was ${status} → restarted`);
        } catch (e) {
          issues.push(`❌ ${proc.name} is ${status} — restart FAILED: ${e.message}`);
        }
      } else if (restarts > MAX_RESTARTS_BEFORE_ALERT && proc.critical) {
        warnings.push(`⚠️ ${proc.name} has restarted ${restarts}x — may be unstable`);
      }
    }
    // cron processes: stopped is expected — no action needed
  }

  // ── Check alpha-scraper actually ran recently ─────────────────────────────
  const alphaRanRecently = await checkAlphaScraperActivity();
  if (alphaRanRecently === false) {
    // Cooldown: only kick once per hour to avoid spam
    const kickCooldownFile = "/tmp/.alpha_kick_cooldown";
    let shouldKick = true;
    try {
      const stat = fs.statSync(kickCooldownFile);
      if (Date.now() - stat.mtimeMs < 60 * 60 * 1000) shouldKick = false; // within 1 hour
    } catch {}
    if (shouldKick) {
      try {
        fs.writeFileSync(kickCooldownFile, Date.now().toString());
        await execAsync("source ~/.nvm/nvm.sh && pm2 restart alpha-scraper", { shell: "/bin/bash" });
        healed.push("🔧 alpha-scraper hadn't logged in 35m → kicked it");
      } catch {}
    }
  }

  // ── Check jarvis-caller tunnel is alive (only during calling hours) ───────
  if (hour >= 9 && hour < 20) {
    const callerProc = list.find(p => p.name === "jarvis-caller");
    const callerUp   = callerProc?.pm2_env?.status === "online";
    if (!callerUp) {
      issues.push("❌ jarvis-caller is DOWN during calling hours");
    }

  }

  // ── Log results ───────────────────────────────────────────────────────────
  const hasIssues  = issues.length > 0;
  const hasHealed  = healed.length > 0;
  const hasWarning = warnings.length > 0;

  // Log locally only — no Telegram spam
  if (hasIssues || hasHealed || hasWarning) {
    const summary = [...healed, ...warnings, ...issues].join(" | ");
    console.log(`[Watchdog] ${summary}`);
  } else {
    console.log(`[Watchdog] ✅ All systems nominal at ${now.toLocaleTimeString("en-US", { timeZone: "America/New_York" })}`);
  }

  // ── Save health snapshot to Supabase ─────────────────────────────────────
  try {
    const statusMap = {};
    for (const proc of PROCESSES) {
      const pm2 = list.find(p => p.name === proc.name);
      statusMap[proc.name] = pm2?.pm2_env?.status || "missing";
    }
    await sb.from("jarvis_log").insert({
      type:    "watchdog",
      message: hasIssues ? `ISSUES: ${issues.join(" | ")}` : hasHealed ? `Healed: ${healed.join(" | ")}` : "All systems nominal",
      source:  "jarvis-watchdog",
    });
  } catch {}
}

// ── EOD health summary (sent at 8pm) ─────────────────────────────────────────
async function sendDailyReport() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  try {
    const [{ data: calls }, { data: logs }] = await Promise.all([
      sb.from("jarvis_calls").select("contact_name,stage_after,call_duration").gte("called_at", today.toISOString()).neq("phone", "+13479704969"),
      sb.from("jarvis_log").select("message").eq("source", "alpha-scraper").gte("created_at", today.toISOString()).order("created_at", { ascending: false }).limit(1),
    ]);

    const total       = (calls || []).length;
    const convos      = (calls || []).filter(c => (c.call_duration || 0) > 30).length;
    const hot         = (calls || []).filter(c => c.stage_after === "Hot Follow Up").length;
    const qualified   = (calls || []).filter(c =>
      ["Hot Follow Up","Warm Follow Up","Decision Pending","Contract Sent"].includes(c.stage_after || "")
    ).length;
    const lastScraper = logs?.[0]?.message || "No scraper activity today";

    await sendTelegram(
      `📊 <b>Daily EOD Report</b>\n` +
      `──────────────────────────\n` +
      `📞 Total Calls: <b>${total}</b>\n` +
      `🗣 Conversations: <b>${convos}</b>\n` +
      `🔥 Hot Leads: <b>${hot}</b>\n` +
      `✅ Qualified: <b>${qualified}</b>\n` +
      `🕷 Last Alpha Scraper: ${lastScraper.slice(0, 80)}\n` +
      `──────────────────────────\n` +
      `Tomorrow: David calls at 9am, 11am, 1pm, 3pm, 5pm, 6pm, 7pm EST`
    );
  } catch (e) {
    await sendTelegram(`📊 <b>EOD Report Error</b>: ${e.message}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  const hour = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();

  // Send daily EOD report at 8pm — use flag file to send only once per day
  if (hour === 20) {
    const fs = require('fs');
    const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    const flagFile = '/tmp/eod_sent_' + today.replace(/\//g, '-') + '.flag';
    if (!fs.existsSync(flagFile)) {
      fs.writeFileSync(flagFile, '1');
      await sendDailyReport();
    }
    return;
  }

  await runHealthCheck();
})();
