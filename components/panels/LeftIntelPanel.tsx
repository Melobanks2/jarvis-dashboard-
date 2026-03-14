'use client';

import { motion } from 'framer-motion';
import { useAgents } from '@/lib/hooks/useAgents';
import { useCalls } from '@/lib/hooks/useCalls';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

const STATUS_COLOR = { active: '#00ff88', idle: '#ffd700', offline: '#2a2a46' };

export function LeftIntelPanel() {
  const { refreshKey } = useApp();
  const { agents }     = useAgents(refreshKey);
  const { calls }      = useCalls(refreshKey);

  const answered   = calls.filter(c => c.call_duration > 10).length;
  const hot        = calls.filter(c => c.stage_after === 'Hot Follow Up' && c.stage_before !== 'Hot Follow Up').length;

  return (
    <div
      className="hidden lg:flex flex-col overflow-y-auto flex-shrink-0"
      style={{
        width: 260,
        background: 'rgba(8,8,20,0.55)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div className="flex flex-col gap-0 py-6 px-5">

        {/* Agent Status */}
        <Module label="Agent Status">
          <div className="flex flex-col gap-2.5">
            {/* Chief */}
            <div className="flex items-center gap-2.5">
              <div className="relative flex-shrink-0">
                <span className="w-2 h-2 rounded-full block bg-ngreen" style={{ boxShadow: '0 0 8px #00ff88' }} />
                <span className="absolute inset-0 rounded-full animate-ping bg-ngreen opacity-30" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] text-textb font-mono">Jarvis</div>
                <div className="text-[8px] text-dimtext tracking-wide">Chief of Staff</div>
              </div>
              <span className="text-[8px] font-orbitron text-ngreen tracking-[1px]">ACTIVE</span>
            </div>

            {/* Sub-agents */}
            {agents.map(a => (
              <motion.div key={a.key} className="flex items-center gap-2.5" whileHover={{ x: 2 }}>
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: STATUS_COLOR[a.status],
                    boxShadow: a.status !== 'offline' ? `0 0 6px ${STATUS_COLOR[a.status]}` : 'none',
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-jtext truncate font-mono">{a.name}</div>
                </div>
                <span
                  className="text-[7px] font-orbitron tracking-[1px] uppercase flex-shrink-0"
                  style={{ color: STATUS_COLOR[a.status] }}
                >
                  {a.status}
                </span>
              </motion.div>
            ))}
          </div>
        </Module>

        <Divider />

        {/* Today's Performance */}
        <Module label="Today's Performance">
          <div className="flex flex-col gap-3">
            <PerfRow label="Calls Made"      value={calls.length} color="#00e5ff" />
            <PerfRow label="Sellers Reached" value={answered}     color="#00ff88" />
            <PerfRow label="Hot Leads Found" value={hot}          color="#ff3366" />
            <PerfRow label="In Pipeline"     value="—"            color="#aa44ff" />
          </div>
        </Module>

        <Divider />

        {/* System Health */}
        <Module label="System Health">
          <div className="flex flex-col gap-2">
            <HealthRow label="Supabase"    ok />
            <HealthRow label="GHL CRM"     ok />
            <HealthRow label="Telegram Bot" ok />
            <HealthRow label="ElevenLabs"  ok />
          </div>
        </Module>

        <Divider />

        {/* Last Calls */}
        {calls.length > 0 && (
          <Module label="Recent Calls">
            <div className="flex flex-col gap-2">
              {calls.slice(0, 4).map(c => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-ncyan flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-jtext truncate">{c.contact_name || 'Unknown'}</div>
                    <div className="text-[8px] text-dimtext">{timeAgo(c.called_at)}</div>
                  </div>
                  <span className="text-[9px] text-ncyan font-mono flex-shrink-0">
                    {Math.floor(c.call_duration / 60)}:{String(c.call_duration % 60).padStart(2, '0')}
                  </span>
                </div>
              ))}
            </div>
          </Module>
        )}
      </div>
    </div>
  );
}

function Module({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-px bg-ngreen/40" />
        <span className="text-[8px] font-orbitron tracking-[2.5px] uppercase text-dimtext">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-white/[0.04]" />;
}

function PerfRow({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-dimtext font-mono">{label}</span>
      <span className="font-orbitron text-[13px] font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function HealthRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-dimtext font-mono">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: ok ? '#00ff88' : '#ff3366', boxShadow: ok ? '0 0 5px #00ff88' : '0 0 5px #ff3366' }} />
        <span className="text-[8px] font-orbitron tracking-[1px]" style={{ color: ok ? '#00ff88' : '#ff3366' }}>{ok ? 'OK' : 'DOWN'}</span>
      </div>
    </div>
  );
}
