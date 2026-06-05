'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Phone, Clock, Tag, ChevronDown } from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { usePipeline, Lead } from '@/lib/hooks/usePipeline';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

const STAGE_COLORS: Record<string, string> = {
  'Hot Follow Up':       '#ff3366',
  'Warm Follow Up':      '#ff8800',
  'Decision Pending':    '#aa44ff',
  'Contract Sent':       '#00ff88',
  'Under Contract':      '#00cc66',
  'New Lead':            '#00aaff',
  'Cold Follow Up':      '#5a5a88',
  'Attempt 1':           '#484870',
  'Attempt 2':           '#404068',
  'Attempt 3-5':         '#383858',
  'Unresponsive':        '#303050',
  'Closed':              '#ffd700',
  'Signed w/ Someone Else': '#5a5a80',
  'Disposition':         '#5a5a80',
  'Dead':                '#2a2a44',
};

const ORDER = [
  'Decision Pending','Contract Sent','Under Contract',
  'Hot Follow Up','Warm Follow Up','New Lead',
  'Cold Follow Up','Attempt 1','Attempt 2','Attempt 3-5',
  'Unresponsive','Closed','Signed w/ Someone Else','Disposition','Dead',
];

export function Pipeline() {
  const { refreshKey } = useApp();
  const { data, loading, error } = usePipeline(refreshKey);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) return <LoadState />;
  if (error)   return <ErrorState msg={error} />;
  if (!data)   return null;

  return (
    <div className="flex flex-col gap-5">
      {/* Summary bar */}
      <GlassCard accent="purple" padding="p-4">
        <div className="flex items-center justify-between mb-1">
          <SectionTitle accent="purple" badge={`${data.total} Total Leads`}>Pipeline</SectionTitle>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {['Decision Pending','Contract Sent','Hot Follow Up','Warm Follow Up','New Lead'].map(s => {
            const c = STAGE_COLORS[s];
            const n = data.stages[s]?.length ?? 0;
            return (
              <div key={s} className="text-center p-2 rounded-sm border" style={{ background: `${c}08`, borderColor: `${c}20` }}>
                <AnimatedCounter target={n} className="font-orbitron text-[24px] font-black block" style={{ color: c } as React.CSSProperties} />
                <div className="text-[8px] text-dimtext mt-1">{s}</div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Kanban columns */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {ORDER.map(stage => {
          const leads  = data.stages[stage] ?? [];
          const color  = STAGE_COLORS[stage] ?? '#5a5a80';
          const isOpen = expanded === stage;

          return (
            <motion.div
              key={stage}
              layout
              className="rounded-sm border overflow-hidden"
              style={{ background: 'rgba(10,10,20,0.8)', borderColor: `${color}25` }}
            >
              {/* Column header */}
              <button
                className="w-full flex items-center gap-2 px-3 py-2.5 border-b text-left"
                style={{ borderColor: `${color}20`, background: `${color}08` }}
                onClick={() => setExpanded(isOpen ? null : stage)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-orbitron text-[8px] font-bold truncate" style={{ color }}>{stage}</div>
                  <AnimatedCounter target={leads.length} className="font-orbitron text-[20px] font-black block leading-tight" style={{ color } as React.CSSProperties} />
                </div>
                <ChevronDown size={12} style={{ color, transform: isOpen ? 'rotate(180deg)' : 'none', transition: '.2s' }} />
              </button>

              {/* Lead previews */}
              <div className="p-2 flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                {leads.slice(0, isOpen ? 20 : 4).map(lead => (
                  <LeadCard key={lead.id} lead={lead} color={color} />
                ))}
                {leads.length === 0 && (
                  <div className="text-[9px] text-dimtext italic py-2 text-center">Empty</div>
                )}
                {!isOpen && leads.length > 4 && (
                  <button
                    className="text-[8px] text-dimtext py-1 text-center hover:text-jtext"
                    onClick={() => setExpanded(stage)}
                  >
                    +{leads.length - 4} more
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function LeadCard({ lead, color }: { lead: Lead; color: string }) {
  return (
    <div className="p-2 rounded-sm border text-[10px]" style={{ background: `${color}06`, borderColor: `${color}18` }}>
      <div className="text-textb font-bold truncate mb-0.5">{lead.name}</div>
      {lead.address && <div className="text-dimtext text-[9px] truncate mb-0.5">{lead.address}</div>}
      <div className="flex items-center gap-2 text-[8px] text-dimtext">
        {lead.daysInStage != null && <span className="flex items-center gap-0.5"><Clock size={7} />{lead.daysInStage}d</span>}
        {lead.phone && <span className="flex items-center gap-0.5"><Phone size={7} />{lead.phone}</span>}
      </div>
      {lead.lastNote && (
        <div className="text-[9px] text-dimtext mt-1 italic line-clamp-2">"{lead.lastNote.slice(0, 80)}"</div>
      )}
    </div>
  );
}

function LoadState() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-[11px] text-dimtext animate-pulse font-orbitron tracking-[2px]">Loading pipeline data...</div>
    </div>
  );
}

function ErrorState({ msg }: { msg: string }) {
  return (
    <GlassCard accent="red" padding="p-6">
      <div className="text-nred text-[11px] font-orbitron">Pipeline Error: {msg}</div>
    </GlassCard>
  );
}
