'use client';

import { useEffect, useRef } from 'react';
import { useFeed } from '@/lib/hooks/useFeed';
import { useApp } from '@/lib/AppContext';

const TYPE_COLOR: Record<string, string> = {
  success: '#00ff88',
  error:   '#ff3366',
  warning: '#ff8800',
  info:    '#00aaff',
  call:    '#00e5ff',
};

export function ActivityFeedStrip() {
  const { refreshKey } = useApp();
  const { items } = useFeed(refreshKey, 30);
  const trackRef = useRef<HTMLDivElement>(null);

  // Build marquee content (doubled for seamless loop)
  const text = items
    .slice(0, 20)
    .map(i => {
      const color = TYPE_COLOR[i.type] || '#5a5a80';
      const src   = i.source ? `[${i.source.toUpperCase()}]` : '';
      return `<span style="color:${color};margin-right:8px">●</span><span style="color:#5a5a80;margin-right:4px;font-size:9px">${src}</span><span style="color:#b8c0d8">${i.message?.slice(0, 80) ?? ''}</span><span style="color:#16162e;margin:0 24px">│</span>`;
    })
    .join('');

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center overflow-hidden"
      style={{
        height: 36,
        background: 'rgba(6,6,14,0.96)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid rgba(0,255,136,.1)',
        boxShadow: '0 -1px 0 rgba(0,255,136,.08)',
      }}
    >
      {/* Label */}
      <div
        className="flex-shrink-0 flex items-center gap-2 px-3 border-r border-border2 h-full"
        style={{ background: 'rgba(0,255,136,.06)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-ngreen animate-blink" style={{ boxShadow: '0 0 6px #00ff88' }} />
        <span className="font-orbitron text-[8px] text-ngreen tracking-[2px] uppercase">Live</span>
      </div>

      {/* Scrolling content */}
      <div className="flex-1 overflow-hidden relative" style={{ height: '100%' }}>
        <div
          className="flex items-center h-full font-mono text-[11px] whitespace-nowrap animate-marquee"
          dangerouslySetInnerHTML={{ __html: text + text }}
        />
      </div>
    </div>
  );
}
