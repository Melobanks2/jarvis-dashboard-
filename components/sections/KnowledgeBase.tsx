'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { BookOpen, Youtube, FileText, Lightbulb, ChevronDown, ChevronUp, ExternalLink, Search, Clock } from 'lucide-react';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface KBEntry {
  id: string;
  created_at: string;
  message: string;
  type: string;
}

interface ParsedEntry {
  id: string;
  date: string;
  title: string;
  source: 'youtube' | 'manual' | 'daily';
  label: string;
  preview: string;
  raw: string;
}

function parseEntry(row: KBEntry): ParsedEntry {
  const msg   = row.message || '';
  const isYT  = msg.includes('youtube.com') || msg.includes('youtu.be') || row.type === 'knowledge_feed';
  const label = msg.replace(/^\[LEARNED\]\s*/, '').replace(/^\[.*?\]\s*/, '').split(':')[0].slice(0, 60);
  return {
    id:      row.id,
    date:    row.created_at,
    title:   msg.startsWith('[LEARNED]') ? msg.replace('[LEARNED] ', '').split(':')[0].slice(0, 80) : label,
    source:  isYT ? 'youtube' : row.type === 'wholesale_research' ? 'daily' : 'manual',
    label:   row.type === 'wholesale_research' ? 'Daily Research' : row.type === 'knowledge_feed' ? 'You Fed This' : 'Notes',
    preview: msg.split(':').slice(1).join(':').trim().slice(0, 180),
    raw:     msg,
  };
}

const TELEGRAM_BOT = 'JarvisLoveraBot';

export function KnowledgeBase() {
  const [entries,   setEntries]   = useState<ParsedEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [filter,    setFilter]    = useState<'all' | 'youtube' | 'daily' | 'manual'>('all');
  const [search,    setSearch]    = useState('');
  const [totalDays, setTotalDays] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await sb
        .from('jarvis_log')
        .select('id, created_at, message, type')
        .in('type', ['knowledge_feed', 'wholesale_research'])
        .order('created_at', { ascending: false })
        .limit(200);

      if (data) {
        const parsed = data.map(parseEntry);
        setEntries(parsed);
        const days = new Set(parsed.map(e => e.date.split('T')[0])).size;
        setTotalDays(days);
      }
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  const filtered = entries.filter(e => {
    if (filter !== 'all' && e.source !== filter) return false;
    if (search && !e.title.toLowerCase().includes(search.toLowerCase()) && !e.preview.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const youtubeCount = entries.filter(e => e.source === 'youtube').length;
  const dailyCount   = entries.filter(e => e.source === 'daily').length;
  const manualCount  = entries.filter(e => e.source === 'manual').length;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold text-textb">Knowledge Base</h1>
          <p className="text-[11px] text-dimtext mt-0.5">
            {entries.length} entries across {totalDays} days — growing daily at 7am
          </p>
        </div>
        <a
          href={`https://t.me/${TELEGRAM_BOT}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all"
          style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80' }}
        >
          <BookOpen size={10} />
          Feed Jarvis
          <ExternalLink size={9} />
        </a>
      </div>

      {/* How to feed instructions */}
      <div
        className="rounded-xl p-4"
        style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.12)' }}
      >
        <div className="text-[10px] font-semibold text-[#a78bfa] mb-2 flex items-center gap-1.5">
          <Lightbulb size={10} /> HOW TO FEED JARVIS KNOWLEDGE
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-[#60a5fa]">
              <Youtube size={10} /> YouTube Videos
            </div>
            <div className="text-[10px] text-dimtext leading-relaxed">
              Paste any YouTube URL in Telegram to <span className="text-white/70 font-medium">@{TELEGRAM_BOT}</span>.
              Jarvis auto-fetches the transcript, extracts insights, saves to this KB.
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-[#4ade80]">
              <FileText size={10} /> Notes & Text
            </div>
            <div className="text-[10px] text-dimtext leading-relaxed">
              Send <span className="text-white/70 font-mono">learn: [paste anything]</span> — course notes, transcripts,
              articles, or ideas. Jarvis summarizes and saves.
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-[#fbbf24]">
              <Clock size={10} /> Auto-Research (7am daily)
            </div>
            <div className="text-[10px] text-dimtext leading-relaxed">
              Every morning Jarvis deep-dives a wholesale topic: negotiation, marketing, VA mgmt, lead ROI, deal analysis, and more.
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Daily Research', count: dailyCount,   color: '#fbbf24', source: 'daily'   as const },
          { label: 'Videos Fed',     count: youtubeCount, color: '#60a5fa', source: 'youtube' as const },
          { label: 'Manual Notes',   count: manualCount,  color: '#4ade80', source: 'manual'  as const },
        ].map(s => (
          <button
            key={s.source}
            onClick={() => setFilter(filter === s.source ? 'all' : s.source)}
            className="rounded-xl p-3 text-left transition-all"
            style={{
              background: filter === s.source ? `${s.color}12` : 'rgba(255,255,255,0.02)',
              border: `1px solid ${filter === s.source ? `${s.color}30` : 'rgba(255,255,255,0.06)'}`,
            }}
          >
            <div className="text-[18px] font-bold" style={{ color: s.color }}>{s.count}</div>
            <div className="text-[9px] text-dimtext mt-0.5">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-dimtext" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search knowledge base..."
          className="w-full pl-8 pr-3 py-2 rounded-lg text-[11px] text-textb placeholder-dimtext outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        />
      </div>

      {/* Entry list */}
      {loading ? (
        <div className="text-center py-12 text-dimtext text-[11px]">Loading knowledge base...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-dimtext text-[11px]">
          {entries.length === 0
            ? 'No entries yet — send a YouTube link or "learn: [text]" to @JarvisLoveraBot to get started'
            : 'No entries match your filter'
          }
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(entry => {
            const isOpen = expanded === entry.id;
            return (
              <div
                key={entry.id}
                className="rounded-xl overflow-hidden transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : entry.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                >
                  {/* Icon */}
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{
                      background: entry.source === 'youtube' ? 'rgba(96,165,250,0.12)'
                        : entry.source === 'daily' ? 'rgba(251,191,36,0.12)'
                        : 'rgba(74,222,128,0.12)',
                    }}
                  >
                    {entry.source === 'youtube' ? <Youtube size={12} style={{ color: '#60a5fa' }} />
                      : entry.source === 'daily' ? <Clock size={12} style={{ color: '#fbbf24' }} />
                      : <FileText size={12} style={{ color: '#4ade80' }} />}
                  </div>

                  {/* Title + preview */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-textb truncate">{entry.title}</span>
                      <span
                        className="flex-shrink-0 text-[8px] px-1.5 py-0.5 rounded"
                        style={{
                          background: entry.source === 'youtube' ? 'rgba(96,165,250,0.1)'
                            : entry.source === 'daily' ? 'rgba(251,191,36,0.1)'
                            : 'rgba(74,222,128,0.1)',
                          color: entry.source === 'youtube' ? '#60a5fa'
                            : entry.source === 'daily' ? '#fbbf24'
                            : '#4ade80',
                        }}
                      >
                        {entry.label}
                      </span>
                    </div>
                    {!isOpen && (
                      <div className="text-[10px] text-dimtext truncate mt-0.5">{entry.preview}</div>
                    )}
                  </div>

                  {/* Date + chevron */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <span className="text-[9px] text-dimtext">
                      {new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    {isOpen ? <ChevronUp size={11} className="text-dimtext" /> : <ChevronDown size={11} className="text-dimtext" />}
                  </div>
                </button>

                {/* Expanded content */}
                {isOpen && (
                  <div
                    className="px-4 pb-4 pt-1 text-[10px] text-dimtext leading-relaxed whitespace-pre-wrap"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    {entry.raw}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
