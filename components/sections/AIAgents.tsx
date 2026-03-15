'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, Activity, Clock, X, Zap } from 'lucide-react';
import { useAgents } from '@/lib/hooks/useAgents';
import { useFeed } from '@/lib/hooks/useFeed';
import { useApp } from '@/lib/AppContext';
import { timeAgo } from '@/lib/supabase';
import type { AgentSceneDef } from '@/components/three/AgentsScene';
import { SplineScene } from '@/components/ui/SplineScene';

// Feature flag — set NEXT_PUBLIC_USE_SPLINE=true + NEXT_PUBLIC_SPLINE_SCENE_URL=<url>
// in .env.local to switch from Three.js robots to a Spline 3D scene.
const USE_SPLINE     = process.env.NEXT_PUBLIC_USE_SPLINE === 'true';
const SPLINE_SCENE   = process.env.NEXT_PUBLIC_SPLINE_SCENE_URL ?? '';

const AgentsScene = dynamic(
  () => import('@/components/three/AgentsScene'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center" style={{ height: 500 }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border border-ngreen/30 animate-pulse flex items-center justify-center">
            <div className="w-5 h-5 rounded-full bg-ngreen/20 animate-pulse" />
          </div>
          <span className="text-[10px] text-dimtext tracking-[1.5px] uppercase animate-pulse">Initializing 3D Scene</span>
        </div>
      </div>
    ),
  }
);

const JARVIS: AgentSceneDef = {
  key:          'JARVIS',
  name:         'Jarvis',
  color:        '#4ade80',
  description:  'Central AI orchestrator. Coordinates all agents, manages Telegram communications, analyzes calls, and drives wholesale operations end-to-end.',
  schedule:     'Always Active',
  lastActivity: null,
  runCount:     0,
  status:       'active',
};

const STATUS_LABEL: Record<string, string> = { active: 'Online', idle: 'Idle', offline: 'Offline' };
const STATUS_COLOR: Record<string, string> = { active: '#4ade80', idle: '#fbbf24', offline: '#52526e' };

export function AIAgents() {
  const { refreshKey } = useApp();
  const { agents }     = useAgents(refreshKey);
  const { items: feed }= useFeed(refreshKey, 60);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const allAgents = [JARVIS, ...agents];
  const selected  = selectedKey ? allAgents.find(a => a.key === selectedKey) ?? null : null;
  const agentFeed = selected
    ? feed.filter(f => f.source?.toUpperCase().replace(/[\s-]/g, '_') === selected.key).slice(0, 5)
    : [];

  return (
    <div className="flex flex-col gap-4">

      {/* Label */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-textb">Agent Fleet</h2>
          <p className="text-[10px] text-dimtext mt-0.5">
            {agents.filter(a => a.status === 'active').length} active ·{' '}
            {agents.filter(a => a.status === 'idle').length} idle ·{' '}
            {agents.filter(a => a.status === 'offline').length} offline
          </p>
        </div>
        <p className="text-[9px] text-dimtext tracking-[1.5px] uppercase">Click any agent to inspect</p>
      </div>

      {/* 3D Scene canvas */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          height: 500,
          background: 'radial-gradient(ellipse 80% 70% at 50% 40%, rgba(74,222,128,0.04) 0%, rgba(11,12,22,0.95) 65%)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {USE_SPLINE && SPLINE_SCENE ? (
          /* ── Spline 3D scene ─────────────────────────────────────────────
             HOW TO SET UP:
             1. Go to spline.design — create a free account
             2. Build or import 7 Iron Man suits (import .glb from Sketchfab)
             3. Agent colors: Jarvis #4ade80, Alpha #60a5fa, Call #a78bfa,
                County #fb923c, Caller #4ade80, Bot #67e8f9, ASAP #fbbf24
             4. Name each object exactly as the agent key (e.g. ALPHA_SCRAPER)
             5. Add hover/float animations per suit
             6. Share → Copy link → paste .splinecode URL into .env.local:
                NEXT_PUBLIC_USE_SPLINE=true
                NEXT_PUBLIC_SPLINE_SCENE_URL=https://...splinecode
          ─────────────────────────────────────────────────────────────────── */
          <SplineScene
            scene={SPLINE_SCENE}
            className="w-full h-full"
            onLoad={(spline) => {
              try {
                const all = [JARVIS, ...agents];
                all.forEach(agent => {
                  const obj = spline.findObjectByName(agent.key) ?? spline.findObjectByName(agent.name);
                  if (!obj) return;
                  obj.emissiveIntensity = agent.status === 'active' ? 3.0
                    : agent.status === 'idle' ? 0.8 : 0.2;
                });
              } catch (e) {
                console.log('[Spline] object control skipped:', e);
              }
            }}
          />
        ) : (
          <AgentsScene
            agents={agents}
            jarvis={JARVIS}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        )}

        {/* Edge vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 110% 100% at 50% 50%, transparent 45%, rgba(11,12,19,0.55) 100%)' }}
        />

        {/* Top status bar */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ngreen animate-blink" />
            <span className="text-[9px] text-ngreen font-medium tracking-[1.5px] uppercase">Live</span>
          </div>
          <div className="flex items-center gap-1.5">
            {allAgents.map(a => (
              <span
                key={a.key}
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: STATUS_COLOR[a.status], opacity: a.status === 'offline' ? 0.3 : 0.85 }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Detail panel — slides in when agent selected */}
      <AnimatePresence mode="wait">
        {selected && (
          <motion.div
            key={selected.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(18,19,32,0.95)',
              border: `1px solid ${selected.color}20`,
              boxShadow: `inset 0 1px 0 ${selected.color}18, 0 0 40px ${selected.color}08`,
            }}
          >
            <div className="p-5 flex items-start gap-4">

              {/* Color bar */}
              <div className="w-0.5 self-stretch rounded-full flex-shrink-0" style={{ background: selected.color }} />

              <div className="flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  {selected.key === 'JARVIS' && <Crown size={13} style={{ color: selected.color }} />}
                  <h3
                    className="font-orbitron text-[13px] font-bold tracking-[2px]"
                    style={{ color: selected.color }}
                  >
                    {selected.name.toUpperCase()}
                  </h3>
                  <span
                    className="text-[8px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-[0.8px]"
                    style={{ background: `${STATUS_COLOR[selected.status]}12`, color: STATUS_COLOR[selected.status] }}
                  >
                    {STATUS_LABEL[selected.status]}
                  </span>
                  <span className="text-[9px] text-dimtext">{selected.schedule}</span>
                </div>

                <p className="text-[11px] text-jtext leading-relaxed mb-4">{selected.description}</p>

                {/* Stats */}
                <div className="flex items-center gap-6 text-[10px] text-dimtext mb-4">
                  <span className="flex items-center gap-1.5">
                    <Activity size={11} style={{ color: selected.color }} />
                    <span style={{ color: selected.color }} className="font-semibold">{selected.runCount}</span>
                    <span>runs logged</span>
                  </span>
                  {selected.lastActivity && (
                    <span className="flex items-center gap-1.5">
                      <Clock size={11} />
                      Last active {timeAgo(selected.lastActivity)}
                    </span>
                  )}
                </div>

                {/* Recent logs */}
                {agentFeed.length > 0 && (
                  <div>
                    <p className="text-[8px] font-semibold text-dimtext uppercase tracking-[1.5px] mb-2">Recent Activity</p>
                    <div className="flex flex-col gap-1.5">
                      {agentFeed.map(f => (
                        <div key={f.id} className="flex items-start gap-2 text-[10px]">
                          <Zap size={9} className="mt-0.5 flex-shrink-0" style={{ color: selected.color }} />
                          <span className="text-jtext flex-1 leading-snug">{f.message}</span>
                          <span className="text-dimtext flex-shrink-0 text-[8px]">{timeAgo(f.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {agentFeed.length === 0 && selected.key !== 'JARVIS' && (
                  <p className="text-[10px] text-dimtext italic">No recent logs yet for this agent.</p>
                )}
              </div>

              <button
                onClick={() => setSelectedKey(null)}
                className="text-dimtext hover:text-textb transition-colors p-1 rounded flex-shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Name tag pills — always visible, clickable */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {allAgents.map(a => (
          <button
            key={a.key}
            onClick={() => setSelectedKey(selectedKey === a.key ? null : a.key)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-medium transition-all"
            style={{
              background:   selectedKey === a.key ? `${a.color}12` : a.status === 'active' ? `${a.color}09` : 'rgba(255,255,255,0.03)',
              border:       `1px solid ${selectedKey === a.key ? a.color + '30' : a.status === 'active' ? a.color + '28' : 'rgba(255,255,255,0.07)'}`,
              color:        selectedKey === a.key ? a.color : a.status === 'active' ? a.color + 'cc' : '#52526e',
              boxShadow:    a.status === 'active' ? `0 0 10px ${a.color}28` : 'none',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: STATUS_COLOR[a.status], opacity: a.status === 'offline' ? 0.35 : 0.9 }}
            />
            {a.name}
          </button>
        ))}
      </div>
    </div>
  );
}
