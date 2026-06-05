'use client';

import clsx from 'clsx';

type Status = 'online' | 'idle' | 'offline';

const COLOR: Record<Status, string> = {
  online:  '#00ff88',
  idle:    '#ffd700',
  offline: '#333355',
};

export function StatusDot({ status, label, size = 'md' }: { status: Status; label?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = { sm: 'w-1.5 h-1.5', md: 'w-2 h-2', lg: 'w-2.5 h-2.5' }[size];
  const c  = COLOR[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={clsx('rounded-full flex-shrink-0', sz, status === 'online' && 'animate-blink')}
        style={{ background: c, boxShadow: status !== 'offline' ? `0 0 6px ${c}` : 'none' }}
      />
      {label && <span className="font-mono text-[10px] uppercase tracking-wider text-dimtext">{label}</span>}
    </span>
  );
}
