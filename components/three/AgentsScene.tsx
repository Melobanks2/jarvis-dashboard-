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

// Fixed gold accent — secondary color on all suits (like Mark VII's gold)
const GOLD = new THREE.Color('#8a6c1e');
const GOLD_LIGHT = new THREE.Color('#b89230');

// ── Iron Man Mark VII suit ────────────────────────────────────────────────────
function Robot({
  color, status, isSelected, isJarvis,
}: {
  color: string; status: string; isSelected: boolean; isJarvis: boolean;
}) {
  const c      = useMemo(() => new THREE.Color(color), [color]);
  const cDark  = useMemo(() => new THREE.Color(color).multiplyScalar(0.45), [color]);
  const errC   = useMemo(() => new THREE.Color('#200505'), []);

  const active  = status === 'active';
  const idle    = status === 'idle';
  const offline = status === 'offline';
  const base    = active ? 0.30 : idle ? 0.14 : 0.04;
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

    // Arc reactor
    if (arcRingRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.8)) + 1) / 2;
        arcRingRef.current.emissiveIntensity = isSelected ? 2.4 + p * 1.4 : 1.6 + p * 1.1;
      } else if (idle) {
        const p = (Math.sin(t * (2 * Math.PI / 2.5)) + 1) / 2;
        arcRingRef.current.emissiveIntensity = isSelected ? 1.6 + p * 0.8 : 1.0 + p * 0.6;
      } else {
        arcRingRef.current.emissiveIntensity = 0.2;
      }
    }
    if (arcCoreRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.8)) + 1) / 2;
        arcCoreRef.current.opacity = 0.60 + p * 0.36;
      } else if (idle) {
        const p = (Math.sin(t * (2 * Math.PI / 2.5)) + 1) / 2;
        arcCoreRef.current.opacity = 0.40 + p * 0.30;
      } else {
        arcCoreRef.current.opacity = 0.12;
      }
    }

    // Eyes
    [eyeRef0, eyeRef1].forEach(ref => {
      if (!ref.current) return;
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.8) + 0.4) + 1) / 2;
        ref.current.emissiveIntensity = isSelected ? 3.0 + p * 1.0 : 2.0 + p * 0.8;
      } else if (idle) {
        ref.current.emissiveIntensity = isSelected ? 2.0 : 1.1;
      } else {
        ref.current.emissiveIntensity = 0.12;
      }
    });

    // Boot thrusters
    [thruster0Ref, thruster1Ref].forEach((ref, i) => {
      if (!ref.current) return;
      if (active) {
        const flicker = (Math.sin(t * (2 * Math.PI / 0.4) + i * 1.3) + 1) / 2;
        ref.current.opacity = 0.40 + flicker * 0.32;
      } else { ref.current.opacity = idle ? 0.14 : 0.03; }
    });
    [thruster2Ref, thruster3Ref].forEach((ref, i) => {
      if (!ref.current) return;
      if (active) {
        const flicker = (Math.sin(t * (2 * Math.PI / 0.4) + i * 1.3 + 0.8) + 1) / 2;
        ref.current.opacity = 0.58 + flicker * 0.30;
      } else { ref.current.opacity = idle ? 0.28 : 0.06; }
    });

    // Outer energy shell
    if (glowShellRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 1.2)) + 1) / 2;
        glowShellRef.current.opacity = 0.04 + p * 0.07;
      } else { glowShellRef.current.opacity = 0; }
    }
  });

  // ── Material factories ────────────────────────────────────────────────────
  // Primary armor plates — agent color, metallic
  const armor = () => ({
    color:             offline ? '#1c1420' : c,
    emissive:          offline ? errC : c,
    emissiveIntensity: offline ? 0.02 : ei * 0.22,
    metalness:         0.76,
    roughness:         0.24,
  });
  // Dark recesses between plates
  const recess = () => ({
    color:             offline ? '#0e0b12' : cDark,
    emissive:          offline ? errC : c,
    emissiveIntensity: offline ? 0.01 : ei * 0.08,
    metalness:         0.94,
    roughness:         0.06,
  });
  // Gold accent panels — joints, inner panels
  const gold = () => ({
    color:             offline ? '#1a1510' : GOLD,
    emissive:          offline ? errC : GOLD_LIGHT,
    emissiveIntensity: offline ? 0.01 : (isSelected ? 0.55 : 0.28),
    metalness:         0.88,
    roughness:         0.12,
  });
  const glowC  = offline ? '#2a2030' : color;
  const glowEm = offline ? errC : c;

  return (
    <group scale={isJarvis ? 1.32 : 1.0}>

      {/* ── Active energy shell ──────────────────────────────────────────── */}
      <mesh>
        <sphereGeometry args={[1.68, 16, 12]} />
        <meshBasicMaterial ref={glowShellRef} color={color} transparent opacity={0} side={THREE.BackSide} depthWrite={false} />
      </mesh>

      {/* ══ HELMET ══════════════════════════════════════════════════════════ */}

      {/* Helmet shell — tall, slightly rounded */}
      <RoundedBox args={[0.76, 0.84, 0.68]} radius={0.04} smoothness={4} position={[0, 2.16, 0]}>
        <meshStandardMaterial {...armor()} />
      </RoundedBox>
      {/* Faceplate — distinct mask panel, tapers to chin */}
      <mesh position={[0, 2.12, 0.358]}>
        <boxGeometry args={[0.56, 0.62, 0.055]} />
        <meshStandardMaterial {...armor()} />
      </mesh>
      {/* Faceplate brow ridge — angular overhang */}
      <mesh position={[0, 2.40, 0.364]}>
        <boxGeometry args={[0.52, 0.075, 0.045]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Cheek panels — sides of faceplate */}
      <mesh position={[-0.318, 2.12, 0.348]}>
        <boxGeometry args={[0.092, 0.38, 0.060]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      <mesh position={[0.318, 2.12, 0.348]}>
        <boxGeometry args={[0.092, 0.38, 0.060]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Chin — narrower, pointed */}
      <mesh position={[0, 1.810, 0.348]}>
        <boxGeometry args={[0.26, 0.195, 0.062]} />
        <meshStandardMaterial {...armor()} />
      </mesh>
      {/* Chin taper bottom */}
      <mesh position={[0, 1.730, 0.340]}>
        <boxGeometry args={[0.18, 0.100, 0.055]} />
        <meshStandardMaterial {...armor()} />
      </mesh>

      {/* Eye slits — wide, angled inward (Mark VII) */}
      <mesh position={[-0.145, 2.225, 0.400]} rotation={[0, 0, 0.22]}>
        <boxGeometry args={[0.195, 0.048, 0.028]} />
        <meshStandardMaterial ref={eyeRef0} color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.12 : (isSelected ? 3.4 : 2.4)} metalness={0.2} roughness={0.04} />
      </mesh>
      <mesh position={[0.145, 2.225, 0.400]} rotation={[0, 0, -0.22]}>
        <boxGeometry args={[0.195, 0.048, 0.028]} />
        <meshStandardMaterial ref={eyeRef1} color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.12 : (isSelected ? 3.4 : 2.4)} metalness={0.2} roughness={0.04} />
      </mesh>

      {/* Neck collar — connects helmet to chest */}
      <mesh position={[0, 1.760, 0]}>
        <cylinderGeometry args={[0.22, 0.28, 0.18, 12]} />
        <meshStandardMaterial {...gold()} />
      </mesh>

      {/* Sensor spike */}
      <mesh position={[0, 2.635, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.36, 6]} />
        <meshStandardMaterial color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.05 : 0.55} metalness={0.5} roughness={0.2} />
      </mesh>
      <mesh position={[0, 2.830, 0]}>
        <coneGeometry args={[0.025, 0.10, 6]} />
        <meshStandardMaterial color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.05 : (isSelected ? 2.6 : 1.6)} />
      </mesh>

      {/* ══ CHEST ═══════════════════════════════════════════════════════════ */}

      {/* Upper chest base — very broad (Mark VII V-taper) */}
      <RoundedBox args={[1.32, 0.74, 0.86]} radius={0.06} smoothness={4} position={[0, 1.29, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>
      {/* Left pectoral plate */}
      <RoundedBox args={[0.505, 0.50, 0.082]} radius={0.045} smoothness={4} position={[-0.305, 1.405, 0.435]}>
        <meshStandardMaterial {...armor()} />
      </RoundedBox>
      {/* Right pectoral plate */}
      <RoundedBox args={[0.505, 0.50, 0.082]} radius={0.045} smoothness={4} position={[0.305, 1.405, 0.435]}>
        <meshStandardMaterial {...armor()} />
      </RoundedBox>
      {/* Sternum center strip */}
      <mesh position={[0, 1.40, 0.448]}>
        <boxGeometry args={[0.085, 0.50, 0.040]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Arc reactor ring */}
      <mesh position={[0, 1.295, 0.458]}>
        <torusGeometry args={[0.105, 0.034, 14, 36]} />
        <meshStandardMaterial ref={arcRingRef} color={offline ? '#2a2030' : color} emissive={glowEm} emissiveIntensity={offline ? 0.2 : (isSelected ? 2.8 : 2.0)} metalness={0.3} roughness={0.07} />
      </mesh>
      {/* Arc reactor core — white glow */}
      <mesh position={[0, 1.295, 0.467]}>
        <circleGeometry args={[0.072, 36]} />
        <meshBasicMaterial ref={arcCoreRef} color={offline ? '#444450' : '#d8f0ff'} transparent opacity={offline ? 0.10 : (isSelected ? 0.95 : 0.72)} />
      </mesh>

      {/* Waist / abs — significantly narrower than chest */}
      <RoundedBox args={[0.88, 0.56, 0.74]} radius={0.05} smoothness={4} position={[0, 0.74, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>
      {/* Abdominal armor lines */}
      {([0.91, 0.79, 0.68, 0.58] as number[]).map((y, i) => (
        <mesh key={y} position={[0, y, 0.378]}>
          <boxGeometry args={[0.56 - i * 0.06, 0.022, 0.024]} />
          <meshBasicMaterial color={offline ? '#333340' : color} transparent opacity={offline ? 0.04 : (0.22 - i * 0.04)} />
        </mesh>
      ))}
      {/* Hip joint panels — gold accent (Mark VII signature) */}
      {([-0.36, 0.36] as number[]).map(x => (
        <mesh key={x} position={[x, 0.615, 0.365]}>
          <boxGeometry args={[0.155, 0.130, 0.052]} />
          <meshStandardMaterial {...gold()} />
        </mesh>
      ))}

      {/* ══ SHOULDERS (large dome pauldrons) ════════════════════════════════ */}

      {([-1, 1] as number[]).map(side => (
        <group key={side}>
          {/* Main pauldron — large rounded dome */}
          <mesh position={[side * 0.84, 1.56, -0.04]} scale={[1.05, 0.80, 0.90]}>
            <sphereGeometry args={[0.38, 20, 14]} />
            <meshStandardMaterial {...armor()} />
          </mesh>
          {/* Pauldron underside skirt — gold accent */}
          <mesh position={[side * 0.84, 1.27, -0.04]}>
            <cylinderGeometry args={[0.30, 0.23, 0.24, 18]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Top panel seam line */}
          <mesh position={[side * 0.84, 1.74, 0.01]}>
            <boxGeometry args={[0.44, 0.022, 0.34]} />
            <meshBasicMaterial color={offline ? '#333340' : color} transparent opacity={offline ? 0.04 : 0.16} />
          </mesh>
        </group>
      ))}

      {/* ══ ARMS ════════════════════════════════════════════════════════════ */}

      {([-0.80, 0.80] as number[]).map(x => (
        <group key={x}>
          {/* Upper arm — narrower cylinder */}
          <mesh position={[x, 1.105, 0]}>
            <cylinderGeometry args={[0.140, 0.130, 0.44, 16]} />
            <meshStandardMaterial {...armor()} />
          </mesh>
          {/* Elbow joint — gold accent sphere */}
          <mesh position={[x, 0.860, 0]}>
            <sphereGeometry args={[0.145, 14, 10]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Forearm / gauntlet — MUCH wider than upper arm (Mark VII signature) */}
          <RoundedBox args={[0.365, 0.505, 0.350]} radius={0.045} smoothness={4} position={[x, 0.575, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Forearm back tech panel — gold */}
          <mesh position={[x, 0.590, -0.185]}>
            <boxGeometry args={[0.280, 0.350, 0.044]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Wrist band */}
          <mesh position={[x, 0.340, 0]}>
            <cylinderGeometry args={[0.175, 0.175, 0.068, 14]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Repulsor palm */}
          <mesh position={[x, 0.300, 0.180]}>
            <circleGeometry args={[0.065, 24]} />
            <meshBasicMaterial color={offline ? '#444450' : color} transparent opacity={offline ? 0.05 : (isSelected ? 0.95 : 0.76)} />
          </mesh>
          <mesh position={[x, 0.300, 0.173]}>
            <torusGeometry args={[0.065, 0.015, 8, 24]} />
            <meshStandardMaterial color={offline ? '#333340' : color} emissive={glowEm} emissiveIntensity={offline ? 0.05 : (isSelected ? 2.4 : 1.4)} metalness={0.3} roughness={0.07} />
          </mesh>
        </group>
      ))}

      {/* ══ LEGS ════════════════════════════════════════════════════════════ */}

      {([-0.295, 0.295] as number[]).map((x, legIdx) => (
        <group key={x}>
          {/* Hip connection — gold accent */}
          <mesh position={[x, 0.530, 0]} scale={[1, 0.55, 1]}>
            <sphereGeometry args={[0.22, 12, 8]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Thigh armor — large and prominent */}
          <RoundedBox args={[0.475, 0.560, 0.455]} radius={0.055} smoothness={4} position={[x, 0.270, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Inner thigh panel — gold (very visible in Mark VII) */}
          <mesh position={[x * 0.55, 0.270, 0.230]}>
            <boxGeometry args={[0.180, 0.380, 0.048]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Knee joint — gold */}
          <mesh position={[x, 0.005, 0.050]}>
            <boxGeometry args={[0.300, 0.120, 0.220]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Knee front plate */}
          <mesh position={[x, 0.010, 0.220]}>
            <boxGeometry args={[0.265, 0.175, 0.075]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Shin / greave */}
          <RoundedBox args={[0.390, 0.510, 0.375]} radius={0.045} smoothness={4} position={[x, -0.190, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Front shin panel — recessed face */}
          <mesh position={[x, -0.175, 0.210]}>
            <boxGeometry args={[0.235, 0.390, 0.045]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Ankle / boot top — gold accent band */}
          <mesh position={[x, -0.455, 0.080]}>
            <cylinderGeometry args={[0.200, 0.210, 0.072, 14]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Boot — wide and flat */}
          <RoundedBox args={[0.460, 0.145, 0.590]} radius={0.045} smoothness={4} position={[x, -0.530, 0.095]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Boot thruster fill — animated */}
          <mesh position={[x, -0.615, 0.095]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.150, 24]} />
            <meshBasicMaterial
              ref={legIdx === 0 ? thruster0Ref : thruster1Ref}
              color={offline ? '#444450' : color}
              transparent opacity={offline ? 0.03 : (active ? 0.45 : idle ? 0.14 : 0.03)}
            />
          </mesh>
          {/* Boot thruster ring — animated */}
          <mesh position={[x, -0.617, 0.095]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.115, 0.162, 24]} />
            <meshBasicMaterial
              ref={legIdx === 0 ? thruster2Ref : thruster3Ref}
              color={offline ? '#444450' : color}
              transparent opacity={offline ? 0.03 : (active ? 0.65 : idle ? 0.28 : 0.06)}
            />
          </mesh>
        </group>
      ))}

      {/* ── Floor glow disk ──────────────────────────────────────────────── */}
      <mesh position={[0, -0.635, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.88, 32]} />
        <meshBasicMaterial color={offline ? '#333340' : color} transparent opacity={active ? 0.18 : idle ? 0.09 : 0.03} />
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
        intensity={agent.status === 'active' ? 1.8 : agent.status === 'idle' ? 0.7 : 0.15}
        distance={4.0}
        decay={2}
        position={[0, 3.2, 0]}
      />
      {/* Warm fill light from below (bounced thruster effect) */}
      <pointLight
        color={agent.color}
        intensity={agent.status === 'active' ? 0.4 : 0.12}
        distance={2.5}
        decay={2}
        position={[0, -0.4, 0]}
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
      camera={{ position: [0, 2.8, 10.8], fov: 46 }}
      style={{ background: 'transparent' }}
      gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.18 }}
      onClick={() => onSelect(null)}
    >
      <fog attach="fog" args={['#0b0c16', 14, 30]} />
      <ambientLight intensity={0.22} />
      {/* Key light — warm from upper front */}
      <directionalLight position={[4, 12, 8]} intensity={0.80} color="#ffe8d0" castShadow />
      {/* Fill light — cool from left */}
      <directionalLight position={[-8, 4, -4]} intensity={0.32} color="#3050c0" />
      {/* Rim light — from behind */}
      <directionalLight position={[0, 6, -8]} intensity={0.22} color="#ffffff" />

      <Grid
        position={[0, -0.64, 0]}
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

      <AgentMesh
        agent={jarvis as any}
        position={[0, 0, -1.4]}
        isSelected={selectedKey === jarvis.key}
        isJarvis
        onSelect={() => onSelect(selectedKey === jarvis.key ? null : jarvis.key)}
      />

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
