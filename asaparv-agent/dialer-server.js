/**
 * Multi-Line Dialer — Express service
 *
 * Mounts on port 3007. Nginx on api.jarviscommandcenter.space proxies
 * /dialer/* → http://localhost:3007/dialer/*.
 *
 * Routes:
 *   POST /dialer/call             — start a 5-line session
 *   POST /dialer/webhook          — Telnyx Call Control callbacks
 *   GET  /dialer/status           — per-lane + David live state + progress
 *   GET  /dialer/progress         — session progress metrics (cursor, completed, remaining)
 *   POST /dialer/disposition      — push outcome to GHL
 *   GET  /dialer/session-summary  — totals at end of session
 *   GET  /dialer/healthz          — liveness + Phase-2b readiness
 */

'use strict';

require('dotenv').config({ path: '/root/asaparv-agent/.env' });

const http    = require('http');
const express = require('express');
const cors = require('cors');

const callRoute        = require('./dialer-call');
const webhookRoute     = require('./dialer-webhook');
const statusRoute      = require('./dialer-status');
const dispositionRoute = require('./dialer-disposition');
const summaryRoute     = require('./dialer-session-summary');
const progressRoute    = require('./dialer-progress');
const thunder          = require('./dialer-thunder-instances');
const recording        = require('./dialer-recording');
const stall            = require('./dialer-stall');
const leadsRoute       = require('./dialer-leads');

// Audio static-serving paths (formerly from dialer-opener.js, now fully removed).
const PUBLIC_URL_PREFIX = '/dialer/audio';
const CACHE_DIR         = '/root/asaparv-agent/audio/cache';

const PORT = parseInt(process.env.DIALER_PORT || '3007', 10);
const PHASE2B_ENABLED = process.env.DIALER_PHASE2B_ENABLED === 'true';

const app = express();

app.use(cors({
  origin: [
    'https://jarviscommandcenter.space',
    'https://www.jarviscommandcenter.space',
    'http://localhost:3000',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json({ limit: '1mb' }));

app.get('/dialer/healthz', (_req, res) => {
  res.json({
    ok: true,
    phase2b: {
      enabled: PHASE2B_ENABLED,
      stall_ready: stall.stallExists(),
      whisper_url: process.env.WHISPER_URL || 'http://127.0.0.1:8801',
      f5tts_url:   process.env.F5TTS_URL   || 'http://127.0.0.1:8800',
      qwen_url:    process.env.QWEN_URL    || 'http://127.0.0.1:8802',
      instance_1_snapshot: !!process.env.INSTANCE_1_SNAPSHOT,
      thunder_token:       !!process.env.THUNDER_TOKEN,
    },
    thunder: thunder.snapshotAll(),
  });
});

app.use(PUBLIC_URL_PREFIX, express.static(CACHE_DIR, {
  maxAge: 0,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store'); },
}));
app.use(PUBLIC_URL_PREFIX, express.static('/root/asaparv-agent/audio/static', {
  maxAge: '1h',
}));
// Pre-rendered David corpus MP3s (2026-05-29): /dialer/audio/corpus-david/<file>.mp3
app.use(PUBLIC_URL_PREFIX + '/corpus-sarah', express.static('/root/asaparv-agent/audio/corpus/sarah', {
  maxAge: '7d',
}));
app.use(PUBLIC_URL_PREFIX + '/corpus-david', express.static('/root/asaparv-agent/audio/corpus/david', {
  maxAge: '7d',
}));
// David hardcoded-script prerenders (2026-05-28): /dialer/audio/<callId>/<step>.wav
app.use(PUBLIC_URL_PREFIX, express.static('/root/asaparv-agent/audio/david-script', {
  maxAge: 0,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store'); },
}));

app.post('/dialer/call',            callRoute);
app.post('/dialer/webhook',         webhookRoute);
app.get('/dialer/status',           statusRoute);
app.get('/dialer/progress',         progressRoute);
app.post('/dialer/disposition',     dispositionRoute);
app.get('/dialer/session-summary',  summaryRoute);

// Leads dashboard (served here because Vercel Hobby is at its 12-function cap)
app.get('/dialer/leads',        leadsRoute.list);
app.post('/dialer/lead-action',  leadsRoute.action);

app.use((err, _req, res, _next) => {
  console.error('[dialer] unhandled error:', err);
  res.status(500).json({ error: err.message || 'internal error' });
});

const server = http.createServer(app);
recording.attachRecordingWss(server);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dialer] listening on http://127.0.0.1:${PORT}`);
  console.log(`[dialer] thunder instance-1 idle=${thunder.instance1.idleMs}ms (DAVID — Qwen 2.5 14B)`);
  if (PHASE2B_ENABLED) {
    console.log('[dialer] PHASE-2B ENABLED — qualification loop active. Requires Thunder + Whisper/Qwen/F5-TTS endpoints reachable.');
  } else {
    console.log('[dialer] PHASE-2B disabled (set DIALER_PHASE2B_ENABLED=true to activate). Opener-end → Chris bridge.');
  }
});
