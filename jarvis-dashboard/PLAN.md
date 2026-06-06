# 🛠 Jarvis Dashboard — Build Plan

## Current Phase: Multi-Dialer Voice Pipeline (Sarah AI)

### Objective
Improve the existing MultiDialer with real-time audio streaming using **pre-recorded Sarah WAV assets** for TTS and **Gemini API for STT**. No paid voice APIs. Context handoff to Jarvis Chat after each call.

---

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER (Dashboard — MultiDialer.tsx)                              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 1. Upload CSV leads                                         │    │
│  │ 2. Click "Start Dialing"                                    │    │
│  │ 3. Poll /dialer/status every 1.5s for:                      │    │
│  │    - Lane states (idle → ringing → connected → ended)        │    │
│  │    - Live transcript text (from Gemini STT on VPS)           │    │
│  │    - Sarah audio playback status                             │    │
│  │ 4. Display real-time transcript in TranscriptPanel           │    │
│  │ 5. After call ends → auto-generate summary → handoff to chat│    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Reads API keys from localStorage:                                  │
│  - jarvis_chat_settings → apiKeys.gemini.key                        │
│  - Passes key to VPS backend in request headers                     │
│                                                                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP (proxy through Vercel /api/*)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BACKEND (VPS: api.jarviscommandcenter.space)                       │
│                                                                     │
│  Voice Pipeline (per call):                                         │
│  ├── Telnyx → initiates outbound calls (5 lanes)                    │
│  ├── Telnyx Media Streams → incoming audio                          │
│  ├── STT: Gemini Speech-to-Text API (streaming)                     │
│  │   └── Uses API key from dashboard settings                       │
│  ├── LLM: David AI agent processes transcript                       │
│  ├── TTS: Pre-recorded Sarah WAV files (no API call needed)         │
│  │   ├── greet-prefix-24k.wav + greet-suffix-24k.wav                │
│  │   ├── line-*.wav (ballpark, condition, fact-find, etc.)          │
│  │   ├── pain-*.wav (divorce, inherited, landlord, etc.)            │
│  │   ├── obj-*.wav (are-you-ai, dnc, hostile, etc.)                │
│  │   └── closer-*.wav (cold, dead, hot-warm)                        │
│  ├── Audio streamed back through Telnyx Media Streams               │
│  └── Transcript + call data stored in Supabase                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Sarah Voice Asset Map

All WAV files live in `sarah-corpus/script-v4/` (24kHz mono):

| Category | File | Purpose |
|----------|------|---------|
| **Greeting** | `greet-prefix-24k.wav` | "Hi, this is Sarah from..." |
| | `greet-suffix-24k.wav` | "...calling about your property" |
| **Closer** | `closer-cold-24k.wav` | Cold lead closing script |
| | `closer-dead-24k.wav` | Dead lead closing script |
| | `closer-hot-warm-24k.wav` | Hot/warm lead closing script |
| **Lines** | `line-ballpark-24k.wav` | "Just ballpark, what were you thinking?" |
| | `line-condition-overall-24k.wav` | Property condition question |
| | `line-condition-systems-24k.wav` | Systems condition question |
| | `line-decision-makers-24k.wav` | Decision makers question |
| | `line-fact-find-24k.wav` | Fact finding question |
| | `line-occupancy-24k.wav` | Occupancy question |
| | `line-ownership-length-24k.wav` | Ownership length question |
| | `line-price-24k.wav` | Price discussion |
| | `line-pitch-24k.wav` | Value pitch |
| | `line-timeline-followup-24k.wav` | Timeline follow-up |
| | `line-timeline-thinking-24k.wav` | Timeline thinking |
| **Pain Points** | `pain-behind-24k.wav` | "Are you behind on payments?" |
| | `pain-divorce-24k.wav` | Divorce situation |
| | `pain-exploring-24k.wav` | Exploring options |
| | `pain-inherited-24k.wav` | Inherited property |
| | `pain-landlord-24k.wav` | Tired landlord |
| | `pain-relocating-24k.wav` | Relocating seller |
| | `pain-vacant-24k.wav` | Vacant property |
| **Objections** | `obj-are-you-ai-24k.wav` | "Are you AI?" |
| | `obj-dnc-24k.wav` | Do Not Contact |
| | `obj-give-me-offer-24k.wav` | "Give me an offer" |
| | `obj-hostile-24k.wav` | Hostile response |
| | `obj-not-interested-24k.wav` | Not interested |

---

### Implementation Phases

#### Phase 1: Frontend — Settings Panel (API Key Wiring)

**File:** `components/sections/IntelligenceChat.tsx`

**Changes:**
1. Add `gemini` as a provider option in `ProviderKey` type
2. Add input field in Chat Settings overlay (API KEYS section) for Gemini key
3. Export `getApiKey(provider: string): string | null` helper

```diff
-type ProviderKey = 'openrouter' | 'openai' | 'anthropic' | 'google';
+type ProviderKey = 'openrouter' | 'openai' | 'anthropic' | 'google' | 'gemini';

-const PROVIDER_LABELS: Record<ProviderKey, string> = { ... };
+const PROVIDER_LABELS: Record<ProviderKey, string> = {
+  openrouter: 'OpenRouter',
+  openai:     'OpenAI',
+  anthropic:  'Anthropic',
+  google:     'Google Gemini',
+  gemini:     'Gemini (Voice STT)',
+};

+export function getApiKey(provider: string): string | null { ... }
```

---

#### Phase 2: Frontend — MultiDialer Voice Integration

**File:** `components/sections/MultiDialer.tsx`

**Changes:**

##### 2a. Import getApiKey + add voice state
```diff
+import { getApiKey } from '@/components/sections/IntelligenceChat';

+// Voice settings state
+const [voiceSettings, setVoiceSettings] = useState(() => {
+  try {
+    const raw = localStorage.getItem('jarvis_dialer_settings');
+    return raw ? JSON.parse(raw) : {
+      sttProvider: 'gemini',
+      greetingMode: 'auto',  // auto = play greet-prefix + greet-suffix
+      scriptMode: 'auto',    // auto = play line-*.wav based on context
+    };
+  } catch {
+    return { sttProvider: 'gemini', greetingMode: 'auto', scriptMode: 'auto' };
+  }
+});
```

##### 2b. Pass Gemini API key in dial request
```diff
  // In dialNextBatch, add API key to request body:
  body: JSON.stringify({
    sessionId: sid,
    leads: batch,
    cursor: fromCursor,
    totalLeads: leads.length,
+   geminiApiKey: getApiKey('gemini'),
+   voiceSettings,
  }),
```

##### 2c. Upgrade TranscriptPanel (replace stub)
```diff
-function TranscriptPanel({ active }: { active: boolean }) {
-  return (
-    <div>
-      <span>Whisper pipeline pending — transcript will stream here.</span>
-    </div>
-  );
-}
+function TranscriptPanel({ active, transcript, speakingLead }: {
+  active: boolean;
+  transcript: TranscriptLine[];
+  speakingLead: 'david' | 'lead' | null;
+}) {
+  // Real-time scrollable transcript with speaker diarization
+  // - David lines: cyan (#00e5ff)
+  // - Lead lines: green (#00ff88)
+  // - System: dim (#52526e)
+}
```

##### 2d. Add transcript state + polling
```diff
+const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
+const [speakingLead, setSpeakingLead] = useState<'david' | 'lead' | null>(null);

// In startPolling, extract transcript from status response:
+if (data.transcript) setTranscript(data.transcript);
+if (data.speaking_lead) setSpeakingLead(data.speaking_lead);
```

##### 2e. Add AudioPlayer component
```diff
+function AudioPlayer({ audioUrl, label }: { audioUrl: string | null; label?: string }) {
+  // Plays TTS audio from backend (pre-recorded Sarah WAVs)
+  // Controls: play/pause, volume
+  // Auto-plays when audioUrl changes
+}
```

##### 2f. Add dialer settings gear panel
```diff
+function DialerSettings({ settings, onChange, onClose }: { ... }) {
+  // STT provider selector (Gemini only for now)
+  // Script mode (auto / manual)
+  // Greeting mode (auto / skip)
+  // Persisted to localStorage
+}
```

---

#### Phase 3: Frontend — Context Handoff to Jarvis Chat

**File:** `components/sections/MultiDialer.tsx`

When a call ends (disposition submitted), auto-generate a summary and push it to Jarvis Chat context:

```diff
  // In handleDisposition, after posting to backend:
+ const summaryPayload = {
+   lead: activeLead,
+   disposition: disp,
+   callDuration,
+   transcript: transcript.map(t => `${t.speaker}: ${t.text}`).join('\n'),
+   sessionId,
+ };
+
+ // Store summary in localStorage for Jarvis Chat to pick up
+ const handoffKey = 'jarvis_chat_handoff';
+ const existing = JSON.parse(localStorage.getItem(handoffKey) || '[]');
+ existing.push({
+   ...summaryPayload,
+   timestamp: new Date().toISOString(),
+   source: 'multi-dialer',
+ });
+ localStorage.setItem(handoffKey, JSON.stringify(existing));
+
+ // Clear transcript for next call
+ setTranscript([]);
+ setSpeakingLead(null);
```

**File:** `components/sections/IntelligenceChat.tsx`

In `buildSystemPrompt()` or on mount, check for handoff data:

```diff
+// On mount, check for dialer handoff context
+useEffect(() => {
+  const handoff = JSON.parse(localStorage.getItem('jarvis_chat_handoff') || '[]');
+  if (handoff.length > 0) {
+    // Prepend dialer context to system prompt
+    const contextBlock = handoff.map(h =>
+      `[DIALER CALL] ${h.lead.name} (${h.lead.phone}) — ${h.disposition}\n` +
+      `Duration: ${h.callDuration}s\nTranscript:\n${h.transcript}`
+    ).join('\n\n');
+    setSystemContext(prev => prev + '\n\n## Recent Dialer Activity\n' + contextBlock);
+    // Clear after reading
+    localStorage.removeItem('jarvis_chat_handoff');
+  }
+}, []);
```

---

#### Phase 4: Free-Tier Safety

Already implemented via `resolveOpenRouterModel()` + `OR_FREE_SUFFIX`. The dialer STT uses Gemini free tier (generativelanguage.googleapis.com with API key). TTS uses pre-recorded WAV files (no API call). No paid routes triggered.

---

### Implementation Order

| Step | Task | Files | Status |
|------|------|-------|--------|
| 1 | Add `gemini` + `elevenlabs` providers to ChatSettings | IntelligenceChat.tsx | ✅ Done |
| 2 | Export `getApiKey()` helper | IntelligenceChat.tsx | ✅ Done |
| 3 | Add dialer voice settings state | MultiDialer.tsx | ✅ Done |
| 4 | Pass Gemini API key in dial requests | MultiDialer.tsx | ✅ Done |
| 5 | Upgrade TranscriptPanel (real-time transcript) | MultiDialer.tsx | ✅ Done |
| 6 | Add AudioPlayer component | MultiDialer.tsx | ⬜ Deferred (audio_url from backend) |
| 7 | Add context handoff (MultiDialer → localStorage) | MultiDialer.tsx | ✅ Done |
| 8 | Add context handoff (localStorage → IntelligenceChat) | IntelligenceChat.tsx | ✅ Done |
| 9 | Update PLAN.md with completion status | PLAN.md | ✅ Done |
| 10 | Commit + push | git | ⬜ Pending |

---

### Safety Constraints

- **NO paid voice APIs** — Sarah WAV files used for TTS (pre-owned assets)
- **NO local model execution** — Gemini STT via API only
- **API keys in localStorage** — only sent to our VPS backend
- **Free-tier locked** — OpenRouter routes use `:free` suffix, Gemini uses free tier
- **Graceful degradation** — missing API key shows UI warning, doesn't crash

---

*Last updated: 2026-06-05 — Phase 1-3 implemented, AudioPlayer deferred pending backend audio_url support*
