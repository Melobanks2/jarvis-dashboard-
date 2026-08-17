'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Home, DollarSign, Star, Pencil, PhoneOutgoing, Trophy } from 'lucide-react';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { GlassCard, GlassPill } from '@/components/ui/GlassCard';
import { usePipeline, Lead } from '@/lib/hooks/usePipeline';
import { useApp } from '@/lib/AppContext';
import { useMonthFunnel } from '@/lib/hooks/useMonthFunnel';

// ── Targets ─────────────────────────────────────────────────────────────────
const MONTHLY_GOAL = 30000;
const YEARLY_GOAL  = 360000;
// Average assignment fee used to convert deals ↔ dollars. Tune as real closes land.
const AVG_FEE = 8500;
// Funnel fallbacks used until this month has enough volume to trust live rates.
const FALLBACK_CONV_RATE = 0.15;  // dials → conversations
const FALLBACK_HOT_RATE  = 0.15;  // conversations → hot
const HOT_CLOSE_RATE     = 0.20;  // hot → close (no attribution data yet — assumption)

const C = { blue: '#0a84ff', pos: '#30d158', urg: '#ff453a', warn: '#ff9f0a', purple: '#bf5af2', cyan: '#64d2ff', dim: 'rgba(235,235,245,0.35)' };
const NUM = 'font-orbitron font-semibold';

const money = (n: number) => '$' + Math.round(n).toLocaleString();

// Weekdays from today through month end, inclusive.
function workdaysLeft(): number {
  const d = new Date();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  let n = 0;
  for (let cur = new Date(d); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) n++;
  }
  return Math.max(1, n);
}

// daysInStage = days since the lead ENTERED its current stage (lastChange is a
// generic updatedAt that bumps on any edit — a note on an old closed deal would
// otherwise re-count it as this month's revenue).
const enteredStageWithin = (l: Lead, days: number) =>
  l.daysInStage != null
    ? l.daysInStage < days
    : !!l.lastChange && (Date.now() - new Date(l.lastChange).getTime()) / 86_400_000 < days;

export function GoalsVision() {
  const { refreshKey } = useApp();
  const { data } = usePipeline(refreshKey);
  const funnel = useMonthFunnel(refreshKey);

  // ── Editable "why" (idea 8) ─────────────────────────────────────────────
  const [why, setWhy] = useState('');
  const [editingWhy, setEditingWhy] = useState(false);
  useEffect(() => { try { setWhy(localStorage.getItem('jarvis_vision_why') || ''); } catch { /* ignore */ } }, []);
  const saveWhy = (v: string) => {
    setWhy(v); setEditingWhy(false);
    try { localStorage.setItem('jarvis_vision_why', v); } catch { /* ignore */ }
  };

  // ── Live money math (ideas 1–3) ─────────────────────────────────────────
  // A 'Closed' stage key only appears if some GHL stage name contains "closed".
  // None currently does, so revenue is UNTRACKED rather than $0 — the two must
  // not look the same on screen.
  const revenueTracked = data != null && 'Closed' in (data.stages ?? {});
  const closedAll   = data?.stages['Closed'] ?? [];
  const nowDate     = new Date();
  const closedMonth = closedAll.filter(l => enteredStageWithin(l, nowDate.getDate()));
  const inMotionLeads: Lead[] = [
    ...(data?.stages['Under Contract'] ?? []),
    ...(data?.stages['Contract Sent'] ?? []),
  ];
  const dayOfYear = Math.floor((Date.now() - new Date(nowDate.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1;
  const closedYear = closedAll.filter(l => enteredStageWithin(l, dayOfYear));
  const realized  = closedMonth.length * AVG_FEE;
  const inMotion  = inMotionLeads.length * AVG_FEE;

  const now = nowDate;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expectedByNow = MONTHLY_GOAL * (now.getDate() / daysInMonth);
  // Pace = money actually collected. In-motion deals are upside, not revenue.
  const paceValue = realized;
  const onPace = revenueTracked && paceValue >= expectedByNow;

  // ── Marching orders (idea 2): vision → today's required dials ───────────
  const liveConv = funnel.calls  >= 50 ? funnel.convos / Math.max(1, funnel.calls)  : 0;
  const liveHot  = funnel.convos >= 10 ? funnel.hot    / Math.max(1, funnel.convos) : 0;
  const convRate = liveConv > 0 ? liveConv : FALLBACK_CONV_RATE;
  const hotRate  = liveHot  > 0 ? liveHot  : FALLBACK_HOT_RATE;
  const closesPerDial = Math.max(0.0001, convRate * hotRate * HOT_CLOSE_RATE);
  const dealsNeededTotal  = Math.max(0, Math.ceil((MONTHLY_GOAL - realized) / AVG_FEE));
  // Deals in motion are NOT subtracted from the dial requirement — an unsigned
  // contract is not collected money, and discounting dials against it told
  // Chris to stop prospecting while the month sat at $0.
  const days = workdaysLeft();
  const dialsPerDay = dealsNeededTotal === 0 ? 0 : Math.ceil(dealsNeededTotal / closesPerDial / days);
  const hotPerDay = Math.max(1, Math.round(dialsPerDay * convRate * hotRate));
  const motionCovers = Math.min(inMotionLeads.length, dealsNeededTotal);

  // ── Last win (idea 6) ───────────────────────────────────────────────────
  const lastWin = useMemo(() => {
    const age = (l: Lead) => l.daysInStage ?? (l.lastChange ? (Date.now() - new Date(l.lastChange).getTime()) / 86_400_000 : Infinity);
    const pool = [...closedAll, ...inMotionLeads].filter(l => age(l) !== Infinity);
    if (!pool.length) return null;
    return pool.sort((a, b) => age(a) - age(b))[0];
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const winDays = lastWin ? Math.max(0, Math.floor(lastWin.daysInStage ?? (Date.now() - new Date(lastWin.lastChange).getTime()) / 86_400_000)) : null;
  const freshWin = winDays != null && winDays <= 2;

  // ── Rings (idea 4) ──────────────────────────────────────────────────────
  const revenuePct  = Math.min(100, (realized / MONTHLY_GOAL) * 100);
  const motionPct   = Math.min(100 - revenuePct, (inMotion / MONTHLY_GOAL) * 100);
  const dealsPct    = Math.min(100, (closedMonth.length / 3) * 100);
  const cashflowPct = 0; // passive income not tracked yet

  // ── Yearly (idea 7) ─────────────────────────────────────────────────────
  const quarter = Math.floor(now.getMonth() / 3);            // 0-based, Aug → Q3
  const yearlyPacePct = Math.min(100, (paceValue * 12 / YEARLY_GOAL) * 100);

  return (
    <div className="flex flex-col gap-5">

      {/* Why + pace */}
      <div className="flex items-center gap-4 flex-wrap">
        {editingWhy ? (
          <input
            autoFocus
            defaultValue={why}
            placeholder="Why are you doing this? One sentence."
            onBlur={e => saveWhy(e.target.value.trim())}
            onKeyDown={e => { if (e.key === 'Enter') saveWhy((e.target as HTMLInputElement).value.trim()); }}
            className="flex-1 min-w-[280px] bg-transparent border-b border-border2 text-[21px] font-medium text-textb tracking-[-0.02em] outline-none pb-1"
          />
        ) : (
          <button onClick={() => setEditingWhy(true)} className="tap text-left group flex items-baseline gap-2.5">
            <span className="text-[21px] font-medium tracking-[-0.02em]" style={{ color: why ? '#f5f5f7' : 'rgba(235,235,245,0.35)' }}>
              {why || 'Why are you doing this? Click to write it down.'}
            </span>
            <Pencil size={13} className="opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0 text-dimtext" />
          </button>
        )}
        <GlassPill color={!revenueTracked ? C.dim : onPace ? C.pos : C.warn} className="ml-auto">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: !revenueTracked ? C.dim : onPace ? C.pos : C.warn }} />
          {!revenueTracked
            ? <>Revenue not tracked · no closed-won stage in GHL</>
            : <>{onPace ? 'On pace' : 'Behind pace'} · day {now.getDate()} of {daysInMonth} · should be at {money(expectedByNow)}</>}
        </GlassPill>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* This month — rings + live money */}
        <GlassCard>
          <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb mb-4">This month</p>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="relative flex-shrink-0">
              {freshWin && (
                <motion.div className="absolute inset-[-10px] rounded-full pointer-events-none"
                  animate={{ opacity: [0.35, 0.08, 0.35] }} transition={{ duration: 2.4, repeat: Infinity }}
                  style={{ background: `radial-gradient(circle, ${C.pos}33, transparent 70%)` }} />
              )}
              <Rings rings={[
                { pct: revenuePct, extraPct: motionPct, color: C.warn },
                { pct: dealsPct,    color: C.pos },
                { pct: cashflowPct, color: C.blue },
              ]} />
            </div>
            <div className="flex-1 min-w-[200px] flex flex-col gap-3">
              <RingRow color={C.warn} label="Revenue collected">
                {revenueTracked
                  ? <AnimatedCounter target={realized} prefix="$" className={`${NUM} text-[22px]`} style={{ color: C.warn } as React.CSSProperties} />
                  : <span className={`${NUM} text-[22px]`} style={{ color: C.dim }}>not tracked</span>}
                <span className="text-[12px] text-dimtext ml-1.5">of {money(MONTHLY_GOAL)}</span>
                {inMotion > 0 && <div className="text-[12px]" style={{ color: `${C.warn}99` }}>{money(inMotion)} in motion ({inMotionLeads.length} deals) — not collected yet</div>}
              </RingRow>
              <RingRow color={C.pos} label="Deals closed">
                <span className={`${NUM} text-[22px]`} style={{ color: C.pos }}>{closedMonth.length}</span>
                <span className="text-[12px] text-dimtext ml-1.5">of 3</span>
              </RingRow>
              <RingRow color={C.blue} label="Passive cash flow">
                <span className={`${NUM} text-[22px]`} style={{ color: C.blue }}>$0</span>
                <span className="text-[12px] text-dimtext ml-1.5">of $10,000</span>
              </RingRow>
            </div>
          </div>
          <div className="flex items-center gap-2.5 mt-5 pt-4 border-t border-border text-[13px]">
            <Trophy size={13} style={{ color: C.pos }} />
            {lastWin ? (
              <span className="text-jtext">Last win — <span className="text-textb font-medium">{lastWin.name}</span> · {lastWin.stage} · {winDays === 0 ? 'today' : `${winDays}d ago`}</span>
            ) : (
              <span className="text-dimtext">First win of the month is still out there</span>
            )}
          </div>
        </GlassCard>

        {/* Marching orders — vision reverse-engineered into today's dials */}
        <GlassCard>
          <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb mb-4">Today&apos;s marching orders</p>
          {dealsNeededTotal === 0 ? (
            <div className="flex flex-col items-start gap-2">
              <span className={`${NUM} text-[44px] leading-none`} style={{ color: C.pos }}>Goal hit</span>
              <p className="text-[13px] text-jtext mt-2">{money(MONTHLY_GOAL)} collected. Everything from here is next month&apos;s head start.</p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-3">
                <AnimatedCounter target={dialsPerDay} className={`${NUM} text-[52px] leading-none`} style={{ color: C.blue } as React.CSSProperties} />
                <span className="text-[15px] text-jtext">dials per day, {days} workdays left</span>
              </div>
              <div className="mt-4 flex flex-col gap-2 text-[13px]">
                <FunnelLine icon label={`${Math.round(convRate * 100)}% answer`} text={`≈ ${Math.round(dialsPerDay * convRate)} conversations a day`} color={C.cyan} />
                <FunnelLine label={`${Math.round(hotRate * 100)}% qualify`} text={`≈ ${hotPerDay} hot lead${hotPerDay === 1 ? '' : 's'} a day`} color={C.urg} />
                <FunnelLine label={`${Math.round(HOT_CLOSE_RATE * 100)}% close`} text={`${dealsNeededTotal} deal${dealsNeededTotal === 1 ? '' : 's'} still needed${motionCovers > 0 ? ` · ${motionCovers} in motion could cover some if they close` : ''}`} color={C.pos} />
              </div>
              <div className="mt-4 pt-3.5 border-t border-border text-[12px] text-dimtext">
                Rates are live from this month&apos;s {funnel.calls.toLocaleString()} dials{funnel.calls < 50 ? ' (low volume — using baseline rates)' : ''} · avg fee {money(AVG_FEE)}
              </div>
            </>
          )}
        </GlassCard>
      </div>

      {/* 2026 vision — quarters + long-range goals */}
      <GlassCard>
        <div className="flex items-baseline gap-3 mb-4 flex-wrap">
          <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb">2026 vision</p>
          <span className="text-[12px] text-dimtext">{money(YEARLY_GOAL)} · run rate puts you at {Math.round(yearlyPacePct)}% of it</span>
        </div>
        <div className="grid grid-cols-4 gap-2.5 mb-5">
          {[0, 1, 2, 3].map(q => {
            const state = q < quarter ? 'past' : q === quarter ? 'now' : 'future';
            return (
              <div key={q} className="rounded-xl border px-3 py-2.5 text-center"
                style={{
                  borderColor: state === 'now' ? `${C.blue}55` : 'rgba(255,255,255,0.08)',
                  background: state === 'now' ? `${C.blue}14` : 'rgba(255,255,255,0.04)',
                  opacity: state === 'past' ? 0.45 : 1,
                }}>
                <div className="text-[12px] font-semibold" style={{ color: state === 'now' ? C.blue : 'rgba(235,235,245,0.62)' }}>
                  Q{q + 1}{state === 'now' && ' · now'}
                </div>
                <div className="text-[11px] text-dimtext mt-0.5">{money(YEARLY_GOAL / 4)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3.5">
          {[
            { label: 'Deals closed this month', value: closedMonth.length, target: 3, color: C.pos },
            { label: 'Properties owned', value: 0, target: 5, color: C.blue },
            { label: 'Monthly cash flow', value: 0, target: 10000, color: C.warn, prefix: '$' },
            { label: 'Yearly revenue', value: closedYear.length * AVG_FEE, target: YEARLY_GOAL, color: C.purple, prefix: '$' },
          ].map(g => (
            <div key={g.label}>
              <div className="flex justify-between text-[13px] mb-1.5">
                <span className="text-jtext">{g.label}</span>
                <span className="text-dimtext font-orbitron">{g.prefix ?? ''}{g.value.toLocaleString()} / {g.prefix ?? ''}{g.target.toLocaleString()}</span>
              </div>
              <Bar value={Math.min(100, (g.value / g.target) * 100)} color={g.color} />
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Personal goals — in deal units */}
      <GlassCard>
        <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb mb-4">Personal goals</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'BMW M4 Competition', category: 'Vehicle', target: 85000, current: 0, color: C.blue },
            { label: 'Waterfront property', category: 'Real estate', target: 1, current: 0, color: C.pos, unit: 'deal' },
            { label: 'Move to Miami Beach', category: 'Lifestyle', target: 1, current: 0, color: C.purple, unit: 'ready' },
            { label: 'Monthly passive income', category: 'Finance', target: 10000, current: 0, color: C.warn },
          ].map(g => {
            const dealsAway = g.unit ? null : Math.max(1, Math.ceil((g.target - g.current) / AVG_FEE));
            const pct = g.unit ? g.current * 100 : Math.min(100, (g.current / g.target) * 100);
            return (
              <div key={g.label} className="rounded-2xl border border-border p-4 bg-bg2" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
                <div className="text-[11px] font-medium tracking-[0.08em] uppercase mb-1.5" style={{ color: g.color }}>{g.category}</div>
                <div className="text-[14px] font-medium text-textb mb-1 leading-snug">{g.label}</div>
                <div className="text-[12px] text-dimtext mb-3">
                  {g.unit
                    ? `${g.current}/${g.target} ${g.unit}`
                    : <><span className="text-jtext font-medium">≈ {dealsAway} avg deals away</span> · {money(g.target - g.current)} to go</>}
                </div>
                <Bar value={pct} color={g.color} thin />
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Vision board */}
      <GlassCard>
        <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb mb-4">Vision board</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: <Home size={17} />, title: 'Real estate portfolio', desc: 'Own 5+ cash-flowing rentals generating $10k/mo passive income', color: C.pos },
            { icon: <DollarSign size={17} />, title: '$1M revenue', desc: 'Hit $1M in wholesale assignment fees and build a 7-figure business', color: C.warn },
            { icon: <Star size={17} />, title: 'Automation empire', desc: 'Fully automated deal flow — AI handles 90% of operations end to end', color: C.purple },
          ].map(v => (
            <div key={v.title} className="rounded-2xl border border-border p-4 bg-bg2" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
              <div className="mb-2.5" style={{ color: v.color }}>{v.icon}</div>
              <div className="text-[14px] font-medium text-textb mb-1">{v.title}</div>
              <div className="text-[12px] text-dimtext leading-relaxed">{v.desc}</div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

// Apple-activity-style concentric rings. Outer ring supports a lighter
// "in motion" extension arc that starts where the solid arc ends.
function Rings({ rings }: { rings: { pct: number; extraPct?: number; color: string }[] }) {
  const size = 148, stroke = 12, gap = 3;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      {rings.map((r, i) => {
        const radius = (size - stroke) / 2 - i * (stroke + gap);
        const circ = 2 * Math.PI * radius;
        return (
          <g key={i}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={`${r.color}22`} strokeWidth={stroke} />
            {r.extraPct != null && r.extraPct > 0 && (
              <motion.circle cx={size / 2} cy={size / 2} r={radius} fill="none"
                stroke={`${r.color}55`} strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={circ}
                initial={{ strokeDashoffset: circ }}
                animate={{ strokeDashoffset: circ * (1 - (r.pct + r.extraPct) / 100) }}
                transition={{ duration: 1.2, ease: [0.32, 0.72, 0, 1], delay: 0.15 }} />
            )}
            <motion.circle cx={size / 2} cy={size / 2} r={radius} fill="none"
              stroke={r.color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={circ}
              initial={{ strokeDashoffset: circ }}
              animate={{ strokeDashoffset: circ * (1 - Math.max(0.5, r.pct) / 100) }}
              transition={{ duration: 1.2, ease: [0.32, 0.72, 0, 1] }} />
          </g>
        );
      })}
    </svg>
  );
}

function RingRow({ color, label, children }: { color: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ background: color }} />
      <div>
        <div className="text-[12px] text-dimtext">{label}</div>
        <div className="flex items-baseline flex-wrap">{children}</div>
      </div>
    </div>
  );
}

function FunnelLine({ label, text, color, icon }: { label: string; text: string; color: string; icon?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {icon ? <PhoneOutgoing size={12} style={{ color }} /> : <span className="w-3" />}
      <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${color}1a`, color }}>{label}</span>
      <span className="text-jtext">{text}</span>
    </div>
  );
}

function Bar({ value, color, thin }: { value: number; color: string; thin?: boolean }) {
  return (
    <div className={`relative ${thin ? 'h-1' : 'h-1.5'} rounded-full overflow-hidden`} style={{ background: `${color}14` }}>
      <motion.div className="absolute top-0 left-0 h-full rounded-full"
        style={{ background: color, opacity: 0.75 }}
        initial={{ width: 0 }} animate={{ width: `${value}%` }}
        transition={{ type: 'spring', stiffness: 90, damping: 24 }} />
    </div>
  );
}
