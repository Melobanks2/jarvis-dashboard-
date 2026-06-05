'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  target: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function AnimatedCounter({ target, duration = 700, prefix = '', suffix = '', decimals = 0, className, style }: Props) {
  const [value,    setValue]    = useState(0);
  const startRef  = useRef<number | null>(null);
  const frameRef  = useRef<number>(0);

  useEffect(() => {
    const start = 0;
    startRef.current = null;
    cancelAnimationFrame(frameRef.current);

    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const p = Math.min((ts - startRef.current) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setValue(start + (target - start) * e);
      if (p < 1) frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  const display = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString();
  return <span className={className} style={style}>{prefix}{display}{suffix}</span>;
}
