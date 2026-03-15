'use client';

import dynamic from 'next/dynamic';

const Spline = dynamic(() => import('@splinetool/react-spline'), { ssr: false });

interface SplineSceneProps {
  scene: string;
  className?: string;
  onLoad?: (spline: any) => void;
}

export function SplineScene({ scene, className, onLoad }: SplineSceneProps) {
  return (
    <Spline scene={scene} className={className} onLoad={onLoad} />
  );
}
