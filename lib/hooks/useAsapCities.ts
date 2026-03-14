'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface AsapCity {
  id: string;
  city: string;
  state: string;
  status: 'completed' | 'running' | 'queued' | 'failed';
  leads_found: number;
  last_run: string | null;
  created_at: string;
}

export function useAsapCities(refreshKey: number) {
  const [cities, setCities] = useState<AsapCity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('asap_cities')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setCities(data || []);
        setLoading(false);
      });
  }, [refreshKey]);

  return { cities, loading };
}
