'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, Thermometer, Snowflake, Phone, MapPin, Clock } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { usePipeline, Lead } from '@/lib/hooks/usePipeline';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

const TABS = ['Pipeline Leads', 'Hot Sellers', 'County Leads'] as const;
type Tab = typeof TABS[number];

const STAGE_COLOR: Record<string, string> = {
  'Hot Follow Up': '#ff3366', 'Warm Follow Up': '#ff8800', 'Decision Pending': '#aa44ff',
  'Contract Sent': '#00ff88', 'Under Contract': '#00cc66', 'New Lead': '#00aaff',
  'Cold Follow Up': '#5a5a88', 'Unresponsive': '#303050',
};

export function LeadIntelligence() {
  const { refreshKey } = useApp();
  const { data, loading } = usePipeline(refreshKey);
  const [tab, setTab] = useState<Tab>('Pipeline Leads');
  const [search, setSearch] = useState('');

  const hot    = data?.stages['Hot Follow Up']   ?? [];
  const warm   = data?.stages['Warm Follow Up']  ?? [];
  const cold   = data?.stages['Cold Follow Up']  ?? [];
  const allLeads = Object.values(data?.stages ?? {}).flat();
  const filtered = allLeads.filter(l =>
    !search || l.name.toLowerCase().includes(search.toLowerCase()) || l.address?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Intel cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <IntelCard label="Hot Sellers"    count={hot.length}  color="#ff3366" icon={<Flame size={18} />} leads={hot.slice(0,3)} />
        <IntelCard label="Warm Leads"     count={warm.length} color="#ff8800" icon={<Thermometer size={18} />} leads={warm.slice(0,3)} />
        <IntelCard label="Cold Follow Up" count={cold.length} color="#00aaff" icon={<Snowflake size={18} />} leads={cold.slice(0,3)} />
        <IntelCard label="Total Pipeline" count={data?.total ?? 0} color="#aa44ff" icon={<Phone size={18} />} leads={[]} />
      </div>

      {/* Search bar */}
      <div className="relative">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search leads by name or address..."
          className="w-full bg-bg3 border border-border2 rounded-sm px-4 py-2.5 text-[11px] font-mono text-jtext placeholder-dimtext focus:outline-none focus:border-nblue/50 transition-colors"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border2">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2 text-[10px] font-orbitron tracking-[1px] uppercase border-b-2 transition-all -mb-px"
            style={{ color: tab === t ? '#00aaff' : '#5a5a80', borderColor: tab === t ? '#00aaff' : 'transparent' }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Table */}
      {tab === 'Pipeline Leads' && (
        <LeadsTable leads={filtered} loading={loading} />
      )}
      {tab === 'Hot Sellers' && (
        <HotSellers leads={hot} />
      )}
      {tab === 'County Leads' && (
        <CountyLeads refreshKey={refreshKey} />
      )}
    </div>
  );
}

function IntelCard({ label, count, color, icon, leads }: { label: string; count: number; color: string; icon: React.ReactNode; leads: Lead[] }) {
  return (
    <GlassCard accent="blue" padding="p-3" hover={false}>
      <div className="flex items-center gap-2 mb-2" style={{ color }}>
        {icon}
        <span className="text-[8px] font-orbitron tracking-[1px] uppercase text-dimtext">{label}</span>
      </div>
      <AnimatedCounter target={count} className="font-orbitron text-[30px] font-black block mb-2" style={{ color } as React.CSSProperties} />
      {leads.map(l => (
        <div key={l.id} className="text-[9px] text-dimtext truncate py-0.5 border-t border-border first:border-0">{l.name}</div>
      ))}
    </GlassCard>
  );
}

function LeadsTable({ leads, loading }: { leads: Lead[]; loading: boolean }) {
  if (loading) return <div className="text-dimtext text-[11px] italic py-8 text-center animate-pulse">Loading leads...</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="border-b border-border2">
            {['Name', 'Address', 'Stage', 'Phone', 'Days', 'Updated'].map(h => (
              <th key={h} className="text-left py-2 px-3 font-orbitron text-[8px] text-dimtext tracking-[1px] uppercase sticky top-0 bg-bg">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.slice(0, 100).map(lead => {
            const sc = STAGE_COLOR[lead.stage] || '#5a5a80';
            return (
              <tr key={lead.id} className="border-b border-border hover:bg-bg3 transition-colors">
                <td className="py-2 px-3 text-textb font-bold">{lead.name}</td>
                <td className="py-2 px-3 text-dimtext max-w-[160px] truncate">{lead.address}</td>
                <td className="py-2 px-3">
                  <span className="text-[8px] px-1.5 py-0.5 rounded-sm whitespace-nowrap" style={{ background: `${sc}15`, color: sc, border: `1px solid ${sc}25` }}>{lead.stage}</span>
                </td>
                <td className="py-2 px-3 text-dimtext">{lead.phone}</td>
                <td className="py-2 px-3 text-dimtext">{lead.daysInStage ?? '—'}</td>
                <td className="py-2 px-3 text-dimtext">{lead.updatedAt ? timeAgo(lead.updatedAt) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {leads.length === 0 && <div className="text-dimtext text-[11px] italic py-8 text-center">No leads found</div>}
    </div>
  );
}

function HotSellers({ leads }: { leads: Lead[] }) {
  if (leads.length === 0) return <div className="text-dimtext text-[11px] italic py-8 text-center">No hot sellers right now</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {leads.map(l => (
        <GlassCard key={l.id} accent="red" padding="p-3" hover={false}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="font-orbitron text-[12px] font-bold text-textb">{l.name}</div>
              <div className="text-[9px] text-dimtext mt-0.5">{l.phone}</div>
            </div>
            <div className="text-right">
              <div className="font-orbitron text-[11px] text-nred">{l.daysInStage ?? 0}d in stage</div>
            </div>
          </div>
          {l.address && <div className="flex items-center gap-1 text-[9px] text-dimtext mb-2"><MapPin size={9} /> {l.address}</div>}
          {l.lastNote && <div className="text-[9px] text-dimtext italic border-t border-border pt-2 line-clamp-2">"{l.lastNote}"</div>}
          {l.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {l.tags.slice(0, 5).map(t => (
                <span key={t} className="text-[8px] px-1.5 py-0.5 rounded-sm bg-nred/10 text-nred border border-nred/20">{t}</span>
              ))}
            </div>
          )}
        </GlassCard>
      ))}
    </div>
  );
}

function CountyLeads({ refreshKey }: { refreshKey: number }) {
  const [loading, setLoading] = useState(false);
  return (
    <div className="text-dimtext text-[11px] italic py-8 text-center">
      County leads data loads from <code className="text-ncyan">county_leads</code> Supabase table
    </div>
  );
}
