'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';

type Accent = 'green' | 'gold' | 'cyan' | 'blue' | 'purple' | 'orange' | 'red';

const ACCENT_COLOR: Record<Accent, string> = {
  green:  '#00ff88',
  gold:   '#ffd700',
  cyan:   '#00e5ff',
  blue:   '#00aaff',
  purple: '#aa44ff',
  orange: '#ff8800',
  red:    '#ff3366',
};

interface Props extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: React.ReactNode;
  accent?: Accent;
  hover?: boolean;
  padding?: string;
}

export function GlassCard({ children, accent = 'green', hover = true, padding = 'p-4', className, ...rest }: Props) {
  const c = ACCENT_COLOR[accent];
  return (
    <motion.div
      className={clsx(
        'relative overflow-hidden rounded-sm border border-border2',
        padding,
        hover && 'cursor-default',
        className
      )}
      style={{ background: 'rgba(12,12,24,0.85)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
      whileHover={hover ? { y: -2, boxShadow: `0 8px 32px ${c}18` } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      {...rest}
    >
      {/* Accent top line */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg,transparent,${c} 30%,${c} 70%,transparent)`, opacity: 0.55 }} />
      {/* Corner TL */}
      <div className="absolute top-0 left-0 w-3.5 h-3.5" style={{ borderTop: `1px solid ${c}`, borderLeft: `1px solid ${c}`, opacity: 0.45 }} />
      {/* Corner BR */}
      <div className="absolute bottom-0 right-0 w-3.5 h-3.5" style={{ borderBottom: `1px solid ${c}`, borderRight: `1px solid ${c}`, opacity: 0.45 }} />
      {children}
    </motion.div>
  );
}

export function SectionTitle({ children, accent = 'green', badge }: { children: React.ReactNode; accent?: Accent; badge?: string }) {
  const c = ACCENT_COLOR[accent];
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="w-1 h-4 rounded-sm" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
      <span className="font-orbitron text-[10px] font-bold tracking-[3px] uppercase" style={{ color: c }}>{children}</span>
      {badge && <span className="ml-auto text-[9px] text-dimtext border border-border2 px-2 py-0.5 rounded-sm bg-bg3 font-orbitron tracking-wider">{badge}</span>}
    </div>
  );
}
