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

// ── LatheGeometry profile for the Iron Man helmet shell ───────────────────────
// Revolved around Y axis — wide at cheekbones, tapers to chin and crown.
// All coordinates in local space; group is centered at world y=2.18.
const HELMET_PTS: [number, number][] = [
  [0.062, -0.338],  // chin tip
  [0.132, -0.272],  // chin
  [0.220, -0.168],  // lower jaw
  [0.314, -0.044],  // jaw
  [0.390,  0.080],  // cheek lower
  [0.408,  0.186],  // cheekbone — widest point
  [0.385,  0.292],  // temple
  [0.350,  0.396],  // upper side
  [0.274,  0.484],  // crown lower
  [0.175,  0.550],  // crown
  [0.076,  0.606],  // near top
  [0.022,  0.642],  // peak
];

// ── Iron Man Mark VII suit ────────────────────────────────────────────────────
function Robot({
  color, status, isSelected, isJarvis,
}: {
  color: string; status: string; isSelected: boolean; isJarvis: boolean;
}) {
  const c      = useMemo(() => new THREE.Color(color), [color]);
  const cDark  = useMemo(() => new THREE.Color(color).multiplyScalar(0.45), [color]);
  const cOff   = useMemo(() => new THREE.Color(color).lerp(GREY_MIX, 0.55), [color]);
  const cOffDk = useMemo(() => new THREE.Color(color).lerp(GREY_MIX, 0.72), [color]);

  // Helmet LatheGeometry — one per component instance, deps=[] so created once
  const helmetGeo = useMemo(() => {
    const pts = HELMET_PTS.map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, 30);
  }, []);

  const active  = status === 'active';
  const idle    = status === 'idle';
  const offline = status === 'offline';

  // Higher baseline for active — dramatically more visible
  const emBase = active ? 0.88 : idle ? 0.32 : 0.0;
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

    // Arc reactor — fast pulse when active, slow breathe when idle
    if (arcRingRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.7)) + 1) / 2;
        arcRingRef.current.emissiveIntensity = isSelected ? 3.2 + p * 1.6 : 2.2 + p * 1.2;
      } else if (idle) {
        const p = (Math.sin(t * (2 * Math.PI / 2.5)) + 1) / 2;
        arcRingRef.current.emissiveIntensity = 0.8 + p * 0.5;
      } else {
        arcRingRef.current.emissiveIntensity = 0.0;
      }
    }
    if (arcCoreRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.7)) + 1) / 2;
        arcCoreRef.current.opacity = 0.65 + p * 0.32;
      } else if (idle) {
        const p = (Math.sin(t * (2 * Math.PI / 2.5)) + 1) / 2;
        arcCoreRef.current.opacity = 0.32 + p * 0.26;
      } else {
        arcCoreRef.current.opacity = 0.0;
      }
    }

    // Eyes — full bright when active
    [eyeRef0, eyeRef1].forEach(ref => {
      if (!ref.current) return;
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 0.7) + 0.4) + 1) / 2;
        ref.current.emissiveIntensity = isSelected ? 4.0 + p * 1.2 : 2.8 + p * 1.0;
      } else if (idle) {
        ref.current.emissiveIntensity = 0.7;
      } else {
        ref.current.emissiveIntensity = 0.0;
      }
    });

    // Boot thrusters — flicker
    [thruster0Ref, thruster1Ref].forEach((ref, i) => {
      if (!ref.current) return;
      if (active) {
        const f = (Math.sin(t * (2 * Math.PI / 0.35) + i * 1.3) + 1) / 2;
        ref.current.opacity = 0.45 + f * 0.35;
      } else { ref.current.opacity = idle ? 0.12 : 0.0; }
    });
    [thruster2Ref, thruster3Ref].forEach((ref, i) => {
      if (!ref.current) return;
      if (active) {
        const f = (Math.sin(t * (2 * Math.PI / 0.35) + i * 1.3 + 0.8) + 1) / 2;
        ref.current.opacity = 0.65 + f * 0.30;
      } else { ref.current.opacity = idle ? 0.22 : 0.0; }
    });

    // Outer energy shell — stronger for active
    if (glowShellRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 1.0)) + 1) / 2;
        glowShellRef.current.opacity = 0.07 + p * 0.13;  // max 0.20 (was 0.11)
      } else { glowShellRef.current.opacity = 0; }
    }
  });

  // ── Material factories ────────────────────────────────────────────────────
  const armor = () => ({
    color:             offline ? cOff   : c,
    emissive:          offline ? cOff   : c,
    emissiveIntensity: offline ? 0.0    : ei * 0.36,
    metalness: 0.76, roughness: 0.24,
  });
  const recess = () => ({
    color:             offline ? cOffDk : cDark,
    emissive:          offline ? cOffDk : c,
    emissiveIntensity: offline ? 0.0    : ei * 0.10,
    metalness: 0.94, roughness: 0.05,
  });
  const gold = () => ({
    color:             offline ? cOffDk : GOLD,
    emissive:          offline ? cOffDk : GOLD_LIGHT,
    emissiveIntensity: offline ? 0.0    : (isSelected ? 0.65 : 0.30),
    metalness: 0.88, roughness: 0.12,
  });
  const glowC  = offline ? '#888898' : color;
  const glowEm = offline ? new THREE.Color('#888898') : c;

  return (
    <group scale={isJarvis ? 1.32 : 1.0}>

      {/* Energy shell — active glow (max 0.20 opacity, was 0.11) */}
      <mesh>
        <sphereGeometry args={[1.72, 16, 12]} />
        <meshBasicMaterial ref={glowShellRef} color={color} transparent opacity={0} side={THREE.BackSide} depthWrite={false} />
      </mesh>

      {/* ══ HELMET — LatheGeometry shell + faceplate details ════════════════ */}

      {/* Main helmet shell — Iron Man profile (wide cheekbones, tapered chin) */}
      <mesh position={[0, 2.18, 0]} geometry={helmetGeo}>
        <meshStandardMaterial {...armor()} side={THREE.FrontSide} />
      </mesh>

      {/* Faceplate panel — raised from the lathe surface */}
      <mesh position={[0, 2.13, 0.398]}>
        <boxGeometry args={[0.530, 0.570, 0.055]} />
        <meshStandardMaterial {...armor()} />
      </mesh>

      {/* Faceplate seam — top groove */}
      <mesh position={[0, 2.400, 0.378]}>
        <boxGeometry args={[0.470, 0.014, 0.018]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Faceplate seam — bottom groove */}
      <mesh position={[0, 1.875, 0.342]}>
        <boxGeometry args={[0.370, 0.014, 0.016]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Faceplate seam — left side groove */}
      <mesh position={[-0.268, 2.145, 0.356]} rotation={[0, 0.38, 0]}>
        <boxGeometry args={[0.014, 0.500, 0.016]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Faceplate seam — right side groove */}
      <mesh position={[0.268, 2.145, 0.356]} rotation={[0, -0.38, 0]}>
        <boxGeometry args={[0.014, 0.500, 0.016]} />
        <meshStandardMaterial {...recess()} />
      </mesh>

      {/* Forehead center ridge */}
      <mesh position={[0, 2.360, 0.400]}>
        <boxGeometry args={[0.020, 0.120, 0.018]} />
        <meshStandardMaterial {...recess()} />
      </mesh>

      {/* Ear/side panels at cheekbone level */}
      {([-1, 1] as number[]).map(s => (
        <mesh key={s} position={[s * 0.378, 2.190, 0.060]} rotation={[0, s * -0.70, 0]}>
          <boxGeometry args={[0.075, 0.175, 0.100]} />
          <meshStandardMaterial {...recess()} />
        </mesh>
      ))}

      {/* Brow ridge above eyes */}
      <mesh position={[0, 2.395, 0.402]}>
        <boxGeometry args={[0.475, 0.068, 0.042]} />
        <meshStandardMaterial {...recess()} />
      </mesh>

      {/* Chin — angular point (the LatheGeometry already tapers, these add angularity) */}
      <mesh position={[0, 1.830, 0.355]}>
        <boxGeometry args={[0.250, 0.185, 0.060]} />
        <meshStandardMaterial {...armor()} />
      </mesh>
      <mesh position={[0, 1.750, 0.344]}>
        <boxGeometry args={[0.162, 0.092, 0.052]} />
        <meshStandardMaterial {...armor()} />
      </mesh>

      {/* Eye slits — wide, thin, angled (outer high, inner low = angry Iron Man) */}
      <mesh position={[-0.138, 2.278, 0.408]} rotation={[0, 0, 0.30]}>
        <boxGeometry args={[0.205, 0.040, 0.026]} />
        <meshStandardMaterial ref={eyeRef0} color={glowC} emissive={glowEm}
          emissiveIntensity={offline ? 0.0 : (isSelected ? 3.4 : 2.4)} metalness={0.1} roughness={0.03} />
      </mesh>
      <mesh position={[0.138, 2.278, 0.408]} rotation={[0, 0, -0.30]}>
        <boxGeometry args={[0.205, 0.040, 0.026]} />
        <meshStandardMaterial ref={eyeRef1} color={glowC} emissive={glowEm}
          emissiveIntensity={offline ? 0.0 : (isSelected ? 3.4 : 2.4)} metalness={0.1} roughness={0.03} />
      </mesh>

      {/* Neck collar */}
      <mesh position={[0, 1.750, 0]}>
        <cylinderGeometry args={[0.212, 0.272, 0.180, 14]} />
        <meshStandardMaterial {...gold()} />
      </mesh>

      {/* Sensor nub — small dome on crown */}
      <mesh position={[0, 2.820, -0.015]}>
        <sphereGeometry args={[0.036, 10, 8]} />
        <meshStandardMaterial color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.0 : 0.55} metalness={0.5} roughness={0.2} />
      </mesh>

      {/* ══ CHEST ═══════════════════════════════════════════════════════════ */}

      {/* Chest base — very broad */}
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
        <boxGeometry args={[0.080, 0.500, 0.040]} />
        <meshStandardMaterial {...recess()} />
      </mesh>
      {/* Pec lower seam lines */}
      {([-0.305, 0.305] as number[]).map(x => (
        <mesh key={x} position={[x, 1.168, 0.430]}>
          <boxGeometry args={[0.490, 0.016, 0.022]} />
          <meshStandardMaterial {...recess()} />
        </mesh>
      ))}
      {/* Arc reactor ring — enlarged */}
      <mesh position={[0, 1.295, 0.458]}>
        <torusGeometry args={[0.115, 0.036, 16, 40]} />
        <meshStandardMaterial ref={arcRingRef} color={offline ? '#888898' : color} emissive={glowEm}
          emissiveIntensity={offline ? 0.0 : (isSelected ? 2.8 : 2.0)} metalness={0.3} roughness={0.06} />
      </mesh>
      {/* Arc reactor core */}
      <mesh position={[0, 1.295, 0.470]}>
        <circleGeometry args={[0.080, 36]} />
        <meshBasicMaterial ref={arcCoreRef} color={offline ? '#666676' : '#d8f0ff'} transparent opacity={offline ? 0.0 : (isSelected ? 0.95 : 0.72)} />
      </mesh>

      {/* Waist / abs */}
      <RoundedBox args={[0.88, 0.560, 0.750]} radius={0.05} smoothness={4} position={[0, 0.738, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>
      {/* Abs segments */}
      {([0.912, 0.795, 0.682] as number[]).map((y, i) => (
        <mesh key={y} position={[0, y, 0.382]}>
          <boxGeometry args={[0.58 - i * 0.06, 0.024, 0.026]} />
          <meshBasicMaterial color={offline ? '#666676' : color} transparent opacity={offline ? 0.0 : (0.24 - i * 0.05)} />
        </mesh>
      ))}
      {/* Hip gold panels */}
      {([-0.36, 0.36] as number[]).map(x => (
        <mesh key={x} position={[x, 0.614, 0.365]}>
          <boxGeometry args={[0.155, 0.130, 0.052]} />
          <meshStandardMaterial {...gold()} />
        </mesh>
      ))}

      {/* ══ SHOULDERS ═══════════════════════════════════════════════════════ */}

      {([-1, 1] as number[]).map(side => (
        <group key={side}>
          {/* Main pauldron dome */}
          <mesh position={[side * 0.845, 1.565, -0.040]} scale={[1.05, 0.80, 0.90]}>
            <sphereGeometry args={[0.385, 22, 16]} />
            <meshStandardMaterial {...armor()} />
          </mesh>
          {/* Shoulder joint circle detail */}
          <mesh position={[side * 0.800, 1.330, 0.100]}>
            <torusGeometry args={[0.075, 0.018, 8, 20]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Pauldron skirt */}
          <mesh position={[side * 0.845, 1.268, -0.040]}>
            <cylinderGeometry args={[0.305, 0.230, 0.244, 18]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Top panel seam */}
          <mesh position={[side * 0.845, 1.745, 0.010]}>
            <boxGeometry args={[0.435, 0.020, 0.340]} />
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
          {/* Elbow joint */}
          <mesh position={[x, 0.858, 0]}>
            <sphereGeometry args={[0.148, 14, 10]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Forearm / gauntlet */}
          <RoundedBox args={[0.365, 0.510, 0.352]} radius={0.045} smoothness={4} position={[x, 0.572, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Forearm vertical panel lines */}
          {([-0.060, 0.060] as number[]).map(dx => (
            <mesh key={dx} position={[x + dx, 0.580, -0.178]}>
              <boxGeometry args={[0.014, 0.280, 0.012]} />
              <meshStandardMaterial {...recess()} />
            </mesh>
          ))}
          {/* Back-of-forearm tech panel */}
          <mesh position={[x, 0.586, -0.186]}>
            <boxGeometry args={[0.280, 0.352, 0.044]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Wrist band */}
          <mesh position={[x, 0.337, 0]}>
            <cylinderGeometry args={[0.175, 0.175, 0.068, 14]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Repulsor */}
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
          {/* Hip joint */}
          <mesh position={[x, 0.530, 0]} scale={[1, 0.55, 1]}>
            <sphereGeometry args={[0.220, 12, 8]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Thigh */}
          <RoundedBox args={[0.478, 0.562, 0.458]} radius={0.055} smoothness={4} position={[x, 0.268, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Outer thigh vertical panel line */}
          <mesh position={[x * 1.22, 0.268, 0.100]}>
            <boxGeometry args={[0.016, 0.380, 0.020]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
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
          {/* Knee plate */}
          <mesh position={[x, 0.009, 0.220]}>
            <boxGeometry args={[0.265, 0.176, 0.076]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Shin */}
          <RoundedBox args={[0.392, 0.512, 0.376]} radius={0.045} smoothness={4} position={[x, -0.192, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Front shin panel */}
          <mesh position={[x, -0.176, 0.212]}>
            <boxGeometry args={[0.235, 0.392, 0.045]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Ankle band */}
          <mesh position={[x, -0.458, 0.080]}>
            <cylinderGeometry args={[0.200, 0.210, 0.072, 14]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Boot */}
          <RoundedBox args={[0.462, 0.145, 0.592]} radius={0.045} smoothness={4} position={[x, -0.532, 0.095]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Boot horizontal seam line */}
          <mesh position={[x, -0.468, 0.225]}>
            <boxGeometry args={[0.446, 0.014, 0.020]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
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
        <circleGeometry args={[0.95, 32]} />
        <meshBasicMaterial color={offline ? '#666676' : color} transparent opacity={active ? 0.22 : idle ? 0.09 : 0.0} />
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

  const dotColor   = isActive ? '#4ade80' : isIdle ? '#fbbf24' : '#ef4444';
  const nameColor  = isActive ? agent.color : isIdle ? `${agent.color}bb` : `${agent.color}66`;
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
      {/* Main suit light — 3.0 for active (was 1.8) */}
      <pointLight
        color={agent.color}
        intensity={isActive ? 3.0 : isIdle ? 0.9 : 0.50}
        distance={4.5}
        decay={2}
        position={[0, 3.2, 0]}
      />
      {/* Front-facing light — active only, illuminates the face/chest */}
      <pointLight
        color={agent.color}
        intensity={isActive ? 0.90 : 0.0}
        distance={3.0}
        decay={2}
        position={[0, 1.5, 2.2]}
      />
      {/* Bounce fill from below */}
      <pointLight
        color={agent.color}
        intensity={isActive ? 0.55 : isIdle ? 0.18 : 0.10}
        distance={2.5}
        decay={2}
        position={[0, -0.4, 0]}
      />

      <Robot color={agent.color} status={agent.status} isSelected={isSelected} isJarvis={isJarvis} />

      {/* Name label */}
      <Html position={[0, -0.92, 0]} center distanceFactor={7.5} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          color: nameColor, fontSize: '12px', fontWeight: 500,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          textShadow: nameShadow, whiteSpace: 'nowrap', userSelect: 'none', letterSpacing: '0.5px',
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: dotColor, display: 'inline-block', flexShrink: 0,
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
  key: string; name: string; color: string; description: string;
  schedule: string; lastActivity: string | null; runCount: number;
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
      gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.22 }}
      onClick={() => onSelect(null)}
    >
      <fog attach="fog" args={['#0b0c16', 14, 30]} />
      <ambientLight intensity={0.45} color="#c8d0e8" />
      <directionalLight position={[4, 12, 8]}  intensity={0.75} color="#ffe8d0" />
      <directionalLight position={[-8, 4, -4]} intensity={0.35} color="#3050c0" />
      <directionalLight position={[0, 6, -8]}  intensity={0.28} color="#ffffff" />

      <Grid
        position={[0, -0.64, 0]} args={[30, 30]}
        cellSize={0.9} cellThickness={0.4} cellColor="#161628"
        sectionSize={4.5} sectionThickness={0.8} sectionColor="#202040"
        fadeDistance={22} fadeStrength={1.5} infiniteGrid
      />

      <AgentMesh agent={jarvis as any} position={[0, 0, -1.4]}
        isSelected={selectedKey === jarvis.key} isJarvis
        onSelect={() => onSelect(selectedKey === jarvis.key ? null : jarvis.key)} />

      {agents.map((agent, i) => (
        <AgentMesh key={agent.key} agent={agent as any}
          position={ARC_POSITIONS[i] ?? [i * 1.6 - 4, 0, 0]}
          isSelected={selectedKey === agent.key} isJarvis={false}
          onSelect={() => onSelect(selectedKey === agent.key ? null : agent.key)} />
      ))}

      <OrbitControls enablePan={false} enableZoom={false}
        minPolarAngle={Math.PI / 5} maxPolarAngle={Math.PI / 2.2}
        autoRotate={!selectedKey} autoRotateSpeed={0.35} target={[0, 1.2, 0]} />
    </Canvas>
  );
}
