'use client';

/**
 * Workday — Sarah and Scout's day, and where the clock is in it right now.
 *
 * Reads /dialer/workday, which returns the same structure the scheduler acts
 * on. So this is not a picture of the plan; it IS the plan. If a block cannot
 * run, the reason shown here is the reason the scheduler will refuse.
 *
 * The two operations are colour-separated all the way down, because confusing
 * them is expensive: Sarah dials leads Chris paid for, one line at a time;
 * Scout dials nobody's leads on five lines. Same building, different rules.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Moon, Phone, Database, ClipboardList, Power } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { DIALER_API } from '@/lib/config';

interface Block {
  id: string; kind: 'dial' | 'data' | 'admin'; label: string;
  who: 'sarah' | 'scout' | 'both';
  lanes?: number; pipeline?: string; detail: string;
  start: number; end: number; window: string; active: boolean;
  status: { runnable: boolean; reason: string | null };
}
interface Plan {
  now: { day: string; time: string; hourF: number; workday: boolean };
  callingWindow: { start: string; end: string };
  autopilot: boolean; balance: number | null; blocks: Block[];
}

const WHO_COLOR: Record<string, string> = { sarah: '#0a84ff', scout: '#30d158', both: '#8e8e93' };
const KIND_ICON = { dial: Phone, data: Database, admin: ClipboardList } as const;

export function Workday() {
  const { refreshKey } = useApp();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${DIALER_API}/dialer/workday`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPlan(await r.json());
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  // Re-read every minute so the "now" line and the active block stay honest.
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  if (err) return <div className="text-[12px] p-4" style={{ color: '#ff453a' }}>Workday unreachable: {err}</div>;
  if (!plan) return <div className="text-[12px] text-dimtext p-4">Loading the day…</div>;

  const lowBalance = plan.balance != null && plan.balance < 5;
  const active = plan.blocks.filter(b => b.active);

  return (
    <div className="space-y-4">
      <GlassCard accent={plan.autopilot ? 'green' : 'blue'} padding="p-4" hover={false}>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.5px] text-dimtext">Right now</div>
            <div className="text-[20px] font-semibold text-textb">{plan.now.day} {plan.now.time}</div>
            <div className="text-[10px] text-dimtext mt-0.5">
              calling window {plan.callingWindow.start}–{plan.callingWindow.end}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.5px] text-dimtext">Autopilot</div>
            <div className="text-[20px] font-semibold tabular-nums flex items-center gap-1.5"
                 style={{ color: plan.autopilot ? '#30d158' : '#ff9f0a' }}>
              <Power size={15} />{plan.autopilot ? 'ON' : 'OFF'}
            </div>
            <div className="text-[10px] text-dimtext mt-0.5">
              {plan.autopilot ? 'blocks run on their own' : 'nothing runs by itself'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.5px] text-dimtext">Telnyx</div>
            <div className="text-[20px] font-semibold tabular-nums"
                 style={{ color: lowBalance ? '#ff453a' : '#30d158' }}>
              {plan.balance == null ? '—' : `$${plan.balance.toFixed(2)}`}
            </div>
            <div className="text-[10px] text-dimtext mt-0.5">
              {lowBalance ? 'too low to dial' : 'funded'}
            </div>
          </div>
          <div className="min-w-[150px]">
            <div className="text-[10px] uppercase tracking-[0.5px] text-dimtext">Active block</div>
            <div className="text-[13px] font-semibold text-textb mt-1">
              {active.length ? active.map(b => b.label).join(' · ') : 'nothing scheduled'}
            </div>
          </div>
        </div>
      </GlassCard>

      {lowBalance && (
        <div className="flex items-start gap-2 text-[11.5px] p-3 rounded-xl"
             style={{ background: 'rgba(255,69,58,0.12)', border: '1px solid rgba(255,69,58,0.3)', color: '#ff453a' }}>
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Every dial block is blocked at <b>${plan.balance?.toFixed(2)}</b>. Autopilot on an empty balance
            fails every placement silently for a whole day — the guard stops that, but only funding fixes it.
          </span>
        </div>
      )}

      <div>
        <SectionTitle accent="blue">The day</SectionTitle>
        <div className="space-y-2">
          {plan.blocks.map(b => {
            const Icon = KIND_ICON[b.kind];
            const color = WHO_COLOR[b.who];
            const night = b.kind === 'data';
            return (
              <motion.div key={b.id} layout
                className="rounded-[14px] border p-3 flex gap-3"
                style={{
                  background: b.active ? `${color}12` : 'rgba(255,255,255,0.025)',
                  borderColor: b.active ? `${color}66` : 'var(--border)',
                }}>
                <div className="flex flex-col items-center gap-1 pt-0.5 flex-shrink-0" style={{ width: 74 }}>
                  <span className="text-[10.5px] font-mono tabular-nums text-center leading-tight"
                        style={{ color: b.active ? color : 'var(--dimtext)' }}>
                    {b.window}
                  </span>
                  {night && <Moon size={10} className="text-dimtext" />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon size={12} style={{ color }} />
                    <span className="text-[12.5px] font-semibold text-textb">{b.label}</span>
                    {b.lanes && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded tabular-nums"
                            style={{ background: `${color}1a`, color }}>
                        {b.lanes} {b.lanes === 1 ? 'line' : 'lines'}
                      </span>
                    )}
                    {b.active && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: `${color}22`, color }}>NOW</span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-dimtext mt-1 leading-relaxed">{b.detail}</div>
                  {!b.status.runnable && b.active && (
                    <div className="text-[10px] mt-1 font-medium" style={{ color: '#ff9f0a' }}>
                      blocked — {b.status.reason}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <GlassCard padding="p-4" hover={false}>
        <div className="text-[12.5px] font-semibold text-textb mb-2">Why the day is shaped like this</div>
        <ul className="space-y-1.5 text-[11.5px] text-dimtext">
          <li className="flex gap-2"><span style={{ color: '#0a84ff' }}>→</span>
            <span>Calling is legal <b className="text-textb">{plan.callingWindow.start}–{plan.callingWindow.end}</b>.
            Scout&apos;s record pulls and skip tracing need no phone, so they fill the hours when nobody may be called.
            The two jobs never compete for the machine.</span></li>
          <li className="flex gap-2"><span style={{ color: '#0a84ff' }}>→</span>
            <span><b className="text-textb">Sarah dials one line.</b> Every one of those leads was paid for
            individually; a double-dial burns one.</span></li>
          <li className="flex gap-2"><span style={{ color: '#30d158' }}>→</span>
            <span><b className="text-textb">Scout dials five.</b> Nothing was paid per lead, so volume is the point —
            and only the first human to answer stays on, the rest are hung up instantly.</span></li>
          <li className="flex gap-2"><span style={{ color: '#8e8e93' }}>→</span>
            <span>Sunday is off. Nobody wants a cold call on a Sunday morning.</span></li>
        </ul>
      </GlassCard>
    </div>
  );
}
