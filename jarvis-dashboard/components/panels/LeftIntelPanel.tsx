'use client';

import { motion } from 'framer-motion';
import { useAgents } from '@/lib/hooks/useAgents';
import { useCalls } from '@/lib/hooks/useCalls';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

const STATUS_DOT: Record<string, string> = {
  active:  '#4ade80',
  idle:    '#fbbf24',
  offline: '#2a2a3e',
};

export function LeftIntelPanel() {
  const { refreshKey } = useApp();
  const { agents }     = useAgents(refreshKey);
  const { calls }      = useCalls(refreshKey);

  const answered = calls.filter(c => c.call_duration > 10).length;
  const hot      = calls.filter(c => c.stage_after === 'Hot Follow Up' && c.stage_before !== 'Hot Follow Up').length;

  return (
    <div
      className="hidden lg:flex flex-col flex-shrink-0 overflow-y-auto"
      style={{
        width: 256,
        borderRight: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(11,12,19,0.60)',
      }}
    >
      <div className="px-5 py-6 flex flex-col gap-7">

        {/* Agent Status */}
        <Section label="Agent Status">
          {/* Jarvis chief */}
          <div className="flex items-center gap-3 py-1">
            <div className="relative">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px]"
                style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.2)' }}>
                👑
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-ngreen border border-bg"
                style={{ boxShadow: '0 0 4px rgba(74,222,128,0.6)' }} />
            </div>
            <div className="flex-1">
              <div className="text-[12px] font-medium text-textb leading-none">Jarvis</div>
              <div className="text-[10px] text-dimtext mt-0.5">Chief of Staff</div>
            </div>
            <span className="text-[9px] font-medium rounded-full px-2 py-0.5"
              style={{ background: 'rgba(74,222,128,0.10)', color: '#4ade80' }}>Live</span>
          </div>

          <div className="mt-1 flex flex-col gap-1">
            {agents.map(a => (
              <motion.div key={a.key} className="flex items-center gap-3 py-1.5 rounded-md px-2 -mx-2 transition-colors hover:bg-white/[0.025]">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: STATUS_DOT[a.status], boxShadow: a.status !== 'offline' ? `0 0 5px ${STATUS_DOT[a.status]}50` : 'none' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-jtext truncate">{a.name}</div>
                  {a.lastActivity && (
                    <div className="text-[9px] text-dimtext">{timeAgo(a.lastActivity)}</div>
                  )}
                </div>
                <span className="text-[9px] text-dimtext flex-shrink-0 font-mono">{a.runCount}</span>
              </motion.div>
            ))}
          </div>
        </Section>

        <Divider />

        {/* Today's Performance */}
        <Section label="Today">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Calls"          value={calls.length}   color="#67e8f9" />
            <Metric label="Answered"       value={answered}       color="#4ade80" />
            <Metric label="Hot Found"      value={hot}            color="#f87171" />
            <Metric label="In Pipeline"    value="—"              color="#a78bfa" />
          </div>
        </Section>

        <Divider />

        {/* System Health */}
        <Section label="System Health">
          <div className="flex flex-col gap-2">
            <Health label="Supabase DB"    ok />
            <Health label="GHL CRM"        ok />
            <Health label="Telegram Bot"   ok />
            <Health label="ElevenLabs"     ok />
          </div>
        </Section>

        {/* Recent calls */}
        {calls.length > 0 && (
          <>
            <Divider />
            <Section label="Recent Calls">
              <div className="flex flex-col gap-2">
                {calls.slice(0, 4).map(c => (
                  <div key={c.id} className="flex items-center gap-2.5">
                    <div className="w-1 h-1 rounded-full bg-ncyan flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-jtext truncate">{c.contact_name || 'Unknown'}</div>
                    </div>
                    <span className="text-[10px] text-dimtext font-mono flex-shrink-0">
                      {Math.floor(c.call_duration / 60)}:{String(c.call_duration % 60).padStart(2,'0')}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px] mb-3">{label}</p>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-white/[0.045]" />;
}

function Metric({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div>
      <div className="font-orbitron text-[20px] font-bold leading-none" style={{ color }}>{value}</div>
      <div className="text-[9px] text-dimtext mt-1 font-medium">{label}</div>
    </div>
  );
}

function Health({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-jtext">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full"
          style={{ background: ok ? '#4ade80' : '#f87171', boxShadow: ok ? '0 0 4px rgba(74,222,128,0.5)' : '0 0 4px rgba(248,113,113,0.5)' }} />
        <span className="text-[9px] font-medium" style={{ color: ok ? '#4ade80' : '#f87171' }}>{ok ? 'Operational' : 'Down'}</span>
      </div>
    </div>
  );
}
