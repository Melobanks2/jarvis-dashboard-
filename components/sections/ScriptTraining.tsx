'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, ChevronRight, BookOpen, MessageCircle,
  Flame, Snowflake, Sun, Skull, Bot, AlertTriangle,
  Heart, Home, DollarSign, Plane, Building, Percent,
  Gavel, Search, Shield, Play,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TreeNode {
  id: string;
  label: string;
  script: string;
  children?: TreeNode[];
  color?: string;
  hot?: boolean;
  audioUrl?: string;
}

interface PainPath {
  id: string;
  icon: React.ElementType;
  emoji: string;
  label: string;
  trigger: string;
  response: string;
  ack1: string;
  ack2: string;
  ack2_multiple?: Record<string, string>;
  recap: string[];
  color: string;
  hot?: boolean;
}

interface HandoffTier {
  id: string;
  label: string;
  script: string;
  color: string;
  icon: React.ElementType;
  condition: string;
}

interface Objection {
  id: string;
  trigger: string;
  response: string;
  color?: string;
  audioUrl?: string;
}

// ── Audio Mapping ─────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.jarviscommandcenter.space';

const AUDIO_MAP: Record<string, string> = {
  // Greeting
  'greet-prefix': `${BASE_URL}/audio/APPROVED-FINAL/greet-prefix-final.wav`,
  'greet-suffix': `${BASE_URL}/audio/APPROVED-FINAL/greet-suffix-final.wav`,
  'bad-time': `${BASE_URL}/audio/corpus/sarah/script-v4/line-bad-time-24k.wav`,
  'pitch': `${BASE_URL}/audio/corpus/sarah/script-v4/line-pitch-24k.wav`,
  
  // Fact Find
  'fact-find': `${BASE_URL}/audio/corpus/sarah/script-v4/line-fact-find-24k.wav`,
  
  // Pain Paths
  'divorce': `${BASE_URL}/audio/corpus/sarah/script-v4/pain-divorce-24k.wav`,
  'inherited': `${BASE_URL}/audio/corpus/sarah/script-v4/pain-inherited-24k.wav`,
  'behind': `${BASE_URL}/audio/corpus/sarah/script-v4/pain-behind-24k.wav`,
  'relocating': `${BASE_URL}/audio/corpus/sarah/script-v4/pain-relocating-24k.wav`,
  'vacant': `${BASE_URL}/audio/corpus/sarah/script-v4/pain-vacant-24k.wav`,
  'tired_landlord': `${BASE_URL}/audio/corpus/sarah/script-v4/pain-landlord-24k.wav`,
  'exploring': `${BASE_URL}/audio/corpus/sarah/script-v4/pain-exploring-24k.wav`,
  
  // Core Data
  'timeline': `${BASE_URL}/audio/corpus/sarah/script-v4/line-timeline-thinking-24k.wav`,
  'timeline-followup': `${BASE_URL}/audio/corpus/sarah/script-v4/line-timeline-followup-24k.wav`,
  'ownership': `${BASE_URL}/audio/corpus/sarah/script-v4/line-ownership-length-24k.wav`,
  'decision': `${BASE_URL}/audio/corpus/sarah/script-v4/line-decision-makers-24k.wav`,
  'occupancy': `${BASE_URL}/audio/corpus/sarah/script-v4/line-occupancy-24k.wav`,
  'price': `${BASE_URL}/audio/corpus/sarah/script-v4/line-price-24k.wav`,
  'ballpark': `${BASE_URL}/audio/corpus/sarah/script-v4/line-ballpark-24k.wav`,
  'condition-overall': `${BASE_URL}/audio/corpus/sarah/script-v4/line-condition-overall-24k.wav`,
  'condition-systems': `${BASE_URL}/audio/corpus/sarah/script-v4/line-condition-systems-24k.wav`,
  
  // Closers
  'closer-hot-warm': `${BASE_URL}/audio/corpus/sarah/script-v4/closer-hot-warm-24k.wav`,
  'closer-cold': `${BASE_URL}/audio/corpus/sarah/script-v4/closer-dead-24k.wav`,
  'closer-dead': `${BASE_URL}/audio/corpus/sarah/script-v4/closer-dead-24k.wav`,
  
  // Objections
  'obj-give-offer': `${BASE_URL}/audio/corpus/sarah/script-v4/obj-give-me-offer-24k.wav`,
  'obj-ai': `${BASE_URL}/audio/corpus/sarah/script-v4/obj-are-you-ai-24k.wav`,
  'obj-dnc': `${BASE_URL}/audio/corpus/sarah/script-v4/obj-dnc-24k.wav`,
  'obj-not-interested': `${BASE_URL}/audio/corpus/sarah/script-v4/obj-not-interested-24k.wav`,
  'obj-hostile': `${BASE_URL}/audio/corpus/sarah/script-v4/obj-hostile-24k.wav`,
};

// ── Data ──────────────────────────────────────────────────────────────────────

const PAIN_PATHS: PainPath[] = [
  {
    id: 'divorce',
    icon: Heart,
    emoji: '💔',
    label: 'Divorce',
    trigger: 'separation, divorce, ex, splitting up',
    response: 'Oh gosh, I\'m really sorry to hear that. That\'s a lot to deal with. Are y\'all working towards a certain date to get everything wrapped up?',
    ack1: 'I completely understand, sounds like you\'re ready to move forward and put this behind you.',
    ack2: 'Yeah, that makes total sense — and honestly that\'s exactly why we try to make this as simple and stress-free as possible.',
    recap: ['I know this has been a really tough situation for you with the divorce and everything…'],
    color: '#ff6b9d',
  },
  {
    id: 'inherited',
    icon: Home,
    emoji: '🕊️',
    label: 'Inherited',
    trigger: 'inherited, passed away, estate, parent passed',
    response: 'Oh I\'m so sorry for your loss, that\'s never easy to deal with. Are you handling everything on your own or do you have siblings involved as well?',
    ack1: 'That makes total sense, handling all of that on top of everything else is a lot.',
    ack2: 'Yeah, I hear you — and we just want to make this one less thing you have to worry about.',
    recap: [
      'I know you\'re dealing with the loss of a loved one on top of everything else…',
      'I know dealing with an inherited property and the estate can be really stressful…',
    ],
    color: '#a78bfa',
  },
  {
    id: 'behind',
    icon: DollarSign,
    emoji: '💸',
    label: 'Behind on Payments',
    trigger: 'behind, missed payments, foreclosure, can\'t afford',
    response: 'Oh wow, I\'m sorry you\'re going through that — that\'s really stressful. How far behind are you at this point, and is there a deadline you\'re working against?',
    ack1: 'Got it, so time is definitely a factor here.',
    ack2: 'Yeah, that\'s a lot of pressure — we deal with situations like this all the time and we can move fast.',
    recap: ['I know things have been really stressful financially…'],
    color: '#fbbf24',
  },
  {
    id: 'relocating',
    icon: Plane,
    emoji: '✈️',
    label: 'Relocating',
    trigger: 'moving, relocating, relocating, new job, closer to family',
    response: 'Oh nice — is it more of a lifestyle change, a job move, or are you looking to be closer to family?',
    ack1: 'Oh wow, that\'s exciting.',
    ack2: 'That makes total sense, sounds like you\'re ready to make that move.',
    ack2_multiple: {
      job: 'That makes total sense, sounds like you\'re ready to make that move.',
      upgrading: 'That\'s awesome, sounds like you\'re ready for that next chapter.',
      downsizing: 'That makes total sense, sometimes simpler is just better.',
      closer_family: 'Aw that\'s really sweet, family is everything.',
      moving_with_family: 'That\'s really wonderful, it\'s great that you have that support system.',
    },
    recap: [
      'I know you\'ve got a big move coming up…',
      'I know you\'re ready to simplify things…',
      'I know you\'re trying to get closer to your family…',
    ],
    color: '#60a5fa',
  },
  {
    id: 'vacant',
    icon: Building,
    emoji: '🏚️',
    label: 'Vacant Property',
    trigger: 'vacant, empty, sitting, no one living',
    response: 'How long has it been sitting? What\'s it costing you each month to hold it?',
    ack1: 'Yeah holding a vacant property can be like just having money go straight out the door.',
    ack2: 'Right, and the longer it sits the more it costs — that\'s exactly the kind of situation we help people get out of.',
    recap: ['I know carrying a vacant property can be like just having money go straight out the door…'],
    color: '#fb923c',
  },
  {
    id: 'tired_landlord',
    icon: Percent,
    emoji: '😤',
    label: 'Tired Landlord',
    trigger: 'tenants, renting, landlord, rental, tenant issues',
    response: 'How long have the tenants been in there? They current?',
    ack1: 'Yeah that\'s a tough situation, dealing with tenants is no joke.',
    ack2: 'Yeah, I totally get it — at some point it\'s just not worth the headache anymore.',
    recap: ['I know dealing with tenants has been really draining…'],
    color: '#f59e0b',
  },
  {
    id: 'preforeclosure',
    icon: Gavel,
    emoji: '🔥',
    label: 'Pre-Foreclosure',
    trigger: 'foreclosure, foreclosure notice, sale date',
    response: 'Oh wow, I\'m sorry you\'re dealing with that — how far along are you in the process? Do you have a sale date set yet?',
    ack1: 'Got it, so time is really of the essence here — we definitely want to make sure we can help you before that date.',
    ack2: 'Yeah, and honestly that\'s the most important thing right now — just making sure you have options before that deadline hits.',
    recap: ['I know you\'re up against a foreclosure deadline and you need to get this resolved fast…'],
    color: '#ff3366',
    hot: true,
  },
  {
    id: 'tax_lien',
    icon: Shield,
    emoji: '⚖️',
    label: 'Tax Lien / Auction',
    trigger: 'auction, tax lien, tax sale, county sale',
    response: 'Oh I understand — do you know when the auction date is scheduled for?',
    ack1: 'Got it, so you\'ve got an auction date coming up — that\'s exactly the kind of situation we handle, and we want to make sure we get you taken care of before that happens.',
    ack2: 'Yeah absolutely, and the good news is we\'ve helped people in this exact situation — we just need to move quickly.',
    recap: ['I know you\'ve got an auction date coming up and you need to move on this quickly…'],
    color: '#ff3366',
    hot: true,
  },
  {
    id: 'exploring',
    icon: Search,
    emoji: '🤷',
    label: 'Just Exploring',
    trigger: 'just looking, exploring, thinking about it',
    response: 'Gotcha — what would have to happen for you to actually pull the trigger?',
    ack1: 'Got it, that makes sense.',
    ack2: 'Yeah, totally understandable — no pressure at all, we just want to give you all the information so you can make the best decision for yourself.',
    recap: ['I know you\'re just trying to figure out what makes the most sense…'],
    color: '#94a3b8',
  },
];

const HANDOFF_TIERS: HandoffTier[] = [
  {
    id: 'hot',
    label: 'HOT',
    script: 'Cool, this sounds like a great fit. Chris is our acquisitions manager and he\'s going to want to talk to you directly. What\'s a good time for him to reach back out to you — today or tomorrow?',
    color: '#ff3366',
    icon: Flame,
    condition: 'D-trifecta + ASAP or 30 days + realistic number + engaged. Auto-HOT: pre-foreclosure, tax lien/auction.',
  },
  {
    id: 'warm',
    label: 'WARM',
    script: 'Cool, this sounds like a great fit. Chris is our acquisitions manager and he\'s going to want to talk to you directly. What\'s a good time for him to reach back out to you — today or tomorrow?',
    color: '#fbbf24',
    icon: Sun,
    condition: 'Some motivation + 60-90 day timeline + inflated number.',
  },
  {
    id: 'cold',
    label: 'COLD',
    script: 'No worries — let me have Chris reach out to you when he gets a chance. Thank you so much, talk to you soon.',
    color: '#60a5fa',
    icon: Snowflake,
    condition: 'Low motivation / just exploring / resistant.',
  },
  {
    id: 'dead',
    label: 'DEAD',
    script: 'Totally understand — I\'ll take you off our list. Thanks for your time.',
    color: '#52526e',
    icon: Skull,
    condition: 'Hostile / DNC / not owner / already sold.',
  },
];

const OBJECTIONS: Objection[] = [
  {
    id: 'give_offer',
    trigger: '"Just give me an offer"',
    response: 'I hear you — Chris is the guy who runs the numbers, I just get him the info so he can put together something real. Couple quick questions and I\'ll get you connected.',
    color: '#a78bfa',
    audioUrl: AUDIO_MAP['obj-give-offer'],
  },
  {
    id: 'ai_question',
    trigger: '"Are you a robot / AI?"',
    response: 'Haha — no I\'m not AI, that\'s actually the first time anyone\'s ever said that to me. I\'m Sarah, I just handle the intake calls for Chris.',
    color: '#4ade80',
    audioUrl: AUDIO_MAP['obj-ai'],
  },
  {
    id: 'who_are_you',
    trigger: '"Are you a company? Who are you?"',
    response: 'Yeah so we\'re a real estate acquisitions company — basically what we do is work directly with homeowners like yourself to put together a fair cash offer on the property as-is. No agents, no commissions, no fees. Chris is our acquisitions manager and he\'s the one who actually puts the numbers together.',
    color: '#60a5fa',
  },
  {
    id: 'dnc',
    trigger: '"Take me off your list"',
    response: 'Done — I\'ll mark you as do-not-contact. Have a good one.',
    color: '#52526e',
    audioUrl: AUDIO_MAP['obj-dnc'],
  },
  {
    id: 'not_interested',
    trigger: '"I\'m not interested"',
    response: 'No worries. Mind if I ask — is the timing off, or did you decide not to sell at all? Helps me know whether to check back later.',
    color: '#fbbf24',
    audioUrl: AUDIO_MAP['obj-not-interested'],
  },
  {
    id: 'hostile',
    trigger: 'Rude / Hostile',
    response: 'Totally fair — I\'ll get out of your hair. Take care.',
    color: '#ff3366',
    audioUrl: AUDIO_MAP['obj-hostile'],
  },
];

// ── Components ────────────────────────────────────────────────────────────────

function AudioPlayer({ url }: { url: string }) {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: 'rgba(74,222,128,0.06)' }}>
        <Play size={9} style={{ color: '#4ade80' }} />
        <span className="text-[8px]" style={{ color: '#4ade80' }}>Play Sarah's Audio</span>
      </div>
      <audio
        controls
        preload="none"
        className="h-6 max-w-[200px]"
        style={{ 
          filter: 'hue-rotate(90deg) saturate(0.6)',
          opacity: 0.7,
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      >
        <source src={url} type="audio/wav" />
      </audio>
    </div>
  );
}

function SectionHeader({ title, subtitle, icon: Icon, color }: { title: string; subtitle?: string; icon: React.ElementType; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
        <Icon size={14} style={{ color }} />
      </div>
      <div>
        <div className="text-[13px] font-orbitron font-bold tracking-[1.5px] uppercase" style={{ color: '#e8e8f0' }}>{title}</div>
        {subtitle && <div className="text-[9px] mt-0.5" style={{ color: '#52526e' }}>{subtitle}</div>}
      </div>
    </div>
  );
}

function PhaseCard({ title, subtitle, children, defaultOpen = false }: { title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div
      layout
      className="rounded-xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3.5 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold"
            style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}
          >
            {open ? '−' : '+'}
          </div>
          <div>
            <div className="text-[11px] font-semibold" style={{ color: '#c4c4d6' }}>{title}</div>
            {subtitle && <div className="text-[8px] mt-0.5" style={{ color: '#52526e' }}>{subtitle}</div>}
          </div>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }}>
          <ChevronDown size={12} style={{ color: '#52526e' }} />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5 space-y-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ScriptNode({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <motion.div layout className="relative">
      <div
        className="w-full rounded-lg transition-all"
        style={{
          background: depth === 0 ? 'rgba(74,222,128,0.04)' : 'rgba(255,255,255,0.015)',
          borderLeft: `3px solid ${node.color || (depth === 0 ? '#4ade80' : '#52526e')}44`,
          marginLeft: depth * 16,
        }}
      >
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-start gap-2.5 p-3 hover:opacity-80"
        >
          {hasChildren && (
            <motion.div animate={{ rotate: open ? 90 : 0 }} className="mt-0.5 flex-shrink-0">
              <ChevronRight size={10} style={{ color: '#52526e' }} />
            </motion.div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-orbitron tracking-[1px] uppercase" style={{ color: node.color || '#52526e' }}>
                Node {node.id}
              </span>
              {node.hot && (
                <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,51,102,0.15)', color: '#ff3366' }}>
                  AUTO-HOT
                </span>
              )}
            </div>
            <div className="text-[10.5px] leading-relaxed" style={{ color: '#c4c4d6' }}>{node.script}</div>
          </div>
        </button>
        {node.audioUrl && (
          <div className="px-3 pb-3">
            <AudioPlayer url={node.audioUrl} />
          </div>
        )}
      </div>
      {hasChildren && open && (
        <div className="space-y-1 mt-1">
          {node.children!.map(child => (
            <ScriptNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function PainPathCard({ path }: { path: PainPath }) {
  const [open, setOpen] = useState(false);
  const Icon = path.icon;

  return (
    <motion.div
      layout
      className="rounded-lg overflow-hidden"
      style={{ border: `1px solid ${path.color}22`, background: `${path.color}06` }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-3 hover:opacity-80 transition-opacity"
      >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[12px]" style={{ background: `${path.color}15` }}>
          <Icon size={13} style={{ color: path.color }} />
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold" style={{ color: '#c4c4d6' }}>{path.emoji} {path.label}</span>
            {path.hot && (
              <span className="text-[7px] px-1.5 py-0.5 rounded font-orbitron tracking-[1px] uppercase" style={{ background: 'rgba(255,51,102,0.15)', color: '#ff3366' }}>
                AUTO-HOT
              </span>
            )}
          </div>
          <div className="text-[8px] mt-0.5" style={{ color: '#52526e' }}>Trigger: {path.trigger}</div>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }}>
          <ChevronDown size={10} style={{ color: '#52526e' }} />
        </motion.div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              <div className="rounded-lg p-2.5" style={{ background: `${path.color}08`, borderLeft: `2px solid ${path.color}44` }}>
                <div className="text-[8px] font-orbitron tracking-[1px] uppercase mb-1" style={{ color: path.color }}>Response</div>
                <div className="text-[10px] leading-relaxed" style={{ color: '#c4c4d6' }}>{path.response}</div>
                {AUDIO_MAP[path.id] && <AudioPlayer url={AUDIO_MAP[path.id]} />}
              </div>
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.015)', borderLeft: '2px solid rgba(78,205,196,0.3)' }}>
                <div className="text-[8px] font-orbitron tracking-[1px] uppercase mb-1" style={{ color: '#4ade80' }}>1st Ack</div>
                <div className="text-[10px]" style={{ color: '#a8b0c0' }}>{path.ack1}</div>
              </div>
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.015)', borderLeft: '2px solid rgba(78,205,196,0.3)' }}>
                <div className="text-[8px] font-orbitron tracking-[1px] uppercase mb-1" style={{ color: '#4ade80' }}>2nd Ack</div>
                <div className="text-[10px]" style={{ color: '#a8b0c0' }}>{path.ack2}</div>
              </div>
              <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.015)', borderLeft: '2px solid rgba(167,139,250,0.3)' }}>
                <div className="text-[8px] font-orbitron tracking-[1px] uppercase mb-1" style={{ color: '#a78bfa' }}>RECAP options</div>
                {path.recap.map((r, i) => (
                  <div key={i} className="text-[10px] mt-1" style={{ color: '#a8b0c0' }}>{r}</div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ObjectionCard({ obj }: { obj: Objection }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      layout
      className="rounded-lg overflow-hidden"
      style={{ border: `1px solid ${obj.color || '#52526e'}22`, background: `${obj.color || '#52526e'}06` }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-3 hover:opacity-80 transition-opacity"
      >
        <AlertTriangle size={13} style={{ color: obj.color || '#fbbf24' }} />
        <div className="flex-1 text-left">
          <span className="text-[11px] font-semibold" style={{ color: '#c4c4d6' }}>{obj.trigger}</span>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }}>
          <ChevronDown size={10} style={{ color: '#52526e' }} />
        </motion.div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              <div className="rounded-lg p-2.5" style={{ background: `${obj.color || '#52526e'}08`, borderLeft: `2px solid ${obj.color || '#52526e'}44` }}>
                <div className="text-[9px] font-orbitron tracking-[1px] uppercase mb-1" style={{ color: obj.color || '#a78bfa' }}>Scripted Response</div>
                <div className="text-[10.5px] leading-relaxed" style={{ color: '#c4c4d6' }}>{obj.response}</div>
                {obj.audioUrl && <AudioPlayer url={obj.audioUrl} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ScriptTraining() {
  const [activeTab, setActiveTab] = useState<'script' | 'objections'>('script');

  const TAB_CONFIG = [
    { id: 'script' as const, label: 'Sarah Script', icon: BookOpen },
    { id: 'objections' as const, label: 'Objection Handlers', icon: MessageCircle },
  ];

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto pb-8">

      {/* Header */}
      <div>
        <h2 className="font-orbitron text-[14px] font-bold tracking-[2px] uppercase" style={{ color: '#e8e8f0' }}>
          Script & Training
        </h2>
        <p className="text-[10px] mt-0.5" style={{ color: '#52526e' }}>
          Sarah\'s full decision tree — every line, branch, and handoff condition
        </p>
      </div>

      {/* Tab bar */}
      <div
        className="rounded-xl p-1 flex gap-1"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        {TAB_CONFIG.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[10px] font-orbitron tracking-[1.5px] uppercase transition-all"
              style={{
                background: isActive ? 'rgba(74,222,128,0.1)' : 'transparent',
                color: isActive ? '#4ade80' : '#52526e',
                border: isActive ? '1px solid rgba(74,222,128,0.2)' : '1px solid transparent',
              }}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'script' && (
        <>
          {/* ── Phase 1: Intro ── */}
          <PhaseCard title="Phase 1 — INTRO" subtitle="Opener → Bad Time Gate → Consent">
            <ScriptNode node={{
              id: 'LINE 1',
              label: 'Opener',
              script: '"Hey — this is Sarah, I was just calling to see if you might be interested in selling your property over on [STREET]. Did I catch you at a bad time?"',
              color: '#4ade80',
              audioUrl: AUDIO_MAP['greet-prefix'],
              children: [
                {
                  id: 'LINE 1a',
                  label: 'Bad Time',
                  script: '"Oh no worries at all — when would be a better time to reach you?"',
                  color: '#fbbf24',
                  audioUrl: AUDIO_MAP['bad-time'],
                },
                {
                  id: 'LINE 1b',
                  label: 'No / Go Ahead',
                  script: 'Continue to Line 2',
                  color: '#4ade80',
                  audioUrl: AUDIO_MAP['greet-suffix'],
                },
              ],
            }} />

            <ScriptNode node={{
              id: 'LINE 2',
              label: 'Consent',
              script: '"Perfect. So I just have a few quick questions to see if your property would be a good fit — if it is, I\'ll get you connected with Chris, our acquisitions manager. Sound good?"',
              color: '#4ade80',
              audioUrl: AUDIO_MAP['pitch'],
              children: [
                {
                  id: 'LINE 2a',
                  label: 'Yes',
                  script: 'Move to Fact Find (Phase 2)',
                  color: '#4ade80',
                },
                {
                  id: 'LINE 2b',
                  label: 'Hesitant',
                  script: '"Totally understand — it\'ll only take a couple minutes, I promise."',
                  color: '#fbbf24',
                },
              ],
            }} />
          </PhaseCard>

          {/* ── Phase 2: Fact Find ── */}
          <PhaseCard title="Phase 2 — FACT FIND" subtitle="Pain Discovery → Route to Pain Path">
            <div
              className="rounded-lg p-3 mb-3"
              style={{ background: 'rgba(74,222,128,0.04)', borderLeft: '3px solid rgba(74,222,128,0.4)' }}
            >
              <div className="text-[8px] font-orbitron tracking-[1px] uppercase mb-1" style={{ color: '#4ade80' }}>Node MOTIVATION</div>
              <div className="text-[10.5px] leading-relaxed" style={{ color: '#c4c4d6' }}>
                "So can you catch me up to speed — what\'s going on with the property? What\'s got you thinking about selling?"
              </div>
              <AudioPlayer url={AUDIO_MAP['fact-find']} />
              <div className="text-[9px] mt-2" style={{ color: '#a78bfa' }}>
                Rule: Listen. Do not interrupt. Capture the pain signal. Then route to pain path.
              </div>
            </div>

            <SectionHeader title="Pain Paths" subtitle="Each branch below is a separate expandable section" icon={Heart} color="#ff6b9d" />

            <div className="space-y-2">
              {PAIN_PATHS.filter(p => p.id !== 'preforeclosure' && p.id !== 'tax_lien').map(path => (
                <PainPathCard key={path.id} path={path} />
              ))}
            </div>

            <SectionHeader title="Auto-HOT Paths" subtitle="These trigger immediate escalation" icon={Flame} color="#ff3366" />

            <div className="space-y-2">
              {PAIN_PATHS.filter(p => p.hot).map(path => (
                <PainPathCard key={path.id} path={path} />
              ))}
            </div>
          </PhaseCard>

          {/* ── Phase 3: Core Data ── */}
          <PhaseCard title="Phase 3 — CORE DATA" subtitle="Timeline → Ownership → Decision Makers → Occupancy → Price → Condition">
            <div className="space-y-2">
              <ScriptNode node={{
                id: 'TIMELINE',
                label: 'Timeline',
                script: '"Got it — is it more like as soon as possible, within the next 30 days, or are you thinking more like 60 to 90 days?"',
                color: '#a78bfa',
                audioUrl: AUDIO_MAP['timeline'],
                children: [
                  { id: 'TIMELINE-HOT', label: 'ASAP = HOT', script: '"Okay so you\'re looking to move on this as soon as possible — that sounds good."', color: '#ff3366', hot: true, audioUrl: AUDIO_MAP['timeline-followup'] },
                  { id: 'TIMELINE-WARM', label: '30 days = WARM', script: '"Got it so you\'re thinking within the next 30 days — perfect."', color: '#fbbf24', audioUrl: AUDIO_MAP['timeline-followup'] },
                  { id: 'TIMELINE-COLD', label: '60-90 days = COLD', script: '"Okay so you\'re thinking somewhere in the 60 to 90 day range — good to know."', color: '#60a5fa', audioUrl: AUDIO_MAP['timeline-followup'] },
                ],
              }} />

              <ScriptNode node={{
                id: 'OWNERSHIP',
                label: 'Ownership Length',
                script: '"So tell me — how long have you owned the property?" → "Okay so about [X years] — got it."',
                color: '#60a5fa',
                audioUrl: AUDIO_MAP['ownership'],
              }} />

              <ScriptNode node={{
                id: 'DECISION',
                label: 'Decision Makers',
                script: '"And just so I have everything right — is it just you on the title or is there someone else involved like a spouse or sibling?"',
                color: '#f59e0b',
                audioUrl: AUDIO_MAP['decision'],
                children: [
                  { id: 'DECISION-JUSTME', label: 'Just Me', script: '"Got it, so you\'re the sole owner — perfect."', color: '#4ade80' },
                  { id: 'DECISION-SPOUSE', label: 'Me + Spouse', script: '"Okay so it\'s you and your wife/husband — got it."', color: '#4ade80' },
                  { id: 'DECISION-SIBLING', label: 'Me + Sibling', script: '"Okay so you and your siblings are both on the title — good to know."', color: '#fbbf24' },
                  { id: 'DECISION-COOWNER', label: 'Co-owner not on call', script: '"When\'s the last time you two talked about selling? How\'d that go?"', color: '#ff3366' },
                ],
              }} />

              <ScriptNode node={{
                id: 'OCCUPANCY',
                label: 'Occupancy',
                script: '"And is this your primary home or more of a rental property?"',
                color: '#fb923c',
                audioUrl: AUDIO_MAP['occupancy'],
                children: [
                  { id: 'OCCUPANCY-PRIMARY', label: 'Primary', script: '"Okay got it — and are you currently living in it right now or is it vacant?"', color: '#4ade80' },
                  { id: 'OCCUPANCY-RENTAL', label: 'Rental', script: '"Okay got it — is it currently occupied or is it vacant right now?"', color: '#fbbf24' },
                ],
              }} />

              <div>
                <ScriptNode node={{
                  id: 'NUMBER',
                  label: 'The Number',
                  script: '"Based on everything you\'ve told me — [DYNAMIC RECAP] — what do you feel is a fair price for the property?"',
                  color: '#a78bfa',
                  audioUrl: AUDIO_MAP['price'],
                  children: [
                    { id: 'NUMBER-GIVES', label: 'Gives Number', script: '"And if we could cover all the closing costs, fees and commissions for you, and get this all done today — what do you think is the best price you can do?"', color: '#4ade80' },
                    { id: 'NUMBER-HEDGES', label: 'Hedges', script: '"Ballpark? You gotta have a number in your head."', color: '#fbbf24', audioUrl: AUDIO_MAP['ballpark'] },
                  ],
                }} />
                <div className="px-3 pb-2" style={{ marginLeft: 16 }}>
                  <div className="text-[8px] font-orbitron tracking-[1px] uppercase mb-1" style={{ color: '#52526e' }}>RECAP Order</div>
                  <div className="text-[9px] leading-relaxed" style={{ color: '#8888aa' }}>
                    1. Owned for X years → 2. Property is [occupancy] → 3. Pain reiteration last for max impact
                  </div>
                </div>
              </div>

              <ScriptNode node={{
                id: 'CONDITION',
                label: 'Condition',
                script: '"And what would you say the overall condition of the property is — move-in ready, needs some work, or pretty rough?"',
                color: '#94a3b8',
                audioUrl: AUDIO_MAP['condition-overall'],
                children: [
                  { id: 'CONDITION-FOLLOWUP', label: 'Follow Up', script: '"Roof, HVAC, any big issues you know about?"', color: '#52526e', audioUrl: AUDIO_MAP['condition-systems'] },
                ],
              }} />
            </div>
          </PhaseCard>

          {/* ── Phase 4: Handoff ── */}
          <PhaseCard title="Phase 4 — HANDOFF" subtitle="Lead tier → Chris handoff script" defaultOpen={true}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {HANDOFF_TIERS.map(tier => {
                const Icon = tier.icon;
                return (
                  <motion.div
                    key={tier.id}
                    className="rounded-xl p-3.5 flex flex-col gap-2"
                    style={{
                      background: `${tier.color}06`,
                      border: `1px solid ${tier.color}33`,
                      boxShadow: tier.id === 'hot' ? `0 0 20px ${tier.color}22` : 'none',
                    }}
                    whileHover={{ scale: 1.01 }}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={14} style={{ color: tier.color }} />
                      <span className="text-[10px] font-orbitron tracking-[2px] uppercase font-bold" style={{ color: tier.color }}>
                        {tier.label}
                      </span>
                    </div>
                    <div className="text-[9px] leading-relaxed" style={{ color: '#a8b0c0' }}>{tier.script}</div>
                    <div className="text-[8px] mt-auto pt-1 border-t" style={{ color: '#52526e', borderColor: `${tier.color}15` }}>
                      <span style={{ color: tier.color }}>Condition:</span> {tier.condition}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </PhaseCard>

          {/* ── Design Rules ── */}
          <div
            className="rounded-xl p-3"
            style={{ background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.15)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Bot size={12} style={{ color: '#a78bfa' }} />
              <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#a78bfa' }}>
                Sarah Character Notes
              </span>
            </div>
            <ul className="space-y-1">
              <li className="text-[9px] flex items-start gap-2" style={{ color: '#8888aa' }}>
                <span style={{ color: '#4ade80' }}>•</span>
                Warm, empathetic tone — never pushy. Mirror the seller\'s emotion.
              </li>
              <li className="text-[9px] flex items-start gap-2" style={{ color: '#8888aa' }}>
                <span style={{ color: '#4ade80' }}>•</span>
                Let the seller talk — pauses are okay. Capture full context before routing.
              </li>
              <li className="text-[9px] flex items-start gap-2" style={{ color: '#8888aa' }}>
                <span style={{ color: '#4ade80' }}>•</span>
                Always acknowledge before pivoting. Validate their situation.
              </li>
              <li className="text-[9px] flex items-start gap-2" style={{ color: '#8888aa' }}>
                <span style={{ color: '#4ade80' }}>•</span>
                RECAP before THE NUMBER hits hardest — stack: ownership → occupancy → pain.
              </li>
            </ul>
          </div>
        </>
      )}

      {activeTab === 'objections' && (
        <>
          <PhaseCard title="Objection Handlers" subtitle="Scripted responses to common objections" defaultOpen={true}>
            <div className="space-y-2">
              {OBJECTIONS.map(obj => (
                <ObjectionCard key={obj.id} obj={obj} />
              ))}
            </div>
          </PhaseCard>

          <div
            className="rounded-xl p-3"
            style={{ background: 'rgba(255,51,102,0.04)', border: '1px solid rgba(255,51,102,0.15)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={12} style={{ color: '#ff3366' }} />
              <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#ff3366' }}>
                Objection Handling Rules
              </span>
            </div>
            <ul className="space-y-1">
              <li className="text-[9px] flex items-start gap-2" style={{ color: '#8888aa' }}>
                <span style={{ color: '#ff3366' }}>•</span>
                Never argue. Acknowledge the concern first, then respond.
              </li>
              <li className="text-[9px] flex items-start gap-2" style={{ color: '#8888aa' }}>
                <span style={{ color: '#ff3366' }}>•</span>
                For "just give me an offer" — redirect to Chris as the numbers guy.
              </li>
              <li className="text-[9px] flex items-start gap-2" style={{ color: '#8888aa' }}>
                <span style={{ color: '#ff3366' }}>•</span>
                For AI question — deflect with humor, keep it natural.
              </li>
              <li className="text-[9px] flex items-start gap-2" style={{ color: '#8888aa' }}>
                <span style={{ color: '#ff3366' }}>•</span>
                DNC and Hostile are hard exits — don\'t push, just close gracefully.
              </li>
            </ul>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="text-center text-[8px] pt-2" style={{ color: '#3a3a52' }}>
        Sarah Script v4 — Last updated May 29, 2026
      </div>
    </div>
  );
}