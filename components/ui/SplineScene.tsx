'use client';

import { Suspense, lazy } from 'react';
const Spline = lazy(() => import('@splinetool/react-spline'));

interface SplineSceneProps {
  scene: string;
  className?: string;
  onLoad?: (spline: any) => void;
}

export function SplineScene({ scene, className, onLoad }: SplineSceneProps) {
  return (
    <Suspense
      fallback={
        <div className="w-full h-full flex items-center justify-center">
          <div style={{
            width: '40px', height: '40px',
            border: '2px solid rgba(83,74,183,0.3)',
            borderTop: '2px solid #534AB7',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
        </div>
      }
    >
      <Spline scene={scene} className={className} onLoad={onLoad} />
    </Suspense>
  );
}
