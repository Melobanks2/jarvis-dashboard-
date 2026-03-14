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

// ── Iron Man Mark VII suit — colored armor with animated glow states ───────────
function Robot({
  color, status, isSelected, isJarvis,
}: {
  color: string; status: string; isSelected: boolean; isJarvis: boolean;
}) {
  // Agent color + derived shades
  const c      = useMemo(() => new THREE.Color(color), [color]);
  const cDark  = useMemo(() => new THREE.Color(color).multiplyScalar(0.48), [color]);
  const errC   = useMemo(() => new THREE.Color('#1a0505'), []);

  const active  = status === 'active';
  const idle    = status === 'idle';
  const offline = status === 'offline';
  const base    = active ? 0.28 : idle ? 0.14 : 0.04;
  const ei      = isSelected ? base * 2.2 : base;

  // ── Animated material refs ────────────────────────────────────────────────
  const arcRingRef   = useRef<THREE.MeshStandardMaterial>(null);
  const arcCoreRef   = useRef<THREE.MeshBasicMaterial>(null);
  const eyeRef0      = useRef<THREE.MeshStandardMaterial>(null);
  const eyeRef1      = useRef<THREE.MeshStandardMaterial>(null);
  const thruster0Ref = useRef<THREE.MeshBasicMaterial>(null);
  const thruster1Ref = useRef<THREE.MeshBasicMaterial>(null);
  const thruster2Ref = useRef<THREE.MeshBasicMaterial>(null);
  const thruster3Ref = useRef<THREE.MeshBasicMaterial>(null);
  const glowShellRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    // Arc reactor pulse
    if (arcRingRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.8)) + 1) / 2;
        arcRingRef.current.emissiveIntensity = isSelected ? 2.2 + p * 1.4 : 1.5 + p * 1.1;
      } else if (idle) {
        const p = (Math.sin(t * (2 * Math.PI / 2.5)) + 1) / 2;
        arcRingRef.current.emissiveIntensity = isSelected ? 1.6 + p * 0.8 : 0.9 + p * 0.6;
      } else {
        arcRingRef.current.emissiveIntensity = 0.2;
      }
    }
    if (arcCoreRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.8)) + 1) / 2;
        arcCoreRef.current.opacity = 0.58 + p * 0.38;
      } else if (idle) {
        const p = (Math.sin(t * (2 * Math.PI / 2.5)) + 1) / 2;
        arcCoreRef.current.opacity = 0.38 + p * 0.32;
      } else {
        arcCoreRef.current.opacity = 0.10;
      }
    }

    // Eye slits
    [eyeRef0, eyeRef1].forEach(ref => {
      if (!ref.current) return;
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.8) + 0.4) + 1) / 2;
        ref.current.emissiveIntensity = isSelected ? 2.8 + p * 1.0 : 1.8 + p * 0.8;
      } else if (idle) {
        ref.current.emissiveIntensity = isSelected ? 1.8 : 1.0;
      } else {
        ref.current.emissiveIntensity = 0.12;
      }
    });

    // Boot thrusters — flicker when active
    [thruster0Ref, thruster1Ref].forEach((ref, i) => {
      if (!ref.current) return;
      if (active) {
        const flicker = (Math.sin(t * (2 * Math.PI / 0.4) + i * 1.3) + 1) / 2;
        ref.current.opacity = 0.38 + flicker * 0.30;
      } else {
        ref.current.opacity = idle ? 0.14 : 0.03;
      }
    });
    [thruster2Ref, thruster3Ref].forEach((ref, i) => {
      if (!ref.current) return;
      if (active) {
        const flicker = (Math.sin(t * (2 * Math.PI / 0.4) + i * 1.3 + 0.8) + 1) / 2;
        ref.current.opacity = 0.55 + flicker * 0.32;
      } else {
        ref.current.opacity = idle ? 0.26 : 0.06;
      }
    });

    // Outer energy shell (active only)
    if (glowShellRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 1.2)) + 1) / 2;
        glowShellRef.current.opacity = 0.04 + p * 0.07;
      } else {
        glowShellRef.current.opacity = 0;
      }
    }
  });

  // ── Material factories — agent color is primary ───────────────────────────
  // Raised armor plates: full agent color, metallic
  const armor = () => ({
    color:              offline ? '#1a1520' : c,
    emissive:           offline ? errC : c,
    emissiveIntensity:  offline ? 0.02 : ei * 0.28,
    metalness:          0.80,
    roughness:          0.20,
  });
  // Panel recesses / body base: darkened agent color
  const recess = () => ({
    color:              offline ? '#0f0c14' : cDark,
    emissive:           offline ? errC : c,
    emissiveIntensity:  offline ? 0.01 : ei * 0.12,
    metalness:          0.92,
    roughness:          0.07,
  });
  // Glow-only elements (eyes, repulsors, etc.)
  const glowC  = offline ? '#2a2030' : color;
  const glowEm = offline ? errC : c;

  return (
    <group scale={isJarvis ? 1.32 : 1.0}>

      {/* ── Active energy shell ─────────────────────────────────────────── */}
      <mesh>
        <sphereGeometry args={[1.62, 16, 12]} />
        <meshBasicMaterial
          ref={glowShellRef} color={color} transparent opacity={0}
          side={THREE.BackSide} depthWrite={false}
        />
      </mesh>

      {/* ══ HELMET ══════════════════════════════════════════════════════════ */}

      {/* Main helmet shell */}
      <RoundedBox args={[0.78, 0.74, 0.66]} radius={0.04} smoothness={4} position={[0, 2.12, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>
      {/* Faceplate — centered panel, slightly forward */}
      <mesh position={[0, 2.09, 0.355]}>
        <boxGeometry args={[0.56, 0.56, 0.052]} />
        <meshStandardMaterial {...armor()} />
      </mesh>
      {/* Brow ridge above eyes */}
      <mesh position={[0, 2.36, 0.362]}>
        <boxGeometry args={[0.50, 0.068, 0.042]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Chin guard — narrower, angular */}
      <mesh position={[0, 1.815, 0.345]}>
        <boxGeometry args={[0.28, 0.18, 0.058]} />
        <meshStandardMaterial {...armor()} />
      </mesh>
      {/* Cheek armor — left */}
      <mesh position={[-0.315, 2.09, 0.34]}>
        <boxGeometry args={[0.088, 0.32, 0.058]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Cheek armor — right */}
      <mesh position={[0.315, 2.09, 0.34]}>
        <boxGeometry args={[0.088, 0.32, 0.058]} />
        <meshStandardMaterial {...recess()} />
      </mesh>

      {/* Eye slits — angled slightly (inner lower, outer higher = Mark VII look) */}
      <mesh position={[-0.145, 2.195, 0.395]} rotation={[0, 0, 0.20]}>
        <boxGeometry args={[0.185, 0.046, 0.026]} />
        <meshStandardMaterial
          ref={eyeRef0} color={glowC} emissive={glowEm}
          emissiveIntensity={offline ? 0.12 : (isSelected ? 3.4 : 2.4)}
          metalness={0.2} roughness={0.05}
        />
      </mesh>
      <mesh position={[0.145, 2.195, 0.395]} rotation={[0, 0, -0.20]}>
        <boxGeometry args={[0.185, 0.046, 0.026]} />
        <meshStandardMaterial
          ref={eyeRef1} color={glowC} emissive={glowEm}
          emissiveIntensity={offline ? 0.12 : (isSelected ? 3.4 : 2.4)}
          metalness={0.2} roughness={0.05}
        />
      </mesh>

      {/* Sensor spike antenna */}
      <mesh position={[0, 2.59, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.36, 6]} />
        <meshStandardMaterial color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.05 : 0.55} metalness={0.5} roughness={0.2} />
      </mesh>
      <mesh position={[0, 2.79, 0]}>
        <coneGeometry args={[0.026, 0.10, 6]} />
        <meshStandardMaterial color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.05 : (isSelected ? 2.6 : 1.5)} />
      </mesh>

      {/* ══ CHEST ═══════════════════════════════════════════════════════════ */}

      {/* Upper chest base — broad */}
      <RoundedBox args={[1.26, 0.72, 0.82]} radius={0.06} smoothness={4} position={[0, 1.27, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>
      {/* Left pectoral plate — raised */}
      <RoundedBox args={[0.46, 0.44, 0.075]} radius={0.04} smoothness={4} position={[-0.295, 1.38, 0.42]}>
        <meshStandardMaterial {...armor()} />
      </RoundedBox>
      {/* Right pectoral plate — raised */}
      <RoundedBox args={[0.46, 0.44, 0.075]} radius={0.04} smoothness={4} position={[0.295, 1.38, 0.42]}>
        <meshStandardMaterial {...armor()} />
      </RoundedBox>
      {/* Center sternum strip */}
      <mesh position={[0, 1.38, 0.44]}>
        <boxGeometry args={[0.095, 0.44, 0.038]} />
        <meshStandardMaterial {...recess()} />
      </mesh>

      {/* Arc reactor ring — animated via ref */}
      <mesh position={[0, 1.28, 0.450]}>
        <torusGeometry args={[0.100, 0.032, 12, 32]} />
        <meshStandardMaterial
          ref={arcRingRef}
          color={offline ? '#2a2030' : color}
          emissive={glowEm}
          emissiveIntensity={offline ? 0.2 : (isSelected ? 2.8 : 1.9)}
          metalness={0.3} roughness={0.08}
        />
      </mesh>
      {/* Arc reactor core — white glow */}
      <mesh position={[0, 1.28, 0.458]}>
        <circleGeometry args={[0.068, 32]} />
        <meshBasicMaterial
          ref={arcCoreRef}
          color={offline ? '#444450' : '#e8f4ff'}
          transparent opacity={offline ? 0.10 : (isSelected ? 0.92 : 0.68)}
        />
      </mesh>

      {/* Waist / abs — narrower than chest for Mark VII taper */}
      <RoundedBox args={[0.98, 0.58, 0.75]} radius={0.05} smoothness={4} position={[0, 0.73, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>
      {/* Abdominal armor segments — 4 horizontal lines */}
      {([0.90, 0.78, 0.66, 0.56] as number[]).map((y, i) => (
        <mesh key={y} position={[0, y, 0.385]}>
          <boxGeometry args={[0.58 - i * 0.05, 0.024, 0.022]} />
          <meshBasicMaterial color={offline ? '#333340' : color} transparent opacity={offline ? 0.05 : (0.26 - i * 0.04)} />
        </mesh>
      ))}

      {/* ══ SHOULDERS (rounded pauldrons) ═══════════════════════════════════ */}

      {([-1, 1] as number[]).map(side => (
        <group key={side}>
          {/* Main pauldron — sphere scaled to rounded dome shape */}
          <mesh position={[side * 0.75, 1.54, -0.04]} scale={[1.0, 0.74, 0.82]}>
            <sphereGeometry args={[0.34, 18, 12]} />
            <meshStandardMaterial {...armor()} />
          </mesh>
          {/* Pauldron lower skirt / cap */}
          <mesh position={[side * 0.75, 1.27, -0.04]}>
            <cylinderGeometry args={[0.26, 0.21, 0.22, 16]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Top panel line across shoulder */}
          <mesh position={[side * 0.75, 1.72, -0.04]}>
            <boxGeometry args={[0.42, 0.022, 0.34]} />
            <meshBasicMaterial color={offline ? '#333340' : color} transparent opacity={offline ? 0.04 : 0.18} />
          </mesh>
        </group>
      ))}

      {/* ══ ARMS ════════════════════════════════════════════════════════════ */}

      {([-0.75, 0.75] as number[]).map(x => (
        <group key={x}>
          {/* Upper arm — smooth cylinder */}
          <mesh position={[x, 1.10, 0]}>
            <cylinderGeometry args={[0.150, 0.140, 0.46, 16]} />
            <meshStandardMaterial {...armor()} />
          </mesh>
          {/* Elbow plate — angular */}
          <mesh position={[x, 0.845, 0.055]}>
            <boxGeometry args={[0.240, 0.160, 0.170]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Forearm / gauntlet — wider than upper arm */}
          <RoundedBox args={[0.335, 0.46, 0.325]} radius={0.04} smoothness={4} position={[x, 0.595, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Back of forearm tech panel */}
          <mesh position={[x, 0.605, -0.175]}>
            <boxGeometry args={[0.275, 0.330, 0.042]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Repulsor palm circle */}
          <mesh position={[x, 0.370, 0.170]}>
            <circleGeometry args={[0.062, 24]} />
            <meshBasicMaterial color={offline ? '#444450' : color} transparent opacity={offline ? 0.05 : (isSelected ? 0.95 : 0.74)} />
          </mesh>
          {/* Repulsor ring */}
          <mesh position={[x, 0.370, 0.163]}>
            <torusGeometry args={[0.062, 0.014, 8, 24]} />
            <meshStandardMaterial color={offline ? '#333340' : color} emissive={glowEm} emissiveIntensity={offline ? 0.05 : (isSelected ? 2.4 : 1.3)} metalness={0.3} roughness={0.08} />
          </mesh>
        </group>
      ))}

      {/* ══ LEGS ════════════════════════════════════════════════════════════ */}

      {([-0.290, 0.290] as number[]).map((x, legIdx) => (
        <group key={x}>
          {/* Thigh — large and prominent */}
          <RoundedBox args={[0.455, 0.54, 0.435]} radius={0.05} smoothness={4} position={[x, 0.32, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Knee plate — angular */}
          <mesh position={[x, 0.018, 0.225]}>
            <boxGeometry args={[0.310, 0.165, 0.072]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Shin / greave */}
          <RoundedBox args={[0.375, 0.480, 0.360]} radius={0.04} smoothness={4} position={[x, -0.170, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Front shin panel — flat face */}
          <mesh position={[x, -0.155, 0.205]}>
            <boxGeometry args={[0.220, 0.370, 0.042]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Boot — wide and flat */}
          <RoundedBox args={[0.450, 0.140, 0.570]} radius={0.04} smoothness={4} position={[x, -0.425, 0.092]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Boot thruster fill — animated */}
          <mesh position={[x, -0.508, 0.092]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.145, 24]} />
            <meshBasicMaterial
              ref={legIdx === 0 ? thruster0Ref : thruster1Ref}
              color={offline ? '#444450' : color}
              transparent opacity={offline ? 0.03 : (active ? 0.45 : idle ? 0.14 : 0.03)}
            />
          </mesh>
          {/* Boot thruster ring — animated */}
          <mesh position={[x, -0.510, 0.092]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.112, 0.158, 24]} />
            <meshBasicMaterial
              ref={legIdx === 0 ? thruster2Ref : thruster3Ref}
              color={offline ? '#444450' : color}
              transparent opacity={offline ? 0.03 : (active ? 0.65 : idle ? 0.26 : 0.06)}
            />
          </mesh>
        </group>
      ))}

      {/* ── Floor glow disk ──────────────────────────────────────────────── */}
      <mesh position={[0, -0.555, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.82, 32]} />
        <meshBasicMaterial color={offline ? '#333340' : color} transparent opacity={active ? 0.16 : idle ? 0.08 : 0.03} />
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
        intensity={agent.status === 'active' ? 1.6 : agent.status === 'idle' ? 0.6 : 0.15}
        distance={3.8}
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
      gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.10 }}
      onClick={() => onSelect(null)}
    >
      {/* Atmosphere */}
      <fog attach="fog" args={['#0b0c16', 14, 30]} />
      <ambientLight intensity={0.20} />
      <directionalLight position={[6, 10, 6]} intensity={0.70} color="#ffffff" castShadow />
      <directionalLight position={[-6, 5, -4]} intensity={0.30} color="#4060d0" />

      {/* Infinite grid floor */}
      <Grid
        position={[0, -0.56, 0]}
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
