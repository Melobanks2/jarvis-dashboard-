'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Pencil, Check, RotateCcw, Save,
  Flame, Home, Clock, DollarSign, FileText, Trophy, PhoneCall,
  Target, MessageSquareWarning, ChevronDown, Pause, Thermometer,
  CalendarClock, ShieldCheck,
} from 'lucide-react';
import { parseScript, DEFAULT_SCRIPT_RAW, type ScriptPhase } from '@/lib/acquisitionScript';
import { OfferCalculator } from './OfferCalculator';

const RAW_KEY   = 'acq_script_raw';
const NOTES_KEY = 'acq_script_notes';

// Phase accent palette (cycled) — matches the dashboard's tone.
const PALETTE = ['#30d158', '#ff9f0a', '#0a84ff', '#bf5af2', '#f472b6', '#30d158', '#ff9f0a'];

function phaseIcon(title: string): React.ElementType {
  const t = title.toLowerCase();
  if (/(intro|rapport|open|greet)/.test(t)) return PhoneCall;
  if (/(motiv|why|reason|pain)/.test(t))    return Flame;
  if (/(condition|repair|property|house)/.test(t)) return Home;
  if (/(time|when|urgen)/.test(t))          return Clock;
  if (/(price|number|money|cost)/.test(t))  return DollarSign;
  if (/(offer|present|math)/.test(t))       return FileText;
  if (/(close|next|contract|sign)/.test(t)) return Trophy;
  return MessageSquareWarning;
}

// Maps to the GHL fields Chris captures before hanging up.
const FIELDS: { key: string; label: string; Icon: React.ElementType; placeholder: string }[] = [
  { key: 'pain_type',          label: 'Pain type',        Icon: Flame,        placeholder: 'divorce / inherited / financial / vacant / relocating / tired landlord' },
  { key: 'seller_timeline',    label: 'Timeline',          Icon: Clock,        placeholder: '30 / 60 / 90 / flexible' },
  { key: 'seller_asking_price',label: 'Asking price',      Icon: DollarSign,   placeholder: 'The number they gave you' },
  { key: 'walkaway_number',    label: 'Walk-away number',  Icon: Target,       placeholder: 'Their "happy" number' },
  { key: 'condition_notes',    label: 'Condition notes',   Icon: Home,         placeholder: 'roof / HVAC / foundation / liens' },
  { key: 'lead_temp',          label: 'Lead temp',         Icon: Thermometer,  placeholder: 'hot / warm / cold' },
  { key: 'next_action_date',   label: 'Next action date',  Icon: CalendarClock,placeholder: 'When to follow up' },
];

// Chris's objection handlers, verbatim.
const OBJECTIONS: { q: string; a: string }[] = [
  { q: 'I just want an offer',
    a: "Totally — I'll get you one by the end of this call. Just need a few questions to get it right." },
  { q: "What's your offer? (early)",
    a: "I can't give you a real number until the underwriter runs the property. Give me 5 minutes of questions and I'll get you one." },
  { q: 'I need to talk to my spouse',
    a: "Makes sense. When's a good time we can all get on a call together so I'm not playing telephone?" },
  { q: 'Rude / tired of calls',
    a: 'Do you actually want to hear what I have to say, or are you just tired of these calls? No worries either way.' },
  { q: 'I want to think about it',
    a: 'Totally. What specifically do you need to think through? Maybe I can answer it now.' },
];

// Read before every session.
const GOLDEN_RULES: string[] = [
  'Shut up after every question — silence pulls the pain out.',
  'Never live negotiate. Always the underwriter.',
  '80/20 — 80% about them, 20% about the house.',
  'Stay on the pain until THEY leave it.',
  'Take-it-away if they go quiet.',
  'Never hang up first.',
  'Match their energy, mirror their tone.',
];

export function ScriptGuide() {
  const [raw, setRaw]           = useState(DEFAULT_SCRIPT_RAW);
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState('');
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [stepIdx, setStepIdx]   = useState(0);
  const [notes, setNotes]       = useState<Record<string, string>>({});
  const [showObjections, setShowObjections] = useState(false);
  const [showRules, setShowRules] = useState(false);

  // hydrate from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedRaw = window.localStorage.getItem(RAW_KEY);
    if (savedRaw) setRaw(savedRaw);
    const savedNotes = window.localStorage.getItem(NOTES_KEY);
    if (savedNotes) { try { setNotes(JSON.parse(savedNotes)); } catch {} }
  }, []);

  const phases: ScriptPhase[] = useMemo(() => parseScript(raw), [raw]);

  const phase = phases[phaseIdx];
  const step  = phase?.steps[stepIdx];
  const totalSteps = useMemo(() => phases.reduce((n, p) => n + p.steps.length, 0), [phases]);
  const stepsBefore = useMemo(
    () => phases.slice(0, phaseIdx).reduce((n, p) => n + p.steps.length, 0),
    [phases, phaseIdx],
  );
  const globalStep = stepsBefore + stepIdx + 1;

  const goNext = useCallback(() => {
    if (!phases.length) return;
    if (stepIdx < phases[phaseIdx].steps.length - 1) { setStepIdx(stepIdx + 1); return; }
    if (phaseIdx < phases.length - 1) { setPhaseIdx(phaseIdx + 1); setStepIdx(0); }
  }, [phases, phaseIdx, stepIdx]);

  const goPrev = useCallback(() => {
    if (!phases.length) return;
    if (stepIdx > 0) { setStepIdx(stepIdx - 1); return; }
    if (phaseIdx > 0) {
      const p = phaseIdx - 1;
      setPhaseIdx(p);
      setStepIdx(Math.max(0, phases[p].steps.length - 1));
    }
  }, [phases, phaseIdx, stepIdx]);

  const jumpPhase = (i: number) => { setPhaseIdx(i); setStepIdx(0); };

  // keyboard navigation (disabled while editing / typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, goNext, goPrev]);

  function setNote(key: string, val: string) {
    const next = { ...notes, [key]: val };
    setNotes(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(NOTES_KEY, JSON.stringify(next));
  }

  function saveScript() {
    const parsed = parseScript(draft);
    if (!parsed.length) return; // don't save an empty/unparseable script
    setRaw(draft);
    if (typeof window !== 'undefined') window.localStorage.setItem(RAW_KEY, draft);
    setPhaseIdx(0); setStepIdx(0);
    setEditing(false);
  }

  function resetToDefault() {
    setRaw(DEFAULT_SCRIPT_RAW);
    if (typeof window !== 'undefined') window.localStorage.removeItem(RAW_KEY);
    setPhaseIdx(0); setStepIdx(0);
    setDraft(DEFAULT_SCRIPT_RAW);
  }

  const accent = PALETTE[phaseIdx % PALETTE.length];

  // ── EDIT / PASTE MODE ──
  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-bold text-textb">Paste / edit your script</div>
            <div className="text-[10px] text-dimtext">
              Start a phase with <code className="text-ngreen">#&nbsp;Title</code>, add a coaching cue with{' '}
              <code className="text-ngreen">&gt;&nbsp;note</code>, and leave a blank line between beats.
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-md text-[11px] font-medium"
              style={{ background: 'rgba(255,255,255,0.05)', color: '#c4c4d6', border: '1px solid rgba(255,255,255,0.1)' }}>
              Cancel
            </button>
            <button onClick={saveScript}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-bold"
              style={{ background: 'linear-gradient(135deg,#30d158,#30d158)', color: '#06140b' }}>
              <Save size={13} /> Save script
            </button>
          </div>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={22}
          spellCheck={false}
          className="w-full rounded-lg p-4 text-[13px] leading-relaxed text-textb font-mono resize-y"
          style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }}
        />
        <button onClick={resetToDefault}
          className="self-start flex items-center gap-1.5 text-[10px] text-dimtext hover:text-ngreen transition-colors">
          <RotateCcw size={11} /> Reset to the default wholesale script
        </button>
      </div>
    );
  }

  // ── EMPTY ──
  if (!phase || !step) {
    return (
      <div className="rounded-lg p-8 text-center" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="text-[13px] text-dimtext mb-3">No script yet.</div>
        <button onClick={() => { setDraft(raw); setEditing(true); }}
          className="px-4 py-2 rounded-md text-[12px] font-bold" style={{ background: 'rgba(48,209,88,0.14)', color: '#30d158', border: '1px solid rgba(48,209,88,0.4)' }}>
          Paste your script
        </button>
      </div>
    );
  }

  const hold = !!step.hold;
  const beatAccent = hold ? '#ff9f0a' : accent;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-wider text-dimtext">
          Beat <span className="text-textb font-semibold">{globalStep}</span> / {totalSteps}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowRules(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium"
            style={showRules
              ? { background: 'rgba(10,132,255,0.14)', color: '#0a84ff', border: '1px solid rgba(10,132,255,0.4)' }
              : { background: 'rgba(255,255,255,0.05)', color: '#c4c4d6', border: '1px solid rgba(255,255,255,0.1)' }}>
            <ShieldCheck size={12} /> Golden Rules
          </button>
          <button onClick={() => { setDraft(raw); setEditing(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#c4c4d6', border: '1px solid rgba(255,255,255,0.1)' }}>
            <Pencil size={12} /> Edit script
          </button>
        </div>
      </div>

      {/* Golden Rules — read before every session */}
      <AnimatePresence>
        {showRules && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <div className="rounded-lg p-4" style={{ background: 'rgba(12,16,24,0.7)', border: '1px solid rgba(10,132,255,0.25)' }}>
              <div className="flex items-center gap-2 mb-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: '#0a84ff' }}>
                <ShieldCheck size={14} /> Golden Rules — read before every session
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {GOLDEN_RULES.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[11px] font-bold" style={{ color: '#0a84ff' }}>{i + 1}.</span>
                    <span className="text-[12px] text-jtext leading-snug">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase rail */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {phases.map((p, i) => {
          const active = i === phaseIdx;
          const done = i < phaseIdx;
          const c = PALETTE[i % PALETTE.length];
          const Icon = phaseIcon(p.title);
          return (
            <button key={p.id} onClick={() => jumpPhase(i)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-semibold whitespace-nowrap transition-all flex-shrink-0"
              style={active
                ? { background: `${c}22`, color: c, border: `1px solid ${c}` }
                : done
                  ? { background: 'rgba(48,209,88,0.06)', color: '#30d158', border: '1px solid rgba(48,209,88,0.2)' }
                  : { background: 'rgba(255,255,255,0.03)', color: '#71717a', border: '1px solid rgba(255,255,255,0.08)' }}>
              {done ? <Check size={12} /> : <Icon size={12} />}
              {p.title}
            </button>
          );
        })}
      </div>

      {/* Teleprompter + checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Teleprompter */}
        <div className="rounded-lg flex flex-col" style={{ background: hold ? 'rgba(24,18,4,0.7)' : 'rgba(255,255,255,0.05)', border: `1px solid ${beatAccent}${hold ? '66' : '44'}`, minHeight: 340 }}>
          {/* phase header + step dots */}
          <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: beatAccent }}>{phase.title}</div>
              {hold && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
                  style={{ background: 'rgba(255,159,10,0.15)', color: '#ff9f0a', border: '1px solid rgba(255,159,10,0.4)' }}>
                  <Pause size={9} fill="#ff9f0a" /> Put them on hold
                </span>
              )}
            </div>
            <div className="flex gap-1">
              {phase.steps.map((_, i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full transition-all"
                  style={{ background: i === stepIdx ? beatAccent : 'rgba(255,255,255,0.15)' }} />
              ))}
            </div>
          </div>

          {/* words */}
          <div className="flex-1 flex flex-col justify-center px-6 py-6">
            <AnimatePresence mode="wait">
              <motion.div key={step.id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}>
                <p className="text-[22px] leading-[1.5] font-medium text-textb">{step.say}</p>
                {step.coach && (
                  <div className="mt-4 flex items-start gap-2">
                    <span className="mt-1 w-1 self-stretch rounded-full flex-shrink-0" style={{ background: beatAccent, minHeight: 16 }} />
                    <p className="text-[12px] italic text-dimtext leading-relaxed">{step.coach}</p>
                  </div>
                )}
                {step.branches && step.branches.length > 0 && (
                  <div className="mt-5 rounded-md overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider font-semibold"
                      style={{ background: 'rgba(255,255,255,0.03)', color: '#8b8ba7' }}>
                      If they say → you say
                    </div>
                    {step.branches.map((b, i) => (
                      <div key={i} className="grid grid-cols-[110px_1fr] gap-3 px-3 py-2"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="text-[11px] font-semibold" style={{ color: beatAccent }}>{b.trigger}</div>
                        <div className="text-[12px] text-jtext leading-snug">{b.response}</div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* nav */}
          <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <button onClick={goPrev} disabled={phaseIdx === 0 && stepIdx === 0}
              className="flex items-center gap-1 px-3 py-2 rounded-md text-[12px] font-medium disabled:opacity-30"
              style={{ background: 'rgba(255,255,255,0.04)', color: '#c4c4d6', border: '1px solid rgba(255,255,255,0.08)' }}>
              <ChevronLeft size={14} /> Back
            </button>
            <span className="text-[9px] text-dimtext hidden sm:block">← → arrow keys to move</span>
            <button onClick={goNext} disabled={phaseIdx === phases.length - 1 && stepIdx === phase.steps.length - 1}
              className="flex items-center gap-1 px-5 py-2 rounded-md text-[12px] font-bold disabled:opacity-30"
              style={{ background: `${beatAccent}1f`, color: beatAccent, border: `1px solid ${beatAccent}` }}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Right column: offer calculator + qualify checklist */}
        <div className="flex flex-col gap-4">
        <OfferCalculator />

        {/* Qualify checklist */}
        <div className="rounded-lg p-4 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-dimtext font-semibold">Qualify — jot as you go</div>
            <button title="Clear all"
              onClick={() => { setNotes({}); if (typeof window !== 'undefined') window.localStorage.removeItem(NOTES_KEY); }}
              className="text-dimtext hover:text-ngreen transition-colors">
              <RotateCcw size={11} />
            </button>
          </div>
          {FIELDS.map(({ key, label, Icon, placeholder }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-dimtext">
                <Icon size={11} style={{ color: '#30d158' }} /> {label}
              </label>
              <input
                value={notes[key] || ''}
                onChange={(e) => setNote(key, e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-textb"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', outline: 'none' }}
              />
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* Objection quick-reference */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={() => setShowObjections(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: '#ff9f0a' }}>
            <MessageSquareWarning size={14} /> Objection handling
          </span>
          <ChevronDown size={15} className="text-dimtext transition-transform" style={{ transform: showObjections ? 'rotate(180deg)' : 'none' }} />
        </button>
        <AnimatePresence>
          {showObjections && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="px-4 pb-4 flex flex-col gap-3">
              {OBJECTIONS.map((o, i) => (
                <div key={i} className="rounded-md p-3" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="text-[12px] font-semibold text-textb mb-1">“{o.q}”</div>
                  <div className="text-[12px] text-jtext leading-relaxed">{o.a}</div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
