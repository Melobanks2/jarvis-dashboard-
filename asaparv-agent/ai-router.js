/**
 * ai-router.js — Routes AI calls to Llama (Ollama) or Claude Haiku fallback
 *
 * Usage:
 *   const { aiChat } = require("./ai-router");
 *   const text = await aiChat({ system, messages, max_tokens });
 *
 * - Checks Ollama at localhost:11434 before every call
 * - If available → uses llama3.2:3b locally (free)
 * - If not available → falls back to Claude Haiku automatically
 */

require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

const OLLAMA_URL    = "http://localhost:11434";
const OLLAMA_MODEL  = "llama3.2:3b";
const CLAUDE_MODEL  = "claude-haiku-4-5-20251001";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let ollamaAvailable = null;       // null = unknown, true/false = cached
let lastOllamaCheck = 0;
const OLLAMA_CHECK_INTERVAL = 30 * 1000; // re-check every 30s

async function checkOllama() {
  const now = Date.now();
  if (ollamaAvailable !== null && (now - lastOllamaCheck) < OLLAMA_CHECK_INTERVAL) {
    return ollamaAvailable;
  }
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    ollamaAvailable = res.ok;
  } catch {
    ollamaAvailable = false;
  }
  lastOllamaCheck = now;
  return ollamaAvailable;
}

/**
 * Call Ollama with OpenAI-compatible chat format
 * messages: [{ role: "user"|"assistant"|"system", content: string }]
 */
async function callOllama({ system, messages, max_tokens = 500 }) {
  // Build messages array in Ollama format (system as first message if provided)
  const ollamaMessages = [];
  if (system) ollamaMessages.push({ role: "system", content: system });
  for (const m of messages) ollamaMessages.push({ role: m.role, content: m.content });

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      model:    OLLAMA_MODEL,
      messages: ollamaMessages,
      stream:   false,
      options:  { num_predict: max_tokens, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(90000), // 90s timeout — cold start (model load) can take 35s+
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  const text = data.message?.content?.trim();
  if (!text) throw new Error("Ollama returned empty response");
  return text;
}

/**
 * Call Claude Haiku fallback
 */
async function callClaude({ system, messages, max_tokens = 500 }) {
  const res = await claude.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens,
    ...(system ? { system } : {}),
    messages,
  });
  return res.content[0].text.trim();
}

/**
 * Main router — call this everywhere instead of claude.messages.create
 *
 * Returns: { text: string, model: "llama"|"claude", tokens?: object }
 */
async function aiChat({ system, messages, max_tokens = 500 }) {
  const useOllama = await checkOllama();

  if (useOllama) {
    try {
      const text = await callOllama({ system, messages, max_tokens });
      console.log(`  [AI] llama3.2:3b (local) — ${text.length} chars`);
      return { text, model: "llama" };
    } catch (e) {
      // Ollama failed mid-call — mark unavailable and fall through to Claude
      console.warn(`  [AI] Llama failed (${e.message}) — falling back to Claude Haiku`);
      ollamaAvailable = false;
      lastOllamaCheck = Date.now();
    }
  }

  // Claude Haiku fallback
  const text = await callClaude({ system, messages, max_tokens });
  console.log(`  [AI] Claude Haiku (fallback) — ${text.length} chars`);
  return { text, model: "claude" };
}

module.exports = { aiChat, checkOllama, CLAUDE_MODEL, OLLAMA_MODEL };
