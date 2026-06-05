# Multi-Line Dialer — Architecture

Last updated: 2026-05-27 (Phase-2a opener pipeline shipped)

> **NEXT SESSION: READ THIS FILE FIRST**, then `grep -nR "TODO(phase-2b)" /root/asaparv-agent/dialer-*` for hookup points.

## Session log

| Date       | Phase | Status   | Summary |
|------------|-------|----------|---------|
| 2026-05-27 | 1     | ✅ shipped | 5-line dialer + AMD + GHL disposition + war-room UI on `api.jarviscommandcenter.space/dialer/*` (PM2 `multi-dialer`, port 3007). |
| 2026-05-27 | 2a    | ✅ shipped | Personalized opener pipeline: Chatterbox static WAVs (rendered once) + gTTS name/address + pydub stitch + Telnyx `playback_start`. Full build in 1.7s, zero Thunder cost. On `call.playback.ended` an interim Chris-bridge fires as a safety net. |
| —          | 2b    | ⏳ queued  | Telnyx `streaming_start` after opener → webrtcvad sidecar → VAD positive → `instance1.ensureUp()` + stall-audio loop → on instance ready stop stall and replace Chris-bridge with David. 6 `TODO(phase-2b)` markers placed at hookup points. |

## Phase-2b entry checklist (when you pick this up)

1. Read this file (you're doing it).
2. `grep -nR "TODO(phase-2b)" /root/asaparv-agent/dialer-*.js` — 6 markers, all in the call path.
3. Confirm `INSTANCE_1_SNAPSHOT`, `INSTANCE_2_SNAPSHOT`, `THUNDER_TOKEN` are in `/root/asaparv-agent/.env`. (They were not present as of 2026-05-27.)
4. `apt install` nothing extra — pip-install `webrtcvad` into `/root/cb-env`, `npm install ws` in `/root/asaparv-agent`.
5. Build order: (a) `ws` server inside `dialer-server.js` listening at `/dialer/stream/<callControlId>`, (b) Python `vad-sidecar.py` reading μ-law frames from stdin, (c) wire `streaming_start` after `call.playback.ended` instead of the current Chris-bridge, (d) on VAD positive call `instance1.ensureUp()` and `playback_start` of a stall loop, (e) on instance ready `playback_stop` the stall and hand off to David's brain (separate subproject).
6. Record a stall WAV: "Let me pull up that information for you one moment..." Save at `/root/asaparv-agent/audio/static/stall.wav`. Same format as openers (24kHz mono int16). Run another one-shot Chatterbox render.



## Locked Thunder Instance Architecture

Three Thunder Compute A6000 instances, **strictly separated**. Never run two
workloads on the same instance.

| Instance | GPU stack | Purpose | Owner |
|---|---|---|---|
| **0** | Qwen 2.5 Coder 32B | Intelligence Chat (dashboard) | `/opt/thunder-chat-proxy` — **dialer never touches this** |
| **1** | Llama 3.3 70B + Whisper V3 Turbo + Chatterbox TTS | David voice calls only | `dialer-thunder-instances.js::instance1` |
| **2** | Gemma 3 27B | Logic / decisions only | `dialer-thunder-instances.js::instance2` |

Env vars required for the dialer:
- `INSTANCE_1_SNAPSHOT` — Thunder snapshot name for Instance 1
- `INSTANCE_2_SNAPSHOT` — Thunder snapshot name for Instance 2
- `INSTANCE_1_IDLE_MS` — default 300000 (5 min, per spec)
- `INSTANCE_2_IDLE_MS` — default 600000 (10 min)
- `THUNDER_TOKEN` — same token as `/opt/thunder-chat-proxy`

Every code site that creates a Thunder instance carries the matching flag:

```
// THUNDER INSTANCE 1 — DAVID ONLY
// THUNDER INSTANCE 2 — GEMMA BRAIN ONLY
```

Instance 0 is intentionally **not exported** from `dialer-thunder-instances.js`
so the dialer cannot accidentally spin it up.

## Two-Phase David Call Flow (target state)

```
                                ┌───────────────────────────────────────┐
[CSV row]                       │ Phase-0  Pre-render Chatterbox opener │
   │                            │   "Hey {name}, this is David…"        │
   ▼                            │   audio cached on VPS, public URL     │
[/dialer/call → 5 Telnyx legs]  └───────────────────────────────────────┘
   │
   ▼
[Telnyx AMD = machine]  ── hangup (no Thunder, no opener)
[Telnyx AMD = human]
   │
   ▼
[playback_start opener via Telnyx]              ←  Phase-1 opener
   │
   ▼
[Telnyx Media Streaming WS → webrtcvad sidecar] ←  VAD on VPS
   │
   ├─ VAD negative / hangup-during-opener  ── hangup (no Thunder)
   │
   ▼
[VAD positive — seller responded]
   │
   ▼
[instance1.ensureUp() + stall audio bridge]     ←  Phase-2 brain spin-up
   │
   ▼
[Llama 3.3 70B + Whisper V3 + Chatterbox conversation]
   │
   ▼
[call.hangup → instance1.markIdleStart() → 5-min spin-down]
```

## Opener pipeline (Phase-2a, 2026-05-27) — DEPLOYED

CPU-only personalized opener. **Zero Thunder cost.** When Telnyx AMD confirms
human pickup, the dialer builds and plays a stitched opener WAV before any
bridge happens.

Components:
```
/root/asaparv-agent/audio/static/
├── opener-a.wav  ← "Hey"
├── opener-b.wav  ← "this is David, I was just calling to see if you'd be
│                    interested in selling your property at"
└── opener-c.wav  ← "is that something you'd consider?"

/root/asaparv-agent/scripts/
├── render-static-openers.py   ← Chatterbox; run ONCE on VPS CPU
├── render-dynamic.py          ← gTTS → 24kHz mono int16 WAV
└── stitch-opener.py           ← pydub concat a + name + b + addr + c

/root/asaparv-agent/dialer-opener.js   ← Node wrapper, exposes buildOpenerForCall()
/root/asaparv-agent/audio/cache/       ← stitched WAVs, served at /dialer/audio/<callId>.wav
```

Flow on AMD=human:
```
1. dialer-opener.buildOpenerForCall({ callId, lead })
     → gTTS render lead.name      → /tmp/audio/<callId>-name.wav
     → gTTS render lead.address   → /tmp/audio/<callId>-address.wav      (parallel)
     → pydub stitch               → /root/asaparv-agent/audio/cache/<callId>.wav
     → unlink the two /tmp/audio temp files
2. telnyx playback_start { audio_url: https://api.../dialer/audio/<callId>.wav }
3. on call.playback.ended → cleanup stitched WAV, bridge Chris (interim)
4. on call.hangup         → cleanup stitched WAV
```

Render time: ~1–2 s on the VPS (gTTS is the slow part; ~700ms × 2 parallel).
Telnyx playback latency: ~200ms after `playback_start`. Total perceived gap
between seller "hello" and David's opener: ~1.5–2.5 s.

Format throughout: 24kHz mono 16-bit PCM WAV. Telnyx-compatible.

## What's deployed today (Phase-1 + Phase-2a, 2026-05-27)

✅ Backend Express service on `127.0.0.1:3007`, public at
   `https://api.jarviscommandcenter.space/dialer/*` via nginx.
✅ 5 simultaneous Telnyx legs with AMD `premium`.
✅ AMD-human path bridges the winning lead directly to Chris's cell (legacy
   behavior). Other legs are hung up.
✅ AMD-machine path hangs up immediately, no Thunder, no opener.
✅ GHL disposition write to VA Leads pipeline `o4kqU2y8DYjA73aKUxNu`.
✅ Per-lane + David state polled via `/dialer/status`.
✅ 5-lane war-room UI + David agent card + 200-call goal bar +
   session-summary modal + transcript stub.
✅ Thunder Instance 1 / 2 modules ready but never invoked from the call
   path — preventing wrong-trigger Thunder spend until VAD lands.

## What's NOT deployed (Phase-2b gaps)

❌ Telnyx Media Streaming WebSocket plumbing (`streaming_start` action on the
   live lead leg after the opener finishes).
❌ webrtcvad sidecar (Python service) running on the VPS.
❌ VAD-positive trigger for `instance1.ensureUp()`.
❌ Stall-audio loop during Instance 1 cold start (~10–15s).
❌ Live transcript panel — frontend renders a "Whisper · stub" placeholder.
❌ David actually joining the call audio — UI shows the state machine, but
   no TTS is injected into the bridge.

Phase-2a leaves an interim safety net: after `call.playback.ended`, the
winning leg is bridged to Chris's cell (the legacy Phase-1 behavior). When
Phase-2b lands, that bridge is replaced with `streaming_start` → VAD → spin-up.

Every Phase-2 hookup point in the existing code carries a `TODO(phase-2):`
comment. Grep for them: `grep -nR "TODO(phase-2)" /root/asaparv-agent/dialer-*`

## Cost guardrails

- Telnyx outbound: ~$0.009 / minute × 5 lines × short ring time → ~$18 / 2,000 calls.
- Thunder Instance 1: only billed during VAD-positive conversations + 5 min idle tail.
- Thunder Instance 2: not used in Phase-1; reserved for Phase-2 decision logic.
- Phase-1's old behavior would have spun Instance 1 on every AMD-human pickup
  (~30–40% of dials), which was financially wrong. That trigger has been
  removed; current code does not spin Instance 1 at all.

## File map

```
/root/asaparv-agent/
├── dialer-server.js              ← Express bootstrap (port 3007) + /dialer/audio static
├── dialer-state.js               ← Supabase session/lane helpers
├── dialer-thunder-instances.js   ← Instance 1 + Instance 2 controllers
├── dialer-call.js                ← POST /dialer/call (5-leg + AMD)
├── dialer-webhook.js             ← POST /dialer/webhook (Telnyx events)
├── dialer-status.js              ← GET  /dialer/status
├── dialer-disposition.js         ← POST /dialer/disposition (GHL VA Leads)
├── dialer-session-summary.js     ← GET  /dialer/session-summary
├── dialer-opener.js              ← Phase-2a opener pipeline (Node wrapper)
├── dialer-schema.sql             ← One-time Supabase migration
├── scripts/
│   ├── render-static-openers.py  ← Chatterbox; run ONCE
│   ├── render-dynamic.py         ← gTTS name/address
│   └── stitch-opener.py          ← pydub concat
└── audio/
    ├── static/                   ← opener-a/b/c.wav (committed once)
    └── cache/                    ← stitched per-call WAVs (transient)
```

PM2 process: `multi-dialer` (pm2 id 33). Logs: `pm2 logs multi-dialer`.


---

## Phase-2b shipped (2026-05-28) — David qualification loop

**Status:** code deployed, gated behind `DIALER_PHASE2B_ENABLED=true` (currently
**OFF** — opener-end still bridges Chris).

When enabled, opener-end no longer bridges Chris. Instead David runs a full
qualification conversation:

```
opener WAV ends
   │
   ▼
recording WS is already streaming `both_tracks` (Phase-2a recording)
   │
   ▼
register VAD inbound tap on recording WS                 ← dialer-vad.js
   │
   ▼
stall.start()  → playback_start stall.wav loop          ← dialer-stall.js
   │
   ▼
instance1.ensureUp()  + instance2.ensureUp() (parallel)
   │
   ▼
stall.stop()
   │
   ▼
brain.startQualification()                              ← dialer-david-brain.js
   │   ├─ speak()  → F5-TTS  /tts → playback_start
   │   ├─ playback ended → arm silence timer + listen
   │   ├─ VAD utterance → Whisper /transcribe
   │   ├─ Gemma /decide → CONTINUE | HOT | WARM | COLD | REFUND_REVIEW
   │   ├─ CONTINUE → Llama /generate → next David line → speak()  (loop, max 8 turns)
   │   └─ HOT/WARM/COLD/REFUND → speak closer → telnyxAction hangup
   │                              ↓
   │            disposition.dispose() — GHL pipeline stage + tag + transcript note
   │                              ↓
   │            HOT only → alerts.notifyHot() → Telegram to Chris
   ▼
call.hangup → brain.endCall() + vad.unregister() + recording.unregisterInboundTap()
            + instance1.markIdleStart() (5-min spin-down)
```

### Files added (Phase-2b)

| File | Role |
|---|---|
| `dialer-david-brain.js` | Conversation state machine. HTTP clients for F5-TTS, Whisper, Llama, Gemma. |
| `dialer-vad.js` | Pure-Node RMS endpointing on inbound 8 kHz PCM16. Emits one utterance WAV per seller turn. |
| `dialer-stall.js` | Plays `audio/static/stall.wav` while Instance 1 spins up. |
| `dialer-alerts.js` | Telegram HOT-lead alert to Chris (`@JarvisLoveraBot` → `TELEGRAM_CHAT_ID`). |
| `audio/static/stall.wav` | F5-TTS render of "Let me pull up that information for you one moment..." |

### Files modified (Phase-2b)

| File | Change |
|---|---|
| `dialer-recording.js` | Added `registerInboundTap(callId, cb)` / `unregisterInboundTap()` so VAD can subscribe to inbound PCM16 frames without a second `streaming_start` (Telnyx caps at one per call). |
| `dialer-webhook.js`   | On `call.playback.ended` of the opener: if `DIALER_PHASE2B_ENABLED`, run the qualification flow above; otherwise fall back to the legacy Chris bridge. Also handles `david_turn` playback-ended events to keep the loop ticking, and cleans up brain/VAD state on `call.hangup`. |
| `dialer-disposition.js` | Exposes a callable `dispose({sessionId, disposition, pipeline, lead, callDuration, refundReviewPending})`. Adds iSpeed pipeline (`VJwMSSMaP8KhiPiUfSG0`), HOT/WARM/COLD tag writes, and "Refund Review Pending" tag (iSpeed only per spec). |
| `dialer-server.js`    | `/healthz` now reports Phase-2b readiness (endpoint URLs + Thunder env presence). Startup log calls out enabled/disabled state. |

### Conservative decisions made without asking

1. **SMS to Chris → Telegram.** `.env` has no SMS provider configured; every
   other Jarvis path uses Telegram. `dialer-alerts.notifyHot()` swaps SMS for
   a structured Telegram message including transcript and collected fields.
   Swap by editing one function once a messaging profile is provisioned.
2. **VAD is pure-Node RMS endpointing** (not webrtcvad). Telephony 8 kHz mono
   makes a simple energy-gate + 600 ms silence hangover viable, and it avoids
   a Python sidecar. Drop-in replacement point is `frameRms()`/`detectSpeech`
   inside `dialer-vad.js`.
3. **HTTP service URLs default to local 127.0.0.1** so they ride the same
   SSH-tunnel pattern as the existing `f5-tunnel` PM2 process. Phase-2b
   assumes Whisper V3 Turbo on `:8801`, Llama 3.3 70B on `:8802` (both
   Instance 1), Gemma 3 27B on `:8803` (Instance 2). F5-TTS on `:8800` is
   already up via `f5-tunnel`. The other three tunnels do **not** exist yet —
   they are the gating prereq before flipping `DIALER_PHASE2B_ENABLED=true`.
4. **Pipeline detection from lead metadata.** `pipelineFor(lead)` looks at
   `lead.source` / `lead.pipeline` strings — anything containing
   `ispeed` / `speed-to-lead` / `crm` routes to the iSpeed pipeline; default
   is VA Leads. iSpeed leads can receive the "Refund Review Pending" tag;
   cold outbound (VA Leads) cannot, per spec.
5. **iSpeed stage IDs** are not hardcoded — they're env-overridable
   (`ISPEED_STAGE_HOT|WARM|COLD`). Until ops fills them in, iSpeed disposition
   updates fall back to tag-only (HOT/WARM/COLD tag + Refund Review Pending
   tag). VA Leads has full stage-ID mapping as before.
6. **Feature flag default off.** `DIALER_PHASE2B_ENABLED` is unset → behavior
   identical to Phase-2a (opener plays, then bridge Chris). This means the
   deploy is safe; activation is a one-line `.env` change after prereqs.
7. **No new snapshot of the dialer-side anything was created.** A Thunder
   instance snapshot named `phase2b-qualify-v1` cannot be created until the
   Instance-1 stack (Whisper + Llama servers) is actually running on Thunder
   — see prereqs below. Documented for the next session.

### Prereqs to flip `DIALER_PHASE2B_ENABLED=true`

1. **Whisper V3 Turbo HTTP server on Instance 1, port 8801.**
   Same SSH-tunnel pattern as `f5-tunnel`. Endpoint: `POST /transcribe` with
   body `Content-Type: audio/wav`, returns `{ "text": "..." }`.
2. **Llama 3.3 70B server on Instance 1, port 8802.**
   Endpoint: `POST /generate` with `{ messages, max_tokens, temperature, stop }`,
   returns `{ "text": "..." }` (Ollama or vLLM both fine).
3. **Gemma 3 27B server on Instance 2, port 8803.**
   Endpoint: `POST /decide` with `{ lead, pipeline, history, seller_latest }`,
   returns `{ verdict: 'CONTINUE'|'HOT'|'WARM'|'COLD'|'REFUND_REVIEW',
   motivation, timeline, asking_price, condition, summary, guidance }`.
   This is a structured-output prompt — Gemma needs to be wrapped in a small
   FastAPI shim that produces JSON. (See `ARCHITECTURE.md` Phase-2a's
   `f5-server.py` for the template.)
4. **PM2 SSH tunnels** to Instance 1 (`:8801`, `:8802`) and Instance 2 (`:8803`)
   mirroring the existing `f5-tunnel` process.
5. **`.env` additions** (in `/root/asaparv-agent/.env`):
   ```
   DIALER_PHASE2B_ENABLED=true
   THUNDER_TOKEN=<copy from /opt/thunder-chat-proxy/.env>
   INSTANCE_1_SNAPSHOT=<name of Instance-1 snapshot once created>
   INSTANCE_2_SNAPSHOT=<name of Instance-2 snapshot once created>
   # Optional override per-endpoint (defaults shown):
   # WHISPER_URL=http://127.0.0.1:8801
   # F5TTS_URL=http://127.0.0.1:8800
   # LLAMA_URL=http://127.0.0.1:8802
   # GEMMA_URL=http://127.0.0.1:8803
   # ISPEED_STAGE_HOT|WARM|COLD=<stage UUIDs once ops looks them up>
   ```
6. **Phone test** by enabling on one Telnyx call (e.g. `/dialer/call` with a
   single lead pointing at your mobile). Confirm: opener plays → David's
   first line plays → you answer → David continues. Watch `pm2 logs
   multi-dialer | grep david-brain` for the full conversation transcript.
7. **After phone test passes**, snapshot Instance 1 and Instance 2 with
   the Thunder snapshot endpoint (see Phase-2a doc), record the snapshot
   names in `.env`, then spin down the live instances. Suggested snapshot
   name: `phase2b-qualify-v1` (Instance 1) and `phase2b-gemma-v1` (Instance 2).

### Backups

All edited files backed up before this Phase-2b deploy:
```
/root/asaparv-agent/backups/phase2b-qualify/
├── ARCHITECTURE.md
├── dialer-disposition.js
├── dialer-recording.js
├── dialer-server.js
├── dialer-thunder-instances.js
└── dialer-webhook.js
```
