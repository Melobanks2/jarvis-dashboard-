'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ComposableMap, Geographies, Geography, Marker } = require('react-simple-maps');
import type { AsapCity } from '@/lib/hooks/useAsapCities';

// AlbersUSA topojson — official US states
const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

const STATUS_COLOR: Record<string, string> = {
  completed: '#4ade80',
  running:   '#67e8f9',
  queued:    '#52526e',
  failed:    '#f87171',
};

// Approximate long/lat for each target city
const CITY_COORDS: Record<string, [number, number]> = {
  'Orlando':         [-81.38, 28.54],
  'Tampa':           [-82.46, 27.95],
  'Jacksonville':    [-81.66, 30.33],
  'Miami':           [-80.19, 25.77],
  'Fort Lauderdale': [-80.14, 26.12],
  'Atlanta':         [-84.39, 33.75],
  'Houston':         [-95.37, 29.76],
  'Dallas':          [-96.80, 32.78],
  'Phoenix':         [-112.07, 33.45],
  'Charlotte':       [-80.84, 35.23],
};

export default function AsapMap({ cities }: { cities: AsapCity[] }) {
  const [tooltip, setTooltip] = useState<{ city: AsapCity; x: number; y: number } | null>(null);

  return (
    <div className="relative w-full" style={{ userSelect: 'none' }}>
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 900 }}
        style={{ width: '100%', height: 'auto' }}
      >
        {/* State fills */}
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: unknown[] }) =>
            geographies.map((geo: any) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="rgba(255,255,255,0.04)"
                stroke="rgba(255,255,255,0.10)"
                strokeWidth={0.5}
                style={{
                  default: { outline: 'none' },
                  hover:   { outline: 'none', fill: 'rgba(255,255,255,0.07)' },
                  pressed: { outline: 'none' },
                }}
              />
            ))
          }
        </Geographies>

        {/* City markers */}
        {cities.map((city, i) => {
          const coords = CITY_COORDS[city.city];
          if (!coords) return null;
          const color    = STATUS_COLOR[city.status] || STATUS_COLOR.queued;
          const isActive = city.status === 'running';
          const isDone   = city.status === 'completed';
          const r        = city.status === 'queued' ? 5 : 7;

          return (
            <Marker
              key={city.id}
              coordinates={coords}
              onMouseEnter={(e: React.MouseEvent) => setTooltip({ city, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Pulse ring for running */}
              {isActive && (
                <motion.circle
                  r={14}
                  fill="none"
                  stroke={color}
                  strokeWidth={1}
                  strokeOpacity={0.5}
                  initial={{ scale: 0.6, opacity: 0.8 }}
                  animate={{ scale: [0.6, 2, 0.6], opacity: [0.8, 0, 0.8] }}
                  transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.25 }}
                />
              )}

              {/* Dot */}
              <motion.circle
                r={r}
                fill={color}
                fillOpacity={city.status === 'queued' ? 0.25 : 0.85}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1 + i * 0.07, type: 'spring', stiffness: 400 }}
                style={{ cursor: 'pointer' }}
              />

              {/* City name label */}
              <motion.text
                y={-11}
                textAnchor="middle"
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 8,
                  fill: color,
                  fillOpacity: city.status === 'queued' ? 0.4 : 0.8,
                  pointerEvents: 'none',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 + i * 0.06 }}
              >
                {city.city}
              </motion.text>
            </Marker>
          );
        })}
      </ComposableMap>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg text-[11px]"
          style={{
            left: tooltip.x + 12,
            top:  tooltip.y - 40,
            background: 'rgba(18,19,32,0.95)',
            border: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(12px)',
            minWidth: 140,
          }}
        >
          <div className="font-medium text-textb mb-1">
            {tooltip.city.city}, {tooltip.city.state}
          </div>
          <div className="text-dimtext space-y-0.5">
            <div>{(tooltip.city.scraped_count || 0).toLocaleString()} scraped
              {tooltip.city.total_properties > 0 && ` / ${tooltip.city.total_properties.toLocaleString()}`}
            </div>
            <div>{(tooltip.city.photos_count || 0).toLocaleString()} photos</div>
            <div
              className="font-medium capitalize mt-1"
              style={{ color: STATUS_COLOR[tooltip.city.status] || '#52526e' }}
            >
              {tooltip.city.status}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
