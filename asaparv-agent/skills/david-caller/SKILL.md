---
name: david-caller
description: Full context for David AI caller system in /Users/chrislovera/asaparv-agent/jarvis-caller.js. Use when working on call flow, TTS, STT, GHL updates, Telegram alerts, lead stages, voicemail detection, approval flow, or scheduling.
---

# David AI Caller — Complete Reference

## File & Process
- **File**: `/Users/chrislovera/asaparv-agent/jarvis-caller.js`
- **PM2 name**: `jarvis-caller` (daemon, autorestart, 24/7)
- **Port**: 3000 (Express webhook server)
- **Mode**: Daemon — stays alive, internal cron fires calls on schedule

## Restart / Test Commands
```bash
source ~/.nvm/nvm.sh && pm2 restart jarvis-caller
source ~/.nvm/nvm.sh && pm2 logs jarvis-caller --lines 30 --nostream
curl -X POST http://localhost:3000/internal/call-test    # test call to Chris +13479704969
curl http://localhost:3000/health
```

---

## Full Call Flow (step by step)

1. **Cron fires** (9am / 1pm / 5:30pm Mon–Sat EST) → `runCallBatch()`
2. **fetchLeads()** — GHL API, priority order: Decision Pending → Contract Sent → Hot → Warm → New Lead → Attempt 1
3. **callLead(lead)** — dials via `telnyxClient.calls.dial()`, round-robin across 4 David phones
4. **`call.answered`** webhook → start recording → `davidSpeak(openingText, "opening")`
5. **`davidSpeak()`**:
   - Calls ElevenLabs API (`eleven_turbo_v2_5`, voice `ljX1ZrXuDIIRVcmiVSyR`)
   - Saves MP3 to `/tmp/el_audio/{uuid}.mp3`
   - Serves via `${webhookBase}/audio/el/{uuid}.mp3`
   - Calls `telnyxClient.calls.actions.startPlayback()` with that URL
   - Falls back to Telnyx SSML (`Polly.Matthew-Neural`) if EL fails or times out (10s)
6. **`call.playback.ended`** → `startListening()` → `telnyxClient.calls.actions.startTranscription()` (Deepgram)
7. **`call.transcription`** (is_final=true) → `processSellerSpeech()`
   - After turn 3: auto-triggers `runAsapArv(address)` in background → stores in `state.arvData`
   - Claude Haiku (`claude-haiku-4-5-20251001`) generates response (max 150 tokens)
   - Resolves `[PHRASE:N]` shortcuts to pre-written text
   - Detects DocuSign language → sets `state.verbalAgreement`
   - Calls `davidSpeak()` again
8. **`call.hangup`** → `processCallEnd()`
9. **processCallEnd()**:
   - `hasConversation` = count of "Seller:" turns in transcript (NOT string length)
   - If no conversation → `getNoContactStage()` → attempt ladder
   - If conversation → Claude Haiku analyzes → score 1-10 → stage
   - No-backwards-movement enforced via `STAGE_RANK`
   - Updates GHL stage + tags + writes note with full transcript
   - Logs to `jarvis_calls` Supabase table
   - Sends Telegram alert
   - If score ≥ 7 → `triggerDealApproval()` (uses `state.arvData` or runs fresh ASAP ARV)
   - If `state.verbalAgreement` → sends DocuSign Telegram alert with seller email

---

## AMD (Answering Machine Detection)
- **Test calls**: AMD disabled (`answering_machine_detection: "disabled"`)
- **Real calls**: AMD set to `"detect"` → fires `call.machine.detection.ended`
- **Voicemail rule**: Only hang up if `result === "machine"` AND call duration < 20s AND zero seller turns
- If any condition fails → treat as human, continue call
- `humanConfirmed` flag set when opening audio finishes playing (prevents late AMD from hanging up)

---

## Lead Stage Flow
```
New Lead → [David calls same day]
  └─ No answer → Attempt 1 No Contact
  └─ No answer → Attempt 2 No Contact
  └─ No answer → Attempt 3-5 No Contact
  └─ 6+ no answers → Attempt 6+ Unresponsive (stop calling)
  └─ Answered, score 1-3 → Cold Follow Up (keep calling daily)
  └─ Answered, score 4-6 → Warm Follow Up (keep calling daily)
  └─ Answered, score 7-10 → Hot Follow Up + deal approval card sent
```

**STAGE_RANK** (higher = more progressed, never move backwards):
- Attempt 1 No Contact: 1 → Attempt 2: 2 → Attempt 3-5: 3 → Attempt 6+/Attempt 1: 4
- New Lead: 5 → Cold: 6 → Warm: 7 → Hot: 8 → Decision Pending: 9 → Contract Sent: 10

---

## Calling Schedule (cron inside daemon)
| Time (EST) | Block | Stages | Max |
|---|---|---|---|
| 9:00am Mon–Sat | Morning | Hot + Warm + New Lead | 30 |
| 1:00pm Mon–Sat | Afternoon | New + Attempt 1/2 | 20 |
| 5:30pm Mon–Sat | Evening | Warm + Hot | 20 |
| 8:00pm Mon–Sat | EOD | Daily report via Telegram | — |

---

## Hot Lead Approval Flow
1. Score ≥ 7 → `triggerDealApproval()` runs
2. ASAP ARV → computes 60/65/70% offers
3. Saves to `david_pending_approvals` Supabase table
4. Sends Telegram card with 4 buttons:
   - `✅ $X (60%)` → callback_data: `approve_60_{id}`
   - `✅ $X (65%)` → callback_data: `approve_65_{id}`
   - `✅ $X (70%)` → callback_data: `approve_70_{id}`
   - `❌ PASS + Call Seller Back` → callback_data: `pass_{id}`
5. Chris taps button → `jarvis-telegram.js` POSTs to `/internal/approval-callback` or `/internal/denial-callback`
6. David calls seller back immediately with specific offer or polite denial

---

## Internal API Endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/call-test` | Test call to +13479704969 |
| POST | `/internal/approval-callback` | Trigger callback with offer `{phone, name, address, offerType, offerAmount}` |
| POST | `/internal/denial-callback` | Trigger denial callback `{phone, name, address, reason}` |
| GET | `/health` | Status + active calls |
| GET | `/audio/el/:filename` | Serve ElevenLabs audio to Telnyx |
| GET | `/audio/prebuilt/:filename` | Serve pre-built phrase WAVs |

---

## TTS Architecture
- **Primary**: ElevenLabs `eleven_turbo_v2_5`, voice ID `ljX1ZrXuDIIRVcmiVSyR`
  - Generates MP3 → saves to `/tmp/el_audio/` → served via Cloudflare tunnel URL
  - Telnyx `startPlayback(audio_url)` fetches and plays
  - `call.playback.ended` fires when done
- **Fallback**: Telnyx SSML (`Polly.Matthew-Neural`) if EL fails or times out (10s)
  - `call.speak.ended` fires when done
- **Both handlers** (playback.ended and speak.ended) do the same: start listening or hangup

## STT Architecture
- Telnyx `startTranscription()` with Deepgram engine, inbound track
- `call.transcription` webhook fires with `is_final: true`
- 20s silence timeout on turn 0 (opening) → voicemail message + hangup
- 12s silence timeout on subsequent turns → hangup

---

## Environment Variables Required
```
ANTHROPIC_API_KEY       — Claude Haiku brain
TELNYX_API_KEY          — Telnyx Call Control
TELNYX_CONNECTION_ID    — 2917223818726475365 (Call Control App)
ELEVENLABS_API_KEY      — TTS generation
ELEVENLABS_VOICE_ID     — ljX1ZrXuDIIRVcmiVSyR (David's cloned voice)
SUPABASE_URL            — Database
SUPABASE_KEY            — Database
TELEGRAM_CHAT_ID        — 8105811341
CLOUDFLARE_URL          — Static tunnel URL (optional, falls back to dynamic)
MY_PHONE                — +13479704969 (Chris's phone for test calls)
CLAUDE_AUTO_ANALYSIS    — must be "true" for hot lead detection
ASAPARV_EMAIL           — Chrislovera7@gmail.com
ASAPARV_PASSWORD        — Sports098
```

## GHL Config (hardcoded in file)
- Token: `pit-dada4af8-bbe3-4334-906b-361b9f03bffa`
- Location: `AymErWPrH9U1ddRouslC`
- Pipeline VA♦️Leads: `o4kqU2y8DYjA73aKUxNu`
- Pipeline Wholesalers ⛵️: `QsjO25tMKFZFFzdAkWZP`

## David Phone Numbers (round-robin)
- +14078023958, +14077511849, +13213402827, +13212098308

---

## Supabase Tables Used
| Table | What's Written |
|---|---|
| `jarvis_calls` | Every call: contact, duration, stage before/after, transcript, recording URL |
| `david_pending_approvals` | Hot lead approval queue (status: pending/approved_60pct/etc/passed) |
| `analyzed_calls` | Dedup cache (prevents re-analyzing same call twice) |
| `jarvis_log` | General activity + fallback if jarvis_calls missing |

---

## Common Mistakes to Avoid

1. **Never use `transcript.length > 30` to detect conversations** — use "Seller:" turn count. EL voicemail message alone makes transcript long enough to falsely trigger analysis.

2. **`call.speak.ended` vs `call.playback.ended`** — `speak()` fires `speak.ended`, `startPlayback()` fires `playback.ended`. Both need to handle the same state transitions (start listening / hangup). If you add a new speak method, check which event it fires.

3. **Never enable AMD for test calls** — always `answering_machine_detection: "disabled"` for `isTest: true`. AMD on known human numbers causes false positives.

4. **Telnyx doesn't echo `client_state` in `speak.ended`** — always use `state.callStage` (in-memory) as ground truth, never `stage` from the webhook payload.

5. **ElevenLabs audio must be served via public URL** — Telnyx fetches it from the internet. It uses the Cloudflare tunnel URL (`webhookBase`). Never pass a localhost URL to `startPlayback()`.

6. **Polly Neural voices don't support `<prosody pitch>`** — only `rate` works. Pitch causes `call.speak.failed`.

7. **Supabase `.catch()` is undefined** — use `try { await sb... } catch {}` pattern, never `.catch()` chaining.

8. **Always `source ~/.nvm/nvm.sh` before pm2 commands** — node is installed via NVM.

9. **No backwards stage movement** — always check `STAGE_RANK` before writing a new stage. A Hot Follow Up lead can never go back to Cold.

10. **CLAUDE_AUTO_ANALYSIS must be `"true"` (string) in .env** — `process.env.CLAUDE_AUTO_ANALYSIS === "true"` is the gate for post-call analysis.
