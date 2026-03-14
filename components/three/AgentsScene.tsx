'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBox, Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentInfo } from '@/lib/hooks/useAgents';

// ── Arc positions for 6 sub-agents ───────────────────────────────────────────
const ARC_POSITIONS: [number, number, number][] = [
  [-4.0, 0, 1.6],
  [-2.4, 0, 0.7],
  [-1.0, 0, 0.1],
  [ 1.0, 0, 0.1],
  [ 2.4, 0, 0.7],
  [ 4.0, 0, 1.6],
];

// ── Single robot body assembled from primitives ───────────────────────────────
function Robot({
  color, status, isSelected, isJarvis,
}: {
  color: string; status: string; isSelected: boolean; isJarvis: boolean;
}) {
  const c = useMemo(() => new THREE.Color(color), [color]);
  const active  = status === 'active';
  const idle    = status === 'idle';
  const base    = active ? 0.22 : idle ? 0.10 : 0.03;
  const ei      = isSelected ? base * 2.2 : base;

  // Shared material factories
  const dark = () => ({ color: '#0b0c16', emissive: c, emissiveIntensity: ei, metalness: 0.88, roughness: 0.10 });
  const glow = (i = 0.7) => ({ color, emissive: c, emissiveIntensity: isSelected ? i * 1.8 : i, metalness: 0.45, roughness: 0.18 });

  return (
    <group scale={isJarvis ? 1.32 : 1.0}>
      {/* ── Head ─────────────────────────────────────────── */}
      <RoundedBox args={[0.84, 0.84, 0.74]} radius={0.09} smoothness={4} position={[0, 2.08, 0]}>
        <meshStandardMaterial {...dark()} />
      </RoundedBox>

      {/* Visor */}
      <mesh position={[0, 2.13, 0.38]}>
        <planeGeometry args={[0.54, 0.27]} />
        <meshStandardMaterial color={color} emissive={c} emissiveIntensity={isSelected ? 1.6 : 1.0} transparent opacity={0.92} />
      </mesh>

      {/* Eye dots */}
      {[-0.13, 0.13].map(x => (
        <mesh key={x} position={[x, 2.19, 0.385]}>
          <circleGeometry args={[0.048, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}

      {/* Antenna stem + bulb */}
      <mesh position={[0, 2.60, 0]}>
        <cylinderGeometry args={[0.022, 0.022, 0.44, 8]} />
        <meshStandardMaterial color={color} emissive={c} emissiveIntensity={0.55} metalness={0.5} roughness={0.2} />
      </mesh>
      <mesh position={[0, 2.86, 0]}>
        <sphereGeometry args={[0.062, 16, 16]} />
        <meshStandardMaterial color={color} emissive={c} emissiveIntensity={isSelected ? 2.5 : 1.5} />
      </mesh>

      {/* ── Torso ────────────────────────────────────────── */}
      <RoundedBox args={[1.08, 1.32, 0.84]} radius={0.10} smoothness={4} position={[0, 0.98, 0]}>
        <meshStandardMaterial {...dark()} />
      </RoundedBox>

      {/* Chest badge */}
      <mesh position={[0, 1.12, 0.43]}>
        <planeGeometry args={[0.50, 0.50]} />
        <meshStandardMaterial color={color} emissive={c} emissiveIntensity={isSelected ? 0.9 : 0.52} transparent opacity={0.78} />
      </mesh>

      {/* Chest detail lines */}
      {[0.86, 0.74].map((y, i) => (
        <mesh key={y} position={[0, y, 0.43]}>
          <planeGeometry args={[0.38 - i * 0.08, 0.038]} />
          <meshBasicMaterial color={color} transparent opacity={0.4 - i * 0.1} />
        </mesh>
      ))}

      {/* ── Arms ─────────────────────────────────────────── */}
      {([-0.72, 0.72] as number[]).map(x => (
        <group key={x}>
          <RoundedBox args={[0.27, 0.97, 0.27]} radius={0.06} smoothness={4} position={[x, 0.98, 0]}>
            <meshStandardMaterial {...dark()} />
          </RoundedBox>
          {/* Hand sphere */}
          <mesh position={[x, 0.43, 0]}>
            <sphereGeometry args={[0.135, 16, 16]} />
            <meshStandardMaterial {...glow(0.48)} />
          </mesh>
        </group>
      ))}

      {/* ── Legs ─────────────────────────────────────────── */}
      {([-0.27, 0.27] as number[]).map(x => (
        <group key={x}>
          <RoundedBox args={[0.37, 0.84, 0.37]} radius={0.07} smoothness={4} position={[x, 0.0, 0]}>
            <meshStandardMaterial {...dark()} />
          </RoundedBox>
          {/* Foot */}
          <RoundedBox args={[0.42, 0.16, 0.54]} radius={0.05} smoothness={4} position={[x, -0.44, 0.09]}>
            <meshStandardMaterial {...glow(0.20)} />
          </RoundedBox>
        </group>
      ))}

      {/* ── Floor glow disk ──────────────────────────────── */}
      <mesh position={[0, -0.53, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.72, 32]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 0.14 : idle ? 0.07 : 0.03} />
      </mesh>
    </group>
  );
}

// ── Individual agent mesh with floating + click ────────────────────────────────
function AgentMesh({
  agent, position, isSelected, isJarvis, onSelect,
}: {
  agent: AgentInfo & { key: string; color: string; description: string; schedule: string };
  position: [number, number, number];
  isSelected: boolean;
  isJarvis: boolean;
  onSelect: () => void;
}) {
  const ref  = useRef<THREE.Group>(null);
  const base = position[0] * 0.38 + position[2] * 0.15;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.position.y = position[1] + Math.sin(t * 0.72 + base) * 0.11;
    ref.current.rotation.y = isSelected
      ? t * 0.35
      : Math.sin(t * 0.20 + base) * 0.10;
  });

  return (
    <group
      ref={ref}
      position={position}
      scale={isSelected ? 1.10 : 1}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = 'default'; }}
    >
      <pointLight
        color={agent.color}
        intensity={agent.status === 'active' ? 1.4 : agent.status === 'idle' ? 0.5 : 0.15}
        distance={3.5}
        decay={2}
        position={[0, 3.2, 0]}
      />
      <Robot color={agent.color} status={agent.status} isSelected={isSelected} isJarvis={isJarvis} />
    </group>
  );
}

// ── Main exported scene ───────────────────────────────────────────────────────
export interface AgentSceneDef {
  key: string;
  name: string;
  color: string;
  description: string;
  schedule: string;
  lastActivity: string | null;
  runCount: number;
  status: 'active' | 'idle' | 'offline';
}

interface Props {
  agents: AgentInfo[];
  jarvis: AgentSceneDef;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

export default function AgentsScene({ agents, jarvis, selectedKey, onSelect }: Props) {
  return (
    <Canvas
      camera={{ position: [0, 3.0, 10.5], fov: 48 }}
      style={{ background: 'transparent' }}
      gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onClick={() => onSelect(null)}
    >
      {/* Atmosphere */}
      <fog attach="fog" args={['#0b0c16', 14, 30]} />
      <ambientLight intensity={0.15} />
      <directionalLight position={[6, 10, 6]} intensity={0.55} color="#ffffff" castShadow />
      <directionalLight position={[-6, 5, -4]} intensity={0.25} color="#4060d0" />

      {/* Infinite grid floor */}
      <Grid
        position={[0, -0.54, 0]}
        args={[30, 30]}
        cellSize={0.9}
        cellThickness={0.4}
        cellColor="#161628"
        sectionSize={4.5}
        sectionThickness={0.8}
        sectionColor="#202040"
        fadeDistance={22}
        fadeStrength={1.5}
        infiniteGrid
      />

      {/* Jarvis — center, slightly back */}
      <AgentMesh
        agent={jarvis as any}
        position={[0, 0, -1.4]}
        isSelected={selectedKey === jarvis.key}
        isJarvis
        onSelect={() => onSelect(selectedKey === jarvis.key ? null : jarvis.key)}
      />

      {/* Sub-agents in arc */}
      {agents.map((agent, i) => (
        <AgentMesh
          key={agent.key}
          agent={agent as any}
          position={ARC_POSITIONS[i] ?? [i * 1.6 - 4, 0, 0]}
          isSelected={selectedKey === agent.key}
          isJarvis={false}
          onSelect={() => onSelect(selectedKey === agent.key ? null : agent.key)}
        />
      ))}

      <OrbitControls
        enablePan={false}
        enableZoom={false}
        minPolarAngle={Math.PI / 5}
        maxPolarAngle={Math.PI / 2.2}
        autoRotate={!selectedKey}
        autoRotateSpeed={0.35}
        target={[0, 1.2, 0]}
      />
    </Canvas>
  );
}
