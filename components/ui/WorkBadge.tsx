'use client';

// One status vocabulary used everywhere (Scout HQ, Sarah HQ, the fleet):
//   working = process up AND actively doing its job
//   standby = process up, ready, not actively working right now
//   off     = process not running
export type WorkStatus = 'working' | 'standby' | 'off' | 'unknown';

const CFG: Record<WorkStatus, { c: string; label: string }> = {
  working: { c: '#4ade80', label: 'WORKING' },
  standby: { c: '#fbbf24', label: 'STANDBY' },
  off:     { c: '#ff3366', label: 'OFF' },
  unknown: { c: '#52526e', label: '···' },
};

export function WorkBadge({ status, sub, title }: { status: WorkStatus; sub?: string; title?: string }) {
  const cfg = CFG[status];
  const lit = status === 'working' || status === 'standby';
  return (
    <div className="flex items-center gap-1.5" title={title || sub || status}>
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: cfg.c, boxShadow: lit ? `0 0 8px ${cfg.c}` : 'none' }}
      />
      <span className="text-[10px] font-orbitron tracking-[1px]" style={{ color: cfg.c }}>{cfg.label}</span>
      {sub && <span className="text-[9px] hidden sm:inline" style={{ color: '#8888aa' }}>· {sub}</span>}
    </div>
  );
}
