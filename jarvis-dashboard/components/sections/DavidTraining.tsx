'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BrainCircuit, Phone, TrendingUp, MessageSquare, History, Send,
  ChevronDown, ChevronUp, CheckCircle, Clock, AlertCircle, Play,
  RotateCcw, Zap, Target, DollarSign, User, Home, ArrowRight,
  ThumbsUp, AlertTriangle, RefreshCw, Loader2, Star, Shield,
  Activity, FileText, Bell,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { supabase, fmtTime, fmtDate, timeAgo } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CallLog {
  id: string;
  lead_id?: string;
  seller_name: string;
  address: string;
  call_type: string;
  outcome: string;
  final_price?: number;
  call_duration?: number;
  steps_completed?: number;
  objections_handled?: number;
  novation_considered?: boolean;
  novation_approved?: boolean;
  contract_sent?: boolean;
  created_at: string;
}

interface Adaptation {
  id: string;
  category: string;
  what_changed: string;
  before_text?: string;
  after_text?: string;
  reason: string;
  performance_before?: string;
  performance_after?: string;
  owner_approved?: boolean;
  created_at: string;
}

interface PrecallBrief {
  id: string;
  lead_id?: string;
  strategy_json?: Record<string, unknown>;
  offer_ladder_json?: Record<string, unknown>;
  expected_objections?: string[];
  call_path?: string;
  created_at: string;
}

interface MockSession {
  id: string;
  scenario_config?: Record<string, unknown>;
  transcript?: string;
  score_json?: Record<string, unknown>;
  suggestions?: string[];
  created_at: string;
}

// ─── Seed/sample data (shown when tables empty) ───────────────────────────────

const SAMPLE_CALL_LOGS: CallLog[] = [
  {
    id: 'demo-1',
    seller_name: 'Denise Hawkins',
    address: '123 Main St, Orlando FL',
    call_type: 'Cash',
    outcome: 'CLOSED',
    final_price: 208000,
    call_duration: 862,
    steps_completed: 7,
    objections_handled: 3,
    novation_considered: false,
    novation_approved: false,
    contract_sent: true,
    created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: 'demo-2',
    seller_name: 'Marcus Webb',
    address: '456 Oak Ave, Kissimmee FL',
    call_type: 'Cash',
    outcome: 'WARM FOLLOW UP',
    final_price: undefined,
    call_duration: 1140,
    steps_completed: 6,
    objections_handled: 4,
    novation_considered: false,
    novation_approved: false,
    contract_sent: false,
    created_at: new Date(Date.now() - 4.5 * 3600000).toISOString(),
  },
  {
    id: 'demo-3',
    seller_name: 'Sandra Reyes',
    address: '789 Pine Rd, St. Cloud FL',
    call_type: 'Novation',
    outcome: 'NOVATION DEAL',
    final_price: 267000,
    call_duration: 1320,
    steps_completed: 7,
    objections_handled: 5,
    novation_considered: true,
    novation_approved: true,
    contract_sent: true,
    created_at: new Date(Date.now() - 28 * 3600000).toISOString(),
  },
];

const SAMPLE_ADAPTATIONS: Adaptation[] = [
  {
    id: 'adp-1',
    category: 'Objection Response',
    what_changed: 'Updated response for "I need to think about it"',
    before_text: '"I completely understand, can I ask what specifically you need to think through?"',
    after_text: '"Absolutely — what\'s the one thing that\'s holding you back right now?"',
    reason: 'Previous version had 22% conversion. New version tested at 38%.',
    performance_before: '22%',
    performance_after: '38%',
    owner_approved: true,
    created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
  },
  {
    id: 'adp-2',
    category: 'Hold Timing',
    what_changed: 'Adjusted underwriter hold duration: 45s → 60s',
    before_text: '45 seconds',
    after_text: '60 seconds',
    reason: 'Sellers were answering before David came back. Extra 15 seconds feels more credible.',
    performance_before: undefined,
    performance_after: undefined,
    owner_approved: true,
    created_at: new Date(Date.now() - 27 * 3600000).toISOString(),
  },
  {
    id: 'adp-3',
    category: 'Qualification',
    what_changed: 'Added new blocker-detection question before offer',
    before_text: undefined,
    after_text: '"If the price made sense today, is there anything that would prevent you from moving forward this week?"',
    reason: 'Identifies hidden blockers before the offer stage, reducing dead-end negotiation.',
    performance_before: undefined,
    performance_after: undefined,
    owner_approved: true,
    created_at: new Date(Date.now() - 3 * 24 * 3600000).toISOString(),
  },
  {
    id: 'adp-4',
    category: 'Novation Trigger',
    what_changed: 'Raised Novation gap threshold',
    before_text: 'Gap over $15k triggers Novation check',
    after_text: 'Gap over $20k triggers Novation check',
    reason: 'Too many low-value Novation checks sent to owner. Raising threshold reduces unnecessary interruptions.',
    performance_before: undefined,
    performance_after: undefined,
    owner_approved: true,
    created_at: new Date(Date.now() - 7 * 24 * 3600000).toISOString(),
  },
];

const SAMPLE_TELEGRAM_LOGS = [
  {
    id: 't-1',
    type: 'DEAL AGREED',
    seller: 'Denise Hawkins',
    address: '123 Main St',
    price: '$208,000',
    earnest: '$1,000',
    deal_type: 'Cash',
    status: 'APPROVED',
    approved: true,
    created_at: new Date(Date.now() - 2.5 * 3600000).toISOString(),
  },
  {
    id: 't-2',
    type: 'NOVATION CHECK',
    seller: 'Marcus Webb',
    address: '456 Oak Ave',
    price: '$248,000',
    payoff: '~$198,000',
    gap: '$31,000',
    est_fee: '$40,000',
    status: 'DECLINED',
    approved: false,
    created_at: new Date(Date.now() - 4.8 * 3600000).toISOString(),
  },
  {
    id: 't-3',
    type: 'NOVATION CHECK',
    seller: 'Sandra Reyes',
    address: '789 Pine Rd',
    price: '$267,000',
    payoff: '~$142,000',
    gap: '$48,000',
    est_fee: '$52,000',
    status: 'APPROVED',
    approved: true,
    created_at: new Date(Date.now() - 28.5 * 3600000).toISOString(),
  },
];

const CALL_STEPS = [
  'Warm Re-intro',
  'Re-confirm timeline & condition',
  'Set up the offer (get YES first)',
  'Present offer',
  'Pull-down tactics',
  'Underwriter escalation',
  'Close / Follow-up / Novation pivot',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(sec?: number): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function fmtPrice(n?: number): string {
  if (!n) return '—';
  return `$${n.toLocaleString()}`;
}

const OUTCOME_COLOR: Record<string, string> = {
  CLOSED:            '#4ade80',
  'NOVATION DEAL':   '#fbbf24',
  'WARM FOLLOW UP':  '#67e8f9',
  'COLD FOLLOW UP':  '#60a5fa',
  'NO DEAL':         '#f87171',
};

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'strategy',  label: 'Pre-Call Strategy', icon: <Target size={13} /> },
  { id: 'live',      label: 'Live Call',          icon: <Activity size={13} /> },
  { id: 'learning',  label: 'Learning Updates',   icon: <TrendingUp size={13} /> },
  { id: 'simulator', label: 'Mock Simulator',     icon: <Play size={13} /> },
  { id: 'history',   label: 'Call History',       icon: <History size={13} /> },
  { id: 'telegram',  label: 'Telegram Log',       icon: <Bell size={13} /> },
];

// ─── Pre-Call Strategy Tab ────────────────────────────────────────────────────

function PreCallStrategyTab({ briefs, callLogs }: { briefs: PrecallBrief[]; callLogs: CallLog[] }) {
  // Use latest brief if available, else show demo data
  const hasBriefs = briefs.length > 0;
  const latest = callLogs[0];

  // Demo offer ladder calc
  const arv = 320000;
  const start60 = Math.round(arv * 0.60);
  const step65  = Math.round(arv * 0.65);
  const max70   = Math.round(arv * 0.70);
  const novation= Math.round(arv * 0.84);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Lead Intel */}
      <GlassCard accent="gold" padding="p-4">
        <SectionTitle accent="gold">Lead Intel</SectionTitle>
        {!hasBriefs && (
          <div className="mb-2 px-2 py-1 rounded text-[9px] font-orbitron tracking-wider"
            style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>
            DEMO DATA — Connect david_precall_briefs table for live data
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {[
            ['Name',        latest?.seller_name ?? 'Denise Hawkins'],
            ['Property',    latest?.address     ?? '123 Main St, Orlando FL'],
            ['Beds/Baths',  '3 BR / 2 BA'],
            ['Motivation',  'HIGH'],
            ['Equity',      '~38%'],
            ['Payoff',      '~$198,000'],
            ['Timeline',    '45 days'],
            ['Asking',      '$265,000'],
            ['ARV',         `$${arv.toLocaleString()}`],
            ['Decision Maker', 'Solo'],
            ['Condition',   'Good'],
            ['Novation Qualified', 'NO — timeline too short'],
          ].map(([label, val]) => (
            <div key={label}>
              <div className="text-[8px] text-dimtext uppercase tracking-[1.5px] mb-0.5">{label}</div>
              <div className="text-[11px] text-textb font-medium">{val}</div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Strategy Card */}
      <GlassCard accent="gold" padding="p-4">
        <SectionTitle accent="gold">David's Strategy</SectionTitle>
        <div className="space-y-3">
          <div>
            <div className="text-[9px] text-dimtext uppercase tracking-[1.5px] mb-1">Opening Approach</div>
            <div className="text-[11px] text-textb">Warm re-intro — confident tone</div>
          </div>
          <div>
            <div className="text-[9px] text-dimtext uppercase tracking-[1.5px] mb-1">Re-confirm</div>
            <div className="text-[11px] text-textb">Timeline + condition only — decision maker already confirmed</div>
          </div>
          <div>
            <div className="text-[9px] text-dimtext uppercase tracking-[1.5px] mb-2">Offer Ladder</div>
            <div className="space-y-1">
              {[
                { label: 'Start (60%)',    val: fmtPrice(start60), color: '#4ade80' },
                { label: 'Step 2 (65%)',   val: fmtPrice(step65),  color: '#67e8f9' },
                { label: 'Max (70%)',      val: fmtPrice(max70),   color: '#fbbf24' },
                { label: 'Novation',       val: fmtPrice(novation) + ' (if qual)', color: '#a78bfa' },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-2">
                  <ArrowRight size={10} style={{ color: r.color }} />
                  <span className="text-[10px] text-dimtext w-28">{r.label}</span>
                  <span className="text-[11px] font-bold" style={{ color: r.color }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-dimtext uppercase tracking-[1.5px] mb-1">Expected Objections</div>
            <div className="space-y-0.5">
              {['"That\'s too low"', '"I need to think about it"', '"My neighbor sold for more"'].map(o => (
                <div key={o} className="flex items-start gap-1.5">
                  <AlertCircle size={9} className="mt-0.5 flex-shrink-0" style={{ color: '#fb923c' }} />
                  <span className="text-[10px] text-jtext">{o}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1 rounded-sm px-3 py-2 text-center"
              style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
              <div className="text-[8px] text-dimtext uppercase tracking-wider mb-0.5">Call Path</div>
              <div className="text-[10px] font-bold text-ngreen">CASH ONLY</div>
            </div>
            <div className="flex-1 rounded-sm px-3 py-2 text-center"
              style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
              <div className="text-[8px] text-dimtext uppercase tracking-wider mb-0.5">Novation Pivot</div>
              <div className="text-[10px] font-bold" style={{ color: '#f87171' }}>NO</div>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Logic Explanation */}
      <GlassCard accent="gold" padding="p-4" className="lg:col-span-2">
        <SectionTitle accent="gold">Strategy Logic</SectionTitle>
        <div className="flex gap-3 items-start">
          <BrainCircuit size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
          <p className="text-[11px] text-jtext leading-relaxed">
            David is starting at <span className="text-textb font-semibold">${start60.toLocaleString()} (60%)</span> because
            the seller has 38% equity and a 45-day timeline. Novation is <span className="text-[#f87171] font-semibold">not</span> being
            considered because the timeline is too short — Novation requires 60+ days. Pull-down tactics will be applied
            before any bump to 65%. The seller is a solo decision-maker, so David will push for a commitment on the first call
            rather than scheduling a callback. Underwriter escalation is available if seller shows movement but stalls at the 65% mark.
          </p>
        </div>
      </GlassCard>
    </div>
  );
}

// ─── Live Call Tracker Tab ────────────────────────────────────────────────────

function LiveCallTab() {
  const [activeStep, setActiveStep] = useState(4); // demo: step 4 active
  const [feedback, setFeedback] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);

  const LIVE_DECISIONS = [
    { time: '2:34 PM', text: 'Presented 60% offer ($192,000). Seller said "that\'s too low."' },
    { time: '2:35 PM', text: 'Applied pull-down tactic #2: "Is that set in stone?"' },
    { time: '2:36 PM', text: 'Seller came down $8,000. Moving to underwriter escalation.' },
    { time: '2:37 PM', text: 'On hold 60s — simulating underwriter check.' },
  ];

  const sendFeedback = () => {
    if (!feedback.trim()) return;
    setFeedbackSent(true);
    setFeedback('');
    setTimeout(() => setFeedbackSent(false), 3000);
  };

  return (
    <div className="space-y-4">
      {/* No active call banner */}
      <GlassCard accent="cyan" padding="p-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#67e8f9', boxShadow: '0 0 6px rgba(103,232,249,0.8)' }} />
          <span className="text-[10px] font-orbitron tracking-[2px] uppercase" style={{ color: '#67e8f9' }}>
            Demo Mode — No Active Call
          </span>
          <span className="text-[9px] text-dimtext ml-2">Live data populates here during a real call via GHL webhook</span>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Progress Bar */}
        <GlassCard accent="cyan" padding="p-4" className="lg:col-span-2">
          <SectionTitle accent="cyan" badge={`Step ${activeStep} / ${CALL_STEPS.length}`}>Call Progress</SectionTitle>
          <div className="space-y-2">
            {CALL_STEPS.map((step, i) => {
              const idx = i + 1;
              const done = idx < activeStep;
              const current = idx === activeStep;
              return (
                <motion.div
                  key={step}
                  className="flex items-center gap-3 px-3 py-2 rounded-sm"
                  style={{ background: current ? 'rgba(103,232,249,0.08)' : 'transparent',
                    border: current ? '1px solid rgba(103,232,249,0.2)' : '1px solid transparent' }}
                  animate={current ? { opacity: [1, 0.7, 1] } : {}}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: done ? 'rgba(74,222,128,0.15)' : current ? 'rgba(103,232,249,0.15)' : 'rgba(82,82,110,0.2)',
                      border: `1px solid ${done ? '#4ade80' : current ? '#67e8f9' : '#52526e'}`,
                    }}>
                    {done ? <CheckCircle size={11} style={{ color: '#4ade80' }} />
                      : current ? <Loader2 size={10} className="animate-spin" style={{ color: '#67e8f9' }} />
                      : <span className="text-[8px] text-dimtext">{idx}</span>}
                  </div>
                  <span className="text-[11px]" style={{ color: done ? '#4ade80' : current ? '#67e8f9' : '#52526e' }}>{step}</span>
                  {done && <span className="ml-auto text-[9px] text-dimtext">✓</span>}
                  {current && <span className="ml-auto text-[9px]" style={{ color: '#67e8f9' }}>in progress...</span>}
                </motion.div>
              );
            })}
          </div>
        </GlassCard>

        {/* Live Decisions + Owner Feedback */}
        <div className="space-y-4">
          <GlassCard accent="cyan" padding="p-4">
            <SectionTitle accent="cyan">Live Decision Log</SectionTitle>
            <div className="space-y-2">
              {LIVE_DECISIONS.map((d, i) => (
                <div key={i} className="border-l-2 pl-2" style={{ borderColor: 'rgba(103,232,249,0.3)' }}>
                  <div className="text-[9px] font-orbitron text-dimtext">{d.time}</div>
                  <div className="text-[10px] text-jtext mt-0.5">{d.text}</div>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard accent="gold" padding="p-4">
            <SectionTitle accent="gold">Owner Feedback</SectionTitle>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {[
                { icon: <ThumbsUp size={10} />, label: 'Good', color: '#4ade80' },
                { icon: <AlertTriangle size={10} />, label: 'Slow down', color: '#fb923c' },
                { icon: <RefreshCw size={10} />, label: 'Change approach', color: '#67e8f9' },
                { icon: <DollarSign size={10} />, label: 'Try Novation', color: '#a78bfa' },
              ].map(btn => (
                <motion.button
                  key={btn.label}
                  className="flex items-center justify-center gap-1 py-1.5 rounded-sm text-[9px] font-medium"
                  style={{ background: `${btn.color}10`, border: `1px solid ${btn.color}30`, color: btn.color }}
                  whileHover={{ background: `${btn.color}20` }}
                  whileTap={{ scale: 0.97 }}
                >
                  {btn.icon} {btn.label}
                </motion.button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendFeedback()}
                placeholder="Type live feedback..."
                className="flex-1 bg-bg3 border border-border2 rounded-sm px-2 py-1.5 text-[10px] text-textb outline-none"
                style={{ caretColor: '#fbbf24' }}
              />
              <motion.button
                onClick={sendFeedback}
                className="px-2.5 py-1.5 rounded-sm"
                style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}
                whileTap={{ scale: 0.95 }}
              >
                <Send size={10} />
              </motion.button>
            </div>
            {feedbackSent && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="mt-1.5 text-[9px]" style={{ color: '#4ade80' }}>
                ✓ Feedback sent to David
              </motion.div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

// ─── Learning Updates Tab ─────────────────────────────────────────────────────

function LearningUpdatesTab({ adaptations }: { adaptations: Adaptation[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const data = adaptations.length > 0 ? adaptations : SAMPLE_ADAPTATIONS;
  const isDemo = adaptations.length === 0;

  const CAT_COLOR: Record<string, string> = {
    'Objection Response': '#4ade80',
    'Hold Timing':        '#67e8f9',
    'Qualification':      '#60a5fa',
    'Novation Trigger':   '#a78bfa',
    'Offer Ladder':       '#fbbf24',
    'Call Flow':          '#fb923c',
  };

  return (
    <div className="space-y-4">
      <GlassCard accent="green" padding="p-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={13} style={{ color: '#4ade80' }} />
          <span className="text-[10px] text-jtext">
            {isDemo
              ? 'Demo data — Connect david_adaptations table for live adaptation tracking'
              : `${data.length} total adaptations logged`}
          </span>
        </div>
      </GlassCard>

      <div className="space-y-3">
        {data.map(a => {
          const color = CAT_COLOR[a.category] ?? '#fbbf24';
          const isOpen = expanded === a.id;
          return (
            <GlassCard key={a.id} accent="gold" padding="p-0" hover={false}>
              <button
                className="w-full text-left p-4"
                onClick={() => setExpanded(isOpen ? null : a.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-orbitron tracking-wider px-2 py-0.5 rounded-sm"
                        style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>
                        {a.category}
                      </span>
                      <span className="text-[9px] text-dimtext">{timeAgo(a.created_at)}</span>
                      {a.owner_approved && (
                        <span className="text-[9px] font-orbitron tracking-wider px-1.5 py-0.5 rounded-sm"
                          style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80' }}>
                          APPROVED
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-textb font-medium mt-1">{a.what_changed}</div>
                    {!isOpen && a.reason && (
                      <div className="text-[10px] text-dimtext mt-0.5 truncate">{a.reason}</div>
                    )}
                  </div>
                  <div style={{ color: '#52526e' }}>
                    {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </div>
                </div>
              </button>

              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                      {a.before_text && (
                        <div className="mt-3">
                          <div className="text-[9px] text-dimtext uppercase tracking-[1.5px] mb-1">Before</div>
                          <div className="px-3 py-2 rounded-sm text-[10px] text-jtext"
                            style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)' }}>
                            {a.before_text}
                          </div>
                        </div>
                      )}
                      {a.after_text && (
                        <div>
                          <div className="text-[9px] text-dimtext uppercase tracking-[1.5px] mb-1">After</div>
                          <div className="px-3 py-2 rounded-sm text-[10px] text-jtext"
                            style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)' }}>
                            {a.after_text}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-[9px] text-dimtext uppercase tracking-[1.5px] mb-1">Reason</div>
                        <div className="text-[10px] text-jtext">{a.reason}</div>
                      </div>
                      {(a.performance_before || a.performance_after) && (
                        <div className="flex gap-4">
                          {a.performance_before && (
                            <div>
                              <div className="text-[9px] text-dimtext">Before Performance</div>
                              <div className="text-[13px] font-bold" style={{ color: '#f87171' }}>{a.performance_before}</div>
                            </div>
                          )}
                          {a.performance_after && (
                            <div>
                              <div className="text-[9px] text-dimtext">After Performance</div>
                              <div className="text-[13px] font-bold" style={{ color: '#4ade80' }}>{a.performance_after}</div>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <motion.button
                          className="flex items-center gap-1 px-3 py-1.5 rounded-sm text-[9px] font-medium"
                          style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80' }}
                          whileHover={{ background: 'rgba(74,222,128,0.18)' }}
                        >
                          <CheckCircle size={9} /> Approve
                        </motion.button>
                        <motion.button
                          className="flex items-center gap-1 px-3 py-1.5 rounded-sm text-[9px] font-medium"
                          style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171' }}
                          whileHover={{ background: 'rgba(248,113,113,0.15)' }}
                        >
                          <RotateCcw size={9} /> Roll Back
                        </motion.button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

// ─── Mock Simulator Tab ───────────────────────────────────────────────────────

interface SimConfig {
  sellerName: string;
  address: string;
  arv: string;
  asking: string;
  equity: string;
  timeline: string;
  condition: string;
  payoff: string;
  persona: string;
  objectionLevel: string;
}

const DEFAULT_CONFIG: SimConfig = {
  sellerName: 'Denise',
  address: '123 Main St, Orlando FL',
  arv: '320000',
  asking: '265000',
  equity: '38',
  timeline: '30-60 days',
  condition: 'Good',
  payoff: '198000',
  persona: 'Motivated',
  objectionLevel: 'Moderate',
};

interface ScoreData {
  offer_timing: number;
  silence_after_offer: number;
  pulldown_tactics: number;
  objection_handling: number;
  timeline_reconfirm: number;
  close_probability: number;
  suggestions: string[];
}

function MockSimulatorTab() {
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const [transcript, setTranscript] = useState('');
  const [score, setScore] = useState<ScoreData | null>(null);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const runMock = async () => {
    setLoading(true);
    setStarted(true);
    setTranscript('');
    setScore(null);

    try {
      const res = await fetch('/api/mock-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setTranscript(data.transcript || 'Error generating transcript.');
      setScore(data.score || null);
    } catch {
      setTranscript('Failed to connect to simulator. Check ANTHROPIC_API_KEY in Vercel env vars.');
    } finally {
      setLoading(false);
    }
  };

  // Parse transcript for decision points to highlight them
  const renderTranscript = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      if (line.startsWith('[DECISION POINT')) {
        return (
          <div key={i} className="my-2 px-3 py-2 rounded-sm text-[9px] italic"
            style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', color: '#fbbf24' }}>
            {line}
          </div>
        );
      }
      if (line.startsWith('DAVID:')) {
        return (
          <div key={i} className="my-1.5">
            <span className="text-[9px] font-bold" style={{ color: '#4ade80' }}>DAVID: </span>
            <span className="text-[10px] text-textb">{line.replace('DAVID: ', '')}</span>
          </div>
        );
      }
      if (line.includes(':') && !line.startsWith('[') && !line.startsWith('DAVID:') && !line.startsWith('SCORE')) {
        const colonIdx = line.indexOf(':');
        const speaker = line.slice(0, colonIdx);
        const rest = line.slice(colonIdx + 1);
        return (
          <div key={i} className="my-1.5">
            <span className="text-[9px] font-bold" style={{ color: '#67e8f9' }}>{speaker}: </span>
            <span className="text-[10px] text-jtext">{rest}</span>
          </div>
        );
      }
      if (line.startsWith('[HOLD')) {
        return (
          <div key={i} className="my-1 text-[9px] text-dimtext italic px-2">{line}</div>
        );
      }
      if (line === '') return <div key={i} className="h-1.5" />;
      return <div key={i} className="text-[10px] text-jtext my-0.5">{line}</div>;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Setup Form */}
        <GlassCard accent="purple" padding="p-4" className="lg:col-span-1">
          <SectionTitle accent="purple">Mock Call Setup</SectionTitle>
          <div className="space-y-2.5">
            {[
              { label: 'Seller Name', key: 'sellerName', type: 'text' },
              { label: 'Property Address', key: 'address', type: 'text' },
              { label: 'ARV ($)', key: 'arv', type: 'number' },
              { label: 'Seller Asking ($)', key: 'asking', type: 'number' },
              { label: 'Equity (%)', key: 'equity', type: 'number' },
              { label: 'Mortgage Payoff ($)', key: 'payoff', type: 'number' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-[9px] text-dimtext uppercase tracking-[1.5px]">{f.label}</label>
                <input
                  type={f.type}
                  value={config[f.key as keyof SimConfig]}
                  onChange={e => setConfig(c => ({ ...c, [f.key]: e.target.value }))}
                  className="w-full mt-0.5 bg-bg3 border border-border2 rounded-sm px-2 py-1.5 text-[10px] text-textb outline-none"
                  style={{ caretColor: '#a78bfa' }}
                />
              </div>
            ))}

            {[
              { label: 'Timeline', key: 'timeline', options: ['Under 30 days', '30-60 days', '60+ days'] },
              { label: 'Condition', key: 'condition', options: ['Good', 'Fair', 'Poor'] },
              { label: 'Seller Persona', key: 'persona', options: ['Cooperative', 'Difficult', 'Motivated', 'Testing'] },
              { label: 'Objection Level', key: 'objectionLevel', options: ['Light', 'Moderate', 'Heavy'] },
            ].map(f => (
              <div key={f.key}>
                <label className="text-[9px] text-dimtext uppercase tracking-[1.5px]">{f.label}</label>
                <select
                  value={config[f.key as keyof SimConfig]}
                  onChange={e => setConfig(c => ({ ...c, [f.key]: e.target.value }))}
                  className="w-full mt-0.5 bg-bg3 border border-border2 rounded-sm px-2 py-1.5 text-[10px] text-textb outline-none appearance-none"
                  style={{ caretColor: '#a78bfa' }}
                >
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}

            <motion.button
              onClick={runMock}
              disabled={loading}
              className="w-full py-2.5 rounded-sm text-[10px] font-bold font-orbitron tracking-[2px] flex items-center justify-center gap-2 mt-2"
              style={{ background: loading ? 'rgba(167,139,250,0.1)' : 'rgba(167,139,250,0.15)',
                border: '1px solid rgba(167,139,250,0.35)', color: '#a78bfa' }}
              whileHover={!loading ? { background: 'rgba(167,139,250,0.22)' } : {}}
              whileTap={!loading ? { scale: 0.98 } : {}}
            >
              {loading ? <><Loader2 size={11} className="animate-spin" /> GENERATING...</> : <><Play size={11} /> START MOCK CALL</>}
            </motion.button>
          </div>
        </GlassCard>

        {/* Transcript + Score */}
        <div className="lg:col-span-2 space-y-4">
          <GlassCard accent="purple" padding="p-4">
            <SectionTitle accent="purple" badge={started ? (loading ? 'GENERATING...' : 'COMPLETE') : 'READY'}>
              Mock Call Transcript
            </SectionTitle>

            {!started ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                <Play size={24} style={{ color: '#52526e' }} />
                <div className="text-[11px] text-dimtext">Configure the scenario and click Start Mock Call</div>
                <div className="text-[9px] text-dimtext">David's internal decisions show in <span style={{ color: '#fbbf24' }}>gold brackets</span></div>
              </div>
            ) : (
              <div ref={transcriptRef}
                className="h-80 overflow-y-auto pr-1 space-y-0.5 scrollbar-thin"
                style={{ scrollbarColor: 'rgba(167,139,250,0.3) transparent' }}>
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <Loader2 size={20} className="animate-spin" style={{ color: '#a78bfa' }} />
                    <div className="text-[10px] text-dimtext font-orbitron tracking-[2px]">RUNNING SIMULATION...</div>
                    <div className="text-[9px] text-dimtext">Claude is generating your seller persona and call flow</div>
                  </div>
                ) : (
                  renderTranscript(transcript)
                )}
              </div>
            )}
          </GlassCard>

          {score && (
            <GlassCard accent="gold" padding="p-4">
              <SectionTitle accent="gold">Simulation Score</SectionTitle>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: 'Offer Timing',          val: score.offer_timing },
                  { label: 'Silence After Offer',   val: score.silence_after_offer },
                  { label: 'Pull-Down Tactics',      val: score.pulldown_tactics },
                  { label: 'Objection Handling',     val: score.objection_handling },
                  { label: 'Timeline Re-confirm',    val: score.timeline_reconfirm },
                ].map(s => (
                  <div key={s.label} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] text-dimtext">{s.label}</span>
                      <span className="text-[10px] font-bold" style={{ color: s.val >= 8 ? '#4ade80' : s.val >= 6 ? '#fbbf24' : '#f87171' }}>
                        {s.val}/10
                      </span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <motion.div className="h-full rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${s.val * 10}%` }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                        style={{ background: s.val >= 8 ? '#4ade80' : s.val >= 6 ? '#fbbf24' : '#f87171' }} />
                    </div>
                  </div>
                ))}
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-dimtext">Close Probability</span>
                    <span className="text-[13px] font-bold" style={{ color: '#fbbf24' }}>{score.close_probability}%</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <motion.div className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${score.close_probability}%` }}
                      transition={{ duration: 0.8 }}
                      style={{ background: '#fbbf24' }} />
                  </div>
                </div>
              </div>
              {score.suggestions?.length > 0 && (
                <div>
                  <div className="text-[9px] text-dimtext uppercase tracking-[1.5px] mb-2">Suggestions</div>
                  <div className="space-y-1">
                    {score.suggestions.map((s, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Star size={9} className="mt-0.5 flex-shrink-0" style={{ color: '#fbbf24' }} />
                        <span className="text-[10px] text-jtext">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Call History Tab ─────────────────────────────────────────────────────────

function CallHistoryTab({ callLogs }: { callLogs: CallLog[] }) {
  const [selected, setSelected] = useState<CallLog | null>(null);
  const data = callLogs.length > 0 ? callLogs : SAMPLE_CALL_LOGS;
  const isDemo = callLogs.length === 0;

  return (
    <div className="space-y-4">
      {isDemo && (
        <GlassCard accent="gold" padding="p-3">
          <div className="text-[9px] font-orbitron tracking-wider" style={{ color: '#fbbf24' }}>
            DEMO DATA — Connect david_call_logs table for live history
          </div>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 gap-3">
        {data.map(call => {
          const outcomeColor = OUTCOME_COLOR[call.outcome] ?? '#52526e';
          return (
            <motion.div key={call.id} layout>
              <GlassCard accent="gold" padding="p-4" hover={false}>
                <button className="w-full text-left" onClick={() => setSelected(selected?.id === call.id ? null : call)}>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-sm flex items-center justify-center flex-shrink-0"
                      style={{ background: `${outcomeColor}12`, border: `1px solid ${outcomeColor}30` }}>
                      {call.contract_sent ? <CheckCircle size={14} style={{ color: outcomeColor }} />
                        : call.novation_approved ? <Shield size={14} style={{ color: outcomeColor }} />
                        : <Phone size={14} style={{ color: outcomeColor }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold text-textb">{call.seller_name}</span>
                        <span className="text-[9px] px-2 py-0.5 rounded-sm font-orbitron tracking-wider"
                          style={{ background: `${outcomeColor}15`, border: `1px solid ${outcomeColor}30`, color: outcomeColor }}>
                          {call.outcome}
                        </span>
                        {call.contract_sent && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-sm"
                            style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80' }}>
                            CONTRACT SENT ✓
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-dimtext mt-0.5">{call.address}</div>
                      <div className="flex items-center gap-4 mt-1.5">
                        {call.final_price && (
                          <span className="text-[11px] font-bold" style={{ color: '#fbbf24' }}>{fmtPrice(call.final_price)}</span>
                        )}
                        <span className="text-[9px] text-dimtext">{fmtDuration(call.call_duration)}</span>
                        <span className="text-[9px] text-dimtext">{call.objections_handled} objections</span>
                        <span className="text-[9px] text-dimtext ml-auto">{fmtTime(call.created_at)}</span>
                      </div>
                    </div>
                    {selected?.id === call.id ? <ChevronUp size={13} style={{ color: '#52526e' }} /> : <ChevronDown size={13} style={{ color: '#52526e' }} />}
                  </div>
                </button>

                <AnimatePresence>
                  {selected?.id === call.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-3"
                        style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                        {[
                          { label: 'Call Type',   val: call.call_type ?? '—' },
                          { label: 'Steps Done',  val: `${call.steps_completed ?? 0} / ${CALL_STEPS.length}` },
                          { label: 'Novation?',   val: call.novation_considered ? 'Yes' : 'No' },
                          { label: 'Final Price', val: fmtPrice(call.final_price) },
                        ].map(d => (
                          <div key={d.label}>
                            <div className="text-[8px] text-dimtext uppercase tracking-[1.5px]">{d.label}</div>
                            <div className="text-[11px] text-textb font-medium mt-0.5">{d.val}</div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </GlassCard>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Telegram Log Tab ─────────────────────────────────────────────────────────

function TelegramLogTab() {
  const [dbLogs, setDbLogs] = useState<typeof SAMPLE_TELEGRAM_LOGS>([]);
  const isDemo = dbLogs.length === 0;
  const data = isDemo ? SAMPLE_TELEGRAM_LOGS : dbLogs;

  useEffect(() => {
    supabase
      .from('jarvis_log')
      .select('*')
      .or('type.ilike.%deal%,type.ilike.%novation%,type.ilike.%telegram%')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data: rows }) => {
        if (rows && rows.length > 0) {
          setDbLogs(rows as typeof SAMPLE_TELEGRAM_LOGS);
        }
      });
  }, []);

  return (
    <div className="space-y-4">
      {isDemo && (
        <GlassCard accent="cyan" padding="p-3">
          <div className="text-[9px] font-orbitron tracking-wider" style={{ color: '#67e8f9' }}>
            DEMO DATA — Live Telegram events from jarvis_log table will appear here
          </div>
        </GlassCard>
      )}
      <div className="space-y-3">
        {data.map(log => {
          const isDeal    = log.type === 'DEAL AGREED';
          const isNovation= log.type === 'NOVATION CHECK';
          const color     = isDeal ? '#4ade80' : isNovation ? '#a78bfa' : '#67e8f9';
          const approved  = log.approved;

          return (
            <GlassCard key={log.id} accent={isDeal ? 'green' : isNovation ? 'purple' : 'cyan'} padding="p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-sm flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
                  {isDeal ? <DollarSign size={14} style={{ color }} />
                    : isNovation ? <Shield size={14} style={{ color }} />
                    : <Bell size={14} style={{ color }} />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] font-orbitron tracking-wider px-2 py-0.5 rounded-sm"
                      style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>
                      {log.type}
                    </span>
                    <span className="text-[11px] font-semibold text-textb">{log.seller}</span>
                    <span className="text-[9px] text-dimtext">{log.address}</span>
                    <span className="text-[9px] text-dimtext ml-auto">{fmtTime(log.created_at)}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                    {[
                      ['Price',      log.price],
                      ['Payoff',     (log as { payoff?: string }).payoff],
                      ['Gap',        (log as { gap?: string }).gap],
                      ['Est. Fee',   (log as { est_fee?: string }).est_fee],
                      ['Earnest',    (log as { earnest?: string }).earnest],
                    ].filter(([, v]) => !!v).map(([label, val]) => (
                      <div key={label as string}>
                        <div className="text-[8px] text-dimtext uppercase tracking-[1.5px]">{label}</div>
                        <div className="text-[11px] font-bold text-textb">{val}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[9px] font-orbitron tracking-wider px-2 py-0.5 rounded-sm"
                      style={{
                        background: approved ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.08)',
                        border: approved ? '1px solid rgba(74,222,128,0.25)' : '1px solid rgba(248,113,113,0.2)',
                        color: approved ? '#4ade80' : '#f87171',
                      }}>
                      {approved ? '✓ APPROVED' : '✗ DECLINED'}
                    </span>
                    {isDeal && approved && (
                      <span className="text-[9px] text-dimtext">Contract sent</span>
                    )}
                    {isNovation && !approved && (
                      <span className="text-[9px] text-dimtext">Owner chose follow-up instead</span>
                    )}
                  </div>
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main DavidTraining Component ────────────────────────────────────────────

export function DavidTraining() {
  const [activeTab, setActiveTab] = useState('strategy');
  const [callLogs,     setCallLogs]     = useState<CallLog[]>([]);
  const [adaptations,  setAdaptations]  = useState<Adaptation[]>([]);
  const [briefs,       setBriefs]       = useState<PrecallBrief[]>([]);

  // Fetch Supabase data on mount
  useEffect(() => {
    const fetchAll = async () => {
      const [logs, adps, bfs] = await Promise.all([
        supabase.from('david_call_logs').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('david_adaptations').select('*').order('created_at', { ascending: false }).limit(30),
        supabase.from('david_precall_briefs').select('*').order('created_at', { ascending: false }).limit(5),
      ]);
      if (logs.data)  setCallLogs(logs.data as CallLog[]);
      if (adps.data)  setAdaptations(adps.data as Adaptation[]);
      if (bfs.data)   setBriefs(bfs.data as PrecallBrief[]);
    };
    fetchAll();
  }, []);

  // Summary stats for header
  const totalClosed   = (callLogs.length > 0 ? callLogs : SAMPLE_CALL_LOGS).filter(c => c.outcome === 'CLOSED' || c.outcome === 'NOVATION DEAL').length;
  const totalCalls    = (callLogs.length > 0 ? callLogs : SAMPLE_CALL_LOGS).length;
  const latestAdapt   = (adaptations.length > 0 ? adaptations : SAMPLE_ADAPTATIONS)[0];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BrainCircuit size={18} style={{ color: '#fbbf24' }} />
            <h1 className="font-orbitron text-[14px] font-bold text-textb tracking-[2px]">DAVID AI TRAINING CENTER</h1>
            <span className="text-[8px] font-orbitron tracking-[2px] px-2 py-0.5 rounded-sm"
              style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}>
              ALPHA
            </span>
          </div>
          <p className="text-[10px] text-dimtext">Full transparency into David's calling strategy, decisions, and learning</p>
        </div>

        {/* Quick stats */}
        <div className="flex gap-3 flex-shrink-0">
          {[
            { label: 'Calls Total',  val: totalCalls,  color: '#67e8f9' },
            { label: 'Closed',       val: totalClosed, color: '#4ade80' },
            { label: 'Adaptations',  val: (adaptations.length > 0 ? adaptations : SAMPLE_ADAPTATIONS).length, color: '#fbbf24' },
          ].map(s => (
            <div key={s.label} className="text-center px-3 py-2 rounded-sm"
              style={{ background: `${s.color}08`, border: `1px solid ${s.color}20` }}>
              <div className="text-[16px] font-bold" style={{ color: s.color }}>{s.val}</div>
              <div className="text-[8px] text-dimtext uppercase tracking-[1px]">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Latest adaptation banner */}
      {latestAdapt && (
        <GlassCard accent="gold" padding="p-3" hover={false}>
          <div className="flex items-center gap-2.5">
            <Zap size={12} style={{ color: '#fbbf24' }} />
            <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#fbbf24' }}>
              Latest Adaptation
            </span>
            <span className="text-[10px] text-jtext">{latestAdapt.what_changed}</span>
            <span className="text-[9px] text-dimtext ml-auto">{timeAgo(latestAdapt.created_at)}</span>
          </div>
        </GlassCard>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <motion.button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-sm flex-shrink-0 text-[10px] font-medium transition-colors"
              style={{
                background: active ? 'rgba(251,191,36,0.12)' : 'transparent',
                border: active ? '1px solid rgba(251,191,36,0.28)' : '1px solid transparent',
                color: active ? '#fbbf24' : '#52526e',
              }}
              whileHover={!active ? { color: '#c4c4d6' } : {}}
            >
              {tab.icon}
              {tab.label}
            </motion.button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {activeTab === 'strategy'  && <PreCallStrategyTab briefs={briefs} callLogs={callLogs} />}
          {activeTab === 'live'      && <LiveCallTab />}
          {activeTab === 'learning'  && <LearningUpdatesTab adaptations={adaptations} />}
          {activeTab === 'simulator' && <MockSimulatorTab />}
          {activeTab === 'history'   && <CallHistoryTab callLogs={callLogs} />}
          {activeTab === 'telegram'  && <TelegramLogTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
