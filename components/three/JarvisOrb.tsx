'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { motion } from 'framer-motion';

function Particles({ pulse = 0 }: { pulse?: number }) {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) {
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
    ref.current.rotation.y = t * 0.07;
    ref.current.rotation.x = t * 0.025;
    const s = 1 + Math.sin(t * 1.4) * 0.025 + pulse * 0.06;
    ref.current.scale.setScalar(s);
  });

  return (
    <Points ref={ref} positions={positions}>
      <PointMaterial transparent color="#00ff88" size={0.02} sizeAttenuation depthWrite={false} opacity={0.85} />
    </Points>
  );
}

function NeuralLines() {
  const ref = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const pts = new Float32Array(300 * 6);
    for (let i = 0; i < 300; i++) {
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
    ref.current.rotation.y = t * 0.07;
    ref.current.rotation.x = t * 0.025;
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color="#00e5ff" transparent opacity={0.07} depthWrite={false} />
    </lineSegments>
  );
}

function Ring({ radius, tilt, speed, color }: { radius: number; tilt: number; speed: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.getElapsedTime() * speed;
  });
  return (
    <mesh ref={ref} rotation={[tilt, 0, 0]}>
      <torusGeometry args={[radius, 0.006, 16, 100]} />
      <meshBasicMaterial color={color} transparent opacity={0.28} />
    </mesh>
  );
}

export function JarvisOrb({ pulse = 0, className }: { pulse?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1.2, ease: 'easeOut' }}
    >
      <Canvas camera={{ position: [0, 0, 5.5], fov: 55 }} style={{ background: 'transparent' }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.3} />
        <Particles pulse={pulse} />
        <NeuralLines />
        <Ring radius={2.45} tilt={Math.PI / 4}   speed={0.28}  color="#00ff88" />
        <Ring radius={2.75} tilt={-Math.PI / 5.5} speed={-0.18} color="#00e5ff" />
        <Ring radius={3.1}  tilt={Math.PI / 2.8} speed={0.12}  color="#aa44ff" />
      </Canvas>
    </motion.div>
  );
}
