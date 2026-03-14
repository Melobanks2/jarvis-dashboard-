'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { motion } from 'framer-motion';

function Particles({ pulse = 0 }: { pulse?: number }) {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(1600 * 3);
    for (let i = 0; i < 1600; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 2 * (0.88 + Math.random() * 0.12);
      arr[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = t * 0.055;
    ref.current.rotation.x = t * 0.018;
    const s = 1 + Math.sin(t * 1.2) * 0.018 + pulse * 0.04;
    ref.current.scale.setScalar(s);
  });

  return (
    <Points ref={ref} positions={positions}>
      <PointMaterial
        transparent
        color="#4ade80"
        size={0.018}
        sizeAttenuation
        depthWrite={false}
        opacity={0.70}
      />
    </Points>
  );
}

function NeuralLines() {
  const ref = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const pts = new Float32Array(250 * 6);
    for (let i = 0; i < 250; i++) {
      for (let v = 0; v < 2; v++) {
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        const r = 2;
        pts[i * 6 + v * 3]     = r * Math.sin(phi) * Math.cos(theta);
        pts[i * 6 + v * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        pts[i * 6 + v * 3 + 2] = r * Math.cos(phi);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    return geo;
  }, []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = t * 0.055;
    ref.current.rotation.x = t * 0.018;
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color="#4ade80" transparent opacity={0.055} depthWrite={false} />
    </lineSegments>
  );
}

function Ring({ radius, tilt, speed, color, opacity = 0.18 }: { radius: number; tilt: number; speed: number; color: string; opacity?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.getElapsedTime() * speed;
  });
  return (
    <mesh ref={ref} rotation={[tilt, 0, 0]}>
      <torusGeometry args={[radius, 0.004, 16, 100]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
}

export function JarvisOrb({ pulse = 0, className, style }: { pulse?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <Canvas
        camera={{ position: [0, 0, 5.5], fov: 52 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.2} />
        <Particles pulse={pulse} />
        <NeuralLines />
        <Ring radius={2.42} tilt={Math.PI / 4.5}  speed={0.22}  color="#4ade80" opacity={0.16} />
        <Ring radius={2.72} tilt={-Math.PI / 6}   speed={-0.14} color="#67e8f9" opacity={0.12} />
        <Ring radius={3.05} tilt={Math.PI / 2.8}  speed={0.09}  color="#a78bfa" opacity={0.10} />
      </Canvas>
    </motion.div>
  );
}
