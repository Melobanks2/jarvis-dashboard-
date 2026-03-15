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
// Total height ≈ 3.26 units (y: −0.62 to 2.64)
// Proportions match spec: shoulders 52u, waist 26u, helmet 35h×28w, 3:1 h:w
function Robot({
  color, status, isSelected, isJarvis,
}: {
  color: string; status: string; isSelected: boolean; isJarvis: boolean;
}) {
  const c      = useMemo(() => new THREE.Color(color), [color]);
  const cDark  = useMemo(() => new THREE.Color(color).multiplyScalar(0.45), [color]);
  const cOff   = useMemo(() => new THREE.Color(color).lerp(GREY_MIX, 0.55), [color]);
  const cOffDk = useMemo(() => new THREE.Color(color).lerp(GREY_MIX, 0.72), [color]);

  const active  = status === 'active';
  const idle    = status === 'idle';
  const offline = status === 'offline';

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

    if (glowShellRef.current) {
      if (active) {
        const p = (Math.sin(t * (2 * Math.PI / 1.0)) + 1) / 2;
        glowShellRef.current.opacity = 0.07 + p * 0.13;
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

      {/* Active energy shell — glow aura */}
      <mesh>
        <sphereGeometry args={[1.55, 16, 12]} />
        <meshBasicMaterial ref={glowShellRef} color={color} transparent opacity={0} side={THREE.BackSide} depthWrite={false} />
      </mesh>

      {/* ══ HELMET ═══════════════════════════════════════════════════════════
          Target: 35u tall × 28u wide (taller than wide, ratio 1.25:1)
          Sphere r=0.30 scale(1, 1.25, 0.92) → 0.60w × 0.75h × 0.55d
          Center y=2.250 → top 2.625, chin 1.875
      ══════════════════════════════════════════════════════════════════════ */}

      {/* Main helmet dome — elongated vertically, NOT a ball */}
      <mesh position={[0, 2.250, 0]} scale={[1.0, 1.25, 0.92]}>
        <sphereGeometry args={[0.300, 22, 16]} />
        <meshStandardMaterial {...armor()} />
      </mesh>

      {/* Faceplate — flat panel inset on front face of dome */}
      <mesh position={[0, 2.205, 0.285]}>
        <boxGeometry args={[0.320, 0.440, 0.050]} />
        <meshStandardMaterial {...armor()} />
      </mesh>

      {/* Brow ridge — horizontal bar above eyes */}
      <mesh position={[0, 2.392, 0.282]}>
        <boxGeometry args={[0.490, 0.058, 0.038]} />
        <meshStandardMaterial {...recess()} />
      </mesh>

      {/* Left eye slit — angled (outer corner higher = Iron Man angry look) */}
      <mesh position={[-0.094, 2.304, 0.296]} rotation={[0, 0, 0.22]}>
        <boxGeometry args={[0.150, 0.035, 0.026]} />
        <meshStandardMaterial
          ref={eyeRef0} color={glowC} emissive={glowEm}
          emissiveIntensity={offline ? 0.0 : (isSelected ? 3.4 : 2.4)}
          metalness={0.1} roughness={0.03}
        />
      </mesh>
      {/* Right eye slit — mirror */}
      <mesh position={[0.094, 2.304, 0.296]} rotation={[0, 0, -0.22]}>
        <boxGeometry args={[0.150, 0.035, 0.026]} />
        <meshStandardMaterial
          ref={eyeRef1} color={glowC} emissive={glowEm}
          emissiveIntensity={offline ? 0.0 : (isSelected ? 3.4 : 2.4)}
          metalness={0.1} roughness={0.03}
        />
      </mesh>

      {/* Cheek flares — armor panels on each side of faceplate */}
      {([-1, 1] as number[]).map(s => (
        <mesh key={s} position={[s * 0.268, 2.172, 0.202]} rotation={[0, s * -0.40, 0]}>
          <boxGeometry args={[0.056, 0.168, 0.060]} />
          <meshStandardMaterial {...recess()} />
        </mesh>
      ))}

      {/* Faceplate side seam lines */}
      {([-1, 1] as number[]).map(s => (
        <mesh key={s} position={[s * 0.158, 2.205, 0.272]} rotation={[0, s * 0.30, 0]}>
          <boxGeometry args={[0.013, 0.415, 0.014]} />
          <meshStandardMaterial {...recess()} />
        </mesh>
      ))}

      {/* Chin piece — tapered, angled slightly forward */}
      <mesh position={[0, 1.918, 0.248]} rotation={[0.20, 0, 0]}>
        <boxGeometry args={[0.192, 0.115, 0.058]} />
        <meshStandardMaterial {...armor()} />
      </mesh>

      {/* Neck collar — connects helmet to chest */}
      <mesh position={[0, 1.785, 0]}>
        <cylinderGeometry args={[0.095, 0.116, 0.155, 12]} />
        <meshStandardMaterial {...gold()} />
      </mesh>

      {/* Crown sensor nub */}
      <mesh position={[0, 2.638, -0.012]}>
        <sphereGeometry args={[0.026, 10, 8]} />
        <meshStandardMaterial color={glowC} emissive={glowEm} emissiveIntensity={offline ? 0.0 : 0.55} metalness={0.5} roughness={0.2} />
      </mesh>

      {/* ══ CHEST — tapered: wide at shoulders, narrow at waist ══════════════
          Shoulder width target: 52u → 0.900 total → ±0.450 outer edge
          Upper chest: 0.68w, lower/abs: 0.50w (creates heroic taper)
      ══════════════════════════════════════════════════════════════════════ */}

      {/* Upper chest — broad, houses pec plates */}
      <RoundedBox args={[0.680, 0.520, 0.600]} radius={0.055} smoothness={4} position={[0, 1.442, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>

      {/* Lower chest / abs — narrower at waist */}
      <RoundedBox args={[0.500, 0.440, 0.540]} radius={0.050} smoothness={4} position={[0, 0.950, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>

      {/* Left pec plate */}
      <RoundedBox args={[0.265, 0.368, 0.070]} radius={0.036} smoothness={4} position={[-0.172, 1.502, 0.315]}>
        <meshStandardMaterial {...armor()} />
      </RoundedBox>
      {/* Right pec plate */}
      <RoundedBox args={[0.265, 0.368, 0.070]} radius={0.036} smoothness={4} position={[0.172, 1.502, 0.315]}>
        <meshStandardMaterial {...armor()} />
      </RoundedBox>

      {/* Sternum center strip */}
      <mesh position={[0, 1.470, 0.318]}>
        <boxGeometry args={[0.060, 0.392, 0.036]} />
        <meshStandardMaterial {...recess()} />
      </mesh>

      {/* Pec lower seam lines */}
      {([-0.172, 0.172] as number[]).map(x => (
        <mesh key={x} position={[x, 1.222, 0.308]}>
          <boxGeometry args={[0.255, 0.013, 0.018]} />
          <meshStandardMaterial {...recess()} />
        </mesh>
      ))}

      {/* Arc reactor ring */}
      <mesh position={[0, 1.316, 0.324]}>
        <torusGeometry args={[0.095, 0.028, 16, 36]} />
        <meshStandardMaterial
          ref={arcRingRef} color={offline ? '#888898' : color} emissive={glowEm}
          emissiveIntensity={offline ? 0.0 : (isSelected ? 2.8 : 2.0)}
          metalness={0.3} roughness={0.06}
        />
      </mesh>
      {/* Arc reactor core */}
      <mesh position={[0, 1.316, 0.336]}>
        <circleGeometry args={[0.065, 36]} />
        <meshBasicMaterial ref={arcCoreRef} color={offline ? '#666676' : '#d8f0ff'} transparent opacity={offline ? 0.0 : (isSelected ? 0.95 : 0.72)} />
      </mesh>

      {/* Abdominal plates — three horizontal segments */}
      {([1.068, 0.964, 0.866] as number[]).map((y, i) => (
        <mesh key={y} position={[0, y, 0.283]}>
          <boxGeometry args={[0.360 - i * 0.040, 0.022, 0.022]} />
          <meshBasicMaterial color={offline ? '#666676' : color} transparent opacity={offline ? 0.0 : (0.22 - i * 0.04)} />
        </mesh>
      ))}

      {/* Pelvis — bridges torso to legs */}
      <RoundedBox args={[0.440, 0.175, 0.460]} radius={0.038} smoothness={4} position={[0, 0.658, 0]}>
        <meshStandardMaterial {...recess()} />
      </RoundedBox>

      {/* Hip gold panels */}
      {([-0.160, 0.160] as number[]).map(x => (
        <mesh key={x} position={[x, 0.665, 0.240]}>
          <boxGeometry args={[0.134, 0.115, 0.044]} />
          <meshStandardMaterial {...gold()} />
        </mesh>
      ))}

      {/* ══ SHOULDERS — at ±0.420, pauldron outer edge ≈ ±0.630 ═════════════
          Target total shoulder width: 52u → ±0.450 outer, pauldron center ±0.420
      ══════════════════════════════════════════════════════════════════════ */}

      {([-1, 1] as number[]).map(side => (
        <group key={side}>
          {/* Pauldron dome — sphere scaled for heroic look */}
          <mesh position={[side * 0.418, 1.552, -0.038]} scale={[1.04, 0.82, 0.92]}>
            <sphereGeometry args={[0.212, 18, 12]} />
            <meshStandardMaterial {...armor()} />
          </mesh>
          {/* Shoulder joint gold ring */}
          <mesh position={[side * 0.376, 1.354, 0.098]}>
            <torusGeometry args={[0.064, 0.016, 8, 20]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Pauldron skirt — tapered cylinder below dome */}
          <mesh position={[side * 0.418, 1.276, -0.038]}>
            <cylinderGeometry args={[0.165, 0.126, 0.192, 16]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Top seam line across dome */}
          <mesh position={[side * 0.418, 1.735, 0.014]}>
            <boxGeometry args={[0.330, 0.016, 0.270]} />
            <meshBasicMaterial color={offline ? '#666676' : color} transparent opacity={offline ? 0.0 : 0.14} />
          </mesh>
        </group>
      ))}

      {/* ══ ARMS — center at ±0.338 ═══════════════════════════════════════════
          Target: upper 13u wide, forearm 15u wide (slightly wider)
          At our scale: 0.225 and 0.260 → centers at ±0.338 (inside pauldrons)
      ══════════════════════════════════════════════════════════════════════ */}

      {([-0.338, 0.338] as number[]).map(x => (
        <group key={x}>
          {/* Upper arm */}
          <mesh position={[x, 1.092, 0]}>
            <cylinderGeometry args={[0.085, 0.078, 0.398, 14]} />
            <meshStandardMaterial {...armor()} />
          </mesh>
          {/* Elbow joint */}
          <mesh position={[x, 0.849, 0]}>
            <sphereGeometry args={[0.096, 12, 8]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Forearm / gauntlet — slightly wider than upper arm */}
          <RoundedBox args={[0.220, 0.396, 0.212]} radius={0.036} smoothness={4} position={[x, 0.572, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Forearm vertical panel lines */}
          {([-0.052, 0.052] as number[]).map(dx => (
            <mesh key={dx} position={[x + dx, 0.578, -0.108]}>
              <boxGeometry args={[0.011, 0.258, 0.010]} />
              <meshStandardMaterial {...recess()} />
            </mesh>
          ))}
          {/* Back-of-forearm gold tech panel */}
          <mesh position={[x, 0.582, -0.116]}>
            <boxGeometry args={[0.188, 0.292, 0.036]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Wrist band */}
          <mesh position={[x, 0.338, 0]}>
            <cylinderGeometry args={[0.112, 0.112, 0.053, 12]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Repulsor disc */}
          <mesh position={[x, 0.308, 0.115]}>
            <circleGeometry args={[0.048, 24]} />
            <meshBasicMaterial color={offline ? '#888898' : color} transparent opacity={offline ? 0.0 : (isSelected ? 0.95 : 0.76)} />
          </mesh>
          <mesh position={[x, 0.308, 0.108]}>
            <torusGeometry args={[0.048, 0.013, 8, 24]} />
            <meshStandardMaterial color={offline ? '#888898' : color} emissive={glowEm} emissiveIntensity={offline ? 0.0 : (isSelected ? 2.4 : 1.4)} metalness={0.3} roughness={0.07} />
          </mesh>
        </group>
      ))}

      {/* ══ LEGS — center at ±0.165 ═══════════════════════════════════════════
          Target: thigh 16u wide, shin 14u wide
          At our scale: 0.277 thigh, 0.242 shin → centers at ±0.165
      ══════════════════════════════════════════════════════════════════════ */}

      {([-0.165, 0.165] as number[]).map((x, legIdx) => (
        <group key={x}>
          {/* Hip joint */}
          <mesh position={[x, 0.558, 0]} scale={[1, 0.56, 1]}>
            <sphereGeometry args={[0.160, 12, 8]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Thigh */}
          <RoundedBox args={[0.268, 0.452, 0.262]} radius={0.044} smoothness={4} position={[x, 0.284, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Outer thigh vertical panel line */}
          <mesh position={[x * 1.22, 0.284, 0.095]}>
            <boxGeometry args={[0.013, 0.330, 0.016]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Inner thigh gold panel */}
          <mesh position={[x * 0.52, 0.284, 0.136]}>
            <boxGeometry args={[0.140, 0.316, 0.040]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Knee joint block */}
          <mesh position={[x, 0.022, 0.042]}>
            <boxGeometry args={[0.194, 0.104, 0.186]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Knee front plate */}
          <mesh position={[x, 0.024, 0.188]}>
            <boxGeometry args={[0.168, 0.150, 0.062]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Shin */}
          <RoundedBox args={[0.230, 0.412, 0.228]} radius={0.036} smoothness={4} position={[x, -0.196, 0]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Front shin panel */}
          <mesh position={[x, -0.184, 0.126]}>
            <boxGeometry args={[0.156, 0.318, 0.038]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Ankle band */}
          <mesh position={[x, -0.440, 0.060]}>
            <cylinderGeometry args={[0.126, 0.133, 0.058, 12]} />
            <meshStandardMaterial {...gold()} />
          </mesh>
          {/* Boot */}
          <RoundedBox args={[0.278, 0.132, 0.462]} radius={0.038} smoothness={4} position={[x, -0.525, 0.088]}>
            <meshStandardMaterial {...armor()} />
          </RoundedBox>
          {/* Boot seam line */}
          <mesh position={[x, -0.460, 0.196]}>
            <boxGeometry args={[0.265, 0.012, 0.016]} />
            <meshStandardMaterial {...recess()} />
          </mesh>
          {/* Boot thruster fill */}
          <mesh position={[x, -0.602, 0.088]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.112, 24]} />
            <meshBasicMaterial
              ref={legIdx === 0 ? thruster0Ref : thruster1Ref}
              color={offline ? '#888898' : color}
              transparent opacity={offline ? 0.0 : (active ? 0.45 : idle ? 0.12 : 0.0)}
            />
          </mesh>
          {/* Boot thruster ring */}
          <mesh position={[x, -0.604, 0.088]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.086, 0.120, 24]} />
            <meshBasicMaterial
              ref={legIdx === 0 ? thruster2Ref : thruster3Ref}
              color={offline ? '#888898' : color}
              transparent opacity={offline ? 0.0 : (active ? 0.65 : idle ? 0.22 : 0.0)}
            />
          </mesh>
        </group>
      ))}

      {/* Floor glow */}
      <mesh position={[0, -0.618, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.82, 32]} />
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
      {/* Main suit light */}
      <pointLight
        color={agent.color}
        intensity={isActive ? 3.0 : isIdle ? 0.9 : 0.50}
        distance={4.5}
        decay={2}
        position={[0, 3.2, 0]}
      />
      {/* Front-facing fill — illuminates face and chest when active */}
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
