'use client';

/**
 * Refund Desk — every filed claim as a ticket, with the reply thread on it.
 *
 * The deadline board answers "may I still file this?". This answers "what
 * happened after I filed?", and that is the half where money actually
 * disappears. Vendors do not just approve or deny — they come back asking for
 * call logs, and the claim sits waiting on YOU. Nothing on a deadline board
 * shows that, because the deadline is already behind you.
 *
 * So the board is ordered by whose move it is, not by age or value. The first
 * column is "Waiting on you", and it is the only one that gets an alarm colour.
 * A ticket sitting there is money already spent that is about to be written
 * off for want of an email.
 *
 * Vendor-agnostic: iSpeed today, property-lead vendors next.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, MessageSquare, Send, ChevronDown, Check, X, Clock, Plus,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead } from '@/lib/hooks/useLeads';
import { refundStatusOf } from '@/lib/refundRules';
import { DIALER_API } from '@/lib/config';

const API = `${DIALER_API}/dialer/refund-desk`;

type Status = 'ready' | 'submitted' | 'needs_response' | 'responded' | 'approved' | 'denied' | 'withdrawn';

interface ThreadMsg { at: string; from: string; text: string; status?: string }
interface Ticket {
  id: string; vendor: string; leadName: string; phone: string; address: string;
  price: number; attempts: number; reason: string; status: Status;
  purchasedAt?: number | null; deadlineAt?: number | null;
  submittedAt?: string | null; resolvedAt?: string | null;
  lastVendorReplyAt?: string | null;
  deniedReason?: string | null; amountRecovered?: number | null;
  thread: ThreadMsg[]; createdAt: string; updatedAt: string;
  waitingOnUsDays?: number | null; isOpen?: boolean; threadCount?: number;
}
interface Rollup {
  open: number; openValue: number; atRisk: number; atRiskValue: number;
  oldestWaitDays: number; recovered: number; recoveredValue: number;
  denied: number; deniedValue: number; decided: number;
  approvalRatePct: number | null; deniedReasons: Record<string, number>;
}

// Column order = whose move it is. "Waiting on you" leads because it is the
// only column where doing nothing costs money you have already spent.
const COLS: { id: Status; label: string; sub: string; color: string }[] = [
  { id: 'needs_response', label: 'Waiting on you', sub: 'vendor asked for something', color: '#ff453a' },
  { id: 'ready',          label: 'Ready to file',  sub: 'qualified, not sent',        color: '#64d2ff' },
  { id: 'submitted',      label: 'Filed',          sub: 'waiting on the vendor',      color: '#bf5af2' },
  { id: 'responded',      label: 'Answered',       sub: 'back in their court',        color: '#5e9cff' },
  { id: 'approved',       label: 'Recovered',      sub: 'money back',                 color: '#30d158' },
  { id: 'denied',         label: 'Denied',         sub: 'money gone — learn from it', color: '#ff9f0a' },
];

const REASON_LABEL: Record<string, string> = {
  no_response: 'No response', wrong_number: 'Wrong number', not_selling: 'Not selling',
  already_listed: 'Already listed', under_contract: 'Under contract', bad_info: 'Bad info',
  duplicate: 'Duplicate', other: 'Other', unspecified: 'Not recorded',
};

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US');
const digits10 = (p?: string | null) => String(p || '').replace(/\D/g, '').slice(-10);

export function RefundDesk() {
  const { refreshKey } = useApp();
  const { leads } = useLeads(refreshKey);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(API, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setTickets(j.tickets || []);
      setRollup(j.rollup || null);
      setErr(null);
    } catch (e) {
      setErr(`Refund desk unreachable: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const act = useCallback(async (action: string, body: Record<string, unknown>) => {
    const r = await fetch(`${API}?action=${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await load();
    return r.ok;
  }, [load]);

  // Leads that qualify to file but have no ticket yet — the desk's inbox.
  const fileable = useMemo(() => {
    const have = new Set(tickets.map(t => digits10(t.phone)));
    return leads.filter(l => {
      if (have.has(digits10(l.phone))) return false;
      return refundStatusOf(l).state === 'ready';
    });
  }, [leads, tickets]);

  const byStatus = useMemo(() => {
    const m: Record<Status, Ticket[]> = {
      ready: [], submitted: [], needs_response: [], responded: [],
      approved: [], denied: [], withdrawn: [],
    };
    for (const t of tickets) (m[t.status] ||= []).push(t);
    // Waiting-on-you: oldest first. That is the one about to be written off.
    m.needs_response.sort((a, b) => (b.waitingOnUsDays || 0) - (a.waitingOnUsDays || 0));
    return m;
  }, [tickets]);

  if (loading) return <div className="text-[12px] text-dimtext p-4">Loading refund desk…</div>;

  return (
    <div className="space-y-4">
      {err && (
        <div className="text-[11.5px] p-3 rounded-xl"
             style={{ background: 'rgba(255,69,58,0.12)', border: '1px solid rgba(255,69,58,0.3)', color: '#ff453a' }}>
          {err}
        </div>
      )}

      {rollup && (
        <GlassCard accent="purple" padding="p-4" hover={false}>
          <div className="flex flex-wrap gap-4">
            <Stat label="Waiting on you" value={money(rollup.atRiskValue)}
                  note={rollup.atRisk ? `${rollup.atRisk} claim${rollup.atRisk === 1 ? '' : 's'}${rollup.oldestWaitDays ? ` · oldest ${rollup.oldestWaitDays}d` : ''}` : 'nothing stuck'}
                  color={rollup.atRisk ? '#ff453a' : 'var(--dimtext)'} />
            <Stat label="Open claims" value={money(rollup.openValue)} note={`${rollup.open} in flight`} color="#bf5af2" />
            <Stat label="Recovered" value={money(rollup.recoveredValue)} note={`${rollup.recovered} approved`} color="#30d158" />
            <Stat label="Lost to denials" value={money(rollup.deniedValue)} note={`${rollup.denied} denied`} color="#ff9f0a" />
            <Stat label="Approval rate"
                  value={rollup.approvalRatePct == null ? '—' : `${rollup.approvalRatePct}%`}
                  note={rollup.decided ? `on ${rollup.decided} decided` : 'nothing decided yet'}
                  color={rollup.approvalRatePct == null ? 'var(--dimtext)' : '#64d2ff'} />
          </div>
        </GlassCard>
      )}

      {rollup && rollup.atRisk > 0 && (
        <div className="flex items-start gap-2 text-[11.5px] p-3 rounded-xl"
             style={{ background: 'rgba(255,69,58,0.12)', border: '1px solid rgba(255,69,58,0.3)', color: '#ff453a' }}>
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            <b>{money(rollup.atRiskValue)}</b> is sitting on your reply
            {rollup.oldestWaitDays > 0 && <> — the oldest has waited <b>{rollup.oldestWaitDays} days</b></>}.
            Vendors close claims that go quiet.
          </span>
        </div>
      )}

      {/* qualified leads with no ticket — one click to open one */}
      {fileable.length > 0 && (
        <GlassCard padding="p-3.5" hover={false}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11.5px] font-semibold text-textb">
              {fileable.length} lead{fileable.length === 1 ? '' : 's'} qualified to file
            </span>
            <span className="text-[10.5px] text-dimtext">
              5 attempts, no contact, inside the window · {money(fileable.reduce((n, l) => n + (Number(l.purchasePrice) || 0), 0))}
            </span>
          </div>
          <div className="space-y-1.5">
            {fileable.slice(0, 8).map(l => (
              <FileRow key={l.id} lead={l} onFile={act} />
            ))}
          </div>
        </GlassCard>
      )}

      <div>
        <SectionTitle accent="orange">Claims in flight</SectionTitle>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {COLS.filter(c => ['needs_response', 'ready', 'submitted', 'responded'].includes(c.id)).map(c => (
            <Column key={c.id} meta={c} tickets={byStatus[c.id]} open={open} setOpen={setOpen} act={act} />
          ))}
        </div>
      </div>

      <div>
        <button onClick={() => setShowResolved(s => !s)}
          className="flex items-center gap-2 text-[11px] text-dimtext hover:text-textb transition-colors">
          <ChevronDown size={11} style={{ transform: showResolved ? 'none' : 'rotate(-90deg)' }} />
          {byStatus.approved.length + byStatus.denied.length} decided —
          {' '}{money(rollup?.recoveredValue || 0)} back, {money(rollup?.deniedValue || 0)} lost
        </button>
        <AnimatePresence initial={false}>
          {showResolved && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                {COLS.filter(c => ['approved', 'denied'].includes(c.id)).map(c => (
                  <Column key={c.id} meta={c} tickets={byStatus[c.id]} open={open} setOpen={setOpen} act={act} />
                ))}
              </div>

              {/* Why claims get denied — the only way to stop filing losers. */}
              {rollup && Object.keys(rollup.deniedReasons).length > 0 && (
                <GlassCard padding="p-3.5" hover={false} className="mt-3">
                  <div className="text-[11px] font-semibold text-textb mb-2">Why claims got denied</div>
                  <div className="space-y-1">
                    {Object.entries(rollup.deniedReasons)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, n]) => (
                        <div key={k} className="flex items-center gap-2 text-[11px]">
                          <span className="text-textb">{REASON_LABEL[k] || k}</span>
                          <span className="ml-auto tabular-nums text-dimtext">{n}</span>
                        </div>
                      ))}
                  </div>
                </GlassCard>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FileRow({ lead, onFile }: {
  lead: Lead; onFile: (a: string, b: Record<string, unknown>) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const rf = refundStatusOf(lead);
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg"
         style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] text-textb truncate">{lead.name}</div>
        <div className="text-[9.5px] text-dimtext truncate">
          {money(Number(lead.purchasePrice) || 0)} · {rf.attempts} attempts · {rf.daysLeft}d left
        </div>
      </div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onFile('create', {
            leadName: lead.name, phone: lead.phone, address: lead.address,
            contactId: lead.contactId, price: Number(lead.purchasePrice) || 0,
            attempts: rf.attempts, purchasedAt: lead.purchasedAt,
            deadlineAt: lead.refundDeadline, reason: 'no_response',
            vendor: lead.provider || 'ispeed',
            note: `${rf.attempts} documented attempts, no contact.`,
          });
          setBusy(false);
        }}
        className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-opacity disabled:opacity-40"
        style={{ background: 'rgba(100,210,255,0.16)', color: '#64d2ff' }}>
        <Plus size={9} /> {busy ? 'Opening…' : 'Open ticket'}
      </button>
    </div>
  );
}

function Column({ meta, tickets, open, setOpen, act }: {
  meta: typeof COLS[number]; tickets: Ticket[];
  open: string | null; setOpen: (id: string | null) => void;
  act: (a: string, b: Record<string, unknown>) => Promise<boolean>;
}) {
  const total = tickets.reduce((n, t) => n + (Number(t.price) || 0), 0);
  return (
    <div className="rounded-[18px] border overflow-hidden flex flex-col"
         style={{ background: 'rgba(255,255,255,0.03)', borderColor: meta.id === 'needs_response' && tickets.length ? `${meta.color}66` : 'var(--border)' }}>
      <div className="px-3.5 py-2.5 border-b border-border"
           style={{ background: `linear-gradient(180deg, ${meta.color}1f, transparent)` }}>
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
          <span className="ml-auto text-[13px] font-semibold tabular-nums text-textb">{tickets.length}</span>
        </div>
        <div className="text-[10px] text-dimtext mt-0.5">{meta.sub}{total ? ` · ${money(total)}` : ''}</div>
      </div>
      <div className="p-2 space-y-1.5 flex-1">
        {tickets.length === 0 && <div className="text-[10.5px] text-dimtext px-1.5 py-2">Empty</div>}
        {tickets.map(t => (
          <TicketCard key={t.id} t={t} color={meta.color}
                      expanded={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)}
                      act={act} />
        ))}
      </div>
    </div>
  );
}

function TicketCard({ t, color, expanded, onToggle, act }: {
  t: Ticket; color: string; expanded: boolean; onToggle: () => void;
  act: (a: string, b: Record<string, unknown>) => Promise<boolean>;
}) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const waiting = t.waitingOnUsDays;

  const send = async (from: 'chris' | 'vendor') => {
    if (!reply.trim()) return;
    setBusy(true);
    await act('reply', { id: t.id, text: reply.trim(), from });
    setReply(''); setBusy(false);
  };

  return (
    <div className="rounded-[10px] overflow-hidden"
         style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid var(--border)' }}>
      <button onClick={onToggle} className="w-full text-left p-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] font-medium text-textb truncate">{t.leadName || t.phone}</span>
          <span className="ml-auto text-[11px] font-semibold tabular-nums" style={{ color }}>
            {money(t.price)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[9.5px] text-dimtext flex-wrap">
          <span>{REASON_LABEL[t.reason] || t.reason}</span>
          {t.vendor && <span className="opacity-70">{t.vendor}</span>}
          {t.threadCount ? (
            <span className="flex items-center gap-1"><MessageSquare size={8} />{t.threadCount}</span>
          ) : null}
          {waiting != null && (
            <span className="flex items-center gap-1 font-semibold" style={{ color: waiting >= 3 ? '#ff453a' : '#ff9f0a' }}>
              <Clock size={8} />{waiting}d on you
            </span>
          )}
          {t.status === 'denied' && t.deniedReason && (
            <span style={{ color: '#ff9f0a' }}>{REASON_LABEL[t.deniedReason] || t.deniedReason}</span>
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-2 pb-2 space-y-2">
              {/* thread */}
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {(t.thread || []).map((m, i) => (
                  <div key={i} className="text-[10px] rounded-md px-2 py-1.5"
                       style={{
                         background: m.from === 'vendor' ? 'rgba(255,159,10,0.12)' : 'rgba(100,210,255,0.10)',
                         border: '1px solid var(--border)',
                       }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-semibold" style={{ color: m.from === 'vendor' ? '#ff9f0a' : '#64d2ff' }}>
                        {m.from === 'vendor' ? t.vendor || 'vendor' : m.from}
                      </span>
                      <span className="text-dimtext tabular-nums">
                        {new Date(m.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <div className="text-textb whitespace-pre-wrap">{m.text}</div>
                  </div>
                ))}
                {!(t.thread || []).length && <div className="text-[10px] text-dimtext px-1">No messages yet.</div>}
              </div>

              {/* reply — either side, because logging what THEY said is what
                  moves the ticket into "waiting on you" */}
              <div className="flex gap-1.5">
                <input
                  value={reply} onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send('chris'); } }}
                  placeholder="Log a message…"
                  className="flex-1 min-w-0 px-2 py-1 rounded-md text-[10.5px] bg-transparent text-textb outline-none"
                  style={{ border: '1px solid var(--border)' }} />
                <button disabled={busy || !reply.trim()} onClick={() => send('vendor')} title="They said this"
                        className="px-1.5 py-1 rounded-md text-[9.5px] font-semibold disabled:opacity-30"
                        style={{ background: 'rgba(255,159,10,0.16)', color: '#ff9f0a' }}>
                  Them
                </button>
                <button disabled={busy || !reply.trim()} onClick={() => send('chris')} title="You said this"
                        className="px-1.5 py-1 rounded-md disabled:opacity-30"
                        style={{ background: 'rgba(100,210,255,0.16)', color: '#64d2ff' }}>
                  <Send size={10} />
                </button>
              </div>

              {/* outcome */}
              <div className="flex gap-1.5 flex-wrap">
                {t.status === 'ready' && (
                  <Action label="Mark filed" color="#bf5af2"
                          onClick={() => act('status', { id: t.id, status: 'submitted' })} />
                )}
                {t.isOpen && (
                  <>
                    <Action label="Approved" color="#30d158" icon={<Check size={9} />}
                            onClick={() => act('status', { id: t.id, status: 'approved' })} />
                    <Action label="Denied" color="#ff9f0a" icon={<X size={9} />}
                            onClick={() => {
                              const why = window.prompt(
                                'Why was it denied? (no_response, wrong_number, not_selling, already_listed, under_contract, bad_info, duplicate, other)',
                                'other');
                              if (why) act('status', { id: t.id, status: 'denied', deniedReason: why });
                            }} />
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Action({ label, color, icon, onClick }: {
  label: string; color: string; icon?: React.ReactNode; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[9.5px] font-semibold"
            style={{ background: `${color}1f`, color }}>
      {icon}{label}
    </button>
  );
}

function Stat({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  return (
    <div className="min-w-[130px]">
      <div className="text-[10px] uppercase tracking-[0.5px] text-dimtext">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums leading-tight" style={{ color }}>{value}</div>
      <div className="text-[10px] text-dimtext mt-0.5">{note}</div>
    </div>
  );
}
