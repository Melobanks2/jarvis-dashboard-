'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface AsapCity {
  id: number;
  city: string;
  state: string;
  total_properties: number;
  scraped_count: number;
  photos_count: number;
  status: 'completed' | 'running' | 'queued' | 'failed';
  last_updated: string | null;
  assigned_agent: number | null;
}

// DB may store 'complete' (legacy) — normalize to 'completed'
function normalizeCity(c: AsapCity): AsapCity {
  return { ...c, status: c.status === ('complete' as string) ? 'completed' : c.status };
}

export interface AsapTotals {
  total_properties: number;
  total_photos: number;
  total_photo_files: number;
  with_owner_data: number;
  with_dm_data: number;
  cities_done: number;
  cities_running: number;
}

export function useAsapData(refreshKey: number) {
  const [cities,  setCities]  = useState<AsapCity[]>([]);
  const [totals,  setTotals]  = useState<AsapTotals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // Load cities
      const { data: cityData } = await supabase
        .from('asap_cities')
        .select('*')
        .order('id', { ascending: true });

      const cities = ((cityData || []) as AsapCity[]).map(normalizeCity);
      setCities(cities);

      // Load aggregate stats from asap_sold_properties
      const [
        { count: totalProps },
        { count: withPhotos },
        { count: withOwner },
        { count: withDm },
      ] = await Promise.all([
        supabase.from('asap_sold_properties').select('*', { count: 'exact', head: true }),
        supabase.from('asap_sold_properties').select('*', { count: 'exact', head: true }).eq('photos_collected', true),
        supabase.from('asap_sold_properties').select('*', { count: 'exact', head: true }).not('owner_name', 'is', null),
        supabase.from('asap_sold_properties').select('*', { count: 'exact', head: true }).not('dm_property_id', 'is', null),
      ]);

      // Sum photo_count from cities table for total photo files
      const totalPhotoFiles = cities.reduce((sum, c) => sum + (c.photos_count || 0), 0);

      setTotals({
        total_properties: totalProps || 0,
        total_photos: withPhotos || 0,
        total_photo_files: totalPhotoFiles,
        with_owner_data: withOwner || 0,
        with_dm_data: withDm || 0,
        cities_done: cities.filter(c => c.status === 'completed').length,
        cities_running: cities.filter(c => c.status === 'running').length,
      });

      setLoading(false);
    };

    load();
  }, [refreshKey]);

  return { cities, totals, loading };
}
