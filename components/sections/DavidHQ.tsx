'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Clock, Mic, BarChart2, BookOpen,
  ThumbsUp, ThumbsDown, Star, Flag, MessageSquare,
  CheckCircle2, XCircle, Play, ChevronDown, ChevronUp,
  RefreshCw, AlertTriangle, Phone, TrendingUp,
} from 'lucide-react';
import { supabase, timeAgo, fmtDate, todayStart } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingApproval {
  id: string;
  contact_id: string;
  contact_name: string;
  phone: string;
  address: string;
  arv: number;
  offer_60: number;
  offer_65: number;
  offer_70: number;
  novation_offer: number | null;
  novation_qualified: boolean;
  motivation_score: number;
  motivation_summary: string;
  condition_summary: string;
  repair_breakdown: Record<string, string>;
  mortgage_payoff: number;
  timeline: string;
  transcript_snippet: string;
  status: 'pending' | 'approved_cash' | 'approved_novation' | 'passed';
  approved_type: string | null;
  created_at: string;
}

interface LiveCall {
  id: string;
  contact_name: string;
  phone: string;
  address: string;
  call_duration: number;
  stage_before: string;
  stage_after: string;
  tags_applied: string[];
  summary: string;
  called_at: string;
}

interface Recording {
  id: string;
  contact_name: string;
  phone: string;
  address: string;
  transcript_full: string;
  recording_url: string | null;
  call_duration: number;
  stage_after: string;
  called_at: string;
}

interface FeedbackMap {
  [lineIndex: number]: { reaction: string; comment: string };
}

interface MockSession {
  id: string;
  call_type: string;
  seller_name: string;
  persona: string;
  objection_level: string;
  score: ScoreData | null;
  transcript: string;
  created_at: string;
}

interface ScoreData {
  offer_timing: number;
  silence_discipline: number;
  pulldown_tactics: number;
  objection_handling: number;
  rapport_building: number;
  motivation_depth: number;
  close_execution: number;
  overall: number;
  close_probability: number;
  suggestions: string[];
}

// ─── Tab nav ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'approvals',    label: 'Pending Approvals', icon: Shield },
  { id: 'live',         label: 'Live Calls',        icon: Phone },
  { id: 'recordings',   label: 'Recordings',        icon: Mic },
  { id: 'performance',  label: 'Performance',       icon: BarChart2 },
  { id: 'training',     label: 'Training',          icon: BookOpen },
] as const;

type TabId = typeof TABS[number]['id'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return '$' + n.toLocaleString();
}

function ScoreBar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = pct >= 70 ? '#4ade80' : pct >= 45 ? '#fbbf24' : '#f87171';
  return (
    <div className="mb-2">
      <div className="flex justify-between mb-1">
        <span className="text-[10px]" style={{ color: '#9090a8' }}>{label}</span>
        <span className="text-[10px] font-bold" style={{ color }}>{value}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ─── Tab 1: Pending Approvals ─────────────────────────────────────────────────

function ApprovalCard({ item, onDecision }: { item: PendingApproval; onDecision: (id: string, action: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const isPending = item.status === 'pending';

  const handle = async (action: string) => {
    if (!isPending) return;
    setLoading(action);
    try {
      await fetch('/api/approve-deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId: item.id, action, contactId: item.contact_id }),
      });
      onDecision(item.id, action);
    } finally {
      setLoading(null);
    }
  };

  const scoreColor = item.motivation_score >= 7 ? '#4ade80' : item.motivation_score >= 4 ? '#fbbf24' : '#f87171';
  const glowStyle = isPending
    ? { boxShadow: '0 0 0 1px rgba(248,113,113,0.25), 0 0 20px rgba(248,113,113,0.06)' }
    : {};

  return (
    <div
      className="rounded-xl mb-3 overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', ...glowStyle }}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>{item.contact_name}</span>
              {isPending && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>
                  PENDING
                </span>
              )}
              {!isPending && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{
                  background: item.status === 'passed' ? 'rgba(82,82,110,0.2)' : 'rgba(74,222,128,0.15)',
                  color: item.status === 'passed' ? '#52526e' : '#4ade80',
                }}>
                  {item.status === 'passed' ? 'PASSED' : item.approved_type?.toUpperCase() || 'APPROVED'}
                </span>
              )}
            </div>
            <div className="text-[10px]" style={{ color: '#52526e' }}>{item.address}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px]" style={{ color: '#52526e' }}>Motivation</div>
            <div className="text-[18px] font-bold font-orbitron" style={{ color: scoreColor }}>
              {item.motivation_score}<span className="text-[11px]">/10</span>
            </div>
          </div>
        </div>

        {/* ARV + Offers grid */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { label: 'ARV', value: fmt$(item.arv), color: '#60a5fa' },
            { label: '60%', value: fmt$(item.offer_60), color: '#4ade80' },
            { label: '65%', value: fmt$(item.offer_65), color: '#fbbf24' },
            { label: '70%', value: fmt$(item.offer_70), color: '#f87171' },
          ].map(col => (
            <div key={col.label} className="text-center p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="text-[9px] mb-0.5" style={{ color: '#52526e' }}>{col.label}</div>
              <div className="text-[11px] font-bold" style={{ color: col.color }}>{col.value}</div>
            </div>
          ))}
        </div>

        {item.novation_qualified && item.novation_offer && (
          <div className="mb-3 px-3 py-2 rounded-lg flex items-center justify-between" style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)' }}>
            <span className="text-[10px] font-bold" style={{ color: '#a78bfa' }}>✦ NOVATION QUALIFIED</span>
            <span className="text-[11px] font-bold" style={{ color: '#a78bfa' }}>{fmt$(item.novation_offer)}</span>
          </div>
        )}

        {/* Quick info */}
        <div className="flex gap-3 mb-3 flex-wrap">
          <Info label="Payoff" value={fmt$(item.mortgage_payoff)} />
          <Info label="Timeline" value={item.timeline} />
          <Info label="Condition" value={item.condition_summary} />
        </div>

        {/* Motivation summary */}
        {item.motivation_summary && (
          <p className="text-[10px] italic mb-3" style={{ color: '#9090a8' }}>
            &ldquo;{item.motivation_summary}&rdquo;
          </p>
        )}

        {/* Transcript toggle */}
        {item.transcript_snippet && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[10px] mb-3 transition-colors"
            style={{ color: '#52526e' }}
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {expanded ? 'Hide' : 'Show'} transcript snippet
          </button>
        )}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-3"
            >
              <div className="p-3 rounded-lg text-[10px] font-mono leading-relaxed" style={{ background: 'rgba(0,0,0,0.3)', color: '#9090a8', whiteSpace: 'pre-wrap' }}>
                {item.transcript_snippet}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action buttons */}
        {isPending && (
          <div className="grid grid-cols-3 gap-2">
            <ActionBtn label="APPROVE CASH" color="#4ade80" loading={loading === 'approve_cash'} onClick={() => handle('approve_cash')} />
            {item.novation_qualified
              ? <ActionBtn label="APPROVE NOV" color="#a78bfa" loading={loading === 'approve_novation'} onClick={() => handle('approve_novation')} />
              : <div />
            }
            <ActionBtn label="PASS" color="#f87171" loading={loading === 'pass'} onClick={() => handle('pass')} dimmed />
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px]" style={{ color: '#52526e' }}>{label}:</span>
      <span className="text-[10px] font-medium" style={{ color: '#c4c4d6' }}>{value}</span>
    </div>
  );
}

function ActionBtn({ label, color, loading, onClick, dimmed }: { label: string; color: string; loading: boolean; onClick: () => void; dimmed?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="px-3 py-2 rounded-lg text-[10px] font-bold transition-all"
      style={{
        background: dimmed ? `rgba(82,82,110,0.15)` : `${color}15`,
        border: `1px solid ${dimmed ? 'rgba(82,82,110,0.3)' : `${color}35`}`,
        color: dimmed ? '#52526e' : color,
        opacity: loading ? 0.6 : 1,
      }}
    >
      {loading ? '...' : label}
    </button>
  );
}

function PendingApprovalsTab() {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('david_pending_approvals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    console.log('[PendingApprovals] query result:', { count: data?.length, error: error?.message });
    if (data) setItems(data as PendingApproval[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const handleDecision = (id: string, action: string) => {
    setItems(prev => prev.map(item =>
      item.id === id
        ? { ...item, status: action === 'pass' ? 'passed' : action === 'approve_novation' ? 'approved_novation' : 'approved_cash', approved_type: action }
        : item
    ));
  };

  const pending  = items.filter(i => i.status === 'pending');
  const decided  = items.filter(i => i.status !== 'pending');

  if (loading) return <Spinner />;

  return (
    <div>
      {pending.length === 0 && decided.length === 0 && (
        <Empty icon={<Shield size={28} />} text="No pending approvals" sub="Qualified calls will appear here automatically" />
      )}
      {pending.length > 0 && (
        <>
          <SectionHeader label={`${pending.length} Pending`} color="#f87171" />
          {pending.map(item => <ApprovalCard key={item.id} item={item} onDecision={handleDecision} />)}
        </>
      )}
      {decided.length > 0 && (
        <>
          <SectionHeader label="Decided" color="#52526e" />
          {decided.map(item => <ApprovalCard key={item.id} item={item} onDecision={handleDecision} />)}
        </>
      )}
    </div>
  );
}

// ─── Tab 2: Live Calls ────────────────────────────────────────────────────────

function LiveCallsTab() {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Show last 48h so calls are visible even if none happened today
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 48);
    const { data, error } = await supabase
      .from('jarvis_calls')
      .select('*')
      .gte('called_at', cutoff.toISOString())
      .order('called_at', { ascending: false })
      .limit(50);
    console.log('[LiveCalls] query result:', { count: data?.length, error: error?.message });
    if (data) setCalls(data as LiveCall[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    setCalls([]);
    setLoading(true);
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <Spinner />;
  if (calls.length === 0) return <Empty icon={<Phone size={28} />} text="No calls in last 48 hours" sub="Active calls will appear here every 15 seconds" />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionHeader label={`${calls.length} calls (last 48h)`} color="#67e8f9" />
        <div className="flex items-center gap-1.5 text-[9px]" style={{ color: '#52526e' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-ngreen animate-pulse" />
          Live · 15s refresh
        </div>
      </div>
      {calls.map(call => (
        <div key={call.id} className="p-4 rounded-xl mb-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-[12px] font-semibold" style={{ color: '#e8e8f0' }}>{call.contact_name}</div>
              <div className="text-[10px]" style={{ color: '#52526e' }}>{call.address}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold" style={{ color: '#67e8f9' }}>{Math.floor((call.call_duration || 0) / 60)}:{String((call.call_duration || 0) % 60).padStart(2, '0')}</div>
              <div className="text-[9px]" style={{ color: '#52526e' }}>{timeAgo(call.called_at)}</div>
            </div>
          </div>
          <div className="flex gap-2 mb-2 flex-wrap">
            {call.stage_before && <Tag label={call.stage_before} color="#52526e" />}
            {call.stage_after && call.stage_after !== call.stage_before && (
              <>
                <span style={{ color: '#52526e', fontSize: 10 }}>→</span>
                <Tag label={call.stage_after} color="#4ade80" />
              </>
            )}
            {call.tags_applied?.map(t => <Tag key={t} label={t} color="#60a5fa" />)}
          </div>
          {call.summary && (
            <p className="text-[10px]" style={{ color: '#9090a8' }}>{call.summary}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
      {label}
    </span>
  );
}

// ─── Tab 3: Recordings ────────────────────────────────────────────────────────

function RecordingsTab() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [feedback, setFeedback]     = useState<Record<string, FeedbackMap>>({});
  const [comment, setComment]       = useState<Record<string, string>>({});

  useEffect(() => {
    setRecordings([]);
    setLoading(true);
    supabase
      .from('jarvis_calls')
      .select('id,contact_name,phone,address,transcript_full,recording_url,call_duration,stage_after,called_at')
      .not('transcript_full', 'is', null)
      .order('called_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        console.log('[Recordings] query result:', { count: data?.length, error: error?.message });
        if (data) setRecordings(data as Recording[]);
        setLoading(false);
      });
  }, []);

  const loadFeedback = async (sessionId: string) => {
    if (feedback[sessionId]) return;
    const res = await fetch(`/api/call-feedback?sessionId=${sessionId}`);
    const json = await res.json();
    const map: FeedbackMap = {};
    (json.feedback || []).forEach((f: { line_index: number; reaction: string; comment: string }) => {
      map[f.line_index] = { reaction: f.reaction, comment: f.comment };
    });
    setFeedback(prev => ({ ...prev, [sessionId]: map }));
  };

  const toggleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      loadFeedback(id);
    }
  };

  const saveFeedback = async (sessionId: string, lineIndex: number, lineText: string, reaction: string) => {
    setFeedback(prev => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] || {}), [lineIndex]: { reaction, comment: (prev[sessionId]?.[lineIndex]?.comment || '') } },
    }));
    await fetch('/api/call-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, lineIndex, lineText, reaction }),
    });
  };

  const saveComment = async (sessionId: string, lineIndex: number, lineText: string) => {
    const c = comment[`${sessionId}-${lineIndex}`] || '';
    setFeedback(prev => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] || {}), [lineIndex]: { reaction: (prev[sessionId]?.[lineIndex]?.reaction || ''), comment: c } },
    }));
    await fetch('/api/call-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, lineIndex, lineText, comment: c }),
    });
    setComment(prev => { const n = {...prev}; delete n[`${sessionId}-${lineIndex}`]; return n; });
  };

  if (loading) return <Spinner />;
  if (recordings.length === 0) return <Empty icon={<Mic size={28} />} text="No recordings yet" sub="Call transcripts will appear here" />;

  return (
    <div>
      {recordings.map(rec => {
        const isOpen = expanded === rec.id;
        const lines  = (rec.transcript_full || '').split('\n').filter(Boolean);
        const fb     = feedback[rec.id] || {};

        return (
          <div key={rec.id} className="mb-3 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {/* Recording header */}
            <button
              className="w-full flex items-center justify-between p-4 text-left"
              onClick={() => toggleExpand(rec.id)}
            >
              <div>
                <div className="text-[12px] font-semibold" style={{ color: '#e8e8f0' }}>{rec.contact_name}</div>
                <div className="text-[10px]" style={{ color: '#52526e' }}>{rec.address} · {fmtDate(rec.called_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                {rec.stage_after && <Tag label={rec.stage_after} color="#a78bfa" />}
                {rec.recording_url && (
                  <a
                    href={`/api/el-recording?id=${rec.recording_url.match(/conversations\/(conv_\w+)/)?.[1] || ''}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="p-1.5 rounded flex items-center"
                    title="Play recording"
                    style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)', flexShrink: 0 }}
                  >
                    <Play size={11} />
                  </a>
                )}
                <span style={{ color: '#52526e' }}>{isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>
              </div>
            </button>

            {/* Expanded transcript with per-line feedback */}
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                    {lines.map((line, idx) => {
                      const lineFb = fb[idx];
                      const isDavid = line.startsWith('David:') || line.startsWith('Jarvis:');
                      const isComment = line.startsWith('[');
                      return (
                        <div
                          key={idx}
                          className="px-4 py-2 group"
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            background: isComment ? 'rgba(74,222,128,0.03)' : 'transparent',
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <p
                              className="flex-1 text-[10px] leading-relaxed"
                              style={{
                                color: isDavid ? '#c4c4d6' : isComment ? '#4ade80' : '#9090a8',
                                fontStyle: isComment ? 'italic' : 'normal',
                              }}
                            >
                              {line}
                            </p>
                            {/* Reaction buttons */}
                            {!isComment && (
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                {[
                                  { r: 'thumbs_up',   icon: <ThumbsUp size={10} />,   c: '#4ade80' },
                                  { r: 'thumbs_down', icon: <ThumbsDown size={10} />, c: '#f87171' },
                                  { r: 'star',        icon: <Star size={10} />,       c: '#fbbf24' },
                                  { r: 'flag',        icon: <Flag size={10} />,       c: '#60a5fa' },
                                ].map(btn => (
                                  <button
                                    key={btn.r}
                                    onClick={() => saveFeedback(rec.id, idx, line, btn.r)}
                                    className="p-1 rounded transition-colors"
                                    style={{
                                      color: lineFb?.reaction === btn.r ? btn.c : '#52526e',
                                      background: lineFb?.reaction === btn.r ? `${btn.c}15` : 'transparent',
                                    }}
                                  >
                                    {btn.icon}
                                  </button>
                                ))}
                                <button
                                  onClick={() => setComment(prev => ({ ...prev, [`${rec.id}-${idx}`]: '' }))}
                                  className="p-1 rounded transition-colors"
                                  style={{ color: lineFb?.comment ? '#67e8f9' : '#52526e' }}
                                >
                                  <MessageSquare size={10} />
                                </button>
                              </div>
                            )}
                          </div>
                          {/* Comment input */}
                          {comment[`${rec.id}-${idx}`] !== undefined && (
                            <div className="mt-1 flex gap-2">
                              <input
                                className="flex-1 text-[10px] px-2 py-1 rounded outline-none"
                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e8e8f0' }}
                                placeholder="Add coaching note..."
                                value={comment[`${rec.id}-${idx}`] ?? (lineFb?.comment || '')}
                                onChange={e => setComment(prev => ({ ...prev, [`${rec.id}-${idx}`]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && saveComment(rec.id, idx, line)}
                                autoFocus
                              />
                              <button
                                onClick={() => saveComment(rec.id, idx, line)}
                                className="text-[9px] px-2 py-1 rounded font-bold"
                                style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80' }}
                              >
                                Save
                              </button>
                            </div>
                          )}
                          {lineFb?.comment && comment[`${rec.id}-${idx}`] === undefined && (
                            <div className="mt-1 text-[9px] italic px-2 py-1 rounded" style={{ color: '#67e8f9', background: 'rgba(103,232,249,0.06)' }}>
                              💬 {lineFb.comment}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab 4: Performance ───────────────────────────────────────────────────────

function PerformanceTab() {
  const [stats, setStats] = useState<{
    today: number; week: number; month: number;
    qualified: number; offersApproved: number;
    contractsSent: number; dealsClosed: number;
    avgDuration: number;
    stageBreakdown: Record<string, number>;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      const now    = new Date();
      const today  = new Date(now); today.setHours(0,0,0,0);
      const week   = new Date(now); week.setDate(now.getDate() - 7);
      const month  = new Date(now); month.setDate(1); month.setHours(0,0,0,0);

      const { data: all, error: allErr } = await supabase
        .from('jarvis_calls')
        .select('called_at,call_duration,stage_after,tags_applied')
        .gte('called_at', month.toISOString());
      console.log('[Performance] jarvis_calls result:', { count: all?.length, error: allErr?.message });

      if (!all) return;

      const todayNum  = all.filter(r => new Date(r.called_at) >= today).length;
      const weekNum   = all.filter(r => new Date(r.called_at) >= week).length;
      const monthNum  = all.length;

      const qualified = all.filter(r =>
        r.stage_after && ['Decision Pending','Hot Follow Up','Warm Follow Up','Contract Sent','Closed Won'].includes(r.stage_after)
      ).length;
      const contracts = all.filter(r => r.stage_after === 'Contract Sent').length;
      const closed    = all.filter(r => r.stage_after === 'Closed Won').length;

      const { data: approvals, error: appErr } = await supabase
        .from('david_pending_approvals')
        .select('status')
        .gte('created_at', month.toISOString());
      console.log('[Performance] pending_approvals result:', { count: approvals?.length, error: appErr?.message });
      const approved = (approvals || []).filter(a => a.status !== 'pending' && a.status !== 'passed').length;

      const avgDur = all.length
        ? Math.round(all.reduce((s, r) => s + (r.call_duration || 0), 0) / all.length)
        : 0;

      const stageBreakdown: Record<string, number> = {};
      all.forEach(r => {
        if (r.stage_after) stageBreakdown[r.stage_after] = (stageBreakdown[r.stage_after] || 0) + 1;
      });

      setStats({ today: todayNum, week: weekNum, month: monthNum, qualified, offersApproved: approved, contractsSent: contracts, dealsClosed: closed, avgDuration: avgDur, stageBreakdown });
    };
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  if (!stats) return <Spinner />;

  const convRate = stats.month > 0 ? Math.round((stats.qualified / stats.month) * 100) : 0;

  return (
    <div>
      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Calls Today',       value: stats.today,         color: '#67e8f9', icon: <Phone size={14} /> },
          { label: 'Calls This Week',   value: stats.week,          color: '#60a5fa', icon: <TrendingUp size={14} /> },
          { label: 'Qualified Leads',   value: stats.qualified,     color: '#4ade80', icon: <CheckCircle2 size={14} /> },
          { label: 'Offers Approved',   value: stats.offersApproved,color: '#fbbf24', icon: <Shield size={14} /> },
          { label: 'Contracts Sent',    value: stats.contractsSent, color: '#a78bfa', icon: <TrendingUp size={14} /> },
          { label: 'Deals Closed',      value: stats.dealsClosed,   color: '#4ade80', icon: <CheckCircle2 size={14} /> },
          { label: 'Conversion Rate',   value: `${convRate}%`,      color: '#fbbf24', icon: <BarChart2 size={14} /> },
          { label: 'Avg Call Duration', value: `${Math.floor(stats.avgDuration / 60)}m ${stats.avgDuration % 60}s`, color: '#67e8f9', icon: <Clock size={14} /> },
        ].map(kpi => (
          <div key={kpi.label} className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-1.5 mb-2" style={{ color: kpi.color }}>
              {kpi.icon}
              <span className="text-[9px] uppercase tracking-wide" style={{ color: '#52526e' }}>{kpi.label}</span>
            </div>
            <div className="font-orbitron text-[20px] font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Stage breakdown */}
      {Object.keys(stats.stageBreakdown).length > 0 && (
        <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[11px] font-semibold mb-3" style={{ color: '#e8e8f0' }}>Stage Breakdown (This Month)</div>
          {Object.entries(stats.stageBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([stage, count]) => {
              const pct = stats.month > 0 ? (count / stats.month) * 100 : 0;
              return (
                <div key={stage} className="mb-2">
                  <div className="flex justify-between mb-1">
                    <span className="text-[10px]" style={{ color: '#9090a8' }}>{stage}</span>
                    <span className="text-[10px] font-bold" style={{ color: '#c4c4d6' }}>{count}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#4ade80' }} />
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ─── Tab 5: Training ──────────────────────────────────────────────────────────

const CALL_TYPES    = ['offer_call','qual_call','foreclosure','follow_up'];
const PERSONAS      = ['Motivated','Cooperative','Difficult','Testing','Foreclosure','Landlord'];
const OBJ_LEVELS    = ['Light','Moderate','Heavy'];

function TrainingTab() {
  const [form, setForm] = useState({
    callType: 'offer_call', sellerName: 'Denise', address: '123 Main St, Tampa FL 33601',
    arv: '320000', asking: '265000', equity: '38', timeline: '30-60 days',
    condition: 'Good', payoff: '198000', motivation: 'Divorce',
    persona: 'Motivated', objectionLevel: 'Moderate',
    foreclosureStatus: 'active', auctionDate: '',
  });
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<{ transcript: string; score: ScoreData | null; meta: Record<string, unknown> } | null>(null);
  const [sessions, setSessions] = useState<MockSession[]>([]);
  const [sessionExpanded, setSessionExpanded] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from('david_mock_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => { if (data) setSessions(data as MockSession[]); });
  }, []);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res  = await fetch('/api/mock-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const json = await res.json();
      setResult(json);
      // Scroll to transcript
      setTimeout(() => transcriptRef.current?.scrollIntoView({ behavior: 'smooth' }), 200);
      // Save session
      if (json.transcript) {
        await supabase.from('david_mock_sessions').insert({
          call_type: form.callType, seller_name: form.sellerName,
          persona: form.persona, objection_level: form.objectionLevel,
          score: json.score, transcript: json.transcript,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const f = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div>
      {/* Config panel */}
      <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="text-[11px] font-semibold mb-3" style={{ color: '#e8e8f0' }}>Mock Call Setup</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <FormField label="Call Type">
            <select value={form.callType} onChange={e => f('callType', e.target.value)} className="form-select">
              {CALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Seller Persona">
            <select value={form.persona} onChange={e => f('persona', e.target.value)} className="form-select">
              {PERSONAS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </FormField>
          <FormField label="Objection Level">
            <select value={form.objectionLevel} onChange={e => f('objectionLevel', e.target.value)} className="form-select">
              {OBJ_LEVELS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </FormField>
          <FormField label="Seller Name">
            <input value={form.sellerName} onChange={e => f('sellerName', e.target.value)} className="form-input" />
          </FormField>
          <FormField label="ARV">
            <input value={form.arv} onChange={e => f('arv', e.target.value)} className="form-input" placeholder="320000" />
          </FormField>
          <FormField label="Asking Price">
            <input value={form.asking} onChange={e => f('asking', e.target.value)} className="form-input" placeholder="265000" />
          </FormField>
          <FormField label="Motivation">
            <input value={form.motivation} onChange={e => f('motivation', e.target.value)} className="form-input" placeholder="Divorce" />
          </FormField>
          <FormField label="Timeline">
            <select value={form.timeline} onChange={e => f('timeline', e.target.value)} className="form-select">
              {['30 days','30-60 days','60+ days'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Condition">
            <select value={form.condition} onChange={e => f('condition', e.target.value)} className="form-select">
              {['Good','Fair','Poor'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="w-full py-3 rounded-lg font-bold text-[12px] transition-all"
          style={{
            background: loading ? 'rgba(74,222,128,0.08)' : 'rgba(74,222,128,0.15)',
            color: '#4ade80',
            border: '1px solid rgba(74,222,128,0.3)',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2"><RefreshCw size={13} className="animate-spin" /> Generating call...</span>
          ) : '▶  Generate Mock Call'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div ref={transcriptRef}>
          {/* Scores */}
          {result.score && (
            <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-semibold" style={{ color: '#e8e8f0' }}>Performance Score</div>
                <div>
                  <span className="text-[9px]" style={{ color: '#52526e' }}>Close Probability </span>
                  <span className="font-orbitron text-[16px] font-bold" style={{ color: result.score.close_probability >= 60 ? '#4ade80' : result.score.close_probability >= 35 ? '#fbbf24' : '#f87171' }}>
                    {result.score.close_probability}%
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                {[
                  ['Offer Timing',       result.score.offer_timing],
                  ['Silence Discipline', result.score.silence_discipline],
                  ['Pull-Down Tactics',  result.score.pulldown_tactics],
                  ['Objection Handling', result.score.objection_handling],
                  ['Rapport Building',   result.score.rapport_building],
                  ['Motivation Depth',   result.score.motivation_depth],
                  ['Close Execution',    result.score.close_execution],
                  ['Overall',            result.score.overall],
                ].map(([label, val]) => (
                  <ScoreBar key={label as string} label={label as string} value={val as number} />
                ))}
              </div>
              {result.score.suggestions?.length > 0 && (
                <div className="mt-3 p-3 rounded-lg" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }}>
                  <div className="text-[10px] font-bold mb-2" style={{ color: '#fbbf24' }}>Coaching Notes</div>
                  {result.score.suggestions.map((s, i) => (
                    <div key={i} className="text-[10px] mb-1 flex gap-2" style={{ color: '#9090a8' }}>
                      <span style={{ color: '#fbbf24' }}>→</span>{s}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Transcript */}
          <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="text-[11px] font-semibold mb-3" style={{ color: '#e8e8f0' }}>Call Transcript</div>
            <div className="text-[10px] leading-relaxed font-mono whitespace-pre-wrap" style={{ color: '#9090a8' }}>
              {result.transcript}
            </div>
          </div>
        </div>
      )}

      {/* Past sessions */}
      {sessions.length > 0 && (
        <div className="mt-6">
          <SectionHeader label="Past Mock Sessions" color="#52526e" />
          {sessions.map(s => (
            <div key={s.id} className="mb-2 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                className="w-full flex items-center justify-between p-3 text-left"
                onClick={() => setSessionExpanded(sessionExpanded === s.id ? null : s.id)}
              >
                <div>
                  <span className="text-[11px] font-medium" style={{ color: '#c4c4d6' }}>{s.seller_name} · {s.call_type}</span>
                  <span className="text-[10px] ml-2" style={{ color: '#52526e' }}>{s.persona} / {s.objection_level}</span>
                </div>
                <div className="flex items-center gap-2">
                  {s.score && (
                    <span className="font-orbitron text-[13px] font-bold" style={{ color: s.score.overall >= 7 ? '#4ade80' : s.score.overall >= 5 ? '#fbbf24' : '#f87171' }}>
                      {s.score.overall}/10
                    </span>
                  )}
                  {sessionExpanded === s.id ? <ChevronUp size={12} style={{ color: '#52526e' }} /> : <ChevronDown size={12} style={{ color: '#52526e' }} />}
                </div>
              </button>
              <AnimatePresence>
                {sessionExpanded === s.id && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 text-[10px] font-mono whitespace-pre-wrap leading-relaxed" style={{ color: '#9090a8', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      {s.transcript}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .form-select, .form-input {
          width: 100%;
          padding: 6px 8px;
          border-radius: 8px;
          font-size: 11px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          color: #e8e8f0;
          outline: none;
        }
        .form-select option { background: #0c0d14; color: #e8e8f0; }
        .form-select:focus, .form-input:focus { border-color: rgba(74,222,128,0.4); }
      `}</style>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] mb-1 uppercase tracking-wide" style={{ color: '#52526e' }}>{label}</div>
      {children}
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <RefreshCw size={18} className="animate-spin" style={{ color: '#52526e' }} />
    </div>
  );
}

function Empty({ icon, text, sub }: { icon: React.ReactNode; text: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: '#52526e' }}>
      {icon}
      <div className="text-[12px] font-medium" style={{ color: '#9090a8' }}>{text}</div>
      <div className="text-[10px]">{sub}</div>
    </div>
  );
}

function SectionHeader({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-px flex-1" style={{ background: `${color}30` }} />
      <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color }}>{label}</span>
      <div className="h-px flex-1" style={{ background: `${color}30` }} />
    </div>
  );
}

// ─── Main DavidHQ ─────────────────────────────────────────────────────────────

export function DavidHQ() {
  const [activeTab, setActiveTab] = useState<TabId>('approvals');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    supabase
      .from('david_pending_approvals')
      .select('id', { count: 'exact' })
      .eq('status', 'pending')
      .then(({ count }) => setPendingCount(count || 0));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl flex-wrap" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {TABS.map(tab => {
          const active  = activeTab === tab.id;
          const Icon = tab.icon;
          const hasBadge = tab.id === 'approvals' && pendingCount > 0;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all flex-1 justify-center"
              style={{
                background: active ? 'rgba(251,191,36,0.12)' : 'transparent',
                color: active ? '#fbbf24' : '#52526e',
                border: active ? '1px solid rgba(251,191,36,0.25)' : '1px solid transparent',
              }}
            >
              <Icon size={12} />
              <span className="hidden sm:inline">{tab.label}</span>
              {hasBadge && (
                <span
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center"
                  style={{ background: '#f87171', color: '#fff' }}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {activeTab === 'approvals'   && <PendingApprovalsTab />}
            {activeTab === 'live'        && <LiveCallsTab />}
            {activeTab === 'recordings'  && <RecordingsTab />}
            {activeTab === 'performance' && <PerformanceTab />}
            {activeTab === 'training'    && <TrainingTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
