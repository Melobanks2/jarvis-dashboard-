#!/usr/bin/env node
// sync-knowledge.js — Nightly sync of knowledge_base → JARVIS-CONTEXT.md
// Runs at 11pm via PM2 cron. Reads all entries from Supabase, rewrites the
// Knowledge Base section in JARVIS-CONTEXT.md so Claude Code always has
// the latest wholesale knowledge every morning.

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const fs   = require("fs");
const path = require("path");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const CONTEXT_FILE = path.join(__dirname, "JARVIS-CONTEXT.md");
const SECTION_START = "\n---\n\n## Knowledge Base";
const SECTION_END   = "\n\n---\n\n## "; // next section marker

async function run() {
  console.log("[sync-knowledge] Starting sync...");

  // Fetch all knowledge_base entries
  const { data: entries, error } = await sb
    .from("knowledge_base")
    .select("title, summary, key_concepts, best_practices, things_to_avoid, market_insights, category, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[sync-knowledge] Supabase error:", error.message);
    process.exit(1);
  }

  console.log(`[sync-knowledge] Found ${entries.length} knowledge entries`);

  // Build the Knowledge Base section
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

  let section = `\n---\n\n## Knowledge Base\n_Last synced: ${now} EST — ${entries.length} total entries_\n\n`;

  if (entries.length === 0) {
    section += `_No entries yet. Teach Jarvis with: learn [title] [content]_\n`;
  } else {
    // Group by category
    const byCategory = {};
    for (const e of entries) {
      const cat = e.category || "wholesale";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(e);
    }

    for (const [cat, items] of Object.entries(byCategory)) {
      section += `### ${cat.charAt(0).toUpperCase() + cat.slice(1)} (${items.length} entries)\n\n`;

      for (const e of items) {
        const date = new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        section += `**${e.title}** _(${date})_\n`;
        if (e.summary) section += `${e.summary}\n`;

        const concepts = Array.isArray(e.key_concepts) ? e.key_concepts : [];
        if (concepts.length > 0) {
          section += `- Key concepts: ${concepts.slice(0, 5).join(" · ")}\n`;
        }

        const practices = Array.isArray(e.best_practices) ? e.best_practices : [];
        if (practices.length > 0) {
          section += `- Best practices: ${practices.slice(0, 3).join(" · ")}\n`;
        }

        const avoid = Array.isArray(e.things_to_avoid) ? e.things_to_avoid : [];
        if (avoid.length > 0) {
          section += `- Avoid: ${avoid.slice(0, 3).join(" · ")}\n`;
        }

        section += "\n";
      }
    }

    // Aggregate top concepts across all entries
    const allConcepts = entries.flatMap(e => Array.isArray(e.key_concepts) ? e.key_concepts : []);
    const allPractices = entries.flatMap(e => Array.isArray(e.best_practices) ? e.best_practices : []);
    const allAvoid = entries.flatMap(e => Array.isArray(e.things_to_avoid) ? e.things_to_avoid : []);

    if (allConcepts.length > 0) {
      section += `### Aggregate Insights (across all entries)\n\n`;
      section += `**Top concepts:** ${[...new Set(allConcepts)].slice(0, 10).join(", ")}\n\n`;
      if (allPractices.length > 0) {
        section += `**Best practices:**\n${[...new Set(allPractices)].slice(0, 8).map(p => `- ${p}`).join("\n")}\n\n`;
      }
      if (allAvoid.length > 0) {
        section += `**Things to avoid:**\n${[...new Set(allAvoid)].slice(0, 6).map(a => `- ${a}`).join("\n")}\n\n`;
      }
    }
  }

  // Read the current file
  let content = fs.readFileSync(CONTEXT_FILE, "utf8");

  // Remove existing Knowledge Base section if present
  const startIdx = content.indexOf(SECTION_START);
  if (startIdx !== -1) {
    content = content.substring(0, startIdx);
  }

  // Append the new section
  content = content.trimEnd() + section;

  fs.writeFileSync(CONTEXT_FILE, content);
  console.log(`[sync-knowledge] ✅ JARVIS-CONTEXT.md updated with ${entries.length} entries`);
}

run().catch(e => { console.error("[sync-knowledge] Fatal:", e.message); process.exit(1); });
