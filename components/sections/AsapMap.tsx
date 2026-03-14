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
  complete:  '#4ade80',   // legacy DB value
  running:   '#67e8f9',
  queued:    '#52526e',
  failed:    '#f87171',
};

// Approximate long/lat for each target city
const CITY_COORDS: Record<string, [number, number]> = {
  // Florida
  'Altamonte Springs': [-81.37, 28.66],
  'Apopka':            [-81.73, 28.67],
  'Boca Raton':        [-80.10, 26.35],
  'Boynton Beach':     [-80.09, 26.53],
  'Bradenton':         [-82.57, 27.50],
  'Cape Coral':        [-81.95, 26.56],
  'Clearwater':        [-82.80, 27.97],
  'Coral Springs':     [-80.27, 26.27],
  'Daytona Beach':     [-81.02, 29.21],
  'Delray Beach':      [-80.07, 26.46],
  'Deltona':           [-81.27, 28.90],
  'Fort Lauderdale':   [-80.14, 26.12],
  'Fort Myers':        [-81.87, 26.64],
  'Fort Pierce':       [-80.32, 27.45],
  'Gainesville':       [-82.33, 29.65],   // FL (default)
  'Gainesville:FL':    [-82.33, 29.65],
  'Gainesville:GA':    [-83.82, 34.30],
  'Hialeah':           [-80.28, 25.86],
  'Hollywood':         [-80.19, 26.01],
  'Jacksonville':      [-81.66, 30.33],
  'Kissimmee':         [-81.41, 28.29],
  'Lakeland':          [-81.95, 28.04],
  'Melbourne':         [-80.60, 28.08],
  'Miami':             [-80.19, 25.77],
  'Miramar':           [-80.23, 25.99],
  'Naples':            [-81.80, 26.14],
  'Ocala':             [-82.14, 29.19],
  'Orange':            [-81.28, 28.54],
  'Ormond Beach':      [-81.06, 29.29],
  'Orlando':           [-81.38, 28.54],
  'Palm Bay':          [-80.59, 27.99],
  'Palm Coast':        [-81.21, 29.58],
  'Panama City':       [-85.66, 30.16],
  'Pembroke Pines':    [-80.34, 26.01],
  'Pensacola':         [-87.22, 30.42],
  'Plantation':        [-80.24, 26.13],
  'Pompano Beach':     [-80.12, 26.24],
  'Port Orange':       [-81.01, 29.14],
  'Port St. Lucie':    [-80.35, 27.29],
  'St. Cloud':         [-81.28, 28.25],
  'St. Petersburg':    [-82.64, 27.77],
  'Sarasota':          [-82.53, 27.34],
  'Stuart':            [-80.24, 27.20],
  'Sunrise':           [-80.26, 26.15],
  'Tallahassee':       [-84.28, 30.44],
  'Tampa':             [-82.46, 27.95],
  'Titusville':        [-80.81, 28.61],
  'Vero Beach':        [-80.40, 27.64],
  'West Palm Beach':   [-80.05, 26.71],
  'Winter Park':       [-81.34, 28.60],
  // Georgia
  'Albany':            [-84.16, 31.58],
  'Alpharetta':        [-84.29, 34.08],
  'Athens':            [-83.38, 33.96],
  'Atlanta':           [-84.39, 33.75],
  'Augusta':           [-81.97, 33.47],
  'Cartersville':      [-84.80, 34.17],
  'Columbus':          [-84.99, 32.46],
  'Douglasville':      [-84.75, 33.75],
  'Kennesaw':          [-84.62, 34.02],
  'Macon':             [-83.63, 32.84],
  'Marietta':          [-84.55, 33.95],
  'McDonough':         [-84.15, 33.45],
  'Newnan':            [-84.80, 33.38],
  'Peachtree City':    [-84.60, 33.40],
  'Rome':              [-85.16, 34.26],
  'Roswell':           [-84.36, 34.02],
  'Sandy Springs':     [-84.38, 33.92],
  'Savannah':          [-81.10, 32.08],
  'Smyrna':            [-84.52, 33.88],
  'Stockbridge':       [-84.23, 33.54],
  'Warner Robins':     [-83.63, 32.61],
  // Texas
  'Abilene':           [-99.73, 32.45],
  'Allen':             [-96.67, 33.10],
  'Amarillo':          [-101.84, 35.22],
  'Arlington':         [-97.11, 32.74],
  'Austin':            [-97.74, 30.27],
  'Beaumont':          [-94.10, 30.08],
  'Brownsville':       [-97.50, 25.90],
  'Carrollton':        [-96.89, 32.95],
  'College Station':   [-96.34, 30.63],
  'Corpus Christi':    [-97.40, 27.80],
  'Dallas':            [-96.80, 32.78],
  'Denton':            [-97.13, 33.21],
  'Edinburg':          [-98.16, 26.30],
  'El Paso':           [-106.49, 31.76],
  'Fort Worth':        [-97.33, 32.73],
  'Frisco':            [-96.82, 33.15],
  'Garland':           [-96.64, 32.91],
  'Grand Prairie':     [-97.00, 32.75],
  'Houston':           [-95.37, 29.76],
  'Irving':            [-96.94, 32.81],
  'Killeen':           [-97.73, 31.12],
  'Laredo':            [-99.50, 27.51],
  'League City':       [-95.09, 29.51],
  'Lewisville':        [-97.00, 33.05],
  'Lubbock':           [-101.85, 33.58],
  'McAllen':           [-98.23, 26.20],
  'McKinney':          [-96.62, 33.20],
  'Mesquite':          [-96.60, 32.77],
  'Midland':           [-102.08, 31.99],
  'Odessa':            [-102.37, 31.85],
  'Pasadena':          [-95.21, 29.69],
  'Pearland':          [-95.29, 29.56],
  'Plano':             [-96.70, 33.02],
  'Richardson':        [-96.73, 32.96],
  'Round Rock':        [-97.68, 30.51],
  'San Antonio':       [-98.49, 29.42],
  'Sugar Land':        [-95.64, 29.62],
  'Tyler':             [-95.30, 32.35],
  'Waco':              [-97.15, 31.55],
  // Arizona
  'Avondale':          [-112.35, 33.44],
  'Buckeye':           [-112.58, 33.37],
  'Bullhead City':     [-114.57, 35.14],
  'Casa Grande':       [-111.76, 32.88],
  'Chandler':          [-111.84, 33.30],
  'Flagstaff':         [-111.65, 35.20],
  'Gilbert':           [-111.79, 33.35],
  'Glendale':          [-112.19, 33.54],
  'Goodyear':          [-112.36, 33.44],
  'Lake Havasu City':  [-114.32, 34.48],
  'Maricopa':          [-112.05, 33.05],
  'Mesa':              [-111.83, 33.42],
  'Peoria':            [-112.24, 33.58],
  'Phoenix':           [-112.07, 33.45],
  'Prescott':          [-112.47, 34.54],
  'Queen Creek':       [-111.63, 33.25],
  'Scottsdale':        [-111.92, 33.49],
  'Surprise':          [-112.37, 33.63],
  'Tempe':             [-111.94, 33.42],
  'Tucson':            [-110.97, 32.22],
  'Yuma':              [-114.62, 32.69],
  // North Carolina
  'Apex':              [-78.85, 35.73],
  'Asheville':         [-82.55, 35.57],
  'Burlington':        [-79.44, 36.10],
  'Cary':              [-78.78, 35.79],
  'Chapel Hill':       [-79.06, 35.91],
  'Charlotte':         [-80.84, 35.23],
  'Concord':           [-80.59, 35.41],
  'Cornelius':         [-80.86, 35.48],
  'Durham':            [-78.90, 35.99],
  'Fayetteville':      [-78.88, 35.05],
  'Gastonia':          [-81.19, 35.26],
  'Greensboro':        [-79.79, 36.07],
  'Greenville':        [-77.37, 35.61],
  'Hickory':           [-81.34, 35.73],
  'High Point':        [-79.99, 35.96],
  'Huntersville':      [-80.84, 35.41],
  'Indian Trail':      [-80.67, 35.08],
  'Kannapolis':        [-80.62, 35.49],
  'Matthews':          [-80.72, 35.12],
  'Mooresville':       [-80.81, 35.58],
  'Raleigh':           [-78.64, 35.78],
  'Rocky Mount':       [-77.80, 35.94],
  'Wilmington':        [-77.95, 34.23],
  'Wilson':            [-77.92, 35.72],
  'Winston-Salem':     [-80.24, 36.10],
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
          const coords = CITY_COORDS[`${city.city}:${city.state}`] ?? CITY_COORDS[city.city];
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
