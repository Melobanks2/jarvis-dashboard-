'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

export interface MonthFunnel { calls: number; convos: number; hot: number; }

// This month's dial funnel — three cheap head-only count queries.
// Shared by GoalsVision (marching orders) and RoadTo100K (live vitals).
export function useMonthFunnel(refreshKey: number): MonthFunnel {
  const [f, setF] = useState<MonthFunnel>({ calls: 0, convos: 0, hot: 0 });
  useEffect(() => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const iso = start.toISOString();
    const base = () => supabase.from('jarvis_calls')
      .select('*', { count: 'exact', head: true })
      .gte('called_at', iso)
      .neq('phone', '+13479704969');
    let active = true;
    Promise.all([base(), base().gt('call_duration', 30), base().eq('stage_after', 'Hot Follow Up')])
      .then(([a, b, c]) => { if (active) setF({ calls: a.count ?? 0, convos: b.count ?? 0, hot: c.count ?? 0 }); });
    return () => { active = false; };
  }, [refreshKey]);
  return f;
}
