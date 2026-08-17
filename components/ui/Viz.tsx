'use client';

import { motion } from 'framer-motion';

/**
 * Small chart primitives in the Liquid Glass language.
 *
 * Hand-rolled SVG rather than recharts: these render inline inside chat
 * bubbles and stat strips, where recharts' own margins, tooltips and axis
 * chrome fight the glass material. Everything here is layout-free — the caller
 * owns the container.
 */

const SPRING = { type: 'spring', stiffness: 260, damping: 30 } as const;

export type Unit = 'count' | 'money' | 'days';

export interface Slice { label: string; value: number; color: string; sub?: string }
export interface Tile { label: string; value: string; color: string; note?: string }

export const fmtValue = (n: number, unit: Unit = 'count') =>
  unit === 'money' ? '$' + Math.round(n).toLocaleString()
  : unit === 'days' ? `${Math.round(n)}d`
  : Math.round(n).toLocaleString();

/** Horizontal ranked bars. The workhorse — stages, sources, ages, money. */
export function BarList({ slices, unit = 'count', max: maxIn, labelWidth = 118 }: {
  slices: Slice[]; unit?: Unit; max?: number; labelWidth?: number;
}) {
  const max = maxIn ?? Math.max(1, ...slices.map(s => s.value));
  return (
    <div className="flex flex-col gap-1.5">
      {slices.map((s, i) => (
        <div key={`${s.label}-${i}`} className="flex items-center gap-3">
          <span className="flex-shrink-0 min-w-0" style={{ width: labelWidth }} title={s.label}>
            <span className="block text-[12px] text-jtext truncate">{s.label}</span>
            {s.sub && <span className="block text-[10px] text-dimtext truncate">{s.sub}</span>}
          </span>
          <div className="flex-1 h-[18px] rounded-md bg-white/[0.05] overflow-hidden min-w-[40px]">
            <motion.div
              className="h-full rounded-md"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, (s.value / max) * 100)}%` }}
              transition={{ ...SPRING, delay: i * 0.03 }}
              style={{
                background: `linear-gradient(90deg, ${s.color}, ${s.color}66)`,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)',
              }}
            />
          </div>
          <span className="text-[12px] font-semibold flex-shrink-0 text-right w-[62px]"
            style={{ color: s.color, fontVariantNumeric: 'tabular-nums' }}>
            {fmtValue(s.value, unit)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Ring with a legend. Used for mixes that should add up to a whole. */
export function Donut({ slices, centerValue, centerLabel, size = 128 }: {
  slices: Slice[]; centerValue: string; centerLabel: string; size?: number;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const stroke = 13;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  // Offsets are computed, not animated: animating strokeDashoffset from zero
  // makes every segment sweep through the same arc and reads as a glitch.
  let acc = 0;
  const arcs = slices.filter(s => s.value > 0).map(s => {
    const len = total ? (s.value / total) * circ : 0;
    const arc = { ...s, len, offset: acc };
    acc += len;
    return arc;
  });

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
          {arcs.map((a, i) => (
            <motion.circle
              key={`${a.label}-${i}`}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={a.color} strokeWidth={stroke}
              strokeDasharray={`${a.len} ${circ - a.len}`}
              strokeDashoffset={-a.offset}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: i * 0.06 }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[20px] font-semibold text-textb tracking-[-0.02em]"
            style={{ fontVariantNumeric: 'tabular-nums' }}>{centerValue}</span>
          <span className="text-[10px] text-dimtext uppercase tracking-wider">{centerLabel}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 min-w-[132px]">
        {slices.filter(s => s.value > 0).map((s, i) => (
          <div key={`${s.label}-${i}`} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[12px] text-jtext flex-1">{s.label}</span>
            <span className="text-[12px] font-semibold text-textb" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {s.value}
            </span>
            {total > 0 && (
              <span className="text-[11px] text-dimtext w-[34px] text-right">
                {Math.round((s.value / total) * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Grid of headline numbers. */
export function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
      {tiles.map((t, i) => (
        <motion.div key={`${t.label}-${i}`}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: i * 0.04 }}
          className="rounded-xl px-3.5 py-3 border"
          style={{ background: `${t.color}14`, borderColor: `${t.color}33` }}>
          <div className="text-[11px] text-dimtext mb-1">{t.label}</div>
          <div className="text-[19px] font-semibold tracking-[-0.02em]"
            style={{ color: t.color, fontVariantNumeric: 'tabular-nums' }}>{t.value}</div>
          {t.note && <div className="text-[11px] text-dimtext mt-0.5">{t.note}</div>}
        </motion.div>
      ))}
    </div>
  );
}

/** Thin segmented bar — a whole broken into parts, when a donut is too heavy. */
export function StackBar({ slices, height = 10 }: { slices: Slice[]; height?: number }) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const parts = slices.filter(s => s.value > 0);
  return (
    <div className="flex w-full overflow-hidden rounded-full" style={{ height }}>
      {parts.map((s, i) => (
        <motion.div key={`${s.label}-${i}`}
          initial={{ width: 0 }} animate={{ width: `${(s.value / total) * 100}%` }}
          transition={{ ...SPRING, delay: i * 0.04 }}
          title={`${s.label}: ${s.value}`}
          style={{
            background: s.color,
            // Only the outer edges are rounded, so the stack reads as one bar.
            borderTopLeftRadius: i === 0 ? height : 0,
            borderBottomLeftRadius: i === 0 ? height : 0,
            borderTopRightRadius: i === parts.length - 1 ? height : 0,
            borderBottomRightRadius: i === parts.length - 1 ? height : 0,
          }} />
      ))}
    </div>
  );
}
