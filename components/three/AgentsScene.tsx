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

// ── Iron Man suit assembled from primitives ───────────────────────────────────
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
  const dark  = () => ({ color: '#0b0c16', emissive: c, emissiveIntensity: ei, metalness: 0.92, roughness: 0.08 });
  const panel = () => ({ color: '#12131f', emissive: c, emissiveIntensity: ei * 0.55, metalness: 0.95, roughness: 0.06 });
  const glow  = (i = 0.7) => ({ color, emissive: c, emissiveIntensity: isSelected ? i * 1.8 : i, metalness: 0.45, roughness: 0.18 });

  return (
    <group scale={isJarvis ? 1.32 : 1.0}>

      {/* ── HELMET ───────────────────────────────────────── */}
      {/* Main helmet — angular, minimal radius */}
      <RoundedBox args={[0.80, 0.76, 0.68]} radius={0.04} smoothness={4} position={[0, 2.10, 0]}>
        <meshStandardMaterial {...dark()} />
      </RoundedBox>
      {/* Faceplate — forward-angled panel */}
      <mesh position={[0, 2.06, 0.36]}>
        <boxGeometry args={[0.58, 0.50, 0.04]} />
        <meshStandardMaterial {...panel()} />
      </mesh>
      {/* Chin guard */}
      <mesh position={[0, 1.80, 0.33]}>
        <boxGeometry args={[0.44, 0.16, 0.06]} />
        <meshStandardMaterial {...dark()} />
      </mesh>
      {/* Eye slits — narrow horizontal glowing strips */}
      {([-0.14, 0.14] as number[]).map(x => (
        <mesh key={x} position={[x, 2.19, 0.40]}>
          <boxGeometry args={[0.17, 0.048, 0.025]} />
          <meshStandardMaterial color={color} emissive={c} emissiveIntensity={isSelected ? 3.2 : 2.2} metalness={0.2} roughness={0.05} />
        </mesh>
      ))}
      {/* Sensor spike antenna */}
      <mesh position={[0, 2.57, 0]}>
        <cylinderGeometry args={[0.016, 0.016, 0.36, 6]} />
        <meshStandardMaterial color={color} emissive={c} emissiveIntensity={0.55} metalness={0.5} roughness={0.2} />
      </mesh>
      <mesh position={[0, 2.77, 0]}>
        <coneGeometry args={[0.028, 0.10, 6]} />
        <meshStandardMaterial color={color} emissive={c} emissiveIntensity={isSelected ? 2.5 : 1.5} />
      </mesh>

      {/* ── CHEST ARMOR ──────────────────────────────────── */}
      {/* Main chest plate */}
      <RoundedBox args={[1.10, 1.28, 0.78]} radius={0.05} smoothness={4} position={[0, 0.98, 0]}>
        <meshStandardMaterial {...dark()} />
      </RoundedBox>
      {/* Center chest panel */}
      <mesh position={[0, 1.04, 0.40]}>
        <boxGeometry args={[0.52, 0.68, 0.04]} />
        <meshStandardMaterial {...panel()} />
      </mesh>
      {/* Arc reactor ring */}
      <mesh position={[0, 1.20, 0.435]}>
        <torusGeometry args={[0.10, 0.032, 12, 32]} />
        <meshStandardMaterial color={color} emissive={c} emissiveIntensity={isSelected ? 2.8 : 1.9} metalness={0.3} roughness={0.08} />
      </mesh>
      {/* Arc reactor core glow */}
      <mesh position={[0, 1.20, 0.442]}>
        <circleGeometry args={[0.068, 32]} />
        <meshBasicMaterial color={color} transparent opacity={isSelected ? 0.92 : 0.68} />
      </mesh>
      {/* Horizontal armor seam lines */}
      {([0.86, 0.74] as number[]).map((y, i) => (
        <mesh key={y} position={[0, y, 0.41]}>
          <boxGeometry args={[0.46 - i * 0.08, 0.028, 0.022]} />
          <meshBasicMaterial color={color} transparent opacity={0.32 - i * 0.08} />
        </mesh>
      ))}
      {/* Shoulder pauldrons — wide angular plates */}
      {([-0.80, 0.80] as number[]).map(x => (
        <group key={x}>
          <RoundedBox args={[0.36, 0.28, 0.60]} radius={0.04} smoothness={4} position={[x, 1.46, -0.04]}>
            <meshStandardMaterial {...dark()} />
          </RoundedBox>
          {/* Outer edge bevel */}
          <mesh position={[x * 1.05, 1.46, -0.04]}>
            <boxGeometry args={[0.07, 0.20, 0.48]} />
            <meshStandardMaterial {...panel()} />
          </mesh>
        </group>
      ))}

      {/* ── ARMS (upper arm + gauntlet) ───────────────────── */}
      {([-0.72, 0.72] as number[]).map(x => (
        <group key={x}>
          {/* Upper arm */}
          <RoundedBox args={[0.26, 0.46, 0.26]} radius={0.04} smoothness={4} position={[x, 1.18, 0]}>
            <meshStandardMaterial {...dark()} />
          </RoundedBox>
          {/* Elbow joint sphere */}
          <mesh position={[x, 0.89, 0]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial {...panel()} />
          </mesh>
          {/* Forearm / gauntlet — slightly wider */}
          <RoundedBox args={[0.30, 0.42, 0.30]} radius={0.04} smoothness={4} position={[x, 0.62, 0]}>
            <meshStandardMaterial {...dark()} />
          </RoundedBox>
          {/* Repulsor palm — glowing circle */}
          <mesh position={[x, 0.40, 0.16]}>
            <circleGeometry args={[0.072, 24]} />
            <meshBasicMaterial color={color} transparent opacity={isSelected ? 0.95 : 0.72} />
          </mesh>
          <mesh position={[x, 0.40, 0.154]}>
            <torusGeometry args={[0.072, 0.016, 8, 24]} />
            <meshStandardMaterial color={color} emissive={c} emissiveIntensity={isSelected ? 2.4 : 1.3} metalness={0.3} roughness={0.08} />
          </mesh>
        </group>
      ))}

      {/* ── LEGS (greaves + boot thrusters) ──────────────── */}
      {([-0.27, 0.27] as number[]).map(x => (
        <group key={x}>
          {/* Upper leg */}
          <RoundedBox args={[0.36, 0.44, 0.36]} radius={0.04} smoothness={4} position={[x, 0.38, 0]}>
            <meshStandardMaterial {...dark()} />
          </RoundedBox>
          {/* Knee plate */}
          <mesh position={[x, 0.10, 0.19]}>
            <boxGeometry args={[0.26, 0.11, 0.055]} />
            <meshStandardMaterial {...panel()} />
          </mesh>
          {/* Lower leg / greave */}
          <RoundedBox args={[0.34, 0.42, 0.34]} radius={0.04} smoothness={4} position={[x, -0.14, 0]}>
            <meshStandardMaterial {...dark()} />
          </RoundedBox>
          {/* Boot */}
          <RoundedBox args={[0.40, 0.13, 0.52]} radius={0.04} smoothness={4} position={[x, -0.41, 0.08]}>
            <meshStandardMaterial {...dark()} />
          </RoundedBox>
          {/* Boot thruster glow — underneath */}
          <mesh position={[x, -0.50, 0.08]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.14, 24]} />
            <meshBasicMaterial color={color} transparent opacity={active ? 0.55 : idle ? 0.22 : 0.06} />
          </mesh>
          <mesh position={[x, -0.502, 0.08]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.11, 0.155, 24]} />
            <meshBasicMaterial color={color} transparent opacity={active ? 0.80 : idle ? 0.38 : 0.10} />
          </mesh>
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
