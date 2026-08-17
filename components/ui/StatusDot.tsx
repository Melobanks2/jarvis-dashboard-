'use client';

import clsx from 'clsx';

type Status = 'online' | 'idle' | 'offline';

const COLOR: Record<Status, string> = {
  online:  '#30d158',
  idle:    '#ff9f0a',
  offline: 'rgba(235,235,245,0.25)',
};

export function StatusDot({ status, label, size = 'md' }: { status: Status; label?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = { sm: 'w-1.5 h-1.5', md: 'w-2 h-2', lg: 'w-2.5 h-2.5' }[size];
  const c  = COLOR[status];
  return (
    <span className="inline-flex items-center gap-2">
      <span className={clsx('rounded-full flex-shrink-0', sz)} style={{ background: c }} />
      {label && <span className="text-[12px] text-dimtext">{label}</span>}
    </span>
  );
}
