'use client';

import { useState, useEffect } from 'react';

export interface Lead {
  id: string;
  contactId: string;
  name: string;
  phone: string;
  address: string;
  tags: string[];
  stage: string;
  createdAt: string;
  updatedAt: string;
  lastChange: string;
  daysInStage: number | null;
  value: number;
  lastNote: string | null;
}

export interface PipelineData {
  stages: Record<string, Lead[]>;
  total: number;
  stageOrder: string[];
}

export function usePipeline(refreshKey: number) {
  const [data,    setData]    = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch('/api/pipeline')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(json => { if (active) { setData(json); setLoading(false); } })
      .catch(e  => { if (active) { setError(String(e)); setLoading(false); } });
    return () => { active = false; };
  }, [refreshKey]);

  return { data, loading, error };
}
