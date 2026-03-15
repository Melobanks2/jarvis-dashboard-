'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBox, Grid, OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentInfo } from '@/lib/hooks/useAgents';

const ARC_POSITIONS: [number, number, number][] = [
  [-4.0, 0, 1.6],
  [-2.4, 0, 0.7],
  [-1.0, 0, 0.1],
  [ 1.0, 0, 0.1],
  [ 2.4, 0, 0.7],
  [ 4.0, 0, 1.6],
];

const GOLD       = new THREE.Color('#8a6c1e');
const GOLD_LIGHT = new THREE.Color('#c49a30');
const GREY_MIX   = new THREE.Color('#5a5a68');

// ── Iron Man Mark VII suit ────────────────────────────────────────────────────
function Robot({
  color, status, isSelected, isJarvis,
}: {
  color: string; status: string; isSelected: boolean; isJarvis: boolean;
}) {
  const c       = useMemo(() => new THREE.Color(color), [color]);
  const cDark   = useMemo(() => new THREE.Color(color).multiplyScalar(0.45), [color]);
  // Offline color: 55% grey blend — desaturated but still recognizable
  const cOff    = useMemo(() => new THREE.Color(color).lerp(GREY_MIX, 0.55), [color]);
  const cOffDk  = useMemo(() => new THREE.Color(color).lerp(GREY_MIX, 0.70), [color]);
  const errC    = useMemo(() => new THREE.Color('#280808'), []);

  const active  = status === 'active';
  const idle    = status === 'idle';
  const offline = status === 'offline';

  // ── Emissive baseline per state (not multiplied to invisibility) ──────────
  const emBase = active ? 0.55 : idle ? 0.32 : 0.0;   // offline base = 0 (ambient/lights do the work)
  const ei     = isSelected ? emBase * 1.8 : emBase;

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

    if (arcRingRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.8)) + 1) / 2;
        arcRingRef.current.emissiveIntensity = isSelected ? 2.4 + p * 1.4 : 1.6 + p * 1.1;
      } else if (idle) {
        const p = (Math.sin(t * (2 * Math.PI / 2.5)) + 1) / 2;
        arcRingRef.current.emissiveIntensity = 0.8 + p * 0.5;
      } else {
        arcRingRef.current.emissiveIntensity = 0.0;
      }
    }
    if (arcCoreRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.8)) + 1) / 2;
        arcCoreRef.current.opacity = 0.60 + p * 0.36;
      } else if (idle) {
        const p = (Math.sin(t * (2 * Math.PI / 2.5)) + 1) / 2;
        arcCoreRef.current.opacity = 0.30 + p * 0.28;
      } else {
        arcCoreRef.current.opacity = 0.0;
      }
    }

    [eyeRef0, eyeRef1].forEach(ref => {
      if (!ref.current) return;
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.8) + 0.4) + 1) / 2;
        ref.current.emissiveIntensity = isSelected ? 3.0 + p * 1.0 : 2.0 + p * 0.8;
      } else if (idle) {
        ref.current.emissiveIntensity = 0.7;
      } else {
        ref.current.emissiveIntensity = 0.0;
      }
    });

    [thruster0Ref, thruster1Ref].forEach((ref, i) => {
      if (!ref.current) return;
      if (active) {
        const flicker = (Math.sin(t * (2 * Math.PI / 0.4) + i * 1.3) + 1) / 2;
        ref.current.opacity = 0.40 + flicker * 0.32;
      } else { ref.current.opacity = idle ? 0.12 : 0.0; }
    });
    [thruster2Ref, thruster3Ref].forEach((ref, i) => {
      if (!ref.current) return;
      if (active) {
        const flicker = (Math.sin(t * (2 * Math.PI / 0.4) + i * 1.3 + 0.8) + 1) / 2;
        ref.current.opacity = 0.58 + flicker * 0.30;
      } else { ref.current.opacity = idle ? 0.22 : 0.0; }
    });

    if (glowShellRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 1.2)) + 1) / 2;
        glowShellRef.current.opacity = 0.04 + p * 0.07;
      } else { glowShellRef.current.opacity = 0; }
    }
  });

  // ── Material factories ────────────────────────────────────────────────────
  // Main armor plates — agent color (full saturation), ambient+lights make it visible
  const armor = () => ({
    color:             offline ? cOff   : c,
    emissive:          offline ? cOff   : c,
    emissiveIntensity: offline ? 0.0    : ei * 0.32,
    metalness: 0.76, roughness: 0.24,
  });
  // Panel recesses — darkened agent color
  const recess = () => ({
    color:             offline ? cOffDk : cDark,
    emissive:          offline ? cOffDk : c,
    emissiveIntensity: offline ? 0.0    : ei * 0.10,
    metalness: 0.92, roughness: 0.06,
  });
  // Gold accent joints
  const gold = () => ({
    color:             offline ? cOffDk : GOLD,
    emissive:          offline ? cOffDk : GOLD_LIGHT,
    emissiveIntensity: offline ? 0.0    : (isSelected ? 0.55 : 0.26),
    metalness: 0.88, roughness: 0.12,
  });
  const glowC  = offline ? '#888898' : color;
  const glowEm = offline ? new THREE.Color('#888898') : c;

  return (
    <group scale={isJarvis ? 1.32 : 1.0}>

      {/* Energy shell — active only */}
      <mesh>
        <sphereGeometry args={[1.68, 16, 12]} />
        <meshBasicMaterial ref={glowShellRef} color={color} transparent opacity={0} side={THREE.BackSide} depthWrite={false} />
      </mesh>

      {/* ══ HELMET — sphere dome + angular face ══════════════════════════════ */}

      {/* Skull dome — smooth rounded sphere (the key Iron Man shape) */}
      <mesh position={[0, 2.24, -0.02]} scale={[1.0, 1.02, 0.86]}>
        <sphereGeometry args={[0.403, 24, 18]} />
        <meshStandardMaterial {...armor()} />
      </mesh>
      {/* Faceplate — angular front mask panel */}
      <mesh position={[0, 2.10, 0.362]}>
        <boxGeometry args={[0.545, 0.58, 0.052]} />
        <meshStandardMaterial {...armor()} />
      </mesh>
      {/* Brow ridge */}
      <mesh position={[0, 2.390, 0.366]}>
        <boxGeometry args={[0.495, 0.070, 0.044]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Cheek panels */}
      <mesh position={[-0.310, 2.09, 0.346]}>
        <boxGeometry args={[0.088, 0.36, 0.058]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      <mesh position={[0.310, 2.09, 0.346]}>
        <boxGeometry args={[0.088, 0.36, 0.058]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Lower jaw block — fills gap between sphere and chin */}
      <mesh position={[0, 1.840, 0.305]}>
        <boxGeometry args={[0.595, 0.270, 0.605]} />
        <meshStandardMaterial {...armor()} />
      </mesh>
      {/* Chin — narrow, pointed */}
      <mesh position={[0, 1.810, 0.356]}>
        <boxGeometry args={[0.265, 0.195, 0.062]} />
        <meshStandardMaterial {...armor()} />
      </mesh>
      <mesh position={[0, 1.728, 0.347]}>
        <boxGeometry args={[0.170, 0.095, 0.055]} />
        <meshStandardMaterial {...armor()} />
      </mesh>

      {/* Eye slits — angled inward (inner lower, outer higher) */}
      <mesh position={[-0.142, 2.228, 0.398]} rotation={[0, 0, 0.22]}>
        <boxGeometry args={[0.190, 0.046, 0.028]} />
        <meshStandardMaterial ref={eyeRef0} color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.0 : (isSelected ? 3.4 : 2.4)} metalness={0.2} roughness={0.04} />
      </mesh>
      <mesh position={[0.142, 2.228, 0.398]} rotation={[0, 0, -0.22]}>
        <boxGeometry args={[0.190, 0.046, 0.028]} />
        <meshStandardMaterial ref={eyeRef1} color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.0 : (isSelected ? 3.4 : 2.4)} metalness={0.2} roughness={0.04} />
      </mesh>

      {/* Neck collar */}
      <mesh position={[0, 1.755, 0]}>
        <cylinderGeometry args={[0.215, 0.275, 0.180, 14]} />
        <meshStandardMaterial {...gold()} />
      </mesh>

      {/* Sensor nub — small dome on crown (replaces spike) */}
      <mesh position={[0, 2.645, -0.015]}>
        <sphereGeometry args={[0.038, 10, 8]} />
        <meshStandardMaterial color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.0 : 0.55} metalness={0.5} roughness={0.2} />
      </mesh>

      {/* ══ CHEST ═══════════════════════════════════════════════════════════ */}

      <RoundedBox args={[1.32, 0.74, 0.86]} radius={0.06} smoothness={4} position={[0, 1.290, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>
      {/* Left pec plate */}
      <RoundedBox args={[0.505, 0.500, 0.082]} radius={0.045} smoothness={4} position={[-0.305, 1.405, 0.435]}>
        <meshStandardMaterial {...armor()} />
      </RoundedBox>
      {/* Right pec plate */}
      <RoundedBox args={[0.505, 0.500, 0.082]} radius={0.045} smoothness={4} position={[0.305, 1.405, 0.435]}>
        <meshStandardMaterial {...armor()} />
      </RoundedBox>
      {/* Sternum strip */}
      <mesh position={[0, 1.400, 0.448]}>
        <boxGeometry args={[0.082, 0.500, 0.040]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Arc reactor ring */}
      <mesh position={[0, 1.295, 0.458]}>
        <torusGeometry args={[0.106, 0.034, 14, 36]} />
        <meshStandardMaterial ref={arcRingRef} color={offline ? '#888898' : color} emissive={glowEm} emissiveIntensity={offline ? 0.0 : (isSelected ? 2.8 : 2.0)} metalness={0.3} roughness={0.07} />
      </mesh>
      {/* Arc reactor core */}
      <mesh position={[0, 1.295, 0.467]}>
        <circleGeometry args={[0.072, 36]} />
        <meshBasicMaterial ref={arcCoreRef} color={offline ? '#666676' : '#d8f0ff'} transparent opacity={offline ? 0.0 : (isSelected ? 0.95 : 0.72)} />
      </mesh>

      {/* Waist / abs — narrower taper */}
      <RoundedBox args={[0.88, 0.560, 0.750]} radius={0.05} smoothness={4} position={[0, 0.738, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>
      {/* Abs segments */}
      {([0.912, 0.795, 0.682, 0.578] as number[]).map((y, i) => (
        <mesh key={y} position={[0, y, 0.380]}>
          <boxGeometry args={[0.56 - i * 0.06, 0.022, 0.024]} />
          <meshBasicMaterial color={offline ? '#666676' : color} transparent opacity={offline ? 0.0 : (0.22 - i * 0.04)} />
        </mesh>
      ))}
      {/* Hip joint gold panels */}
      {([-0.36, 0.36] as number[]).map(x => (
        <mesh key={x} position={[x, 0.614, 0.365]}>
          <boxGeometry args={[0.155, 0.130, 0.052]} />
          <meshStandardMaterial {...gold()} />
        </mesh>
      ))}

      {/* ══ SHOULDERS — large dome pauldrons ════════════════════════════════ */}

      {([-1, 1] as number[]).map(side => (
        <group key={side}>
          <mesh position={[side * 0.845, 1.565, -0.040]} scale={[1.05, 0.80, 0.90]}>
            <sphereGeometry args={[0.385, 22, 16]} />
            <meshStandardMaterial {...armor()} />
          </mesh>
          <mesh position={[side * 0.845, 1.268, -0.040]}>
            <cylinderGeometry args={[0.305, 0.230, 0.244, 18]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          <mesh position={[side * 0.845, 1.745, 0.010]}>
            <boxGeometry args={[0.435, 0.022, 0.340]} />
            <meshBasicMaterial color={offline ? '#666676' : color} transparent opacity={offline ? 0.0 : 0.16} />
          </mesh>
        </group>
      ))}

      {/* ══ ARMS ════════════════════════════════════════════════════════════ */}

      {([-0.800, 0.800] as number[]).map(x => (
        <group key={x}>
          {/* Upper arm — smooth cylinder */}
          <mesh position={[x, 1.106, 0]}>
            <cylinderGeometry args={[0.140, 0.130, 0.445, 16]} />
            <meshStandardMaterial {...armor()} />
          </mesh>
          {/* Elbow — gold sphere joint */}
          <mesh position={[x, 0.858, 0]}>
            <sphereGeometry args={[0.146, 14, 10]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Forearm — significantly wider gauntlet */}
          <RoundedBox args={[0.365, 0.510, 0.352]} radius={0.045} smoothness={4} position={[x, 0.572, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Back-of-forearm tech panel — gold */}
          <mesh position={[x, 0.586, -0.186]}>
            <boxGeometry args={[0.280, 0.352, 0.044]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Wrist band */}
          <mesh position={[x, 0.337, 0]}>
            <cylinderGeometry args={[0.175, 0.175, 0.068, 14]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Repulsor palm */}
          <mesh position={[x, 0.295, 0.182]}>
            <circleGeometry args={[0.062, 24]} />
            <meshBasicMaterial color={offline ? '#888898' : color} transparent opacity={offline ? 0.0 : (isSelected ? 0.95 : 0.76)} />
          </mesh>
          <mesh position={[x, 0.295, 0.175]}>
            <torusGeometry args={[0.062, 0.015, 8, 24]} />
            <meshStandardMaterial color={offline ? '#888898' : color} emissive={glowEm} emissiveIntensity={offline ? 0.0 : (isSelected ? 2.4 : 1.4)} metalness={0.3} roughness={0.07} />
          </mesh>
        </group>
      ))}

      {/* ══ LEGS ════════════════════════════════════════════════════════════ */}

      {([-0.294, 0.294] as number[]).map((x, legIdx) => (
        <group key={x}>
          {/* Hip joint sphere */}
          <mesh position={[x, 0.530, 0]} scale={[1, 0.55, 1]}>
            <sphereGeometry args={[0.220, 12, 8]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Thigh */}
          <RoundedBox args={[0.478, 0.562, 0.458]} radius={0.055} smoothness={4} position={[x, 0.268, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Inner thigh gold panel */}
          <mesh position={[x * 0.55, 0.268, 0.232]}>
            <boxGeometry args={[0.182, 0.382, 0.048]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Knee joint */}
          <mesh position={[x, 0.004, 0.050]}>
            <boxGeometry args={[0.302, 0.120, 0.222]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Knee front plate */}
          <mesh position={[x, 0.009, 0.220]}>
            <boxGeometry args={[0.265, 0.176, 0.076]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Shin */}
          <RoundedBox args={[0.392, 0.512, 0.376]} radius={0.045} smoothness={4} position={[x, -0.192, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Front shin face panel */}
          <mesh position={[x, -0.176, 0.212]}>
            <boxGeometry args={[0.235, 0.392, 0.045]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Ankle gold band */}
          <mesh position={[x, -0.458, 0.080]}>
            <cylinderGeometry args={[0.200, 0.210, 0.072, 14]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Boot */}
          <RoundedBox args={[0.462, 0.145, 0.592]} radius={0.045} smoothness={4} position={[x, -0.532, 0.095]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Boot thruster fill */}
          <mesh position={[x, -0.616, 0.095]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.150, 24]} />
            <meshBasicMaterial
              ref={legIdx === 0 ? thruster0Ref : thruster1Ref}
              color={offline ? '#888898' : color}
              transparent opacity={offline ? 0.0 : (active ? 0.45 : idle ? 0.12 : 0.0)}
            />
          </mesh>
          {/* Boot thruster ring */}
          <mesh position={[x, -0.618, 0.095]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.114, 0.160, 24]} />
            <meshBasicMaterial
              ref={legIdx === 0 ? thruster2Ref : thruster3Ref}
              color={offline ? '#888898' : color}
              transparent opacity={offline ? 0.0 : (active ? 0.65 : idle ? 0.22 : 0.0)}
            />
          </mesh>
        </group>
      ))}

      {/* Floor glow */}
      <mesh position={[0, -0.638, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.90, 32]} />
        <meshBasicMaterial color={offline ? '#666676' : color} transparent opacity={active ? 0.18 : idle ? 0.08 : 0.0} />
      </mesh>
    </group>
  );
}

// ── Individual agent mesh with floating + click + name label ─────────────────
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

  const isActive  = agent.status === 'active';
  const isIdle    = agent.status === 'idle';
  const isOffline = agent.status === 'offline';

  const dotColor   = isActive ? '#4ade80' : isIdle ? '#fbbf24' : '#ef4444';
  const nameColor  = isActive ? agent.color
                   : isIdle   ? `${agent.color}bb`
                   :            `${agent.color}66`;
  const nameShadow = isActive ? `0 0 8px ${agent.color}` : 'none';

  return (
    <group
      ref={ref}
      position={position}
      scale={isSelected ? 1.10 : 1}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = 'default'; }}
    >
      {/* Main suit light from above */}
      <pointLight
        color={agent.color}
        intensity={isActive ? 1.8 : isIdle ? 0.9 : 0.50}
        distance={4.0}
        decay={2}
        position={[0, 3.2, 0]}
      />
      {/* Warm fill from below — bounce/thruster */}
      <pointLight
        color={agent.color}
        intensity={isActive ? 0.45 : isIdle ? 0.18 : 0.10}
        distance={2.5}
        decay={2}
        position={[0, -0.4, 0]}
      />

      <Robot color={agent.color} status={agent.status} isSelected={isSelected} isJarvis={isJarvis} />

      {/* Name label — 3D-positioned HTML overlay */}
      <Html
        position={[0, -0.92, 0]}
        center
        distanceFactor={7.5}
        style={{ pointerEvents: 'none' }}
        zIndexRange={[10, 0]}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          color: nameColor,
          fontSize: '12px',
          fontWeight: 500,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          textShadow: nameShadow,
          whiteSpace: 'nowrap',
          userSelect: 'none',
          letterSpacing: '0.5px',
        }}>
          <span style={{
            width: '6px', height: '6px',
            borderRadius: '50%',
            background: dotColor,
            display: 'inline-block',
            flexShrink: 0,
            boxShadow: isActive ? `0 0 5px ${dotColor}` : 'none',
          }} />
          {agent.name}
        </div>
      </Html>
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
      gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.20 }}
      onClick={() => onSelect(null)}
    >
      <fog attach="fog" args={['#0b0c16', 14, 30]} />

      {/* Ambient — base fill so offline suits remain visible */}
      <ambientLight intensity={0.45} color="#c8d0e8" />
      {/* Key light — warm from upper front */}
      <directionalLight position={[4, 12, 8]} intensity={0.75} color="#ffe8d0" />
      {/* Fill light — cool from left */}
      <directionalLight position={[-8, 4, -4]} intensity={0.35} color="#3050c0" />
      {/* Rim light — separation from background */}
      <directionalLight position={[0, 6, -8]} intensity={0.28} color="#ffffff" />

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
