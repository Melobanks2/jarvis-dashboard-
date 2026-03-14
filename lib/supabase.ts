import { createClient } from '@supabase/supabase-js';

const SB_URL = 'https://afwdfyofjcpbyydbxntr.supabase.co';
const SB_KEY = 'sb_publishable_JsetPmsnsp9CHy6LJp7Q7Q_PYyp_60M';

export const supabase = createClient(SB_URL, SB_KEY);

export function todayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000)   return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000)return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'America/New_York',
  });
}

export function fmtDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'America/New_York',
  });
}
