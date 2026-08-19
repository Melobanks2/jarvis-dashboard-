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

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, MessageSquare, CalendarCheck, ChevronDown, Search, Repeat, StickyNote, Plus, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { photoUrlFor, uploadPropertyPhoto, removePropertyPhoto } from '@/lib/propertyPhoto';

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
type Lane   = 'ispeed' | 'va_leads' | 'scout' | 'other';

/** The qualification facts, as stored on jarvis_calls.collected (migration 002). */
interface Facts {
  motivation?: string | null;
  timeline_thinking?: string | null;
  asking_price?: string | null;
  occupancy_status?: string | null;
  ownership_length?: string | null;
  mortgage_payoff?: string | null;
  condition?: string | null;
  pain_type?: string | null;
  deal_type?: string | null;
  ghl_stage?: string | null;
}

interface Thread {
  key: string;
  source: Source;
  lane: Lane;
  facts: Facts | null;
  dealType: string | null;
  photoUrl: string | null;
  stage: string | null;
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

/**
 * Sarah's leads are not one pool. iSpeed leads are bought per-lead and carry
 * refund deadlines; va_leads come from the property-lead pipeline. Chris works
 * them differently, so the view separates them rather than averaging them.
 */
const laneOf = (pipeline?: string | null, source?: Source): Lane => {
  if (source === 'scout') return 'scout';
  const p = String(pipeline || '').toLowerCase();
  if (p.includes('ispeed')) return 'ispeed';
  if (p.includes('va_leads') || p.includes('property')) return 'va_leads';
  return 'other';
};

const LANE_LABEL: Record<Lane, string> = {
  ispeed: 'iSpeed', va_leads: 'Property', scout: 'Scout', other: 'Other',
};

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
  const [lane, setLane]       = useState<Lane | 'sarah' | 'all'>('sarah');
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
        .select('id,contact_name,phone,address,call_duration,stage_after,stage_before,summary,recording_url,telnyx_recording_url,elevenlabs_recording_url,called_at,collected,pipeline,deal_type,photo_url')
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
          t = { key: k, source, lane: 'other', facts: null, dealType: null, photoUrl: null, stage: null,
                name: name || 'Unknown', phone: phone || k, address: address || null,
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
        // Newest call wins — the query is ordered called_at desc, so the first
        // row we see for a phone is the most recent thing we know about them.
        if (!t.facts && c.collected)  t.facts    = c.collected as Facts;
        if (!t.dealType && c.deal_type) t.dealType = c.deal_type;
        if (!t.photoUrl && c.photo_url) t.photoUrl = c.photo_url;
        if (!t.stage && c.stage_before) t.stage    = c.stage_before;
        if (t.lane === 'other') t.lane = laneOf(c.pipeline, t.source);
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
    const inLane = lane === 'all'   ? threads
                 : lane === 'sarah' ? threads.filter(t => t.source === 'sarah')
                 : threads.filter(t => t.lane === lane);
    if (!q) return inLane;
    return inLane.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.phone.includes(q.replace(/\D/g, '')) ||
      (t.address || '').toLowerCase().includes(q));
  }, [threads, query, lane]);

  const active = threads.find(t => t.key === selected) || null;
  const counts = useMemo(() => ({
    sarah:    threads.filter(t => t.source === 'sarah').length,
    ispeed:   threads.filter(t => t.lane === 'ispeed').length,
    va_leads: threads.filter(t => t.lane === 'va_leads').length,
    scout:    threads.filter(t => t.source === 'scout').length,
    other:    threads.filter(t => t.lane === 'other').length,
    all:      threads.length,
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
            {([['sarah', 'All Sarah'], ['ispeed', 'iSpeed'], ['va_leads', 'Property'], ['scout', 'Scout']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setLane(k)}
                className="flex-1 px-1.5 py-1.5 text-[9.5px] transition-colors whitespace-nowrap"
                style={{
                  color: lane === k ? '#64d2ff' : 'var(--dimtext)',
                  borderBottom: lane === k ? '2px solid #64d2ff' : '2px solid transparent',
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
                {/* One line of why-this-lead-matters, so the rail is scannable
                    without opening every thread. */}
                {(t.facts?.motivation || t.facts?.timeline_thinking) && (
                  <div className="text-[9.5px] truncate mt-0.5" style={{ color: '#64d2ff' }}>
                    {[t.facts?.motivation, t.facts?.timeline_thinking].filter(Boolean).join(' · ')}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1 text-[9.5px] text-dimtext tabular-nums">
                  <span className="flex items-center gap-1"><Repeat size={9} />{t.callCount}×</span>
                  {t.lastAt && <span>{timeAgo(t.lastAt)}</span>}
                  <span className="ml-auto opacity-70">{LANE_LABEL[t.lane]}</span>
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
              <LeadHeader t={active} />
              <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-2">
                {active.entries.map(e => <EntryCard key={e.id} entry={e} />)}
              </div>
              <Composer phone={active.phone} name={active.name} onSent={() => setTick(t => t + 1)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Everything known about the lead, above the conversation.
 *
 * The point is recognition at a glance: Chris should not have to open a
 * transcript to remember who this is or what they want. Facts come from
 * jarvis_calls.collected, which the dialer now writes on every call and which
 * was backfilled from the GHL custom fields for calls made before that.
 */
function LeadHeader({ t }: { t: Thread }) {
  const f = t.facts || {};
  const money = (v?: string | null) => {
    if (!v) return null;
    const n = String(v).replace(/[^0-9.]/g, '');
    if (!n || Number.isNaN(Number(n))) return String(v);   // "no price given"
    return '$' + Number(n).toLocaleString('en-US');
  };
  const rows: [string, string | null][] = [
    ['Motivation', f.motivation || f.pain_type || null],
    ['Timeline',   f.timeline_thinking || null],
    ['Asking',     money(f.asking_price)],
    ['Occupancy',  f.occupancy_status || null],
    ['Owned',      f.ownership_length || null],
    ['Mortgage',   money(f.mortgage_payoff)],
    ['Condition',  f.condition || null],
  ].filter((r): r is [string, string] => Boolean(r[1]));

  return (
    <div className="px-4 py-3 border-b border-border2">
      <div className="flex gap-3">
        <PropertyThumb address={t.address} phone={t.phone} photoUrl={t.photoUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-textb">{t.name}</span>
            {t.lastVerdict && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                    style={{ background: `${verdictColor(t.lastVerdict)}20`, color: verdictColor(t.lastVerdict) }}>
                {t.lastVerdict}
              </span>
            )}
            {t.dealType && t.dealType !== 'either' && (
              <span className="px-1.5 py-0.5 rounded text-[9px]"
                    style={{ background: 'rgba(191,90,242,0.15)', color: '#bf5af2' }}>
                {t.dealType}
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded text-[9px]"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--dimtext)' }}>
              {LANE_LABEL[t.lane]}
            </span>
          </div>
          {t.address && <div className="text-[11px] text-jtext mt-0.5">{t.address}</div>}
          <div className="flex items-center gap-3 mt-1 text-[10px] text-dimtext tabular-nums flex-wrap">
            <span>{t.phone}</span>
            <span className="flex items-center gap-1"><Repeat size={9} />{t.callCount}×</span>
            {t.stage && <span>{t.stage}</span>}
            {t.appointmentAt && (
              <span className="flex items-center gap-1" style={{ color: '#30d158' }}>
                <CalendarCheck size={10} /> {fmtWhen(t.appointmentAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="grid gap-x-4 gap-y-1 mt-2.5 pt-2.5 border-t border-border2"
             style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {rows.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <div className="text-[8.5px] uppercase tracking-wider text-dimtext">{k}</div>
              <div className="text-[11px] text-textb truncate" title={v || ''}>{v}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2.5 pt-2.5 border-t border-border2 text-[10px] text-dimtext italic">
          No qualification facts on file for this lead yet.
        </div>
      )}

      <LeadNotes phoneKey={t.key} contactName={t.name} />
    </div>
  );
}

/**
 * Chris's own notes, separate from the AI call summary.
 *
 * The summary is what Sarah heard; this is what Chris concluded. Keeping them
 * apart matters — an AI summary that quietly absorbed a human correction would
 * make it impossible to tell which is which later.
 */
function LeadNotes({ phoneKey, contactName }: { phoneKey: string; contactName: string }) {
  const [notes, setNotes]   = useState<{ id: number; body: string; created_at: string }[]>([]);
  const [draft, setDraft]   = useState('');
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setNotes([]); setDraft(''); setOpen(false);
    supabase.from('jarvis_lead_notes')
      .select('id,body,created_at').eq('phone_key', phoneKey)
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { if (live && data) setNotes(data as typeof notes); });
    return () => { live = false; };
  }, [phoneKey]);

  const save = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    const { data, error } = await supabase.from('jarvis_lead_notes')
      .insert({ phone_key: phoneKey, contact_name: contactName, body, author: 'chris' })
      .select('id,body,created_at').single();
    if (!error && data) { setNotes(n => [data as typeof notes[0], ...n]); setDraft(''); }
    setSaving(false);
  };

  const remove = async (id: number) => {
    await supabase.from('jarvis_lead_notes').delete().eq('id', id);
    setNotes(n => n.filter(x => x.id !== id));
  };

  return (
    <div className="mt-2.5 pt-2.5 border-t border-border2">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-dimtext hover:text-textb">
        <StickyNote size={10} /> Notes
        {notes.length > 0 && <span className="tabular-nums" style={{ color: '#ff9f0a' }}>{notes.length}</span>}
        <ChevronDown size={10} className="transition-transform" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
      </button>

      {!open && notes.length > 0 && (
        <div className="text-[10.5px] text-jtext mt-1 truncate">{notes[0].body}</div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="flex gap-1.5 mt-2">
              <textarea
                value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }}
                placeholder="What happened on this lead? (⌘↵ to save)"
                rows={2}
                className="flex-1 rounded-lg border border-border2 bg-transparent px-2 py-1.5 text-[11px] text-textb placeholder:text-dimtext outline-none resize-none"
              />
              <button onClick={save} disabled={!draft.trim() || saving}
                className="px-2 rounded-lg text-[10px] disabled:opacity-40 self-stretch"
                style={{ background: 'rgba(100,210,255,0.14)', color: '#64d2ff' }}>
                <Plus size={12} />
              </button>
            </div>
            <div className="flex flex-col gap-1 mt-2">
              {notes.map(n => (
                <div key={n.id} className="group rounded-lg px-2 py-1.5" style={{ background: 'rgba(255,159,10,0.06)' }}>
                  <div className="flex items-start gap-2">
                    <p className="text-[11px] text-jtext whitespace-pre-wrap leading-relaxed flex-1">{n.body}</p>
                    <button onClick={() => remove(n.id)} className="text-[9px] text-dimtext opacity-0 group-hover:opacity-100">✕</button>
                  </div>
                  <div className="text-[8.5px] text-dimtext mt-0.5 tabular-nums">{fmtWhen(n.created_at)}</div>
                </div>
              ))}
              {!notes.length && <p className="text-[10px] text-dimtext italic">No notes yet.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The property photo. Click to attach one, click again to replace it.
 *
 * Street View is still used when a maps key exists AND the address is complete
 * enough to resolve — but 45% of addresses on file are a street name with
 * nothing else, so an uploaded photo is the only thing that works for those.
 * An uploaded photo always wins: Chris chose it deliberately.
 */
function PropertyThumb({ address, phone, photoUrl, size = 64 }: {
  address: string | null; phone?: string | null; photoUrl?: string | null; size?: number;
}) {
  const [url, setUrl]     = useState<string | null>(photoUrl || photoUrlFor(phone) || null);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setUrl(photoUrl || photoUrlFor(phone) || null);
    setMissing(false); setErr(null);
  }, [phone, photoUrl]);

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  const resolvable = !!address && /\b\d{5}\b/.test(address);   // needs a ZIP to look up
  const streetView = mapsKey && resolvable && address
    ? `https://maps.googleapis.com/maps/api/streetview?size=${size * 3}x${size * 3}&location=${encodeURIComponent(address)}&key=${mapsKey}`
    : null;

  const shown = (!missing && url) || streetView;
  const houseNo = String(address || '').trim().split(/\s+/)[0] || '?';

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr(null);
    const r = await uploadPropertyPhoto(phone, file);
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'Upload failed'); return; }
    setMissing(false); setUrl(r.url || photoUrlFor(phone, Date.now()));
  }

  async function onRemove(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    await removePropertyPhoto(phone);
    setBusy(false); setUrl(null); setMissing(true);
  }

  return (
    <div className="relative flex-shrink-0 group" style={{ width: size, height: size }}>
      <input ref={inputRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
      <button
        onClick={() => inputRef.current?.click()}
        title={shown ? 'Click to replace this photo' : 'Click to add a photo'}
        className="w-full h-full rounded-lg overflow-hidden flex items-center justify-center"
        style={{
          background: shown ? 'rgba(255,255,255,0.04)' : 'rgba(100,210,255,0.08)',
          border: '1px solid var(--border2)',
        }}>
        {shown ? (
          <img src={shown} alt="" onError={() => setMissing(true)}
               className="w-full h-full object-cover" />
        ) : (
          <span className="text-[13px] font-semibold" style={{ color: '#64d2ff' }}>
            {busy ? '…' : houseNo}
          </span>
        )}
      </button>

      {!shown && !busy && (
        <span className="absolute inset-x-0 -bottom-4 text-[8px] text-center text-dimtext opacity-0 group-hover:opacity-100 transition-opacity">
          add photo
        </span>
      )}
      {url && !missing && (
        <button onClick={onRemove} title="Remove photo"
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(255,69,58,0.9)', color: '#fff' }}>×</button>
      )}
      {err && <div className="absolute top-full left-0 mt-1 text-[9px] whitespace-nowrap" style={{ color: '#ff453a' }}>{err}</div>}
    </div>
  );
}

/**
 * Send a text without leaving the thread.
 *
 * Posts to the dialer rather than Telnyx directly: the API key stays on the
 * server, and dialer-sms owns opt-out checking, the first-message disclosure
 * and writing the row. A browser that talked to Telnyx itself would have to
 * duplicate all of that and would drift.
 */
function Composer({ phone, name, onSent }: { phone: string; name: string; onSent: () => void }) {
  const [text, setText]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);
  const [ok, setOk]       = useState(false);

  const API = process.env.NEXT_PUBLIC_DIALER_API || '';

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null); setOk(false);
    try {
      const r = await fetch(`${API}/dialer/sms-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, body, contactName: name }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.reason || `HTTP ${r.status}`);
      setText(''); setOk(true); onSent();
      setTimeout(() => setOk(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-border2 p-2.5">
      <div className="flex gap-1.5 items-end">
        <textarea
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1} placeholder={`Text ${String(name).split(' ')[0] || 'this lead'}…  (Enter to send)`}
          className="flex-1 rounded-lg border border-border2 bg-transparent px-2.5 py-2 text-[11.5px] text-textb placeholder:text-dimtext outline-none resize-none"
          style={{ maxHeight: 90 }}
        />
        <button onClick={send} disabled={!text.trim() || busy}
          className="px-2.5 py-2 rounded-lg text-[11px] disabled:opacity-40 flex items-center gap-1"
          style={{ background: 'rgba(100,210,255,0.14)', color: '#64d2ff' }}>
          <Send size={12} />{busy ? '…' : ''}
        </button>
      </div>
      {err && <div className="text-[10px] mt-1" style={{ color: '#ff453a' }}>{err}</div>}
      {ok  && <div className="text-[10px] mt-1" style={{ color: '#30d158' }}>Sent</div>}
      <div className="text-[9px] text-dimtext mt-1">
        First message to a number automatically includes the opt-out line. STOP is honored permanently.
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
