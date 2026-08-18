'use client';

/**
 * Conversations — one lead, everything that ever happened to them.
 *
 * The dashboard already showed calls in five different places (CallCenter,
 * SarahBoard, Leads, DavidHQ, MultiDialer), each with its own slice. What it
 * never showed was a lead's history as a single thread: call, text, call,
 * appointment, in the order it happened. That is the view a VA works out of,
 * and it is what this replaces the pile with.
 *
 * Degrades on purpose. jarvis_messages and jarvis_appointments do not exist
 * until the migration is run, and SMS itself is gated on 10DLC registration.
 * Missing tables render as an empty rail with a note — never a broken screen.
 * (MultiDialer selected a column that did not exist and silently showed zero
 * calls for months; that failure mode is exactly what the guards here avoid.)
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, MessageSquare, CalendarCheck, ChevronDown, Search, Repeat } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const TEST_PHONE = '3479704969';           // Chris's own handset — not a lead
const AUTO_REFRESH_MS = 120_000;   // 2 min; calls do not land faster than that

/* last 10 digits: jarvis_calls stores +1XXXXXXXXXX, GHL stores (XXX) XXX-XXXX */
const pkey = (p?: string | null) => (p || '').replace(/\D/g, '').slice(-10);

type Kind = 'call' | 'text' | 'appointment';

interface Entry {
  id: string;
  callId?: number | string;      // for the lazy transcript fetch
  kind: Kind;
  at: string;
  duration?: number | null;
  verdict?: string | null;
  summary?: string | null;
  transcript?: string | null;
  recordingUrl?: string | null;
  direction?: 'inbound' | 'outbound';
  body?: string | null;
  status?: string | null;
}

type Source = 'sarah' | 'scout';

interface Thread {
  key: string;
  source: Source;
  name: string;
  phone: string;
  address: string | null;
  entries: Entry[];
  callCount: number;
  lastAt: string;
  lastVerdict: string | null;
  appointmentAt: string | null;
}

/**
 * Scout and Sarah are different operations and must not be mixed in one list.
 * Scout is the multi-line cold dialer that GENERATES leads off cold lists.
 * Sarah works leads that already exist in the CRM — bought through iSpeed to
 * Lead / PPL / PPC, or property leads — qualifying them into deals. The
 * disposition writer stamps that difference into stage_before ('Multi-Dialer'
 * vs the GHL stage the lead came from), so it is recoverable per call.
 */
const sourceOf = (stageBefore?: string | null): Source =>
  /multi.?dialer/i.test(String(stageBefore || '')) ? 'scout' : 'sarah';

const VERDICT_COLOR: Record<string, string> = {
  HOT: '#ff453a', WARM: '#ff9f0a', COLD: '#0a84ff', DEAD: '#52526e',
};
const verdictColor = (v?: string | null) =>
  VERDICT_COLOR[String(v || '').toUpperCase()] || '#52526e';

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function fmtDur(s?: number | null) {
  if (!s) return '—';
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function Conversations() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [source, setSource]   = useState<Source | 'all'>('sarah');
  const [loading, setLoading] = useState(true);
  const [notes, setNotes]     = useState<string[]>([]);   // which sources are unavailable
  const [tick, setTick]       = useState(0);

  // Poll only while the tab is visible. A dashboard left open in a background
  // tab was refetching every 30s forever, which is egress spent on nobody.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setTick(t => t + 1);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);

    (async () => {
      const gaps: string[] = [];

      const callsQ = supabase
        .from('jarvis_calls')
        // Deliberately NOT selecting transcript_full here. On the free plan the
        // binding limit is egress, not storage (49 MB of data was generating
        // 1.2 GB of transfer in six days), and transcripts are ~95% of a call
        // row's bytes. They load on expand instead — see EntryCard.
        .select('id,contact_name,phone,address,call_duration,stage_after,stage_before,summary,recording_url,telnyx_recording_url,elevenlabs_recording_url,called_at')
        .order('called_at', { ascending: false })
        .limit(500);

      // These two tables may not exist yet. Query them independently so one
      // missing table cannot take the whole screen down with it.
      const msgsQ = supabase
        .from('jarvis_messages')
        .select('id,phone,contact_name,direction,body,status,sent_at')
        .order('sent_at', { ascending: false })
        .limit(500);

      const apptQ = supabase
        .from('jarvis_appointments')
        .select('id,phone,contact_name,starts_at,status')
        .neq('status', 'cancelled');

      const [callR, msgR, apptR] = await Promise.all([callsQ, msgsQ, apptQ]);
      if (!live) return;

      if (callR.error) gaps.push(`calls unavailable: ${callR.error.message}`);
      if (msgR.error)  gaps.push('texts: table not created yet — run the migration, and SMS needs 10DLC');
      if (apptR.error) gaps.push('appointments: table not created yet — run the migration');

      const map = new Map<string, Thread>();
      const touch = (phone: string | null, name?: string | null, address?: string | null, source: Source = 'sarah') => {
        const k = pkey(phone);
        if (!k || k === TEST_PHONE) return null;
        let t = map.get(k);
        if (!t) {
          t = { key: k, source, name: name || 'Unknown', phone: phone || k, address: address || null,
                entries: [], callCount: 0, lastAt: '', lastVerdict: null, appointmentAt: null };
          map.set(k, t);
        }
        if (name && t.name === 'Unknown') t.name = name;
        if (address && !t.address) t.address = address;
        return t;
      };

      for (const c of callR.data || []) {
        const t = touch(c.phone, c.contact_name, c.address, sourceOf(c.stage_before));
        if (!t) continue;
        t.callCount += 1;
        t.entries.push({
          id: `c${c.id}`, kind: 'call', at: c.called_at,
          duration: c.call_duration, verdict: c.stage_after, summary: c.summary,

          recordingUrl: c.telnyx_recording_url || c.recording_url || c.elevenlabs_recording_url || null,
        });
      }
      for (const m of msgR.data || []) {
        const t = touch(m.phone, m.contact_name);
        if (!t) continue;
        t.entries.push({
          id: `m${m.id}`, kind: 'text', at: m.sent_at,
          direction: m.direction, body: m.body, status: m.status,
        });
      }
      for (const a of apptR.data || []) {
        const t = touch(a.phone, a.contact_name);
        if (!t) continue;
        t.appointmentAt = a.starts_at;
        t.entries.push({ id: `a${a.id}`, kind: 'appointment', at: a.starts_at, status: a.status });
      }

      const list: Thread[] = Array.from(map.values()).map((t: Thread) => {
        t.entries.sort((x: Entry, y: Entry) => +new Date(y.at) - +new Date(x.at));
        const lastCall = t.entries.find((e: Entry) => e.kind === 'call');
        t.lastAt = t.entries[0]?.at || '';
        t.lastVerdict = lastCall?.verdict || null;
        return t;
      }).sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));

      setThreads(list);
      setNotes(gaps);
      setLoading(false);
      setSelected(prev => prev && list.some(t => t.key === prev) ? prev : list[0]?.key ?? null);
    })();

    return () => { live = false; };
  }, [tick]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const bySource = source === 'all' ? threads : threads.filter(t => t.source === source);
    if (!q) return bySource;
    return bySource.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.phone.includes(q.replace(/\D/g, '')) ||
      (t.address || '').toLowerCase().includes(q));
  }, [threads, query, source]);

  const active = threads.find(t => t.key === selected) || null;
  const counts = useMemo(() => ({
    sarah: threads.filter(t => t.source === 'sarah').length,
    scout: threads.filter(t => t.source === 'scout').length,
    all:   threads.length,
  }), [threads]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-textb">Conversations</h2>
          <p className="text-[11px] text-dimtext">Every call, text and appointment for a lead, in one thread. Sarah works CRM leads; Scout works cold lists.</p>
        </div>
        <div className="text-[10px] text-dimtext tabular-nums">
          {threads.length} leads · {threads.reduce((s, t) => s + t.callCount, 0)} calls
        </div>
      </div>

      {notes.length > 0 && (
        <div className="rounded-lg border border-border2 px-3 py-2 text-[10.5px] text-dimtext" style={{ background: 'rgba(255,159,10,0.06)' }}>
          {notes.map((n, i) => <div key={i}>· {n}</div>)}
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(220px, 300px) 1fr' }}>
        {/* ── lead rail ─────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border2 overflow-hidden flex flex-col" style={{ background: 'rgba(255,255,255,0.015)', maxHeight: '70vh' }}>
          <div className="flex border-b border-border2">
            {([['sarah', 'Sarah'], ['scout', 'Scout'], ['all', 'All']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setSource(k)}
                className="flex-1 px-2 py-1.5 text-[10px] transition-colors"
                style={{
                  color: source === k ? '#64d2ff' : 'var(--dimtext)',
                  borderBottom: source === k ? '2px solid #64d2ff' : '2px solid transparent',
                }}>
                {label} <span className="tabular-nums opacity-70">{counts[k]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border2">
            <Search size={12} className="text-dimtext flex-shrink-0" />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="name, phone or address"
              className="bg-transparent text-[11px] text-textb placeholder:text-dimtext outline-none w-full"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {loading && <div className="text-dimtext text-[11px] italic p-4 text-center">Loading…</div>}
            {!loading && !filtered.length && <div className="text-dimtext text-[11px] italic p-4 text-center">No leads found.</div>}
            {filtered.map(t => (
              <button key={t.key} onClick={() => setSelected(t.key)}
                className="w-full text-left px-3 py-2.5 border-b border-border2 transition-colors"
                style={{ background: t.key === selected ? 'rgba(10,132,255,0.10)' : 'transparent' }}>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: verdictColor(t.lastVerdict) }} />
                  <span className="text-[11.5px] text-textb font-medium truncate flex-1">{t.name}</span>
                  {t.appointmentAt && <CalendarCheck size={11} style={{ color: '#30d158' }} />}
                </div>
                <div className="text-[10px] text-dimtext truncate mt-0.5">{t.address || t.phone}</div>
                <div className="flex items-center gap-2 mt-1 text-[9.5px] text-dimtext tabular-nums">
                  <span className="flex items-center gap-1"><Repeat size={9} />{t.callCount}×</span>
                  {t.lastAt && <span>{timeAgo(t.lastAt)}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── thread ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border2 overflow-hidden flex flex-col" style={{ background: 'rgba(255,255,255,0.015)', maxHeight: '70vh' }}>
          {!active ? (
            <div className="text-dimtext text-[11px] italic p-8 text-center">Pick a lead to see the conversation.</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border2">
                <div className="text-[13px] font-semibold text-textb">{active.name}</div>
                <div className="text-[10.5px] text-dimtext">
                  {active.phone}{active.address ? ` · ${active.address}` : ''}
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] tabular-nums">
                  <span className="text-dimtext">reached out <span className="text-textb">{active.callCount}</span> {active.callCount === 1 ? 'time' : 'times'}</span>
                  {active.lastVerdict && (
                    <span className="px-1.5 py-0.5 rounded" style={{ background: `${verdictColor(active.lastVerdict)}20`, color: verdictColor(active.lastVerdict) }}>
                      {active.lastVerdict}
                    </span>
                  )}
                  {active.appointmentAt && (
                    <span className="flex items-center gap-1" style={{ color: '#30d158' }}>
                      <CalendarCheck size={10} /> {fmtWhen(active.appointmentAt)}
                    </span>
                  )}
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-2">
                {active.entries.map(e => <EntryCard key={e.id} entry={e} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(entry.transcript ?? null);
  const [loadingTx, setLoadingTx] = useState(false);

  // One row, one column, only when the user actually opens the call.
  useEffect(() => {
    if (!open || transcript !== null || entry.kind !== 'call' || !entry.callId) return;
    let live = true;
    setLoadingTx(true);
    supabase.from('jarvis_calls').select('transcript_full').eq('id', entry.callId).single()
      .then(({ data }) => { if (live) { setTranscript(data?.transcript_full ?? ''); setLoadingTx(false); } });
    return () => { live = false; };
  }, [open, transcript, entry.kind, entry.callId]);

  if (entry.kind === 'appointment') {
    return (
      <div className="rounded-lg border px-3 py-2 flex items-center gap-2"
           style={{ borderColor: 'rgba(48,209,88,0.35)', background: 'rgba(48,209,88,0.07)' }}>
        <CalendarCheck size={13} style={{ color: '#30d158' }} />
        <span className="text-[11px] text-textb">Appointment with Chris</span>
        <span className="text-[10px] text-dimtext ml-auto tabular-nums">{fmtWhen(entry.at)}</span>
      </div>
    );
  }

  if (entry.kind === 'text') {
    const out = entry.direction === 'outbound';
    return (
      <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
        <div className="rounded-lg px-3 py-2 max-w-[78%]"
             style={{ background: out ? 'rgba(10,132,255,0.14)' : 'rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <MessageSquare size={9} className="text-dimtext" />
            <span className="text-[9px] text-dimtext">{out ? 'Sarah' : 'Seller'} · {fmtWhen(entry.at)}</span>
            {entry.status === 'failed' && <span className="text-[9px]" style={{ color: '#ff453a' }}>failed</span>}
          </div>
          <div className="text-[11px] text-jtext whitespace-pre-wrap leading-relaxed">{entry.body}</div>
        </div>
      </div>
    );
  }

  // call
  return (
    <div className="rounded-lg border border-border2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left">
        <Phone size={12} style={{ color: verdictColor(entry.verdict) }} className="flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-textb">{fmtWhen(entry.at)}</div>
          {entry.verdict && <div className="text-[9.5px]" style={{ color: verdictColor(entry.verdict) }}>{entry.verdict}</div>}
        </div>
        <span className="text-[10px] text-dimtext tabular-nums flex-shrink-0">{fmtDur(entry.duration)}</span>
        {entry.recordingUrl && <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: 'rgba(191,90,242,0.15)', color: '#bf5af2' }}>audio</span>}
        <ChevronDown size={13} className="text-dimtext flex-shrink-0 transition-transform" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="px-3 pb-3 pt-0.5">
              {entry.recordingUrl && <audio src={entry.recordingUrl} controls className="w-full h-8 mb-2" />}
              {entry.summary && <p className="text-[11px] text-jtext leading-relaxed whitespace-pre-wrap mb-2">{entry.summary}</p>}
              {loadingTx && <p className="text-[10px] text-dimtext italic">Loading transcript…</p>}
              {!loadingTx && transcript ? (
                <pre className="text-[10.5px] text-jtext leading-relaxed whitespace-pre-wrap font-sans border-t border-border2 pt-2 max-h-[320px] overflow-y-auto">{transcript}</pre>
              ) : (
                !loadingTx && !entry.summary && <p className="text-[10px] text-dimtext italic">No transcript recorded for this call.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
