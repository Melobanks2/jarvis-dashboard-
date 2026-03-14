'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Clock, AlertCircle, Camera, Database, Home, Users } from 'lucide-react';
import { useAsapData } from '@/lib/hooks/useAsapCities';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

const STATUS_CFG = {
  completed: { label: 'Completed', color: '#4ade80', icon: <CheckCircle2 size={13} /> },
  running:   { label: 'Running',   color: '#67e8f9', icon: <Loader2 size={13} className="animate-spin" /> },
  queued:    { label: 'Queued',    color: '#52526e', icon: <Clock size={13} /> },
  failed:    { label: 'Failed',    color: '#f87171', icon: <AlertCircle size={13} /> },
};

// Accurate SVG coords for the 10 target cities (viewBox 0 0 960 600)
const CITY_COORDS: Record<string, { x: number; y: number }> = {
  'Orlando':         { x: 742, y: 468 },
  'Tampa':           { x: 715, y: 490 },
  'Jacksonville':    { x: 740, y: 428 },
  'Miami':           { x: 752, y: 540 },
  'Fort Lauderdale': { x: 750, y: 528 },
  'Atlanta':         { x: 680, y: 400 },
  'Houston':         { x: 520, y: 470 },
  'Dallas':          { x: 510, y: 410 },
  'Phoenix':         { x: 265, y: 410 },
  'Charlotte':       { x: 700, y: 355 },
};

// Simplified US outline path — accurate continental shape
const US_PATH = `
  M 155,105 L 180,82 L 210,72 L 250,68 L 290,64 L 335,60 L 370,58
  L 420,56 L 468,55 L 520,54 L 560,55 L 600,56 L 640,54 L 670,52
  L 700,50 L 730,52 L 760,56 L 790,62 L 820,68 L 848,78 L 868,88
  L 882,102 L 890,118 L 888,135 L 882,150 L 876,165 L 868,178
  L 858,192 L 848,205 L 840,218 L 832,232 L 826,248 L 820,262
  L 815,278 L 810,294 L 806,310 L 802,328 L 798,346 L 794,364
  L 790,380 L 786,396 L 784,412 L 782,428 L 780,444 L 779,456
  L 776,468 L 772,482 L 770,494 L 766,504 L 762,516 L 758,528
  L 756,540 L 754,552 L 756,560 L 760,565 L 755,570 L 748,568
  L 742,560 L 738,548 L 734,535 L 730,520 L 722,508 L 714,496
  L 706,488 L 700,476 L 694,462 L 688,448 L 680,432 L 672,416
  L 664,402 L 655,388 L 645,374 L 634,360 L 622,348 L 610,338
  L 596,328 L 580,318 L 564,308 L 546,300 L 528,294 L 510,290
  L 492,288 L 474,288 L 456,290 L 438,294 L 420,300 L 402,308
  L 385,318 L 370,330 L 356,344 L 344,360 L 333,376 L 322,392
  L 312,408 L 302,424 L 292,438 L 282,450 L 272,460 L 260,468
  L 248,474 L 234,478 L 220,480 L 206,478 L 192,474 L 178,466
  L 166,456 L 156,444 L 148,430 L 142,414 L 138,398 L 136,380
  L 135,362 L 136,344 L 138,326 L 140,308 L 142,290 L 144,272
  L 146,254 L 148,236 L 150,218 L 152,200 L 153,182 L 154,164
  L 154,146 L 155,128 Z
`;

// Florida peninsula addition
const FL_PATH = `M 779,456 L 782,472 L 783,490 L 782,508 L 779,524
  L 775,538 L 770,550 L 764,558 L 758,562 L 754,560 L 752,552
  L 754,542 L 756,530 L 758,518 L 760,506 L 762,492 L 764,478
  L 766,464 L 768,452 Z`;

export function AsapScraper() {
  const { refreshKey } = useApp();
  const { cities, totals, loading } = useAsapData(refreshKey);

  const totalScraped   = cities.reduce((s, c) => s + (c.scraped_count || 0), 0);
  const totalTarget    = cities.reduce((s, c) => s + (c.total_properties || 0), 0);
  const overallPct     = totalTarget > 0 ? Math.round((totalScraped / totalTarget) * 100) : 0;
  const dbRows         = totals?.total_properties ?? 0;
  const photosCollected= totals?.total_photos ?? 0;
  const photoFiles     = totals?.total_photo_files ?? 0;
  const ownerData      = totals?.with_owner_data ?? 0;

  const photoPct = dbRows > 0 ? Math.round((photosCollected / dbRows) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">

      {/* Top stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          icon={<Database size={15} />}
          label="Properties Scraped"
          value={dbRows.toLocaleString()}
          sub={totalTarget > 0 ? `of ~${totalTarget.toLocaleString()} targeted` : 'loading...'}
          color="#67e8f9"
        />
        <StatCard
          icon={<Camera size={15} />}
          label="Photos Collected"
          value={photoFiles.toLocaleString()}
          sub={`${photoPct}% of records`}
          color="#4ade80"
        />
        <StatCard
          icon={<Users size={15} />}
          label="Owner Data"
          value={ownerData.toLocaleString()}
          sub="DealMachine enriched"
          color="#a78bfa"
        />
        <StatCard
          icon={<Home size={15} />}
          label="Cities Active"
          value={`${totals?.cities_done ?? 0} / ${cities.length}`}
          sub={totals?.cities_running ? `${totals.cities_running} running now` : 'none running'}
          color="#fbbf24"
        />
      </div>

      {/* Overall progress bar */}
      {totalTarget > 0 && (
        <div
          className="rounded-xl p-5"
          style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[13px] font-semibold text-textb">Overall Scraping Progress</p>
              <p className="text-[10px] text-dimtext mt-0.5">
                {totalScraped.toLocaleString()} of {totalTarget.toLocaleString()} properties across {cities.length} cities
              </p>
            </div>
            <span className="font-orbitron text-[28px] font-bold" style={{ color: overallPct >= 80 ? '#4ade80' : overallPct >= 40 ? '#fbbf24' : '#67e8f9' }}>
              {overallPct}%
            </span>
          </div>
          <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <motion.div
              className="absolute top-0 left-0 h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #67e8f9, #4ade80)' }}
              initial={{ width: 0 }}
              animate={{ width: `${overallPct}%` }}
              transition={{ duration: 1.4, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* US Map — takes 3 cols */}
        <div
          className="lg:col-span-3 rounded-xl overflow-hidden"
          style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)', padding: '20px' }}
        >
          <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px] mb-4">Geographic Coverage</p>

          <div className="relative w-full" style={{ paddingBottom: '62.5%' }}>
            <svg
              viewBox="0 0 960 600"
              className="absolute inset-0 w-full h-full"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Background */}
              <rect width="960" height="600" fill="transparent" />

              {/* Grid */}
              {[100,200,300,400,500].map(y => (
                <line key={`gy${y}`} x1="120" y1={y} x2="900" y2={y} stroke="rgba(255,255,255,0.025)" strokeWidth="0.8" />
              ))}
              {[200,350,500,650,800].map(x => (
                <line key={`gx${x}`} x1={x} y1="50" x2={x} y2="580" stroke="rgba(255,255,255,0.025)" strokeWidth="0.8" />
              ))}

              {/* US mainland */}
              <path d={US_PATH} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.09)" strokeWidth="1.2" strokeLinejoin="round" />
              {/* Florida */}
              <path d={FL_PATH} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.09)" strokeWidth="1.2" />

              {/* City dots */}
              {cities.map((city, i) => {
                const coords = CITY_COORDS[city.city];
                if (!coords) return null;
                const cfg      = STATUS_CFG[city.status] || STATUS_CFG.queued;
                const isActive = city.status === 'running';
                const isDone   = city.status === 'completed';

                return (
                  <g key={city.id}>
                    {/* Pulse ring for running */}
                    {isActive && (
                      <motion.circle
                        cx={coords.x} cy={coords.y} r={12}
                        fill="none"
                        stroke={cfg.color}
                        strokeWidth="0.8"
                        initial={{ scale: 0.8, opacity: 0.8 }}
                        animate={{ scale: [0.8, 2.2, 0.8], opacity: [0.8, 0, 0.8] }}
                        transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.3 }}
                      />
                    )}
                    {/* Progress ring for active/done cities */}
                    {(isDone || isActive) && city.total_properties > 0 && (
                      <circle
                        cx={coords.x} cy={coords.y} r={10}
                        fill="none"
                        stroke={cfg.color}
                        strokeWidth="1.5"
                        strokeOpacity="0.2"
                      />
                    )}
                    {/* Main dot */}
                    <motion.circle
                      cx={coords.x} cy={coords.y}
                      r={city.status === 'queued' ? 4 : 6}
                      fill={cfg.color}
                      fillOpacity={city.status === 'queued' ? 0.22 : 0.85}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: i * 0.07, type: 'spring', stiffness: 360 }}
                    />
                    {/* City label */}
                    <motion.text
                      x={coords.x + 9} y={coords.y + 4}
                      fontSize="8"
                      fill={cfg.color}
                      fillOpacity={city.status === 'queued' ? 0.4 : 0.75}
                      fontFamily="Inter, sans-serif"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 + i * 0.05 }}
                    >
                      {city.city}
                    </motion.text>
                  </g>
                );
              })}

              {/* Empty state */}
              {cities.length === 0 && !loading && (
                <text x="480" y="300" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.2)" fontFamily="Inter, sans-serif">
                  No city data yet — run asap-scraper first
                </text>
              )}
            </svg>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 mt-3 flex-wrap">
            {Object.entries(STATUS_CFG).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: cfg.color, opacity: key === 'queued' ? 0.3 : 0.85 }}
                />
                <span className="text-[9px] text-dimtext">{cfg.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* City progress list — takes 2 cols */}
        <div
          className="lg:col-span-2 rounded-xl overflow-hidden flex flex-col"
          style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px]">City Progress</p>
          </div>
          <div className="overflow-y-auto flex-1">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={16} className="animate-spin text-dimtext" />
              </div>
            )}
            {!loading && cities.length === 0 && (
              <div className="text-[10px] text-dimtext text-center py-8 italic px-4">
                No city data yet.<br/>Run asap-scraper to populate.
              </div>
            )}
            {cities.map((city, i) => {
              const cfg     = STATUS_CFG[city.status] || STATUS_CFG.queued;
              const pct     = city.total_properties > 0
                ? Math.min(100, Math.round((city.scraped_count / city.total_properties) * 100))
                : 0;
              const photoPct = city.scraped_count > 0
                ? Math.min(100, Math.round((city.photos_count / city.scraped_count) * 100))
                : 0;

              return (
                <motion.div
                  key={city.id}
                  className="px-5 py-3.5"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  {/* Row header */}
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ color: cfg.color }} className="flex-shrink-0">{cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] font-medium text-textb">{city.city}</span>
                      <span className="text-[10px] text-dimtext ml-1.5">{city.state}</span>
                    </div>
                    <span
                      className="text-[8px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: `${cfg.color}0f`, color: cfg.color }}
                    >
                      {pct}%
                    </span>
                  </div>

                  {/* Progress bar — scraping */}
                  <div className="relative h-1 rounded-full overflow-hidden mb-1.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <motion.div
                      className="absolute top-0 left-0 h-full rounded-full"
                      style={{ background: cfg.color, opacity: 0.6 }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: i * 0.05 }}
                    />
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-3 text-[9px] text-dimtext">
                    <span className="flex items-center gap-1">
                      <Database size={8} />
                      {(city.scraped_count || 0).toLocaleString()}
                      {city.total_properties > 0 && ` / ${city.total_properties.toLocaleString()}`}
                    </span>
                    <span className="flex items-center gap-1">
                      <Camera size={8} />
                      {(city.photos_count || 0).toLocaleString()} photos
                      {city.scraped_count > 0 && ` (${photoPct}%)`}
                    </span>
                    {city.last_updated && (
                      <span className="ml-auto">{timeAgo(city.last_updated)}</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Data breakdown card */}
      <div
        className="rounded-xl p-5"
        style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px] mb-4">Data Quality Breakdown</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <QualityBar
            label="Scraped"
            value={dbRows}
            total={totalTarget || dbRows}
            color="#67e8f9"
            desc="Property records in DB"
          />
          <QualityBar
            label="Photos"
            value={photosCollected}
            total={dbRows}
            color="#4ade80"
            desc="Records with photos collected"
          />
          <QualityBar
            label="Owner Data"
            value={ownerData}
            total={dbRows}
            color="#a78bfa"
            desc="Enriched with DealMachine"
          />
          <QualityBar
            label="Photo Files"
            value={photoFiles}
            total={photoFiles}
            color="#fbbf24"
            desc={`Total individual photos stored`}
            noBar
          />
        </div>
      </div>

    </div>
  );
}

function StatCard({
  icon, label, value, sub, color,
}: { icon: React.ReactNode; label: string; value: string; sub: string; color: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ color }}>
        {icon}
        <span className="text-[9px] font-semibold uppercase tracking-[1px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</span>
      </div>
      <div className="font-orbitron text-[26px] font-bold leading-none" style={{ color }}>{value}</div>
      <div className="text-[9px] text-dimtext mt-1.5">{sub}</div>
    </div>
  );
}

function QualityBar({
  label, value, total, color, desc, noBar,
}: { label: string; value: number; total: number; color: string; desc: string; noBar?: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-jtext">{label}</span>
        {!noBar && <span className="text-[10px] font-mono" style={{ color }}>{pct}%</span>}
      </div>
      <div className="font-orbitron text-[20px] font-bold leading-none mb-1.5" style={{ color }}>
        {value.toLocaleString()}
      </div>
      {!noBar && (
        <div className="relative h-1 rounded-full overflow-hidden mb-1.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <motion.div
            className="absolute top-0 left-0 h-full rounded-full"
            style={{ background: color, opacity: 0.6 }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </div>
      )}
      <div className="text-[9px] text-dimtext">{desc}</div>
    </div>
  );
}
