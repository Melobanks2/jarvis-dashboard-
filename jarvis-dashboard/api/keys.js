// ── Secure API key proxy ──────────────────────────────────────
// Reads keys from root-level .env and exposes only the AI provider
// keys to the client. This keeps keys out of localStorage for
// persistence across sessions / cache clears.
//
// On Vercel, set these as Environment Variables in the dashboard.
// Locally, they come from the root .env file.
// ───────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Only expose the AI provider keys — never expose secrets like
  // Twilio, Telnyx, DealMachine credentials, etc.
  const safeKeys = {
    anthropic: process.env.ANTHROPIC_API_KEY || '',
    gemini: process.env.GEMINI_API_KEY || '',
    openrouter: process.env.OPENROUTER_API_KEY || '',
    groq: process.env.GROQ_API_KEY || '',
    deepseek: process.env.DEEPSEEK_API_KEY || '',
  };

  // Also merge in standard env var names if the GEMINI/GROQ/etc
  // specific ones aren't set but the old names are
  if (!safeKeys.anthropic && process.env.ANTHROPIC_API_KEY) {
    safeKeys.anthropic = process.env.ANTHROPIC_API_KEY;
  }

  return res.status(200).json(safeKeys);
};