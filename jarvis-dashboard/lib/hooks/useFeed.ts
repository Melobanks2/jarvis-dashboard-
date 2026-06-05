'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../supabase';

export interface FeedItem {
  id: string;
  type: string;
  source: string;
  message: string;
  status: string;
  contact_name: string | null;
  priority: string | null;
  created_at: string;
}

export function useFeed(refreshKey: number, limit = 50) {
  const [items,   setItems]   = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase
      .from('jarvis_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (active) { setItems(data || []); setLoading(false); }
      });
    return () => { active = false; };
  }, [refreshKey, limit]);

  return { items, loading };
}
