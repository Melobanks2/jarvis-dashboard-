Read this entire file before doing anything. This is the complete context for Chris Lovera's Jarvis system.

# JARVIS SYSTEM — COMPLETE CONTEXT
Last updated: 2026-03-17

---

## OWNER
Chris Lovera — wholesale real estate investor, Orlando FL
Goal: $30K/month, 4 deals/month
Markets: FL, GA, TX, AZ, NC

---

## SYSTEM OVERVIEW
Fully autonomous AI sales agent system:
1. **David** — AI caller that qualifies leads and gets verbal agreement
2. **Jarvis** — Telegram bot / chief of staff for Chris
3. **Alpha Scraper** — scrapes alphaleads-va.vercel.app for new leads
4. **ASAP ARV** — runs comps on hot lead properties
5. **Call Analyzer** — post-call Claude analysis (backup)
6. **Dashboard** — jarvis-dashboard (Next.js, Vercel)

---

## SERVER ENVIRONMENT
- Machine: macOS, `/Users/chrislovera/asaparv-agent/`
- Node via NVM: `~/.nvm/versions/node/v20.20.1/bin/node`
- PM2: always `source ~/.nvm/nvm.sh` before pm2 commands
- Python: python3.11 for voice_server.py

---

## PM2 PROCESSES
| Name | Script | Mode |
|---|---|---|
| Jarvis | jarvis-telegram.js | persistent, autorestart |
| jarvis-caller | jarvis-caller.js | **DAEMON** — autorestart, runs 24/7, cron internally |
| alpha-scraper | alpha-scraper.js | cron_restart every 30min |
| call-analyzer | call-analyzer.js | cron_restart hourly |
| county-scraper | county-scraper.js | cron_restart 7am daily |
| gmail-watcher | gmail-watcher.js | persistent, autorestart |
| listen-server | listen-server.js | persistent (Whisper STT, port 3003) |
| voice-server | voice_server.py | persistent (Chatterbox TTS, port 3002) |
| asap-scraper | asap-scraper.js | persistent |

---

## CALLING SCHEDULE (Mon–Sat EST, never Sunday, never before 9am or after 8pm)
| Time | Block | Stages | Max |
|---|---|---|---|
| 9:00am | Morning | Hot + Warm + New Lead | 30 |
| 1:00pm | Afternoon | New Lead + Attempt 1-3 | 20 |
| 5:30pm | Evening | Warm + Wholesalers Warm | 20 |
| 8:00pm | EOD | Daily report via Telegram | — |

---

## DAVID'S CALL SYSTEM (jarvis-caller.js)
- **Carrier**: Telnyx Call Control API
- **Outbound phones**: 4 David numbers (round-robin)
  - +14078023958, +14077511849, +13213402827, +13212098308
- **Voice (TTS)**: Chatterbox TTS on voice_server.py (port 3002)
  - WAV PCM 16-bit 16kHz mono required by Telnyx
- **STT**: Whisper on listen-server.js (port 3003) via Telnyx `<Gather input="speech">`
- **AI Brain**: Claude Haiku (`claude-haiku-4-5-20251001`) for conversation
- **Tunnel**: Cloudflare tunnel (static URL via `CLOUDFLARE_URL` env or dynamic)
- **AMD**: Disabled for test calls (`isTest=true`), `humanConfirmed` guard for real calls
- **Recording**: Telnyx `record_start` on every call, `call.recording.saved` webhook saves URL

### Call Flow
1. Fetch leads from GHL (priority: Decision Pending → Contract Sent → Hot → Warm → New → Attempt 1)
2. Pre-generate opening TTS audio (Chatterbox) + fallback to phrase_1.wav
3. Dial via Telnyx `calls.dial()` — AMD disabled for test, `detect` for real
4. `call.answered` → start recording → play opening audio
5. `call.playback.ended` → start Whisper STT listening
6. `call.transcription` → Claude Haiku generates response → `[PHRASE:N]` for instant or Chatterbox TTS for custom
7. `call.hangup` / AMD → `processCallEnd()`
8. Post-call: Claude Haiku analyzes transcript → score 1-10 → stage → GHL update → Supabase log → Telegram alert

### Hot Lead Detection
- Score 7-10 → "Hot Follow Up" + triggers `triggerDealApproval()`
- Score 4-6 → "Warm Follow Up"
- Score 1-3 → "Cold Follow Up"
- No conversation → attempt ladder (Attempt 1 No Contact → ... → Attempt 6+ Unresponsive)

### Deal Approval Flow (score ≥ 7)
1. Runs ASAP ARV scraper for address
2. Computes 60/65/70% offers + Novation qualification
3. Saves to `david_pending_approvals` Supabase table
4. Sends Telegram card with inline buttons: ✅ APPROVE CASH | 🏡 APPROVE NOVATION | ❌ PASS
5. Chris taps button → David notified to call back

---

## DAVID'S SCRIPT SYSTEM
**Script 1 — Standard Acquisition** (all motivated seller leads)
Opening: "Hey [firstName] — this is David with Want To Sell Now. How are you today? We got your information about your property at [address] and just wanted to run through a few quick details. Did you have a timeframe or price in mind for when you were looking to sell?"
Then: Motivation Discovery → Commitment Check → Property Basics → Conditions → Roadblocks → Money Talk → Next Steps

**Script 2 — Negotiation / Offer Math**
Used when justifying offer price. Walk through ARV → selling costs → reno costs → profit margin math.

**Script 3 — Pre-Foreclosure**
Opening acknowledges lender activity, explains 5 options, stress-tests their plan, bridges to selling.

**Script 4 — Seller Finance / Novation**
For on-market/equity-rich: 1031 exchange framing → cash flow problem → seller financing above asking.

---

## GHL (GoHighLevel)
- Token: `pit-dada4af8-bbe3-4334-906b-361b9f03bffa` (also in .env as GHL_API_TOKEN)
- Location: `AymErWPrH9U1ddRouslC`
- Pipeline VA♦️Leads: `o4kqU2y8DYjA73aKUxNu`
- Pipeline Wholesalers ⛵️: `QsjO25tMKFZFFzdAkWZP`
- Stage update: PUT `/opportunities/{oppId}` with `pipelineStageId`
- Tag update: GET existing tags → merge → PUT contact
- Notes: POST `/contacts/{id}/notes` with `{ body, userId: null }`

---

## SUPABASE TABLES
| Table | Purpose |
|---|---|
| `jarvis_calls` | Every AI call logged (contact, duration, stage before/after, transcript, recording_url) |
| `jarvis_log` | General activity log |
| `analyzed_calls` | Dedup cache for call-analyzer |
| `david_pending_approvals` | Hot lead approval queue (Chris approves via Telegram) |
| `jarvis_conversations` | Jarvis Telegram chat memory (10 msg rolling window) |
| `jarvis_ideas` | Ideas board |
| `county_leads` | County scraper output |
| `asap_sold_properties` | ASAP ARV sold comps |
| `asap_cities` | ASAP ARV city scraping status |

---

## TELEGRAM BOT
- Bot: @JarvisLoveraBot
- Token: `8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0`
- Chat ID: `8105811341`
- Jarvis responds to all messages via Claude Sonnet with GHL context

### Key Commands
| Command | Action |
|---|---|
| `call me` / `test david` | Spawns test call to +13479704969 (AMD disabled) |
| `call warm follow ups` | Calls all Warm Follow Up leads |
| `call hot follow ups` | Calls all Hot Follow Up leads |
| `call new leads` | Calls New Lead stage |
| `call [name]` | Searches GHL by name, confirms, calls |
| `call [phone]` | Direct dial |
| `stop calling` | Kills active session |
| `status` / `david status` | Calls today/week, last call, PM2 status |
| `calendar today` / `calendar tomorrow` | Google Calendar |
| `schedule [event] at [time]` | Add calendar event |
| `new idea: [title]` | Save to ideas board |
| `my ideas` | Show ideas board |
| `asap status` | ASAP ARV scraper status |
| `asap start [city]` | Start scraping a city |

---

## .env VARIABLES (key ones)
```
ANTHROPIC_API_KEY       — Claude API
TELNYX_API_KEY          — Telnyx main key
TELNYX_CC_APP_ID        — Call Control App ID
TELNYX_CONNECTION_ID    — Connection ID
TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
SUPABASE_URL / SUPABASE_KEY
GHL_API_TOKEN
ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID
CLOUDFLARE_URL          — static tunnel for Telnyx webhooks
MY_PHONE                — Chris's phone (+13479704969)
CLAUDE_AUTO_ANALYSIS    — must be "true" for hot lead detection
```

---

## DASHBOARD
- Repo: https://github.com/Melobanks2/jarvis-dashboard-
- URL: Auto-deployed on Vercel
- Stack: Next.js 14, TypeScript, Tailwind, Supabase JS, Framer Motion
- Data: All Supabase reads (anon key), GHL via /api/pipeline.js serverless
- Sections: Command Center (KPIs, live call feed, weekly chart), David HQ, AI Agents, Pipeline, etc.
- Refresh: 30s auto + manual button

---

## KNOWN ISSUES / HISTORY
- AMD false positive: Fixed with `isTest=true` (disables AMD) + `humanConfirmed` guard
- Tunnel URL regex: Must match 3+ hyphenated segments to avoid `api.trycloudflare.com`
- Recording URLs: Fixed — `record_start` on every call, `call.recording.saved` webhook saves URL
- CLAUDE_AUTO_ANALYSIS: Added to .env as "true" on 2026-03-17
- Calling schedule: Changed from noon-only cron to daemon mode with 9am/1pm/5:30pm internal cron

---

## QUICK COMMANDS
```bash
# PM2 status
source ~/.nvm/nvm.sh && pm2 status

# Restart caller daemon
source ~/.nvm/nvm.sh && pm2 restart jarvis-caller

# Test call
curl -X POST http://localhost:3000/internal/call-test

# Check caller logs
source ~/.nvm/nvm.sh && pm2 logs jarvis-caller --lines 30 --nostream

# Deploy dashboard
cd /Users/chrislovera/jarvis-dashboard && git push origin main
```
---

## Knowledge Base
_Last synced: Mar 19, 2026, 7:51 PM EST — 0 total entries_

_No entries yet. Teach Jarvis with: learn [title] [content]_
