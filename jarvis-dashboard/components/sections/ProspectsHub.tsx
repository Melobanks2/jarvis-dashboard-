'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, Phone, Clock,
  MapPin, Tag, TrendingUp, FileText, Mic, ExternalLink, AlertCircle,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { useProspects, DealApproval, ProspectCall } from '@/lib/hooks/useProspects';
import { useApp } from '@/lib/AppContext';
import { fmtTime, fmtDate, timeAgo } from '@/lib/supabase';

const FADE_UP = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } };
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtCurrency(n: number | null) {
  if (n == null) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}

// ── Approval Card ─────────────────────────────────────────────────────────────
function ApprovalCard({ approval, onDecision }: { approval: DealApproval; onDecision: (id: string, action: 'approve' | 'pass') => void }) {
  const [showTx, setShowTx] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const handleDecision = async (action: 'approve' | 'pass') => {
    setDeciding(true);
    onDecision(approval.id, action);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="rounded-sm border overflow-hidden"
      style={{ background: 'rgba(170,68,255,0.04)', borderColor: 'rgba(170,68,255,0.25)' }}
    >
      {/* Top accent */}
      <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, #aa44ff 40%, #aa44ff 60%, transparent)' }} />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="font-orbitron text-[13px] font-bold text-textb">{approval.contact_name || 'Unknown Seller'}</div>
            <div className="flex items-center gap-1 text-[10px] text-dimtext mt-0.5">
              <MapPin size={9} />
              <span className="truncate max-w-[280px]">{approval.address || '—'}</span>
            </div>
          </div>
          <div className="text-[8px] text-dimtext font-orbitron tracking-[1px]">{timeAgo(approval.created_at)}</div>
        </div>

        {/* ARV + Offer grid */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="p-2 rounded-sm border" style={{ background: 'rgba(0,229,255,0.05)', borderColor: 'rgba(0,229,255,0.15)' }}>
            <div className="text-[8px] text-dimtext font-orbitron tracking-[1px] mb-0.5">ARV</div>
            <div className="font-orbitron text-[18px] font-black text-ncyan">{fmtCurrency(approval.arv)}</div>
            {approval.repair_estimate && (
              <div className="text-[8px] text-dimtext mt-0.5">Repairs: {fmtCurrency(approval.repair_estimate)}</div>
            )}
          </div>
          <div className="p-2 rounded-sm border" style={{ background: 'rgba(0,255,136,0.05)', borderColor: 'rgba(0,255,136,0.12)' }}>
            <div className="text-[8px] text-dimtext font-orbitron tracking-[1px] mb-1">OFFER RANGE</div>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[9px]">
                <span className="text-dimtext">60% Start</span>
                <span className="text-ngreen font-bold">{fmtCurrency(approval.offer_60)}</span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-dimtext">65% Target</span>
                <span style={{ color: '#ffd700' }} className="font-bold">{fmtCurrency(approval.offer_65)}</span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-dimtext">70% Max</span>
                <span className="text-norange font-bold">{fmtCurrency(approval.offer_70)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Motivation + summary */}
        {(approval.motivation || approval.interest_level) && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {approval.motivation && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-sm border border-npurple/20 bg-npurple/08 text-npurple">{approval.motivation}</span>
            )}
            {approval.interest_level && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-sm border border-ncyan/20 bg-ncyan/08 text-ncyan">{approval.interest_level}</span>
            )}
          </div>
        )}

        {approval.call_summary && (
          <div className="text-[9px] text-dimtext italic mb-3 line-clamp-2">{approval.call_summary}</div>
        )}

        {/* Transcript toggle */}
        {approval.transcript && (
          <>
            <button
              onClick={() => setShowTx(!showTx)}
              className="flex items-center gap-1 text-[9px] text-dimtext hover:text-ncyan transition-colors mb-2"
            >
              <Mic size={9} /> Full Transcript {showTx ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
            </button>
            {showTx && (
              <div className="max-h-[180px] overflow-y-auto text-[8px] font-mono bg-bg3 border border-border2 rounded-sm p-2 leading-relaxed mb-3">
                {approval.transcript.split('\n').map((line, i) => {
                  const isJarvis = line.toLowerCase().startsWith('jarvis') || line.toLowerCase().startsWith('agent');
                  return (
                    <div key={i} style={{ color: isJarvis ? '#00e5ff' : '#00ff88' }}>{line}</div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ASAP ARV report link */}
        {approval.asaparv_report_url && (
          <a
            href={approval.asaparv_report_url}
            target="_blank"
            className="flex items-center gap-1 text-[9px] text-dimtext hover:text-ncyan transition-colors mb-3"
          >
            <ExternalLink size={9} /> View ASAP ARV Report
          </a>
        )}

        {/* Approve / Pass buttons */}
        <div className="flex gap-2">
          <motion.button
            onClick={() => handleDecision('approve')}
            disabled={deciding}
            whileTap={{ scale: 0.95 }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-sm font-orbitron text-[10px] font-bold tracking-[1px] transition-all disabled:opacity-50"
            style={{ background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.30)', color: '#00ff88' }}
          >
            <ThumbsUp size={12} /> APPROVE
          </motion.button>
          <motion.button
            onClick={() => handleDecision('pass')}
            disabled={deciding}
            whileTap={{ scale: 0.95 }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-sm font-orbitron text-[10px] font-bold tracking-[1px] transition-all disabled:opacity-50"
            style={{ background: 'rgba(255,51,102,0.10)', border: '1px solid rgba(255,51,102,0.25)', color: '#ff3366' }}
          >
            <ThumbsDown size={12} /> PASS
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Prospect Call Card ────────────────────────────────────────────────────────
function ProspectCard({ call }: { call: ProspectCall }) {
  const [showTx, setShowTx] = useState(false);

  const tagsArr: string[] = Array.isArray(call.tags_applied)
    ? call.tags_applied
    : typeof call.tags_applied === 'string'
      ? call.tags_applied.split(',').map(t => t.trim()).filter(Boolean)
      : [];

  return (
    <GlassCard accent="cyan" padding="p-3">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-orbitron text-[11px] font-bold text-textb truncate">{call.contact_name || 'Unknown'}</div>
          {call.address && (
            <div className="flex items-center gap-1 text-[9px] text-dimtext mt-0.5 truncate">
              <MapPin size={8} />{call.address}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 text-[9px] text-ncyan flex-shrink-0 ml-2">
          <Clock size={8} />{fmtDuration(call.call_duration)}
        </div>
      </div>

      {/* Stage */}
      {call.stage_after && (
        <div className="flex items-center gap-1 mb-2">
          <span className="text-[8px] px-1.5 py-0.5 rounded-sm border border-npurple/20 bg-npurple/08 text-npurple">{call.stage_after}</span>
        </div>
      )}

      {/* Tags */}
      {tagsArr.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tagsArr.slice(0, 3).map(t => (
            <span key={t} className="text-[7px] px-1.5 py-0.5 rounded-sm bg-bg3 text-dimtext border border-border2">{t}</span>
          ))}
        </div>
      )}

      {call.summary && (
        <div className="text-[9px] text-dimtext italic line-clamp-2 mb-2">{call.summary}</div>
      )}

      {/* Transcript toggle */}
      {call.transcript_full && (
        <>
          <button
            onClick={() => setShowTx(!showTx)}
            className="flex items-center gap-1 text-[8px] text-dimtext hover:text-ncyan transition-colors"
          >
            <Mic size={8} /> Transcript {showTx ? <ChevronUp size={8} /> : <ChevronDown size={8} />}
          </button>
          {showTx && (
            <div className="mt-1.5 max-h-[160px] overflow-y-auto text-[8px] font-mono bg-bg3 border border-border2 rounded-sm p-2 leading-relaxed">
              {call.transcript_full.split('\n').map((line, i) => {
                const isJarvis = line.toLowerCase().startsWith('jarvis');
                return (
                  <div key={i} style={{ color: isJarvis ? '#00e5ff' : '#00ff88' }}>{line}</div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="text-[8px] text-dimtext mt-2">{fmtDate(call.called_at)} {fmtTime(call.called_at)}</div>
    </GlassCard>
  );
}

// ── Main Section ──────────────────────────────────────────────────────────────
export function ProspectsHub() {
  const { refreshKey, refresh } = useApp();
  const { pendingApprovals, decidedApprovals, calls, loading, error } = useProspects(refreshKey);
  const [tab, setTab] = useState<'approvals' | 'prospects' | 'history'>('approvals');
  const [localApprovals, setLocalApprovals] = useState<Record<string, 'approve' | 'pass'>>({});

  const handleDecision = async (approvalId: string, action: 'approve' | 'pass') => {
    // Optimistic update
    setLocalApprovals(prev => ({ ...prev, [approvalId]: action }));

    try {
      const res = await fetch('/api/approve-deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[Approval] Error:', err);
      }
      refresh();
    } catch (e) {
      console.error('[Approval] Network error:', e);
    }
  };

  // Filter out locally decided
  const pendingVisible = pendingApprovals.filter(a => !localApprovals[a.id]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-[11px] text-dimtext animate-pulse font-orbitron tracking-[2px]">Loading prospects...</div>
    </div>
  );

  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col gap-5">

      {/* Metrics row */}
      <motion.div variants={FADE_UP} className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Pending Approval', value: pendingVisible.length, color: '#aa44ff' },
          { label: 'Approved Deals',   value: decidedApprovals.filter(a => a.status === 'approved').length, color: '#00ff88' },
          { label: 'Passed',           value: decidedApprovals.filter(a => a.status === 'passed').length,   color: '#ff3366' },
          { label: 'Calls Logged',     value: calls.length,                                                  color: '#00e5ff' },
        ].map(m => (
          <GlassCard key={m.label} accent="purple" padding="p-3" hover={false}>
            <div className="text-[8px] text-dimtext font-orbitron tracking-[1px] uppercase mb-1">{m.label}</div>
            <AnimatedCounter target={m.value} className="font-orbitron text-[28px] font-black block" style={{ color: m.color } as React.CSSProperties} />
          </GlassCard>
        ))}
      </motion.div>

      {/* Pending approvals alert banner */}
      <AnimatePresence>
        {pendingVisible.length > 0 && tab !== 'approvals' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 px-4 py-2.5 rounded-sm border cursor-pointer"
            style={{ background: 'rgba(170,68,255,0.08)', borderColor: 'rgba(170,68,255,0.30)' }}
            onClick={() => setTab('approvals')}
          >
            <AlertCircle size={13} style={{ color: '#aa44ff' }} />
            <span className="text-[10px] font-orbitron font-bold" style={{ color: '#aa44ff' }}>
              {pendingVisible.length} deal{pendingVisible.length > 1 ? 's' : ''} awaiting your approval
            </span>
            <span className="ml-auto text-[9px] text-dimtext">Tap to review →</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <motion.div variants={FADE_UP}>
        <div className="flex gap-0 mb-4">
          {([
            { key: 'approvals',  label: `Approvals${pendingVisible.length ? ` (${pendingVisible.length})` : ''}` },
            { key: 'prospects',  label: 'Prospect Cards' },
            { key: 'history',    label: 'Call History' },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-4 py-2 text-[10px] font-orbitron tracking-[1px] uppercase border-b-2 transition-all"
              style={{
                color:       tab === t.key ? '#aa44ff' : '#5a5a80',
                borderColor: tab === t.key ? '#aa44ff' : 'transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Approvals tab ── */}
        {tab === 'approvals' && (
          <div className="flex flex-col gap-4">
            {error && (
              <GlassCard accent="red" padding="p-3">
                <div className="text-[10px] text-nred font-orbitron">Error: {error} — run deal_approvals SQL in Supabase first</div>
              </GlassCard>
            )}

            {pendingVisible.length === 0 && !error && (
              <div className="text-center py-12 text-dimtext text-[11px] italic">
                No pending approvals — deals show here after David calls a qualified lead
              </div>
            )}

            <AnimatePresence>
              {pendingVisible.map(a => (
                <ApprovalCard key={a.id} approval={a} onDecision={handleDecision} />
              ))}
            </AnimatePresence>

            {/* Recent decisions */}
            {decidedApprovals.length > 0 && (
              <div className="mt-4">
                <SectionTitle accent="purple" badge={`${decidedApprovals.length} decisions`}>Recent Decisions</SectionTitle>
                <div className="flex flex-col gap-2">
                  {decidedApprovals.slice(0, 10).map(a => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-sm border text-[10px]"
                      style={{
                        background:   a.status === 'approved' ? 'rgba(0,255,136,0.04)' : 'rgba(255,51,102,0.04)',
                        borderColor:  a.status === 'approved' ? 'rgba(0,255,136,0.15)' : 'rgba(255,51,102,0.15)',
                      }}
                    >
                      {a.status === 'approved'
                        ? <ThumbsUp size={10} className="text-ngreen flex-shrink-0" />
                        : <ThumbsDown size={10} className="text-nred flex-shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-textb">{a.contact_name}</span>
                        {a.address && <span className="text-dimtext ml-2 truncate">{a.address}</span>}
                      </div>
                      <div className="text-dimtext flex-shrink-0">
                        ARV {fmtCurrency(a.arv)} · {a.decision_at ? timeAgo(a.decision_at) : timeAgo(a.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Prospects tab (grouped by contact) ── */}
        {tab === 'prospects' && (
          <div>
            {calls.length === 0 ? (
              <div className="text-center py-12 text-dimtext text-[11px] italic">No prospect calls logged yet</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {calls.map(c => <ProspectCard key={c.id} call={c} />)}
              </div>
            )}
          </div>
        )}

        {/* ── Call History tab ── */}
        {tab === 'history' && (
          <div className="flex flex-col gap-2">
            {calls.length === 0 ? (
              <div className="text-center py-12 text-dimtext text-[11px] italic">No calls recorded yet</div>
            ) : (
              calls.map(c => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-sm border text-[10px]"
                  style={{ background: 'rgba(0,229,255,0.03)', borderColor: 'rgba(0,229,255,0.10)' }}
                >
                  <Phone size={10} className="text-ncyan flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-textb">{c.contact_name}</span>
                    {c.address && <span className="text-dimtext ml-2 text-[9px] truncate max-w-[200px] inline-block align-bottom">{c.address}</span>}
                  </div>
                  <span className="text-dimtext flex-shrink-0 text-[9px]">{c.stage_after || '—'}</span>
                  <span className="text-ncyan flex-shrink-0 font-orbitron text-[9px]">{fmtDuration(c.call_duration)}</span>
                  <span className="text-dimtext flex-shrink-0 text-[8px]">{fmtDate(c.called_at)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
