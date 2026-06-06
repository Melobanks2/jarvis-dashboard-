'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, Phone, PhoneOff, Clock, Flame,
  Calendar, BarChart3, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CallRecord {
  timestamp: string;
  disposition: 'hot' | 'warm' | 'cold' | 'no_answer' | 'wrong_number' | 'refund';
  duration: number;
  handoff: boolean;
  leadName: string;
}

interface CallReviewEntry {
  id: string;
  timestamp: string;
  leadName: string;
  leadPhone: string;
  disposition: string;
  callDuration: number;
  transcript: string;
  scriptNode: string;
  audioUrl?: string;
  notes: string;
}

type TimeRange = 'today' | '7d' | '30d' | 'all';

// ── Demo Data Generator ───────────────────────────────────────────────────────

function generateDemoData(): CallRecord[] {
  const records: CallRecord[] = [];
  const dispositions: CallRecord['disposition'][] = ['hot', 'warm', 'cold', 'no_answer', 'wrong_number', 'refund'];
  const names = ['Denise H.', 'Marcus W.', 'Sandra R.', 'James L.', 'Patricia K.', 'Robert M.', 'Angela T.', 'Kevin D.', 'Maria S.', 'David P.'];

  for (let i = 0; i < 60; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const hoursAgo = Math.floor(Math.random() * 12);
    const ts = new Date(Date.now() - daysAgo * 86400000 - hoursAgo * 3600000);
    const disp = dispositions[Math.floor(Math.random() * dispositions.length)];
    records.push({
      timestamp: ts.toISOString(),
      disposition: disp,
      duration: disp === 'no_answer' ? 0 : Math.floor(Math.random() * 600) + 30,
      handoff: disp === 'hot' || (disp === 'warm' && Math.random() > 0.5),
      leadName: names[Math.floor(Math.random() * names.length)],
    });
  }
  return records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function filterByRange(data: CallRecord[], range: TimeRange): CallRecord[] {
  const now = Date.now();
  const cutoff = range === 'today' ? now - 86400000
    : range === '7d' ? now - 7 * 86400000
    : range === '30d' ? now - 30 * 86400000
    : 0;
  return data.filter(r => new Date(r.timestamp).getTime() >= cutoff);
}

function fmtDuration(s: number): string {
  if (s === 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-3 py-2 text-[10px]"
      style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
      <div className="text-[9px] font-orbitron tracking-wider mb-1" style={{ color: '#52526e' }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: '#c4c4d6' }}>{p.name}:</span>
          <span className="font-bold" style={{ color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Metric Card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, change, color, icon: Icon }: {
  label: string; value: string | number; change?: number; color: string; icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-2"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
            <Icon size={14} style={{ color }} />
          </div>
          <span className="text-[9px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>{label}</span>
        </div>
        {change !== undefined && (
          <div className="flex items-center gap-0.5" style={{ color: change >= 0 ? '#4ade80' : '#f87171' }}>
            {change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            <span className="text-[9px] font-bold">{Math.abs(change)}%</span>
          </div>
        )}
      </div>
      <div className="font-orbitron text-[24px] font-black" style={{ color }}>{value}</div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function PerformanceAnalytics() {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');

  const rawData = useMemo(() => generateDemoData(), []);
  const data = useMemo(() => filterByRange(rawTimeData(rawTimeRange(rawData, timeRange), timeRange), timeRange), [rawData, timeRange]);

  // Chart data: group by day
  const chartData = useMemo(() => {
    const grouped: Record<string, { total: number; connected: number; hot: number; handoffs: number; day: string }> = {};
    data.forEach(r => {
      const d = new Date(r.timestamp);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      if (!grouped[key]) grouped[key] = { total: 0, connected: 0, hot: 0, handoffs: 0, day: key };
      grouped[key].total++;
      if (r.disposition !== 'no_answer' && r.disposition !== 'wrong_number') grouped[key].connected++;
      if (r.disposition === 'hot') grouped[key].hot++;
      if (r.handoff) grouped[key].handoffs++;
    });
    return Object.values(grouped);
  }, [data]);

  // Disposition breakdown
  const dispositionData = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(r => { counts[r.disposition] = (counts[r.disposition] || 0) + 1; });
    return [
      { name: 'Hot', count: counts.hot || 0, color: '#ff3366' },
      { name: 'Warm', count: counts.warm || 0, color: '#ff8800' },
      { name: 'Cold', count: counts.cold || 0, color: '#60a5fa' },
      { name: 'No Answer', count: counts.no_answer || 0, color: '#52526e' },
      { name: 'Wrong #', count: counts.wrong_number || 0, color: '#fbbf24' },
      { name: 'Refund', count: counts.refund || 0, color: '#a78bfa' },
    ];
  }, [data]);

  // Summary stats
  const totalCalls = data.length;
  const connectedCount = data.filter(r => r.disposition !== 'no_answer' && r.disposition !== 'wrong_number').length;
  const hotCount = data.filter(r => r.disposition === 'hot').length;
  const handoffCount = data.filter(r => r.handoff).length;
  const avgDuration = connectedCount > 0
    ? Math.round(data.filter(r => r.duration > 0).reduce((s, r) => s + r.duration, 0) / connectedCount)
    : 0;
  const convRate = totalCalls > 0 ? ((connectedCount / totalCalls) * 100).toFixed(1) : '0';
  const handoffRate = connectedCount > 0 ? ((handoffCount / connectedCount) * 100).toFixed(1) : '0';

  const RANGES: { id: TimeRange; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 Days' },
    { id: '30d', label: '30 Days' },
    { id: 'all', label: 'All Time' },
  ];

  return (
    <div className="space-y-5">
      {/* Time Range Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} style={{ color: '#00e5ff' }} />
          <span className="text-[11px] font-orbitron tracking-[1.5px] uppercase font-bold" style={{ color: '#c4c4d6' }}>
            Performance Analytics
          </span>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          {RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setTimeRange(r.id)}
              className="px-3 py-1.5 rounded-md text-[10px] font-medium transition-all"
              style={{
                background: timeRange === r.id ? 'rgba(0,229,255,0.12)' : 'transparent',
                border: timeRange === r.id ? '1px solid rgba(0,229,255,0.25)' : '1px solid transparent',
                color: timeRange === r.id ? '#00e5ff' : '#52526e',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Total Calls" value={totalCalls} color="#00e5ff" icon={Phone} />
        <MetricCard label="Connected" value={connectedCount} change={12} color="#4ade80" icon={TrendingUp} />
        <MetricCard label="Hot Leads" value={hotCount} color="#ff3366" icon={Flame} />
        <MetricCard label="Avg Duration" value={fmtDuration(avgDuration)} color="#a78bfa" icon={Clock} />
      </div>

      {/* Call Volume Chart */}
      <div className="rounded-2xl p-4"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>
            Call Volume & Connections
          </div>
          <div className="flex items-center gap-4 text-[9px]">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: '#00e5ff' }} />
              <span style={{ color: '#52526e' }}>Total Calls</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: '#4ade80' }} />
              <span style={{ color: '#52526e' }}>Connected</span>
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="gradCyan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00e5ff" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#00e5ff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#52526e' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: '#52526e' }} axisLine={false} tickLine={false} />
            <Tooltip content={<DarkTooltip />} />
            <Area type="monotone" dataKey="total" name="Total" stroke="#00e5ff" fill="url(#gradCyan)" strokeWidth={2} />
            <Area type="monotone" dataKey="connected" name="Connected" stroke="#4ade80" fill="url(#gradGreen)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Disposition Breakdown + Handoff Rate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Disposition Bar Chart */}
        <div className="rounded-2xl p-4"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[10px] font-orbitron tracking-[1.5px] uppercase mb-4" style={{ color: '#52526e' }}>
            Disposition Breakdown
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dispositionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#52526e' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#52526e' }} axisLine={false} tickLine={false} />
              <Tooltip content={<DarkTooltip />} />
              <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
                {dispositionData.map((entry, idx) => (
                  <rect key={idx} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Handoff Rate Over Time */}
        <div className="rounded-2xl p-4"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-orbitron tracking-[1.5px] uppercase" style={{ color: '#52526e' }}>
              Handoff Rate
            </div>
            <div className="text-[12px] font-orbitron font-bold" style={{ color: '#fbbf24' }}>
              {handoffRate}%
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#52526e' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#52526e' }} axisLine={false} tickLine={false} />
              <Tooltip content={<DarkTooltip />} />
              <Line type="monotone" dataKey="handoffs" name="Handoffs" stroke="#fbbf24" strokeWidth={2} dot={{ fill: '#fbbf24', r: 3 }} />
              <Line type="monotone" dataKey="hot" name="Hot Leads" stroke="#ff3366" strokeWidth={2} dot={{ fill: '#ff3366', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Conversion Rate + Hot Leads Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-4"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[9px] font-orbitron tracking-[1.5px] uppercase mb-1" style={{ color: '#52526e' }}>
            Conversion Rate
          </div>
          <div className="flex items-end gap-2">
            <span className="font-orbitron text-[28px] font-black" style={{ color: '#4ade80' }}>{convRate}%</span>
            <span className="text-[10px] mb-1" style={{ color: '#52526e' }}>connected / dialed</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: `${convRate}%`, background: 'linear-gradient(90deg, #4ade80, #00e5ff)' }} />
          </div>
        </div>
        <div className="rounded-xl p-4"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[9px] font-orbitron tracking-[1.5px] uppercase mb-1" style={{ color: '#52526e' }}>
            Handoff Rate
          </div>
          <div className="flex items-end gap-2">
            <span className="font-orbitron text-[28px] font-black" style={{ color: '#fbbf24' }}>{handoffRate}%</span>
            <span className="text-[10px] mb-1" style={{ color: '#52526e' }}>of connected → Jarvis</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: `${handoffRate}%`, background: 'linear-gradient(90deg, #fbbf24, #ff8800)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helper to compute time-filtered data ──────────────────────────────────────
function rawTimeData(rawData: CallRecord[], _range: TimeRange): CallRecord[] {
  return rawData;
}
function rawTimeRange(rawData: CallRecord[], _range: TimeRange): CallRecord[] {
  return rawData;
}