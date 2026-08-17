'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileSignature, MapPin, Phone, CalendarClock, Loader2, Plus, X,
  TrendingUp, FileText, ExternalLink,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { DIALER_API } from '@/lib/config';

// Board state lives on the VPS dialer-server (Vercel is at its function cap,
// Supabase is down) — same host as leads/contract data.
const NOVATION_API = `${DIALER_API}/dialer/novation`;
const CONTRACT_API = `${DIALER_API}/dialer/contract`;
const GHL_CONTACT_URL = (id: string) =>
  `https://app.gohighlevel.com/v2/location/AymErWPrH9U1ddRouslC/contacts/detail/${id}`;

interface Task { id: string; label: string; done: boolean; doneAt?: string; }
interface Column { id: string; title: string; emoji: string; color: string; tasks: Task[]; }
interface Deal {
  name: string; address: string; phone: string; contactId: string; docMatch: string;
  underContractSince: string; targetClose: string;
  sellerPrice: string; listPrice: string; spread: string;
}
interface Board { deal: Deal; columns: Column[]; updatedAt: string | null; }
interface Doc { id: string; name: string; status: string; createdAt?: string; recipients?: string[]; }

const daysBetween = (from: string, to: Date = new Date()) => {
  const d = new Date(from + 'T00:00:00');
  return Math.max(0, Math.floor((to.getTime() - d.getTime()) / 86400000));
};

export function NovationTracker() {
  const { refreshKey } = useApp();
  const [board, setBoard]   = useState<Board | null>(null);
  const [docs, setDocs]     = useState<Doc[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTask, setNewTask]   = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(NOVATION_API).then(r => r.json())
      .then(d => { if (d.board) setBoard(d.board); })
      .catch(() => setError('Could not reach the deal board API'));
    fetch(`${CONTRACT_API}/documents?limit=20`).then(r => r.json())
      .then(d => { if (d.documents) setDocs(d.documents); })
      .catch(() => {});
  }, [refreshKey]);

  // Persist the whole board (debounced so rapid checkbox clicks batch into one save).
  function persist(next: Board) {
    setBoard(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      fetch(NOVATION_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
        .then(r => r.json())
        .then(d => { if (!d.ok) setError('Save failed'); })
        .catch(() => setError('Save failed — check connection'))
        .finally(() => setSaving(false));
    }, 500);
  }

  function toggleTask(colId: string, taskId: string) {
    if (!board) return;
    persist({
      ...board,
      columns: board.columns.map(c => c.id !== colId ? c : {
        ...c,
        tasks: c.tasks.map(t => t.id !== taskId ? t : {
          ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString().slice(0, 10) : undefined,
        }),
      }),
    });
  }

  function addTask(colId: string) {
    if (!board || !newTask.trim()) return;
    persist({
      ...board,
      columns: board.columns.map(c => c.id !== colId ? c : {
        ...c,
        tasks: [...c.tasks, { id: `${colId}-${Date.now()}`, label: newTask.trim(), done: false }],
      }),
    });
    setNewTask('');
    setAddingTo(null);
  }

  function removeTask(colId: string, taskId: string) {
    if (!board) return;
    persist({
      ...board,
      columns: board.columns.map(c => c.id !== colId ? c : {
        ...c, tasks: c.tasks.filter(t => t.id !== taskId),
      }),
    });
  }

  function setDealField(key: keyof Deal, value: string) {
    if (!board) return;
    persist({ ...board, deal: { ...board.deal, [key]: value } });
  }

  const stats = useMemo(() => {
    if (!board) return null;
    const all = board.columns.flatMap(c => c.tasks);
    const done = all.filter(t => t.done).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    const current = board.columns.find(c => c.tasks.some(t => !t.done)) || board.columns[board.columns.length - 1];
    return { done, total: all.length, pct, current };
  }, [board]);

  const dealDocs = useMemo(() => {
    const m = board?.deal.docMatch?.toLowerCase();
    if (!m) return [];
    return docs.filter(d => (d.recipients || []).some(r => r.toLowerCase().includes(m)));
  }, [docs, board]);

  if (error && !board) {
    return <div className="flex items-center justify-center h-64 text-[11px]" style={{ color: '#ff453a' }}>{error}</div>;
  }
  if (!board || !stats) {
    return (
      <div className="flex items-center justify-center h-64 text-dimtext">
        <Loader2 size={18} className="animate-spin" style={{ color: '#30d158' }} />
      </div>
    );
  }

  const { deal } = board;
  const daysUC = deal.underContractSince ? daysBetween(deal.underContractSince) : null;
  const daysLeft = deal.targetClose
    ? Math.ceil((new Date(deal.targetClose + 'T00:00:00').getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className="space-y-4">
      {/* ── Deal header ── */}
      <GlassCard accent="green" hover={false}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <FileSignature size={16} style={{ color: '#30d158' }} />
              <span className="text-[15px] font-semibold" style={{ color: '#e8e8f0' }}>{deal.address}</span>
              <a href={GHL_CONTACT_URL(deal.contactId)} target="_blank" rel="noreferrer" title="Open in GHL">
                <ExternalLink size={12} style={{ color: '#52526e' }} />
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px]" style={{ color: '#8a8aa0' }}>
              <span className="flex items-center gap-1.5"><MapPin size={11} />{deal.name}</span>
              <span className="flex items-center gap-1.5"><Phone size={11} />{deal.phone}</span>
              {daysUC !== null && (
                <span className="flex items-center gap-1.5">
                  <CalendarClock size={11} />
                  <span style={{ color: '#ff9f0a' }}>{daysUC} days</span> under contract
                </span>
              )}
              {daysLeft !== null && (
                <span className="flex items-center gap-1.5" style={{ color: daysLeft < 7 ? '#ff453a' : '#0a84ff' }}>
                  <TrendingUp size={11} />
                  {daysLeft >= 0 ? `${daysLeft} days to target close` : `${-daysLeft} days PAST target close`}
                </span>
              )}
              {saving && <span className="flex items-center gap-1" style={{ color: '#52526e' }}><Loader2 size={10} className="animate-spin" />saving…</span>}
            </div>
          </div>

          {/* Progress ring-ish block */}
          <div className="text-right">
            <div className="font-orbitron text-[26px] font-bold" style={{ color: stats.pct === 100 ? '#30d158' : '#ff9f0a' }}>
              {stats.pct}%
            </div>
            <div className="text-[9px] uppercase tracking-[1.5px]" style={{ color: '#52526e' }}>
              {stats.done}/{stats.total} to close · now: {stats.current.emoji} {stats.current.title}
            </div>
          </div>
        </div>

        {/* Progress bar with column segments */}
        <div className="mt-3 h-2 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.05)' }}>
          {board.columns.map(c => {
            const total = board.columns.flatMap(x => x.tasks).length;
            const width = (c.tasks.length / total) * 100;
            const colDone = c.tasks.filter(t => t.done).length;
            const fill = c.tasks.length ? (colDone / c.tasks.length) * 100 : 0;
            return (
              <div key={c.id} style={{ width: `${width}%` }} className="relative" title={`${c.title}: ${colDone}/${c.tasks.length}`}>
                <div className="absolute inset-y-0 left-0" style={{ width: `${fill}%`, background: c.color, opacity: 0.85 }} />
                <div className="absolute inset-y-0 right-0 w-px" style={{ background: 'rgba(0,0,0,0.6)' }} />
              </div>
            );
          })}
        </div>

        {/* Deal numbers — editable */}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          {([
            ['sellerPrice', "Seller's price"],
            ['listPrice', 'List price'],
            ['spread', 'Your spread'],
            ['targetClose', 'Target close'],
          ] as [keyof Deal, string][]).map(([key, label]) => (
            <div key={key} className="rounded-sm px-2.5 py-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-[8px] uppercase tracking-[1.2px]" style={{ color: '#52526e' }}>{label}</div>
              <input
                type={key === 'targetClose' ? 'date' : 'text'}
                value={deal[key]}
                placeholder={key === 'spread' ? '$—' : '—'}
                onChange={e => setDealField(key, e.target.value)}
                className="w-full bg-transparent outline-none text-[12px] font-medium mt-0.5"
                style={{ color: key === 'spread' ? '#30d158' : '#e8e8f0', colorScheme: 'dark' }}
              />
            </div>
          ))}
        </div>
      </GlassCard>

      {/* ── Job board ── */}
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
        {board.columns.map((col, i) => {
          const colDone = col.tasks.filter(t => t.done).length;
          const complete = col.tasks.length > 0 && colDone === col.tasks.length;
          const isCurrent = stats.current.id === col.id && !complete;
          return (
            <motion.div
              key={col.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex-shrink-0 w-[240px] md:w-[calc(20%-10px)] md:min-w-[210px] rounded-sm"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${isCurrent ? col.color + '55' : 'rgba(255,255,255,0.06)'}`,
                boxShadow: isCurrent ? `0 0 24px ${col.color}14` : undefined,
              }}
            >
              {/* Column header */}
              <div className="px-3 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px]">{col.emoji}</span>
                  <span className="text-[11px] font-semibold" style={{ color: complete ? '#30d158' : '#e8e8f0' }}>{col.title}</span>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium"
                  style={{ background: complete ? 'rgba(48,209,88,0.12)' : `${col.color}14`, color: complete ? '#30d158' : col.color }}>
                  {colDone}/{col.tasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div className="p-2 space-y-1.5">
                {col.tasks.map(t => (
                  <div key={t.id} className="group flex items-start gap-2 rounded-sm px-2 py-1.5 transition-colors"
                    style={{ background: t.done ? 'rgba(48,209,88,0.04)' : 'rgba(255,255,255,0.025)' }}>
                    <button
                      onClick={() => toggleTask(col.id, t.id)}
                      className="mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded-sm flex items-center justify-center transition-colors"
                      style={{
                        border: `1px solid ${t.done ? '#30d158' : '#3a3a52'}`,
                        background: t.done ? 'rgba(48,209,88,0.18)' : 'transparent',
                      }}
                    >
                      {t.done && <span className="text-[9px] leading-none" style={{ color: '#30d158' }}>✓</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10.5px] leading-snug" style={{ color: t.done ? '#52526e' : '#c4c4d6', textDecoration: t.done ? 'line-through' : 'none' }}>
                        {t.label}
                      </div>
                      {t.done && t.doneAt && <div className="text-[8px] mt-0.5" style={{ color: '#3a3a52' }}>{t.doneAt}</div>}
                    </div>
                    <button onClick={() => removeTask(col.id, t.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
                      style={{ color: '#3a3a52' }} title="Remove task">
                      <X size={10} />
                    </button>
                  </div>
                ))}

                {/* Add task */}
                {addingTo === col.id ? (
                  <div className="flex items-center gap-1.5 px-1">
                    <input
                      autoFocus
                      value={newTask}
                      onChange={e => setNewTask(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addTask(col.id); if (e.key === 'Escape') { setAddingTo(null); setNewTask(''); } }}
                      placeholder="Task…"
                      className="flex-1 bg-transparent outline-none text-[10.5px] py-1"
                      style={{ color: '#e8e8f0', borderBottom: `1px solid ${col.color}44` }}
                    />
                    <button onClick={() => addTask(col.id)} style={{ color: col.color }}><Plus size={12} /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingTo(col.id); setNewTask(''); }}
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded-sm text-[9.5px] transition-colors"
                    style={{ color: '#3a3a52' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#8a8aa0')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#3a3a52')}
                  >
                    <Plus size={10} /> add task
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ── Signed paperwork (live from GHL) ── */}
      <GlassCard accent="blue" hover={false}>
        <div className="flex items-center gap-2 mb-2">
          <FileText size={13} style={{ color: '#0a84ff' }} />
          <span className="text-[11px] font-semibold" style={{ color: '#e8e8f0' }}>Deal Paperwork</span>
          <span className="text-[9px]" style={{ color: '#52526e' }}>live from GHL Documents &amp; Contracts</span>
        </div>
        {dealDocs.length === 0 ? (
          <div className="text-[10px] py-2" style={{ color: '#52526e' }}>No documents found for this deal.</div>
        ) : (
          <div className="space-y-1">
            {dealDocs.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm" style={{ background: 'rgba(255,255,255,0.025)' }}>
                <span className="text-[10.5px] truncate" style={{ color: '#c4c4d6' }}>{d.name}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {d.createdAt && <span className="text-[9px]" style={{ color: '#3a3a52' }}>{new Date(d.createdAt).toLocaleDateString()}</span>}
                  <span className="text-[9px] px-2 py-0.5 rounded-sm font-medium" style={{
                    background: d.status === 'completed' ? 'rgba(48,209,88,0.12)' : d.status === 'viewed' ? 'rgba(10,132,255,0.12)' : 'rgba(255,255,255,0.06)',
                    color:      d.status === 'completed' ? '#30d158' : d.status === 'viewed' ? '#0a84ff' : '#8a8aa0',
                  }}>{d.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
