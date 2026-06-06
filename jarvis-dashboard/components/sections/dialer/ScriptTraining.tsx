'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, ChevronDown, ChevronRight, Play, Pause,
  MessageSquare, FileText, Clock, User, MapPin,
  ArrowRight, CheckCircle, AlertCircle, Star, Save,
  Volume2, VolumeX, RotateCcw, BookOpen,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScriptNode {
  id: string;
  label: string;
  color: string;
  icon?: string;
  description?: string;
  children?: ScriptNode[];
}

interface CallReviewEntry {
  id: string;
  timestamp: string;
  leadName: string;
  leadPhone: string;
  disposition: string;
  callDuration: number;
  transcript: { speaker: string; text: string; timestamp: string }[];
  scriptNode: string;
  audioUrl?: string;
  notes: string;
}

// ── Decision Tree Data ────────────────────────────────────────────────────────

const SCRIPT_TREE: ScriptNode = {
  id: 'root',
  label: 'GREETING',
  color: '#4ade80',
  icon: '👋',
  description: 'Warm re-introduction. Establish rapport and confirm identity.',
  children: [
    {
      id: 'qualify',
      label: 'QUALIFY',
      color: '#67e8f9',
      icon: '🔍',
      description: 'Re-confirm timeline, condition, and decision-maker status.',
      children: [
        {
          id: 'cash-path',
          label: 'CASH OFFER PATH',
          color: '#4ade80',
          icon: '💰',
          description: 'Seller qualifies for direct cash offer. Timeline 30-60 days.',
          children: [
            {
              id: 'offer-start',
              label: 'START OFFER (60%)',
              color: '#4ade80',
              icon: '🎯',
              description: 'Present initial offer at 60% of ARV.',
              children: [
                {
                  id: 'pulldown',
                  label: 'PULL-DOWN TACTICS',
                  color: '#fbbf24',
                  icon: '⬇️',
                  description: 'Apply pressure reduction tactics if seller resists.',
                  children: [
                    {
                      id: 'underwriter',
                      label: 'UNDERWRITER ESCALATION',
                      color: '#a78bfa',
                      icon: '🎰',
                      description: 'Simulate underwriter review for 60-90 seconds.',
                      children: [
                        {
                          id: 'close-deal',
                          label: 'CLOSE / FOLLOW-UP',
                          color: '#4ade80',
                          icon: '✅',
                          description: 'Push for commitment or schedule warm follow-up.',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'divorce-path',
          label: 'DIVORCE PATH',
          color: '#ff8800',
          icon: '💔',
          description: 'Seller going through divorce. Extra empathy required.',
          children: [
            {
              id: 'divorce-qualify',
              label: 'DIVORCE QUALIFY',
              color: '#ff8800',
              icon: '🔍',
              description: 'Confirm timeline aligns with divorce proceedings.',
              children: [
                {
                  id: 'divorce-offer',
                  label: 'DIVORCE CASH OFFER',
                  color: '#4ade80',
                  icon: '💰',
                  description: 'Present offer with divorce-specific sensitivity.',
                },
              ],
            },
          ],
        },
        {
          id: 'relocating-path',
          label: 'RELOCATING PATH',
          color: '#60a5fa',
          icon: '🚚',
          description: 'Seller needs to relocate quickly. Timeline pressure.',
          children: [
            {
              id: 'reloc-qualify',
              label: 'RELOC QUALIFY',
              color: '#60a5fa',
              icon: '🔍',
              description: 'Confirm relocation date and urgency.',
              children: [
                {
                  id: 'reloc-offer',
                  label: 'RELOC CASH OFFER',
                  color: '#4ade80',
                  icon: '💰',
                  description: 'Fast-track offer for relocation scenario.',
                },
              ],
            },
          ],
        },
        {
          id: 'novation-path',
          label: 'NOVATION PATH',
          color: '#a78bfa',
          icon: '📋',
          description: 'Gap > $20K and timeline 60+ days. Consider Novation.',
          children: [
            {
              id: 'nov-qualify',
              label: 'NOVATION QUALIFY',
              color: '#a78bfa',
              icon: '🔍',
              description: 'Confirm timeline allows for listing + sale.',
              children: [
                {
                  id: 'nov-present',
                  label: 'PRESENT NOVATION',
                  color: '#a78bfa',
                  icon: '📋',
                  description: 'Explain Novation model and commission structure.',
                  children: [
                    {
                      id: 'nov-close',
                      label: 'NOVATION CLOSE',
                      color: '#a78bfa',
                      icon: '✅',
                      description: 'Get agreement for listing contract.',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ── Demo Call Reviews ─────────────────────────────────────────────────────────

const DEMO_REVIEWS: CallReviewEntry[] = [
  {
    id: 'rev-1',
    timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
    leadName: 'Denise Hawkins',
    leadPhone: '(407) 555-0142',
    disposition: 'HOT',
    callDuration: 862,
    transcript: [
      { speaker: 'sarah', text: 'Hi Denise, this is Sarah from the investment team. How are you today?', timestamp: '0:00' },
      { speaker: 'lead', text: 'I\'m doing okay, just busy with everything going on.', timestamp: '0:05' },
      { speaker: 'sarah', text: 'I completely understand. I know you\'re going through a lot. I wanted to follow up on the property at 123 Main St.', timestamp: '0:08' },
      { speaker: 'lead', text: 'Yes, we\'re still considering our options. The timeline is tight though.', timestamp: '0:15' },
      { speaker: 'sarah', text: 'Absolutely. If the price made sense today, is there anything that would prevent you from moving forward this week?', timestamp: '0:22' },
      { speaker: 'lead', text: 'Well... I mean, the right price would help. What are you thinking?', timestamp: '0:30' },
      { speaker: 'sarah', text: 'Based on the condition and market, we could do $192,000 cash, close in 30 days. No repairs needed.', timestamp: '0:38' },
      { speaker: 'lead', text: 'That\'s... lower than I was hoping. Can you do better?', timestamp: '0:48' },
      { speaker: 'sarah', text: 'Is that set in stone for you? What number would make you say yes right now?', timestamp: '0:55' },
      { speaker: 'lead', text: 'Honestly, if you could do $205,000 I\'d sign today.', timestamp: '1:05' },
      { speaker: 'sarah', text: 'Let me check with my underwriter on that. Give me just a moment.', timestamp: '1:12' },
      { speaker: 'sarah', text: '[UNDERWRITER HOLD - 60 seconds]', timestamp: '1:15' },
      { speaker: 'sarah', text: 'Denise, I was able to get $208,000 approved. Can we move forward?', timestamp: '2:15' },
      { speaker: 'lead', text: 'Yes! That works. Let\'s do it.', timestamp: '2:22' },
      { speaker: 'sarah', text: 'Excellent! I\'ll send the contract over right now. You\'ll have it in your email within 10 minutes.', timestamp: '2:28' },
    ],
    scriptNode: 'Cash Path → Pull-Down Tactics → Underwriter → Close',
    notes: '',
  },
  {
    id: 'rev-2',
    timestamp: new Date(Date.now() - 5 * 3600000).toISOString(),
    leadName: 'Marcus Webb',
    leadPhone: '(407) 555-0198',
    disposition: 'WARM',
    callDuration: 1140,
    transcript: [
      { speaker: 'sarah', text: 'Hi Marcus, this is Sarah from the investment team. Quick follow-up on your property.', timestamp: '0:00' },
      { speaker: 'lead', text: 'Oh hey, yeah. I was actually just thinking about calling you back.', timestamp: '0:08' },
      { speaker: 'sarah', text: 'That\'s great to hear! What\'s on your mind?', timestamp: '0:12' },
      { speaker: 'lead', text: 'Well, my wife and I have been talking and we\'re not sure we want to sell yet. We might just rent it out.', timestamp: '0:18' },
      { speaker: 'sarah', text: 'I totally understand. Rental income can be attractive. Can I ask — what would the monthly rent be in that area?', timestamp: '0:25' },
      { speaker: 'lead', text: 'Probably around $1,800 a month.', timestamp: '0:32' },
      { speaker: 'sarah', text: 'And the mortgage payment on the property?', timestamp: '0:35' },
      { speaker: 'lead', text: 'About $1,400.', timestamp: '0:38' },
      { speaker: 'sarah', text: 'So that\'s about $400/month positive cash flow. Over a year that\'s $4,800. But if the property needs any repairs — roof, AC, plumbing — one major repair could wipe out 2-3 years of profit. Have you factored that in?', timestamp: '0:42' },
      { speaker: 'lead', text: 'Yeah, that\'s a good point. The roof is getting old.', timestamp: '1:10' },
      { speaker: 'sarah', text: 'If the price made sense today, would you rather take the certainty of a cash sale vs. the uncertainty of being a landlord?', timestamp: '1:20' },
      { speaker: 'lead', text: 'I need to talk to my wife about it. Can you call back tomorrow?', timestamp: '1:30' },
      { speaker: 'sarah', text: 'Absolutely. What time works best?', timestamp: '1:35' },
      { speaker: 'lead', text: 'After 5pm.', timestamp: '1:38' },
    ],
    scriptNode: 'Cash Path → Objection: "Renting Out" → Rental Analysis',
    notes: '',
  },
  {
    id: 'rev-3',
    timestamp: new Date(Date.now() - 28 * 3600000).toISOString(),
    leadName: 'Sandra Reyes',
    leadPhone: '(407) 555-0267',
    disposition: 'NOVATION',
    callDuration: 1320,
    transcript: [
      { speaker: 'sarah', text: 'Hi Sandra, this is Sarah. I wanted to follow up on the property at 789 Pine Rd.', timestamp: '0:00' },
      { speaker: 'lead', text: 'Yes, hi! I\'ve been waiting to hear from you.', timestamp: '0:06' },
      { speaker: 'sarah', text: 'Great! How has everything been going with the property?', timestamp: '0:10' },
      { speaker: 'lead', text: 'Well, the house is in pretty good shape. We just updated the kitchen last year. But I need at least $267,000 to cover everything.', timestamp: '0:15' },
      { speaker: 'sarah', text: 'I see. With the updates you\'ve done, the ARV in that area is around $320,000. At $267,000, a direct cash offer would be tight for us. But I have another option that might work better for you.', timestamp: '0:25' },
      { speaker: 'lead', text: 'What option?', timestamp: '0:40' },
      { speaker: 'sarah', text: 'We can list the property on the market through our team. With the kitchen updates and the condition, we could likely get you $310,000-$320,000. Our fee is about 6%, and you keep the rest. That\'s potentially $43,000 more than a cash offer.', timestamp: '0:45' },
      { speaker: 'lead', text: 'Really? But I don\'t want to deal with showings and all that.', timestamp: '1:10' },
      { speaker: 'sarah', text: 'We handle everything — staging, showings, negotiations. You just sign the listing agreement and we take it from there. The typical timeline is 60-90 days.', timestamp: '1:18' },
      { speaker: 'lead', text: 'That sounds interesting. What would I need to sign?', timestamp: '1:30' },
    ],
    scriptNode: 'Qualify → Novation Path → Novation Qualify → Present Novation',
    notes: '',
  },
];

const SCRIPT_NODE_COLORS: Record<string, string> = {
  'Cash Path': '#4ade80',
  'Divorce Path': '#ff8800',
  'Relocating Path': '#60a5fa',
  'Novation Path': '#a78bfa',
  'Pull-Down': '#fbbf24',
  'Underwriter': '#a78bfa',
  'Close': '#4ade80',
  'Objection': '#fb923c',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function fmtTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getNodeColor(path: string): string {
  for (const [key, color] of Object.entries(SCRIPT_NODE_COLORS)) {
    if (path.includes(key)) return color;
  }
  return '#52526e';
}

// ── Decision Tree Renderer ────────────────────────────────────────────────────

function TreeNode({ node, depth = 0, expanded, onToggle }: {
  node: ScriptNode; depth?: number; expanded: Set<string>; onToggle: (id: string) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isOpen = expanded.has(node.id);

  return (
    <div>
      <button
        onClick={() => onToggle(node.id)}
        className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg transition-all"
        style={{
          marginLeft: depth * 20,
          background: isOpen ? `${node.color}0c` : 'transparent',
          border: isOpen ? `1px solid ${node.color}22` : '1px solid transparent',
        }}
      >
        {hasChildren ? (
          isOpen
            ? <ChevronDown size={12} style={{ color: node.color, flexShrink: 0 }} />
            : <ChevronRight size={12} style={{ color: '#52526e', flexShrink: 0 }} />
        ) : (
          <div className="w-3 h-3" style={{ flexShrink: 0 }} />
        )}
        {node.icon && <span className="text-[12px]">{node.icon}</span>}
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: node.color, boxShadow: isOpen ? `0 0 6px ${node.color}` : 'none' }}
        />
        <span className="text-[11px] font-medium" style={{ color: isOpen ? node.color : '#c4c4d6' }}>
          {node.label}
        </span>
      </button>

      <AnimatePresence>
        {isOpen && node.description && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="text-[10px] leading-relaxed px-3 py-1.5 ml-6"
              style={{ color: '#8888aa', borderLeft: `2px solid ${node.color}33` }}
            >
              {node.description}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {hasChildren && isOpen && (
        <div>
          {node.children!.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Call Review Detail ────────────────────────────────────────────────────────

function CallReviewDetail({ review, onClose }: { review: CallReviewEntry; onClose: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [notes, setNotes] = useState(review.notes);
  const [saved, setSaved] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handlePlay = () => {
    if (audioRef.current) {
      if (playing) { audioRef.current.pause(); } else { audioRef.current.play().catch(() => {}); }
      setPlaying(!playing);
    }
  };

  const handleSave = () => {
    // Save to localStorage
    try {
      const key = 'jarvis_call_reviews';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing[review.id] = { ...review, notes };
      localStorage.setItem(key, JSON.stringify(existing));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* swallow */ }
  };

  const getNodeHighlight = (path: string) => {
    if (path.includes('Divorce')) return '#ff8800';
    if (path.includes('Reloc')) return '#60a5fa';
    if (path.includes('Novation')) return '#a78bfa';
    return '#4ade80';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: `${getNodeHighlight(review.scriptNode)}15`, border: `1px solid ${getNodeHighlight(review.scriptNode)}30` }}>
            <User size={14} style={{ color: getNodeHighlight(review.scriptNode) }} />
          </div>
          <div>
            <div className="text-[12px] font-bold" style={{ color: '#e8e8f0' }}>{review.leadName}</div>
            <div className="text-[9px]" style={{ color: '#52526e' }}>{review.leadPhone}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[9px] px-2 py-0.5 rounded font-orbitron tracking-wider"
            style={{ background: `${getNodeHighlight(review.scriptNode)}12`, border: `1px solid ${getNodeHighlight(review.scriptNode)}25`, color: getNodeHighlight(review.scriptNode) }}>
            {review.disposition}
          </span>
          <span className="text-[9px]" style={{ color: '#52526e' }}>{fmtDuration(review.callDuration)}</span>
          <button onClick={onClose} className="text-[10px] px-2 py-1 rounded"
            style={{ color: '#52526e', background: 'rgba(255,255,255,0.03)' }}>
            Close
          </button>
        </div>
      </div>

      {/* Audio Player */}
      {review.audioUrl && (
        <div className="px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <audio ref={audioRef} src={review.audioUrl} onEnded={() => setPlaying(false)} />
          <button
            onClick={handlePlay}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px]"
            style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.2)', color: '#00e5ff' }}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
            {playing ? 'Pause Recording' : 'Play Recording'}
          </button>
        </div>
      )}

      {/* Script Node Path */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2 mb-2">
          <GitBranch size={12} style={{ color: getNodeHighlight(review.scriptNode) }} />
          <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>
            Script Path Followed
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {review.scriptNode.split(' → ').map((node, i, arr) => (
            <div key={i} className="flex items-center gap-1.5">
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded"
                style={{
                  background: `${getNodeHighlight(review.scriptNode)}10`,
                  border: `1px solid ${getNodeHighlight(review.scriptNode)}25`,
                  color: getNodeHighlight(review.scriptNode),
                }}
              >
                {node}
              </span>
              {i < arr.length - 1 && (
                <ArrowRight size={10} style={{ color: '#3a3a52' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Color-Coded Transcript */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare size={12} style={{ color: '#52526e' }} />
          <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>
            Transcript
          </span>
        </div>
        <div className="max-h-[300px] overflow-y-auto space-y-1.5 pr-1">
          {review.transcript.map((line, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[8px] font-orbitron w-8 flex-shrink-0 pt-0.5" style={{ color: '#3a3a52' }}>
                {line.timestamp}
              </span>
              <div className="flex-1">
                <span
                  className="text-[8px] font-bold uppercase tracking-wider"
                  style={{
                    color: line.speaker === 'sarah' ? '#00e5ff' : line.speaker === 'lead' ? '#00ff88' : '#52526e',
                  }}
                >
                  {line.speaker === 'sarah' ? 'SARAH' : line.speaker === 'lead' ? 'LEAD' : 'SYS'}:
                </span>
                <span
                  className="text-[10px] ml-1.5"
                  style={{
                    color: line.speaker === 'sarah' ? '#c4c4d6' : line.speaker === 'lead' ? '#c4c4d6' : '#52526e',
                  }}
                >
                  {line.text}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Performance Notes */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={12} style={{ color: '#fbbf24' }} />
          <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>
            Performance Notes
          </span>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add performance notes for this call..."
          className="w-full h-20 rounded-lg px-3 py-2 text-[10px] resize-none outline-none"
          style={{
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: '#c4c4d6',
            caretColor: '#fbbf24',
          }}
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium"
            style={{
              background: saved ? 'rgba(74,222,128,0.15)' : 'rgba(251,191,36,0.1)',
              border: `1px solid ${saved ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.25)'}`,
              color: saved ? '#4ade80' : '#fbbf24',
            }}
          >
            {saved ? <CheckCircle size={10} /> : <Save size={10} />}
            {saved ? 'Saved' : 'Save Notes'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ScriptTraining() {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root', 'qualify']));
  const [reviews, setReviews] = useState<CallReviewEntry[]>(DEMO_REVIEWS);
  const [selectedReview, setSelectedReview] = useState<CallReviewEntry | null>(null);

  // Load saved reviews from localStorage + jarvis_chat_handoff
  useEffect(() => {
    try {
      // Load from localStorage
      const savedKey = 'jarvis_call_reviews';
      const saved = JSON.parse(localStorage.getItem(savedKey) || '{}');
      if (Object.keys(saved).length > 0) {
        const restored = Object.values(saved) as CallReviewEntry[];
        setReviews(prev => {
          const merged = [...prev];
          restored.forEach(r => {
            if (!merged.find(m => m.id === r.id)) merged.push(r);
          });
          return merged;
        });
      }

      // Load from handoff data (calls that came through the dialer)
      const handoffKey = 'jarvis_chat_handoff';
      const handoff = JSON.parse(localStorage.getItem(handoffKey) || '[]');
      if (Array.isArray(handoff) && handoff.length > 0) {
        const handoffReviews: CallReviewEntry[] = handoff.map((h: any, i: number) => ({
          id: `handoff-${i}_${Date.now()}`,
          timestamp: h.timestamp || new Date().toISOString(),
          leadName: h.lead?.name || 'Unknown',
          leadPhone: h.lead?.phone || '—',
          disposition: h.disposition?.toUpperCase() || 'UNKNOWN',
          callDuration: h.callDuration || 0,
          transcript: h.transcript
            ? h.transcript.split('\n').map((line: string) => {
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0) {
                  return {
                    speaker: line.slice(0, colonIdx).toLowerCase(),
                    text: line.slice(colonIdx + 1).trim(),
                    timestamp: '0:00',
                  };
                }
                return { speaker: 'system', text: line, timestamp: '0:00' };
              })
            : [],
          scriptNode: 'Dialer Call — Disposition Logged',
          notes: '',
        }));
        setReviews(prev => [...handoffReviews, ...prev]);
      }
    } catch { /* swallow */ }
  }, []);

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const all = new Set<string>();
    const walk = (node: ScriptNode) => { all.add(node.id); node.children?.forEach(walk); };
    walk(SCRIPT_TREE);
    setExpandedNodes(all);
  };

  return (
    <div className="space-y-5">
      {/* Decision Tree */}
      <div className="rounded-2xl p-4"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GitBranch size={14} style={{ color: '#fbbf24' }} />
            <span className="text-[11px] font-orbitron tracking-[1.5px] uppercase font-bold" style={{ color: '#c4c4d6' }}>
              Script Decision Tree
            </span>
          </div>
          <button
            onClick={expandAll}
            className="text-[9px] px-2 py-1 rounded"
            style={{ color: '#52526e', background: 'rgba(255,255,255,0.03)' }}
          >
            Expand All
          </button>
        </div>
        <div className="space-y-0.5">
          <TreeNode node={SCRIPT_TREE} expanded={expandedNodes} onToggle={toggleNode} />
        </div>
      </div>

      {/* Call Review List */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={14} style={{ color: '#00e5ff' }} />
          <span className="text-[11px] font-orbitron tracking-[1.5px] uppercase font-bold" style={{ color: '#c4c4d6' }}>
            Call Review
          </span>
          <span className="text-[9px] px-2 py-0.5 rounded font-orbitron"
            style={{ background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.2)', color: '#00e5ff' }}>
            {reviews.length}
          </span>
        </div>

        <div className="space-y-3">
          <AnimatePresence mode="wait">
            {selectedReview && (
              <CallReviewDetail
                key={selectedReview.id}
                review={selectedReview}
                onClose={() => setSelectedReview(null)}
              />
            )}
          </AnimatePresence>

          {reviews.map(review => {
            const isSelected = selectedReview?.id === review.id;
            const nodeColor = getNodeColor(review.scriptNode);

            return (
              <motion.div key={review.id} layout>
                <button
                  onClick={() => setSelectedReview(isSelected ? null : review)}
                  className="w-full text-left rounded-2xl p-4 transition-all"
                  style={{
                    background: isSelected ? `${nodeColor}08` : 'rgba(255,255,255,0.02)',
                    border: isSelected ? `1px solid ${nodeColor}33` : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: `${nodeColor}15`, border: `1px solid ${nodeColor}30` }}>
                      <User size={14} style={{ color: nodeColor }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-bold" style={{ color: '#e8e8f0' }}>{review.leadName}</span>
                        <span className="text-[9px] px-2 py-0.5 rounded font-orbitron tracking-wider"
                          style={{ background: `${nodeColor}12`, border: `1px solid ${nodeColor}25`, color: nodeColor }}>
                          {review.disposition}
                        </span>
                        <span className="text-[9px]" style={{ color: '#52526e' }}>{fmtDuration(review.callDuration)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] truncate" style={{ color: '#8888aa' }}>
                          {review.scriptNode}
                        </span>
                        <span className="text-[9px] flex-shrink-0" style={{ color: '#3a3a52' }}>
                          {fmtTimeAgo(review.timestamp)}
                        </span>
                      </div>
                    </div>
                    {isSelected
                      ? <ChevronDown size={13} style={{ color: '#52526e', flexShrink: 0 }} />
                      : <ChevronRight size={13} style={{ color: '#3a3a52', flexShrink: 0 }} />
                    }
                  </div>
                </button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}