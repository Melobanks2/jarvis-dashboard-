'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Info, X } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useMonthFunnel } from '@/lib/hooks/useMonthFunnel';
import { useApp } from '@/lib/AppContext';

// ── Road to $100K — native Liquid Glass port of the Azua funnel model ───────
// The math and roadmap content are Chris's Azua model, verbatim. This version
// adds: live vitals from the pipeline/dialer, Apple styling, spring physics,
// and localStorage persistence of every dial.

const C = { blue: '#0a84ff', pos: '#30d158', urg: '#ff453a', warn: '#ff9f0a', purple: '#bf5af2', cyan: '#64d2ff' };
const NUM = 'font-orbitron font-semibold';
const SPRING = { type: 'spring', stiffness: 90, damping: 24 } as const;
const LS_KEY = 'jarvis_road100k_v1';
const INFRA = 250; // Sarah/VPS/telephony overhead per month
const WORKDAYS = 22;

// Channel colors match the Live performance view: iSpeed orange, Sarah purple.
type ChKey = 'ispeed' | 'ppc' | 'sarah';
const CH_META: Record<ChKey, { name: string; tag: string; color: string }> = {
  ispeed: { name: 'iSpeed', tag: 'Cold, paid data — live now', color: C.warn },
  ppc:    { name: 'PropertyLeads', tag: 'PPC inbound — add after DeLand', color: C.cyan },
  sarah:  { name: 'Sarah', tag: 'AI cold call — the moat', color: C.purple },
};
const AT_SCALE_MIX: Record<ChKey, number> = { ispeed: 0.4, sarah: 0.4, ppc: 0.2 };

interface ModelState {
  deal: number; goal: number;
  c1: number; c2: number; c3: number; c4: number; c5: number; c6: number;
  ch: Record<ChKey, { a: number; p: number }>;
  plan: { target: number; wI: number; wP: number; wS: number };
}
const DEFAULTS: ModelState = {
  deal: 17000, goal: 100000,
  c1: 80, c2: 70, c3: 70, c4: 25, c5: 80, c6: 80,
  ch: { ispeed: { a: 12, p: 30 }, ppc: { a: 75, p: 60 }, sarah: { a: 7, p: 2 } },
  plan: { target: 2, wI: 85, wP: 15, wS: 0 },
};
const PRESETS: Record<string, { label: string; plan: ModelState['plan'] }> = {
  aug:   { label: 'August (now) — iSpeed-led',        plan: { target: 2, wI: 85, wP: 15, wS: 0 } },
  sep:   { label: 'September — add PPC + Sarah',      plan: { target: 4, wI: 50, wP: 25, wS: 25 } },
  scale: { label: 'At scale — $100K month',           plan: { target: 6, wI: 40, wP: 20, wS: 40 } },
};

const GLOSSARY: Record<string, string> = {
  goal: '<b>Revenue goal</b> — total wholesale/novation income you want per month. Deals needed = goal ÷ avg deal size.',
  leads: '<b>Qualified lead</b> — a seller with BOTH motivation and equity. An address alone is not a lead until you confirm those two on the phone.',
  shows: '<b>Appointments shown</b> — sellers who actually showed up at the booked time. Your daily closing-call load once you divide by working days.',
  spend: '<b>Recommended spend</b> — blended monthly marketing dollars to produce the leads above, at the at-scale channel mix.',
  set: '<b>Appointment set</b> — a qualified lead who agreed to a booked time. Target 80% of leads. Below that = a setter/script problem.',
  shown_f: '<b>Shown</b> — booked appointments that actually happened. Target 70%+. Reminder texts and a calendar invite drive this.',
  offers: '<b>Offer made</b> — a real number in front of a shown, qualified seller. You only offer to sellers ready to give a yes or no.',
  signed: '<b>Contract signed</b> — price AND terms agreed. Offer→signed is your close rate; 25% (1 in 4) is the floor.',
  assigned: '<b>Assigned</b> — contract handed to an end buyer for a fee. Target 80%. Low = bad underwriting or weak dispo.',
  closed: '<b>Deal closed</b> — funded and paid. Target 80% of assigned. Killed by title issues, payoff surprises, probate.',
  a2l: '<b>Address → Lead</b> — the share of this channel’s addresses that become qualified leads. Cold/paid run low; PPC inbound runs high.',
  addresses: '<b>Addresses to touch</b> — raw records this channel must produce to hit the lead target, given its Address→Lead rate.',
  cpl: '<b>Cost per lead</b> — what one qualified lead costs here. iSpeed tiers: free pack ($0), coupon ($29), exclusive ($125) — use your blended average.',
  cpd: '<b>Cost per deal</b> — cost per lead ÷ lead→deal conversion. The true acquisition cost of one closing; this number decides which channel wins.',
  roi: '<b>Return on spend</b> — avg deal size ÷ cost per deal. 10:1 is healthy; below that the channel is leaking money.',
  addr: '<b>Addresses</b> — every property record entering the funnel from all channels, before any qualification.',
  dealsize: '<b>Average deal size</b> — your average assignment/novation fee. Floor $15K, aim $20K+.',
  spent: '<b>Money spent</b> — total marketing dollars out the door this month across every channel.',
  revenue: '<b>Revenue collected</b> — deals closed × avg deal size. The only vital that pays the bills.',
};

const MONTH_PLAN: Record<string, { title: string; focus: string; todo: string[] }> = {
  M1: { title: 'Instrument everything', focus: 'Do not touch spend. The entire job this month is visibility — you can’t see the leak yet.', todo: ['Stand up the 8 GHL pipeline stages so every card is counted.', 'Tag each iSpeed lead with its cost tier: free pack / $29 coupon / $125 exclusive.', 'Log which leads got an actual offer — make it a field.', 'Baseline the six vitals. No conclusions yet, just real numbers.'] },
  M2: { title: 'Find and fix the leak', focus: 'One vital will be clearly below benchmark — almost always lead→appt or offer→signed. Fix that one before spending a dollar more.', todo: ['Pull call transcripts and score them against the setting/closing framework.', 'Verify how many "leads" were truly motivated sellers vs junk.', 'Patch the script or close for the broken stage — then re-measure.', 'Keep iSpeed flat (~$1,500). Prove conversion, don’t buy volume.'] },
  M3: { title: 'Add PropertyLeads (PPC)', focus: 'Only now that the funnel converts, add a second channel — routed to its OWN pipeline so cost-per-deal is comparable head to head.', todo: ['Launch a small PropertyLeads/PPC budget (~$2K) into its own pipeline.', 'Turn Sarah on to pre-qualify inbound iSpeed leads.', 'Compare cost-per-deal: iSpeed vs PPC vs Sarah. Fund the winner.'] },
  M4: { title: 'Scale the cheapest channel', focus: 'Push volume through the lowest cost-per-deal — usually Sarah, because a dial is nearly free.', todo: ['Sarah pulls county lists (pre-foreclosure, probate, tired-landlord) and cold-calls.', 'Sarah pre-qualifies and books straight to your calendar.', 'Raise iSpeed exclusive-lead share if its close rate justifies the $125.'] },
  M5: { title: 'Hit the target', focus: 'Full three-channel mix, funnel at benchmark, Sarah carrying qualification. You are purely the closer — 2–3 calls a day.', todo: ['All three channels live, each in its own pipeline, tracked weekly.', 'Anything under 10:1 ROI gets cut or fixed.', 'Reinvest savings into the lowest cost-per-deal channel.'] },
  M6: { title: 'Systematize and compound', focus: 'Steady $100K on AI lead-gen, qualifying, and booking — zero payroll. Harden it; remove yourself from everything but closing.', todo: ['Automate follow-up and refund requests off GHL call outcomes.', 'Document the playbook so the system survives a bad week.', 'Consider the AI-assisted-closer test only once volume is proven.'] },
};

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const fmtK = (n: number) => n >= 1000 ? '$' + (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K' : '$' + Math.round(n);

interface LiveStats { cplRaw: number | null; cpq: number | null; dealsInPlay: number; }

export function RoadTo100K({ live }: { live: LiveStats }) {
  const { refreshKey } = useApp();
  const funnel = useMonthFunnel(refreshKey);
  const [s, setS] = useState<ModelState>(DEFAULTS);
  const [activePreset, setActivePreset] = useState<string | null>('aug');
  const [openMonth, setOpenMonth] = useState<number | null>(null);
  const skipFirstSave = useRef(true);

  // Persist every dial — Chris's tuned reality survives reloads.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<ModelState>;
        setS({
          ...DEFAULTS, ...p,
          ch: { ...DEFAULTS.ch, ...(p.ch ?? {}) },
          plan: { ...DEFAULTS.plan, ...(p.plan ?? {}) },
        });
        setActivePreset(null);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (skipFirstSave.current) { skipFirstSave.current = false; return; }
    const t = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [s]);

  const set = (patch: Partial<ModelState>) => setS(prev => ({ ...prev, ...patch }));
  const setCh = (k: ChKey, prop: 'a' | 'p', v: number) =>
    setS(prev => ({ ...prev, ch: { ...prev.ch, [k]: { ...prev.ch[k], [prop]: v } } }));
  const setPlan = (patch: Partial<ModelState['plan']>) => {
    setActivePreset(null);
    setS(prev => ({ ...prev, plan: { ...prev.plan, ...patch } }));
  };

  // ── The math (ported verbatim) ──────────────────────────────────────────
  const m = useMemo(() => {
    const l2d = (s.c1 / 100) * (s.c2 / 100) * (s.c3 / 100) * (s.c4 / 100) * (s.c5 / 100) * (s.c6 / 100);
    const deals = Math.max(1, Math.round(s.goal / s.deal));
    const revenue = deals * s.deal;
    const leads = deals / l2d;
    const set_ = leads * (s.c1 / 100);
    const shown = set_ * (s.c2 / 100);
    const offers = shown * (s.c3 / 100);
    const signed = offers * (s.c4 / 100);
    const assigned = signed * (s.c5 / 100);
    const closed = assigned * (s.c6 / 100);
    let addresses = 0;
    (Object.keys(AT_SCALE_MIX) as ChKey[]).forEach(k => {
      const a = s.ch[k].a / 100;
      if (a > 0) addresses += (leads * AT_SCALE_MIX[k]) / a;
    });
    const blendedCpl = (mix: Record<ChKey, number>) =>
      mix.ispeed * s.ch.ispeed.p + mix.sarah * s.ch.sarah.p + mix.ppc * s.ch.ppc.p;
    const monthBudget = (d: number, mix: Record<ChKey, number>) => (d / l2d) * blendedCpl(mix) + INFRA;
    const recSpend = monthBudget(deals, AT_SCALE_MIX);
    return { l2d, deals, revenue, leads, set: set_, shown, offers, signed, assigned, closed, addresses, recSpend, monthBudget };
  }, [s]);

  const months = useMemo(() => {
    const t = m.deals;
    const defs = [
      { mo: 'M1', deals: Math.min(t, Math.max(2, Math.round(t * 0.33))), mix: { ispeed: 0.7, sarah: 0.3, ppc: 0 } as Record<ChKey, number>, phase: 'Instrument' },
      { mo: 'M2', deals: Math.max(3, Math.round(t * 0.5)),  mix: { ispeed: 0.6, sarah: 0.4, ppc: 0 } as Record<ChKey, number>, phase: 'Fix leak' },
      { mo: 'M3', deals: Math.min(t, Math.max(4, Math.round(t * 0.67))), mix: { ispeed: 0.5, sarah: 0.4, ppc: 0.1 } as Record<ChKey, number>, phase: 'Add PPC' },
      { mo: 'M4', deals: Math.min(t, Math.max(5, Math.round(t * 0.83))), mix: { ispeed: 0.45, sarah: 0.4, ppc: 0.15 } as Record<ChKey, number>, phase: 'Scale' },
      { mo: 'M5', deals: t, mix: AT_SCALE_MIX, phase: 'Hit target' },
      { mo: 'M6', deals: t + (t >= 6 ? 1 : 0), mix: AT_SCALE_MIX, phase: 'Steady' },
    ];
    return defs.map(d => ({ ...d, budget: m.monthBudget(d.deals, d.mix) }));
  }, [m]);

  const chMath = (k: ChKey) => {
    const addresses = m.leads / (s.ch[k].a / 100);
    const costPerDeal = s.ch[k].p / m.l2d;
    return { addresses, costPerDeal, roi: s.deal / costPerDeal };
  };

  const perDay = m.shown / WORKDAYS;
  const heroRoi = m.revenue / m.recSpend;
  const liveConv = funnel.calls >= 50 ? Math.round((funnel.convos / Math.max(1, funnel.calls)) * 100) : null;
  const liveHot = funnel.convos >= 10 ? Math.round((funnel.hot / Math.max(1, funnel.convos)) * 100) : null;

  // Planner derived
  const P = s.plan;
  const wSum = (P.wI + P.wP + P.wS) || 1;
  const planDefs: [ChKey, number][] = [['ispeed', P.wI], ['ppc', P.wP], ['sarah', P.wS]];
  let planSpend = 0;
  const planCards = planDefs.map(([k, w]) => {
    const share = w / wSum;
    const deals = P.target * share;
    const leads = deals / m.l2d;
    const addr = s.ch[k].a > 0 ? leads / (s.ch[k].a / 100) : 0;
    const spend = leads * s.ch[k].p;
    planSpend += spend;
    return { k, share, deals, leads, addr, spend, shows: leads * (s.c1 / 100) * (s.c2 / 100), cpd: s.ch[k].p / m.l2d };
  });
  const planRev = P.target * s.deal;

  type StageKey = 'addresses' | 'leads' | 'set' | 'shown' | 'offers' | 'signed' | 'assigned' | 'closed';
  const FUNNEL_STAGES: { key: StageKey; label: string; tip: string; note?: string; conv?: number }[] = [
    { key: 'addresses', label: 'Addresses', tip: 'addr', note: 'raw records in' },
    { key: 'leads', label: 'Qualified leads', tip: 'leads', note: 'motivation + equity' },
    { key: 'set', label: 'Appointments set', tip: 'set', conv: s.c1 },
    { key: 'shown', label: 'Appointments shown', tip: 'shown_f', conv: s.c2 },
    { key: 'offers', label: 'Offers made', tip: 'offers', conv: s.c3 },
    { key: 'signed', label: 'Contracts signed', tip: 'signed', conv: s.c4 },
    { key: 'assigned', label: 'Assigned', tip: 'assigned', conv: s.c5 },
    { key: 'closed', label: 'Deals closed', tip: 'closed', conv: s.c6 },
  ];

  return (
    <div className="flex flex-col gap-5">

      {/* Live vitals strip — the bridge between the model and reality */}
      <GlassCard padding="p-4">
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap text-[13px]">
          <span className="text-[13px] font-semibold text-textb">Your live vitals</span>
          <Vital label="Dials this month" value={funnel.calls.toLocaleString()} color={C.blue} />
          <Vital label="Answer rate" value={liveConv != null ? `${liveConv}%` : 'low volume'} color={C.cyan} />
          <Vital label="Hot rate" value={liveHot != null ? `${liveHot}%` : 'low volume'} color={C.urg} />
          <Vital label="iSpeed $/lead" value={live.cplRaw != null ? money(live.cplRaw) : '—'} color={C.warn} />
          <Vital label="$/qualified" value={live.cpq != null ? money(live.cpq) : '—'} color={C.warn} />
          <Vital label="Deals in play" value={String(live.dealsInPlay)} color={C.pos} />
          {live.cplRaw != null && Math.round(live.cplRaw) !== s.ch.ispeed.p && (
            <button onClick={() => setCh('ispeed', 'p', Math.min(125, Math.max(1, Math.round(live.cplRaw!))))}
              className="tap ml-auto rounded-full border px-3 py-1 text-[12px]"
              style={{ borderColor: `${C.blue}44`, color: C.blue, background: `${C.blue}14` }}>
              Set iSpeed cost to live {money(live.cplRaw)}
            </button>
          )}
        </div>
      </GlassCard>

      {/* The target */}
      <GlassCard>
        <Header title="The target" sub="Benchmarks are the wholesaling vitals; the money math is yours. Drag any dial below — everything recomputes." />
        <div className="flex items-end gap-6 flex-wrap">
          <div className="flex items-baseline gap-2">
            <span className={`${NUM} text-[56px] leading-none text-textb`}>{m.deals}</span>
            <span className="text-[15px] text-jtext mb-1">deals / month</span>
          </div>
          <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3 min-w-[280px]">
            <Tile tip="goal" label="Revenue goal" value={fmtK(m.revenue)} note="at your avg deal size" />
            <Tile tip="leads" label="Qualified leads" value={String(Math.ceil(m.leads))} note="per month, top of funnel" />
            <Tile tip="shows" label="Appts shown" value={String(Math.ceil(m.shown))} note={`≈ ${Math.round(perDay)}–${Math.round(perDay) + 1} closing calls/day`} />
            <Tile tip="spend" label="Recommended spend" value={fmtK(m.recSpend)} note="blended, at full scale" />
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border text-[13px] text-jtext leading-relaxed">
          To close <b className="text-textb">{m.deals} deals</b> you need <b className="text-textb">{Math.ceil(m.leads)} qualified leads</b> and{' '}
          <b className="text-textb">{Math.ceil(m.shown)} shown appointments</b> a month — about{' '}
          <b className="text-textb">{Math.round(perDay)}–{Math.round(perDay) + 1} closing calls a day</b>, which one closer can carry.
          At the recommended blended spend that&apos;s a <b style={{ color: C.pos }}>{heroRoi.toFixed(0)}:1 return</b> — well past the 10:1 healthy line.
        </div>
      </GlassCard>

      {/* The funnel */}
      <GlassCard>
        <div className="mb-4">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb">The funnel to hit the target</p>
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: `${C.warn}1a`, color: C.warn }}>Projection — not measured</span>
          </div>
          <p className="text-[12px] text-dimtext mt-0.5 max-w-[640px]">Computed backward from the goal using the dials below. These are targets to hit, not counts of what happened — your measured numbers are in the live vitals strip above.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          {FUNNEL_STAGES.map((st, i) => {
            const val = m[st.key];
            const pct = Math.max(4, (val / m.addresses) * 100);
            const opacity = 1 - i * 0.09;
            return (
              <div key={st.label} className="grid grid-cols-[150px_1fr] gap-3 items-center">
                <div className="text-right">
                  <Def k={st.tip} className="text-[13px] font-medium text-textb">{st.label}</Def>
                  <div className="text-[11px] text-dimtext">{st.note ?? `${st.conv}% pass-through`}</div>
                </div>
                <div className="h-8 flex items-center">
                  <div className="h-8 rounded-lg flex items-center justify-end pr-2.5 min-w-[46px]"
                    style={{ background: C.blue, opacity, width: `${pct}%`, transition: 'width 0.45s cubic-bezier(0.32,0.72,0,1)' }}>
                    <span className={`${NUM} text-[13px] text-white`} style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
                      {val >= 1000 ? Math.round(val).toLocaleString() : val < 10 ? val.toFixed(1) : Math.round(val)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-xl border p-3.5 text-[13px] leading-relaxed"
          style={{ borderColor: `${C.warn}33`, background: `${C.warn}0d`, color: 'rgba(235,235,245,0.62)' }}>
          <b className="text-textb">Read the shape:</b> only <b style={{ color: C.warn }}>{(m.l2d * 100).toFixed(1)}%</b> of qualified leads become
          closed deals (≈ 1 in {Math.round(1 / m.l2d)}). A 10-point drop in your offer→signed close rate nearly doubles the leads — and dollars — you
          need. Fix conversion before you scale marketing.
        </div>
      </GlassCard>

      {/* Channels */}
      <GlassCard>
        <Header title="Three lead channels — cost to convert" sub="Same funnel, three engines. The difference is cost per lead and how many addresses you must touch." />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(Object.keys(CH_META) as ChKey[]).map(k => {
            const cm = chMath(k);
            return (
              <div key={k} className="rounded-2xl border border-border p-4 bg-bg2" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: CH_META[k].color }} />
                  <span className="text-[14px] font-medium text-textb">{CH_META[k].name}</span>
                </div>
                <div className="text-[11px] text-dimtext mt-0.5 mb-3">{CH_META[k].tag}</div>
                <Row tip="a2l" label="Address → lead" value={`${s.ch[k].a}%`} />
                <Row tip="addresses" label="Addresses to touch" value={`${Math.round(cm.addresses).toLocaleString()}/mo`} />
                <Row tip="cpl" label="Cost per lead" value={money(s.ch[k].p)} />
                <Row tip="cpd" label="Cost per deal" value={money(cm.costPerDeal)} />
                <div className="flex items-center justify-between py-1.5 text-[13px]">
                  <Def k="roi" className="text-jtext">Return on spend</Def>
                  <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: `${C.pos}1a`, color: C.pos }}>
                    {Number.isFinite(cm.roi) ? `${cm.roi.toFixed(0)}:1` : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-border text-[13px] text-jtext leading-relaxed">
          <b className="text-textb">The punchline:</b> Sarah&apos;s marginal cost per lead is a couple of dollars because a dial is nearly free. That
          collapses her cost per deal to <b style={{ color: C.purple }}>{money(chMath('sarah').costPerDeal)}</b> vs iSpeed&apos;s{' '}
          <b style={{ color: C.warn }}>{money(chMath('ispeed').costPerDeal)}</b>. A 100%-AI, zero-payroll $100K month is economically real — the
          constraint stops being lead cost and becomes closing throughput and answer rate. Money is not the bottleneck. Conversion is.
        </div>
      </GlassCard>

      {/* The ramp */}
      <GlassCard>
        <Header title="The realistic ramp — $30–50K first, then $100K" sub="Prove conversion cheap, fix the leak, then pour on volume. Bars are deals by channel; the line is revenue. Tap a month for its game plan." />
        <Ramp months={months} deal={s.deal} onPick={i => setOpenMonth(openMonth === i ? null : i)} openIdx={openMonth} />
        <AnimatePresence mode="wait">
          {openMonth != null && months[openMonth] && (
            <motion.div key={openMonth}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }} className="overflow-hidden">
              <MonthDetail d={months[openMonth]} m={m} s={s} onClose={() => setOpenMonth(null)} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex gap-4 mt-3 flex-wrap">
          {(Object.keys(CH_META) as ChKey[]).map(k => (
            <span key={k} className="flex items-center gap-1.5 text-[11px] text-dimtext">
              <span className="w-2 h-2 rounded-full" style={{ background: CH_META[k].color }} />{CH_META[k].name}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[11px] text-dimtext">
            <span className="w-4 h-[3px] rounded-full" style={{ background: C.pos }} />Revenue
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-dimtext">
                {['Month', 'Phase', 'Deals', 'Revenue', 'Spend', 'ROI'].map(h => <th key={h} className="py-2 pr-4 font-medium border-b border-border">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {months.map(d => (
                <tr key={d.mo} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-semibold text-textb">{d.mo}</td>
                  <td className="py-2 pr-4 text-jtext">{d.phase}</td>
                  <td className={`py-2 pr-4 ${NUM} text-textb`}>{d.deals}</td>
                  <td className={`py-2 pr-4 ${NUM} text-textb`}>{money(d.deals * s.deal)}</td>
                  <td className={`py-2 pr-4 ${NUM} text-jtext`}>{money(d.budget)}</td>
                  <td className={`py-2 ${NUM}`} style={{ color: C.pos }}>{(d.deals * s.deal / d.budget).toFixed(0)}:1</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Budget planner */}
      <GlassCard>
        <Header title="Channel budget planner" sub="Pick this month's deal target and channel mix — each card shows the leads, addresses, and dollars that channel needs." />
        <div className="flex gap-2 flex-wrap mb-4">
          {Object.entries(PRESETS).map(([key, p]) => (
            <button key={key}
              onClick={() => { setS(prev => ({ ...prev, plan: { ...p.plan } })); setActivePreset(key); }}
              className="tap rounded-full px-4 py-1.5 text-[12px] border transition-colors"
              style={activePreset === key
                ? { background: C.blue, borderColor: C.blue, color: '#fff' }
                : { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)', color: 'rgba(235,235,245,0.62)' }}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex h-2 rounded-full overflow-hidden border border-border mb-5">
          {planCards.map(c => (
            <div key={c.k} style={{ width: `${c.share * 100}%`, background: CH_META[c.k].color, transition: 'width 0.45s cubic-bezier(0.32,0.72,0,1)' }} />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 mb-5">
          <Slider label="Deals this month" value={P.target} display={String(P.target)} min={1} max={12} step={1} onChange={v => setPlan({ target: v })} />
          <Slider label="iSpeed share" value={P.wI} display={`${P.wI}%`} min={0} max={100} step={5} onChange={v => setPlan({ wI: v })} />
          <Slider label="PropertyLeads share" value={P.wP} display={`${P.wP}%`} min={0} max={100} step={5} onChange={v => setPlan({ wP: v })} />
          <Slider label="Sarah share" value={P.wS} display={`${P.wS}%`} min={0} max={100} step={5} onChange={v => setPlan({ wS: v })} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {planCards.map(c => (
            <div key={c.k} className="rounded-2xl border border-border p-4 bg-bg2"
              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)', opacity: c.share <= 0 ? 0.45 : 1 }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: CH_META[c.k].color }} />
                <span className="text-[14px] font-medium text-textb">{CH_META[c.k].name}</span>
                <span className="ml-auto text-[12px] text-dimtext">{Math.round(c.share * 100)}%</span>
              </div>
              <PlanRow label="Deals from here" value={c.deals.toFixed(1)} />
              <PlanRow label="Qualified leads" value={c.leads < 1 && c.leads > 0 ? c.leads.toFixed(1) : String(Math.round(c.leads))} />
              <PlanRow label="Addresses to touch" value={Math.round(c.addr).toLocaleString()} />
              <PlanRow label="Shown appts" value={c.shows < 1 && c.shows > 0 ? c.shows.toFixed(1) : String(Math.round(c.shows))} />
              <PlanRow label="Cost per deal" value={money(c.cpd)} />
              <PlanRow label="Monthly spend" value={money(c.spend)} accent={CH_META[c.k].color} />
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-border p-4 bg-bg2 text-[14px] text-jtext" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
          To close <b className="text-textb">{P.target} deal{P.target > 1 ? 's' : ''}</b> at this mix, budget{' '}
          <span className={`${NUM} text-[22px] text-textb align-middle mx-1`}>{money(planSpend)}</span> in marketing →{' '}
          <b className="text-textb">{fmtK(planRev)}</b> revenue, a{' '}
          <b style={{ color: C.pos }}>{planSpend > 0 ? (planRev / planSpend).toFixed(0) : '∞'}:1</b> return. That&apos;s your number for the month.
        </div>
      </GlassCard>

      {/* The dials */}
      <GlassCard>
        <Header title="The dials — plug in your reality" sub="Defaults are the healthy benchmarks. As real numbers come in (see the live vitals up top), set them here and the model shows where you stand." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-5">
          <div className="flex flex-col gap-4">
            <GroupTitle>Deal economics</GroupTitle>
            <Slider label="Avg deal size" value={s.deal} display={money(s.deal)} min={10000} max={30000} step={500} onChange={v => set({ deal: v })} />
            <Slider label="Revenue goal / mo" value={s.goal} display={money(s.goal)} min={30000} max={150000} step={5000} onChange={v => set({ goal: v })} />
          </div>
          <div className="flex flex-col gap-4">
            <GroupTitle>Conversion vitals</GroupTitle>
            <Slider label="Lead → appt set" value={s.c1} display={`${s.c1}%`} min={30} max={100} step={5} onChange={v => set({ c1: v })} />
            <Slider label="Appt set → shown" value={s.c2} display={`${s.c2}%`} min={30} max={100} step={5} onChange={v => set({ c2: v })} />
            <Slider label="Shown → offer made" value={s.c3} display={`${s.c3}%`} min={20} max={100} step={5} onChange={v => set({ c3: v })} />
            <Slider label="Offer → signed" value={s.c4} display={`${s.c4}%`} min={10} max={60} step={5} onChange={v => set({ c4: v })} />
            <Slider label="Signed → assigned" value={s.c5} display={`${s.c5}%`} min={40} max={100} step={5} onChange={v => set({ c5: v })} />
            <Slider label="Assigned → closed" value={s.c6} display={`${s.c6}%`} min={40} max={100} step={5} onChange={v => set({ c6: v })} />
          </div>
          <div className="flex flex-col gap-4">
            {(Object.keys(CH_META) as ChKey[]).map(k => (
              <div key={k} className="flex flex-col gap-4">
                <GroupTitle><span className="inline-flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: CH_META[k].color }} />{CH_META[k].name}</span></GroupTitle>
                <Slider label="Address → lead" value={s.ch[k].a} display={`${s.ch[k].a}%`} min={k === 'ppc' ? 30 : 2} max={k === 'ppc' ? 95 : 90} step={1} onChange={v => setCh(k, 'a', v)} />
                <Slider label={k === 'sarah' ? 'Effective cost / lead' : 'Cost / lead'} value={s.ch[k].p} display={money(s.ch[k].p)} min={1} max={k === 'ppc' ? 200 : 125} step={1} onChange={v => setCh(k, 'p', v)} />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-border text-[12px] text-dimtext">
          Model is directional — conversion held equal across channels for clarity. Bought leads run warmer, cold-call leads cooler; split the rates
          once tracking has enough volume. Every dial saves automatically.
        </div>
      </GlassCard>
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <p className="text-[16px] font-semibold tracking-[-0.02em] text-textb">{title}</p>
      <p className="text-[12px] text-dimtext mt-0.5 max-w-[640px]">{sub}</p>
    </div>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium tracking-[0.09em] uppercase text-dimtext">{children}</div>;
}

// Hover glossary — Apple-style dark popover. Rendered through a portal with
// fixed positioning because every GlassCard ancestor sets overflow-hidden,
// which clips an absolutely-positioned child regardless of z-index.
function Def({ k, className, children }: { k: string; className?: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 250, pad = 10;
    setPos({
      x: Math.min(Math.max(pad, r.left), window.innerWidth - W - pad),
      y: r.bottom + 8,
    });
  };
  const hide = () => setPos(null);

  // Close on scroll — a fixed popover would otherwise detach from its trigger.
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [pos]);

  return (
    <span ref={ref} className={`inline-flex items-center gap-1 ${className ?? ''}`}
      onMouseEnter={show} onMouseLeave={hide}
      onFocus={show} onBlur={hide}
      onClick={() => (pos ? hide() : show())}>
      <span tabIndex={0} className="border-b border-dotted border-white/25 cursor-help outline-none">{children}</span>
      <Info size={10} className="text-dimtext opacity-60 flex-shrink-0" />
      {pos && typeof document !== 'undefined' && GLOSSARY[k] && createPortal(
        <span className="fixed z-[9999] w-[250px] rounded-xl border border-border2 p-3 text-[12px] font-normal normal-case tracking-normal text-left leading-relaxed pointer-events-none"
          style={{ left: pos.x, top: pos.y, background: 'rgba(16,20,30,0.97)', color: 'rgba(235,235,245,0.75)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
          dangerouslySetInnerHTML={{ __html: GLOSSARY[k] }} />,
        document.body,
      )}
    </span>
  );
}

function Tile({ tip, label, value, note }: { tip: string; label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-border p-3.5 bg-bg2" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
      <Def k={tip} className="text-[11px] uppercase tracking-[0.07em] text-dimtext">{label}</Def>
      <div className={`${NUM} text-[24px] text-textb mt-1 leading-none`}>{value}</div>
      <div className="text-[11px] text-dimtext mt-1">{note}</div>
    </div>
  );
}

function Vital({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[12px] text-dimtext">{label}</span>
      <span className={`${NUM} text-[14px]`} style={{ color }}>{value}</span>
    </span>
  );
}

function Row({ tip, label, value }: { tip: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border text-[13px]">
      <Def k={tip} className="text-jtext">{label}</Def>
      <span className={`${NUM} text-textb`}>{value}</span>
    </div>
  );
}

function PlanRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-jtext">{label}</span>
      <span className={`${NUM}`} style={{ color: accent ?? '#f5f5f7' }}>{value}</span>
    </div>
  );
}

function Slider({ label, value, display, min, max, step, onChange }: {
  label: string; value: number; display: string; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[13px] mb-1.5">
        <span className="text-jtext">{label}</span>
        <span className={`${NUM} text-textb`}>{display}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full" style={{ accentColor: '#0a84ff' }} />
    </label>
  );
}

function MonthDetail({ d, m, s, onClose }: {
  d: { mo: string; phase: string; deals: number; mix: Record<ChKey, number>; budget: number };
  m: { l2d: number }; s: ModelState; onClose: () => void;
}) {
  const plan = MONTH_PLAN[d.mo];
  const leads = d.deals / m.l2d;
  const shows = leads * (s.c1 / 100) * (s.c2 / 100);
  const rev = d.deals * s.deal;
  const chips = (Object.keys(CH_META) as ChKey[])
    .filter(k => d.mix[k] > 0)
    .map(k => `${CH_META[k].name} ${money(leads * d.mix[k] * s.ch[k].p)}`)
    .join('  ·  ');
  return (
    <div className="mt-4 rounded-2xl border border-border bg-bg2 p-5" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' }}>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[17px] font-semibold tracking-[-0.02em] text-textb">{d.mo} — {plan.title}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em]" style={{ color: C.blue }}>{d.phase}</span>
        <button onClick={onClose} className="tap ml-auto text-dimtext hover:text-textb transition-colors"><X size={15} /></button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 my-4">
        {[['Deals', String(d.deals)], ['Revenue', fmtK(rev)], ['Leads', String(Math.ceil(leads))],
          ['Shown', String(Math.ceil(shows))], ['Spend', fmtK(d.budget)], ['ROI', `${(rev / d.budget).toFixed(0)}:1`]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border p-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="text-[10px] uppercase tracking-[0.06em] text-dimtext">{k}</div>
            <div className={`${NUM} text-[17px] mt-0.5`} style={{ color: k === 'ROI' ? C.pos : '#f5f5f7' }}>{v}</div>
          </div>
        ))}
      </div>
      <p className="text-[13px] text-jtext leading-relaxed">{plan.focus}</p>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {plan.todo.map(t => (
          <li key={t} className="text-[13px] text-jtext flex gap-2">
            <span style={{ color: C.pos }}>→</span>{t}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-dimtext mt-3.5">Channel spend this month: {chips}</p>
    </div>
  );
}

function Ramp({ months, deal, onPick, openIdx }: {
  months: { mo: string; phase: string; deals: number; mix: Record<ChKey, number>; budget: number }[];
  deal: number; onPick: (i: number) => void; openIdx: number | null;
}) {
  const W = 900, H = 300, padL = 40, padR = 16, padT = 30, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxDeals = Math.max(...months.map(d => d.deals));
  const bw = (plotW / months.length) * 0.48;
  const colX = (i: number) => padL + (i + 0.5) * (plotW / months.length);
  const y = (v: number) => padT + plotH - (v / maxDeals) * plotH;
  const order: ChKey[] = ['ispeed', 'sarah', 'ppc'];
  const gridStep = maxDeals > 8 ? 2 : 1;
  const gridLines = [];
  for (let g = 0; g <= maxDeals; g += gridStep) gridLines.push(g);
  const linePath = months.map((d, i) => `${i ? 'L' : 'M'}${colX(i)} ${y(d.deals)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Six month revenue ramp">
      {gridLines.map(g => (
        <g key={g}>
          <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="rgba(255,255,255,0.06)" />
          <text x={padL - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="rgba(235,235,245,0.35)">{g}</text>
        </g>
      ))}
      {months.map((d, i) => {
        let acc = 0;
        const cx = colX(i);
        return (
          <g key={d.mo} onClick={() => onPick(i)} style={{ cursor: 'pointer' }}>
            <rect x={cx - plotW / months.length / 2} y={padT} width={plotW / months.length} height={plotH}
              fill={openIdx === i ? 'rgba(10,132,255,0.07)' : 'transparent'} rx="8" />
            {order.map(k => {
              const dv = d.deals * d.mix[k];
              if (dv <= 0) return null;
              const yTop = y(acc + dv), yBot = y(acc);
              acc += dv;
              return (
                <motion.rect key={k} x={cx - bw / 2} width={bw} rx="3" fill={CH_META[k].color}
                  initial={{ y: yBot, height: 0 }} animate={{ y: yTop, height: Math.max(0, yBot - yTop) }} transition={SPRING} />
              );
            })}
            <text x={cx} y={H - padB + 18} textAnchor="middle" fontSize="12" fontWeight="600" fill="rgba(235,235,245,0.62)">{d.mo}</text>
            <text x={cx} y={H - padB + 33} textAnchor="middle" fontSize="10" fill="rgba(235,235,245,0.35)">{d.phase}</text>
            <text x={cx} y={y(d.deals) - 22} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={C.pos}>{fmtK(d.deals * deal)}</text>
          </g>
        );
      })}
      <path d={linePath} fill="none" stroke={C.pos} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {months.map((d, i) => (
        <circle key={d.mo} cx={colX(i)} cy={y(d.deals)} r="4" fill="#05070d" stroke={C.pos} strokeWidth="2" />
      ))}
    </svg>
  );
}
