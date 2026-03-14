'use client';

import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Clock, AlertCircle, Camera, Database, Home, Users } from 'lucide-react';
import { useAsapData } from '@/lib/hooks/useAsapCities';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';

// Load map CSR-only (topojson + browser APIs)
const AsapMap = dynamic(() => import('./AsapMap'), { ssr: false, loading: () => <MapSkeleton /> });

function MapSkeleton() {
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ minHeight: 260 }}>
      <Loader2 size={18} className="animate-spin text-dimtext" />
    </div>
  );
}

const STATUS_CFG = {
  completed: { label: 'Completed', color: '#4ade80', icon: <CheckCircle2 size={13} /> },
  running:   { label: 'Running',   color: '#67e8f9', icon: <Loader2 size={13} className="animate-spin" /> },
  queued:    { label: 'Queued',    color: '#52526e', icon: <Clock size={13} /> },
  failed:    { label: 'Failed',    color: '#f87171', icon: <AlertCircle size={13} /> },
};

export function AsapScraper() {
  const { refreshKey } = useApp();
  const { cities, totals, loading } = useAsapData(refreshKey);

  const totalScraped    = cities.reduce((s, c) => s + (c.scraped_count    || 0), 0);
  const totalTarget     = cities.reduce((s, c) => s + (c.total_properties || 0), 0);
  const overallPct      = totalTarget > 0 ? Math.round((totalScraped / totalTarget) * 100) : 0;
  const dbRows          = totals?.total_properties  ?? 0;
  const photosCollected = totals?.total_photos      ?? 0;
  const photoFiles      = totals?.total_photo_files ?? 0;
  const ownerData       = totals?.with_owner_data   ?? 0;
  const photoPct        = dbRows > 0 ? Math.round((photosCollected / dbRows) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">

      {/* Top stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={<Database size={15} />} label="Properties Scraped"
          value={dbRows.toLocaleString()}
          sub={totalTarget > 0 ? `of ~${totalTarget.toLocaleString()} targeted` : 'run scraper to populate'}
          color="#67e8f9" />
        <StatCard icon={<Camera size={15} />} label="Photos Collected"
          value={photoFiles.toLocaleString()}
          sub={`${photoPct}% of records`}
          color="#4ade80" />
        <StatCard icon={<Users size={15} />} label="Owner Data"
          value={ownerData.toLocaleString()}
          sub="DealMachine enriched"
          color="#a78bfa" />
        <StatCard icon={<Home size={15} />} label="Cities Active"
          value={`${totals?.cities_done ?? 0} / ${cities.length}`}
          sub={totals?.cities_running ? `${totals.cities_running} running now` : 'none running'}
          color="#fbbf24" />
      </div>

      {/* Overall progress bar */}
      {(totalTarget > 0 || dbRows > 0) && (
        <div
          className="rounded-xl p-5"
          style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[13px] font-semibold text-textb">Overall Scraping Progress</p>
              <p className="text-[10px] text-dimtext mt-0.5">
                {totalScraped.toLocaleString()} of {totalTarget.toLocaleString()} properties · {cities.length} cities
              </p>
            </div>
            <span
              className="font-orbitron text-[28px] font-bold"
              style={{ color: overallPct >= 80 ? '#4ade80' : overallPct >= 40 ? '#fbbf24' : '#67e8f9' }}
            >
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

        {/* US Map */}
        <div
          className="lg:col-span-3 rounded-xl overflow-hidden"
          style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)', padding: '20px' }}
        >
          <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px] mb-3">Geographic Coverage</p>
          <AsapMap cities={cities} />
          <div className="flex items-center gap-5 mt-3 flex-wrap">
            {Object.entries(STATUS_CFG).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: cfg.color, opacity: key === 'queued' ? 0.35 : 0.85 }} />
                <span className="text-[9px] text-dimtext">{cfg.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* City list */}
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
              <p className="text-[10px] text-dimtext text-center py-8 italic px-4">
                No cities yet — run asap-scraper to populate.
              </p>
            )}
            {cities.map((city, i) => {
              const cfg      = STATUS_CFG[city.status] || STATUS_CFG.queued;
              const pct      = city.total_properties > 0
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
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ color: cfg.color }} className="flex-shrink-0">{cfg.icon}</span>
                    <span className="text-[12px] font-medium text-textb flex-1">{city.city}</span>
                    <span className="text-[10px] text-dimtext">{city.state}</span>
                    <span
                      className="text-[8px] font-medium px-2 py-0.5 rounded-full ml-1"
                      style={{ background: `${cfg.color}0f`, color: cfg.color }}
                    >{pct}%</span>
                  </div>
                  <div className="relative h-1 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <motion.div
                      className="absolute top-0 left-0 h-full rounded-full"
                      style={{ background: cfg.color, opacity: 0.6 }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: i * 0.05 }}
                    />
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-dimtext">
                    <span className="flex items-center gap-1">
                      <Database size={8} />
                      {(city.scraped_count || 0).toLocaleString()}
                      {city.total_properties > 0 && ` / ${city.total_properties.toLocaleString()}`}
                    </span>
                    <span className="flex items-center gap-1">
                      <Camera size={8} />
                      {(city.photos_count || 0).toLocaleString()} photos{city.scraped_count > 0 && ` (${photoPct}%)`}
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

      {/* Data quality breakdown */}
      <div
        className="rounded-xl p-5"
        style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <p className="text-[10px] font-semibold text-dimtext uppercase tracking-[1.5px] mb-5">Data Quality</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <QualityBar label="Records in DB"  value={dbRows}          total={totalTarget || dbRows} color="#67e8f9" desc="Properties scraped" />
          <QualityBar label="With Photos"    value={photosCollected} total={dbRows}                color="#4ade80" desc="Records with photos" />
          <QualityBar label="Owner Enriched" value={ownerData}       total={dbRows}                color="#a78bfa" desc="DealMachine data" />
          <QualityBar label="Total Photos"   value={photoFiles}      total={photoFiles}            color="#fbbf24" desc="Individual files" noBar />
        </div>
      </div>

    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(18,19,32,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color }}>{icon}</span>
        <span className="text-[9px] font-semibold uppercase tracking-[1px] text-dimtext">{label}</span>
      </div>
      <div className="font-orbitron text-[26px] font-bold leading-none" style={{ color }}>{value}</div>
      <div className="text-[9px] text-dimtext mt-1.5">{sub}</div>
    </div>
  );
}

function QualityBar({ label, value, total, color, desc, noBar }: { label: string; value: number; total: number; color: string; desc: string; noBar?: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-jtext">{label}</span>
        {!noBar && <span className="text-[10px] font-mono" style={{ color }}>{pct}%</span>}
      </div>
      <div className="font-orbitron text-[20px] font-bold leading-none mb-1.5" style={{ color }}>{value.toLocaleString()}</div>
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
