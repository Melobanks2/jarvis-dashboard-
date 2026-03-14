'use client';

import { motion } from 'framer-motion';
import { Zap, CheckCircle2, Loader2, Clock } from 'lucide-react';
import { useAsapCities } from '@/lib/hooks/useAsapCities';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

// Fallback demo data if table is empty
const DEMO_CITIES = [
  { id: '1', city: 'Detroit',     state: 'MI', status: 'completed' as const, leads_found: 47, last_run: new Date(Date.now() - 2 * 3600000).toISOString(), created_at: '' },
  { id: '2', city: 'Cleveland',   state: 'OH', status: 'completed' as const, leads_found: 32, last_run: new Date(Date.now() - 5 * 3600000).toISOString(), created_at: '' },
  { id: '3', city: 'Columbus',    state: 'OH', status: 'running'   as const, leads_found: 11, last_run: new Date(Date.now() - 15 * 60000).toISOString(),  created_at: '' },
  { id: '4', city: 'Atlanta',     state: 'GA', status: 'queued'    as const, leads_found: 0,  last_run: null, created_at: '' },
  { id: '5', city: 'Memphis',     state: 'TN', status: 'queued'    as const, leads_found: 0,  last_run: null, created_at: '' },
  { id: '6', city: 'Jacksonville',state: 'FL', status: 'queued'    as const, leads_found: 0,  last_run: null, created_at: '' },
  { id: '7', city: 'Baltimore',   state: 'MD', status: 'queued'    as const, leads_found: 0,  last_run: null, created_at: '' },
  { id: '8', city: 'St. Louis',   state: 'MO', status: 'queued'    as const, leads_found: 0,  last_run: null, created_at: '' },
];

const STATUS_CONFIG = {
  completed: { label: 'Completed', color: '#4ade80', icon: <CheckCircle2 size={13} /> },
  running:   { label: 'Running',   color: '#67e8f9', icon: <Loader2 size={13} className="animate-spin" /> },
  queued:    { label: 'Queued',    color: '#52526e', icon: <Clock size={13} /> },
  failed:    { label: 'Failed',    color: '#f87171', icon: <Zap size={13} /> },
};

// Simplified US city coordinates (normalized 0-100 for SVG)
const CITY_COORDS: Record<string, { x: number; y: number }> = {
  'Detroit':      { x: 68, y: 28 },
  'Cleveland':    { x: 70, y: 30 },
  'Columbus':     { x: 70, y: 34 },
  'Atlanta':      { x: 67, y: 52 },
  'Memphis':      { x: 62, y: 50 },
  'Jacksonville': { x: 72, y: 58 },
  'Baltimore':    { x: 76, y: 33 },
  'St. Louis':    { x: 60, y: 40 },
};

export function AsapScraper() {
  const { refreshKey } = useApp();
  const { cities, loading } = useAsapCities(refreshKey);
  const display = cities.length > 0 ? cities : DEMO_CITIES;

  const completed = display.filter(c => c.status === 'completed');
  const running   = display.filter(c => c.status === 'running');
  const queued    = display.filter(c => c.status === 'queued');
  const totalLeads = display.reduce((sum, c) => sum + (c.leads_found || 0), 0);

  return (
    <div className="flex flex-col gap-6">

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Cities Done"   value={completed.length} color="#4ade80" />
        <StatCard label="Running Now"   value={running.length}   color="#67e8f9" />
        <StatCard label="Queued"        value={queued.length}    color="#52526e" />
        <StatCard label="Leads Found"   value={totalLeads}       color="#fbbf24" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* US Map */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)', padding: '20px' }}
        >
          <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px] mb-4">City Coverage Map</p>
          <div className="relative" style={{ paddingBottom: '60%' }}>
            <svg
              viewBox="0 0 100 65"
              className="absolute inset-0 w-full h-full"
              style={{ opacity: 0.9 }}
            >
              {/* Simple US outline approximation */}
              <path
                d="M15,20 L20,12 L35,10 L55,8 L75,10 L88,14 L90,20 L88,28 L85,35 L80,42 L75,50 L68,58 L60,62 L50,63 L40,62 L30,60 L22,55 L16,48 L12,40 L13,30 Z"
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="0.5"
              />
              {/* Florida peninsula */}
              <path
                d="M68,55 L72,60 L70,64 L67,63 Z"
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="0.5"
              />
              {/* Grid lines */}
              {[20, 35, 50, 65].map(y => (
                <line key={y} x1="12" y1={y} x2="90" y2={y} stroke="rgba(255,255,255,0.03)" strokeWidth="0.3" />
              ))}
              {[25, 40, 55, 70, 85].map(x => (
                <line key={x} x1={x} y1="8" x2={x} y2="64" stroke="rgba(255,255,255,0.03)" strokeWidth="0.3" />
              ))}

              {/* City dots */}
              {display.map((city, i) => {
                const coords = CITY_COORDS[city.city];
                if (!coords) return null;
                const cfg = STATUS_CONFIG[city.status];
                const isRunning = city.status === 'running';

                return (
                  <g key={city.id}>
                    {isRunning && (
                      <motion.circle
                        cx={coords.x}
                        cy={coords.y}
                        r={3}
                        fill="none"
                        stroke={cfg.color}
                        strokeWidth="0.4"
                        initial={{ scale: 1, opacity: 0.6 }}
                        animate={{ scale: [1, 2.5, 1], opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
                      />
                    )}
                    <motion.circle
                      cx={coords.x}
                      cy={coords.y}
                      r={city.status === 'queued' ? 1.2 : 1.8}
                      fill={cfg.color}
                      opacity={city.status === 'queued' ? 0.25 : 0.85}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: i * 0.08, type: 'spring', stiffness: 400 }}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: cfg.color, opacity: key === 'queued' ? 0.35 : 0.85 }} />
                <span className="text-[9px] text-dimtext">{cfg.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* City list */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px]">Scraping Progress</p>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
            {display.map((city, i) => {
              const cfg = STATUS_CONFIG[city.status];
              return (
                <motion.div
                  key={city.id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <span style={{ color: cfg.color }} className="flex-shrink-0">{cfg.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-textb">
                      {city.city}, <span className="text-dimtext text-[11px]">{city.state}</span>
                    </div>
                    {city.last_run && (
                      <div className="text-[9px] text-dimtext mt-0.5">{timeAgo(city.last_run)}</div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {city.leads_found > 0 ? (
                      <div className="font-orbitron text-[14px] font-bold" style={{ color: cfg.color }}>{city.leads_found}</div>
                    ) : (
                      <div className="text-[11px] text-dimtext">—</div>
                    )}
                    {city.leads_found > 0 && <div className="text-[8px] text-dimtext">leads</div>}
                  </div>
                  <span
                    className="text-[8px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: `${cfg.color}10`, color: cfg.color }}
                  >
                    {cfg.label}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="font-orbitron text-[28px] font-bold leading-none" style={{ color }}>{value}</div>
      <div className="text-[10px] text-dimtext mt-1.5 font-medium">{label}</div>
    </div>
  );
}
