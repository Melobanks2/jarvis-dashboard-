'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';

type Accent = 'green' | 'gold' | 'cyan' | 'blue' | 'purple' | 'orange' | 'red';

// Apple system colors on dark. Blue is the identity accent; the rest are
// semantic (green = positive, red = urgent, orange = warning).
const ACCENT_COLOR: Record<Accent, string> = {
  green:  '#30d158',
  gold:   '#ff9f0a',
  cyan:   '#64d2ff',
  blue:   '#0a84ff',
  purple: '#bf5af2',
  orange: '#ff9f0a',
  red:    '#ff453a',
};

// iOS-style spring — quick, settles without wobble.
const SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const;

interface Props extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: React.ReactNode;
  accent?: Accent;
  hover?: boolean;
  padding?: string;
}

// Liquid Glass panel: translucent wash + backdrop blur + saturation boost,
// specular top edge, continuous 22px radius. The ambient field painted by
// body::before is what the blur refracts — without it this reads flat.
export function GlassCard({ children, accent = 'blue', hover = true, padding = 'p-5', className, ...rest }: Props) {
  return (
    <motion.div
      className={clsx('glass relative overflow-hidden rounded-[22px]', padding, className)}
      whileHover={hover ? { backgroundColor: 'rgba(255,255,255,0.085)', y: -1 } : undefined}
      transition={SPRING}
      {...rest}
    >
      {/* Soft light falling on the upper half of the pane. Absolutely
          positioned so it never participates in the card's flex/grid layout —
          children stay direct descendants and layout classNames pass through. */}
      <div className="absolute inset-x-0 top-0 h-1/2 pointer-events-none rounded-t-[22px]"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent)' }} />
      {children}
    </motion.div>
  );
}

export function SectionTitle({ children, accent = 'blue', badge }: { children: React.ReactNode; accent?: Accent; badge?: string }) {
  const c = ACCENT_COLOR[accent];
  return (
    <div className="flex items-baseline gap-2.5 mb-4">
      <span className="text-[16px] font-semibold tracking-[-0.02em] text-textb">{children}</span>
      {badge && (
        <span className="ml-auto text-[12px] text-dimtext border border-border rounded-full px-2.5 py-0.5"
          style={{ background: 'rgba(255,255,255,0.05)' }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// Pill button/badge in the same material language.
export function GlassPill({ children, color, onClick, className }: {
  children: React.ReactNode; color?: string; onClick?: () => void; className?: string;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag onClick={onClick}
      className={clsx('inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12px] bg-white/[0.06]',
        onClick && 'tap hover:bg-white/10 cursor-pointer', className)}
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)', color: color || 'rgba(235,235,245,0.62)' }}>
      {children}
    </Tag>
  );
}
