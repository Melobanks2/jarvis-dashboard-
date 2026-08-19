'use client';

/**
 * Refund Pipeline — the 21-day clock on every iSpeed lead.
 *
 * Verified against all 95 leads carrying a deadline: the window is exactly 21
 * days from purchase, every time. So this is a pipeline whose stages are days
 * remaining, not a status someone remembers to set — a lead moves toward the
 * deadline whether or not anyone touches it, which is precisely why refunds
 * get missed.
 *
 * The two halves are different problems and are laid out separately. Before
 * filing, the question is "is this worth filing before the clock runs out".
 * After filing, the question is "has iSpeed paid yet". Mixing them into one
 * row is what makes a refund board useless.
 */

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ChevronDown, Clock } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { useLeads, Lead } from '@/lib/hooks/useLeads';
import { classify } from '@/components/sections/DealFlow';

const WINDOW_DAYS = 21;

/** A lead is worth refunding only if it never went anywhere. */
const REFUNDABLE = new Set(['attempt', 'new', 'unresponsive', 'dead', 'cold']);

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const sum = (ls: Lead[]) => ls.reduce((n, l) => n + (Number(l.purchasePrice) || 0), 0);

type ColId = 'working' | 'decide' | 'last' | 'filed' | 'approved' | 'expired';

const COLS: { id: ColId; label: string; sub: string; color: string }[] = [
  { id: 'working',  label: 'Clock running', sub: '8+ days left',       color: '#30d158' },
  { id: 'decide',   label: 'Decide',        sub: '3–7 days left',      color: '#ff9f0a' },
  { id: 'last',     label: 'Last call',     sub: '0–2 days left',      color: '#ff453a' },
  { id: 'filed',    label: 'Filed',         sub: 'waiting on iSpeed',  color: '#bf5af2' },
  { id: 'approved', label: 'Approved',      sub: 'money recovered',    color: '#30d158' },
  { id: 'expired',  label: 'Window closed', sub: 'can no longer file', color: '#5a5a80' },
];

export function RefundPipeline() {
  const { refreshKey } = useApp();
  const { leads, loading, error } = useLeads(refreshKey);
  const [showExpired, setShowExpired] = useState(false);

  const cols = useMemo(() => {
    const c: Record<ColId, Lead[]> = {
      working: [], decide: [], last: [], filed: [], approved: [], expired: [],
    };
    for (const l of leads) {
      if (l.source !== 'ispeed') continue;
      const { board, key } = classify(l.stageName);

      if (board === 'refund') { c[key === 'approved' ? 'approved' : 'filed'].push(l); continue; }

      const d = l.daysUntilDeadline;
      if (typeof d !== 'number') continue;      // no purchase record — no clock to show
      if (d < 0)      c.expired.push(l);
      else if (d <= 2) c.last.push(l);
      else if (d <= 7) c.decide.push(l);
      else             c.working.push(l);
    }
    for (const k of Object.keys(c) as ColId[]) {
      c[k].sort((a, b) => (a.daysUntilDeadline ?? 0) - (b.daysUntilDeadline ?? 0));
    }
    return c;
  }, [leads]);

  if (loading) return <div className="text-[12px] text-dimtext p-4">Loading refund clocks…</div>;
  if (error)   return <div className="text-[12px] p-4" style={{ color: '#ff453a' }}>{error}</div>;

  // Only leads going nowhere are actually worth filing.
  const actionable = [...cols.last, ...cols.decide, ...cols.working]
    .filter(l => REFUNDABLE.has(classify(l.stageName).key));
  const keeping = [...cols.last, ...cols.decide, ...cols.working].length - actionable.length;

  return (
    <div className="space-y-4">
      {/* the money line */}
      <GlassCard accent="green" padding="p-4" hover={false}>
        <div className="flex flex-wrap gap-4">
          <Stat label="Worth filing now" value={String(actionable.length)}
                note={actionable.length ? `${money(sum(actionable))} still recoverable` : 'nothing in window'}
                color={actionable.length ? '#64d2ff' : 'var(--dimtext)'} />
          <Stat label="Filed, unpaid" value={money(sum(cols.filed))} note={`${cols.filed.length} leads`} color="#bf5af2" />
          <Stat label="Recovered" value={money(sum(cols.approved))} note={`${cols.approved.length} approved`} color="#30d158" />
          <Stat label="Aged out" value={money(sum(cols.expired))} note={`${cols.expired.length} past ${WINDOW_DAYS} days`} color="#ff453a" />
          <Stat label="Keeping" value={String(keeping)} note="in window but working out" color="var(--dimtext)" />
        </div>
      </GlassCard>

      {actionable.length > 0 && (
        <div className="flex items-start gap-2 text-[11.5px] p-3 rounded-xl"
             style={{ background: 'rgba(255,159,10,0.12)', border: '1px solid rgba(255,159,10,0.3)', color: '#ff9f0a' }}>
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            <b>{actionable[0].name}</b> has {actionable[0].daysUntilDeadline} day
            {actionable[0].daysUntilDeadline === 1 ? '' : 's'} left. After that the {money(Number(actionable[0].purchasePrice) || 0)} is not recoverable.
          </span>
        </div>
      )}

      {/* the clock, before filing */}
      <div>
        <SectionTitle accent="orange">Before filing — the {WINDOW_DAYS}-day clock</SectionTitle>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
          {COLS.filter(c => ['working', 'decide', 'last'].includes(c.id)).map(c => (
            <Column key={c.id} meta={c} leads={cols[c.id]} showVerdict />
          ))}
        </div>
      </div>

      {/* after filing */}
      <div>
        <SectionTitle accent="purple">After filing — waiting on the money</SectionTitle>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
          {COLS.filter(c => ['filed', 'approved'].includes(c.id)).map(c => (
            <Column key={c.id} meta={c} leads={cols[c.id]} />
          ))}
        </div>
      </div>

      {/* expired — present, but out of the way */}
      <div>
        <button onClick={() => setShowExpired(s => !s)}
          className="flex items-center gap-2 text-[11px] text-dimtext hover:text-textb transition-colors">
          <ChevronDown size={11} style={{ transform: showExpired ? 'none' : 'rotate(-90deg)' }} />
          {cols.expired.length} windows closed — {money(sum(cols.expired))} that can no longer be filed
        </button>
        <AnimatePresence initial={false}>
          {showExpired && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                <Column meta={COLS[5]} leads={cols.expired} limit={40} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Column({ meta, leads, showVerdict = false, limit = 25 }: {
  meta: typeof COLS[number]; leads: Lead[]; showVerdict?: boolean; limit?: number;
}) {
  const shown = leads.slice(0, limit);
  return (
    <div className="rounded-[16px] border border-border overflow-hidden"
         style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="px-3 py-2 border-b border-border"
           style={{ background: `linear-gradient(180deg, ${meta.color}1f, transparent)` }}>
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
          <span className="ml-auto text-[12px] font-semibold tabular-nums text-textb">{leads.length}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[9.5px] text-dimtext">{meta.sub}</span>
          {leads.length > 0 && (
            <span className="ml-auto text-[9.5px] tabular-nums text-dimtext">{money(sum(leads))}</span>
          )}
        </div>
      </div>

      <div className="p-2 space-y-1.5 overflow-y-auto" style={{ maxHeight: 340 }}>
        {!leads.length && <div className="text-[10.5px] text-dimtext text-center py-4">Empty</div>}
        {shown.map(l => {
          const file = REFUNDABLE.has(classify(l.stageName).key);
          return (
            <div key={l.id} className="rounded-lg p-2"
                 style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-1.5">
                {typeof l.daysUntilDeadline === 'number' && (
                  <span className="text-[10px] font-semibold tabular-nums flex-shrink-0" style={{ color: meta.color }}>
                    {l.daysUntilDeadline < 0 ? `${Math.abs(l.daysUntilDeadline)}d ago` : `${l.daysUntilDeadline}d`}
                  </span>
                )}
                <span className="text-[11px] text-textb truncate">{l.name}</span>
                <span className="ml-auto text-[10px] tabular-nums text-dimtext flex-shrink-0">
                  {money(Number(l.purchasePrice) || 0)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {l.provider && <span className="text-[9px] text-dimtext truncate">{l.provider}</span>}
                {showVerdict && (
                  <span className="ml-auto text-[8.5px] px-1.5 py-0.5 rounded flex-shrink-0 font-semibold uppercase tracking-[0.3px]"
                        style={file
                          ? { background: 'rgba(255,69,58,0.16)', color: '#ff453a' }
                          : { background: 'rgba(48,209,88,0.16)', color: '#30d158' }}>
                    {file ? 'file it' : 'keep'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {leads.length > shown.length && (
          <div className="text-[9.5px] text-dimtext pt-1 text-center">+ {leads.length - shown.length} more</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  return (
    <div className="min-w-[118px]">
      <div className="text-[9px] uppercase tracking-[0.5px] text-dimtext">{label}</div>
      <div className="text-[19px] font-semibold tabular-nums leading-tight" style={{ color }}>{value}</div>
      <div className="text-[9.5px] text-dimtext">{note}</div>
    </div>
  );
}
