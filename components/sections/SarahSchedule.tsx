'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Phone, Moon, ArrowRight, Info } from 'lucide-react';

/* ───────────────────────────────────────────────────────────────────────────
   Sarah's live daily calling routine. Mirrors the cron windows in
   jarvis-caller.js → setupCronJobs() (Mon–Sat, America/New_York). She dials a
   SECTION (CRM stage) at a time, up to the per-section cap, ~90s between
   sections — not one fixed contact at a fixed minute.
   If the crons in jarvis-caller.js change, update SCHEDULE to match.
─────────────────────────────────────────────────────────────────────────── */

interface Section { name: string; cap: number }
interface Window { time: string; hour: number; tag: string; sections: Section[]; report?: boolean }

const SCHEDULE: Window[] = [
  { time: '9:00 AM',  hour: 9,  tag: 'Morning open',        sections: [
    { name: 'New Leads', cap: 15 }, { name: 'Attempt 1', cap: 15 }, { name: 'Attempt 2', cap: 10 }, { name: 'Cold Follow Up', cap: 10 } ] },
  { time: '11:00 AM', hour: 11, tag: 'Mid-morning re-dial', sections: [
    { name: 'New Leads', cap: 12 }, { name: 'Attempt 1', cap: 12 }, { name: 'Attempt 2', cap: 10 }, { name: 'Attempt 3-5', cap: 10 } ] },
  { time: '1:00 PM',  hour: 13, tag: 'Early afternoon',     sections: [
    { name: 'New Leads', cap: 12 }, { name: 'Attempt 1', cap: 12 }, { name: 'Attempt 3-5', cap: 10 }, { name: 'Attempt 6+', cap: 8 } ] },
  { time: '3:00 PM',  hour: 15, tag: 'Afternoon push',      sections: [
    { name: 'New Leads', cap: 12 }, { name: 'Attempt 1', cap: 12 }, { name: 'Attempt 2', cap: 10 }, { name: 'Attempt 3-5', cap: 10 } ] },
  { time: '5:00 PM',  hour: 17, tag: 'Evening prime',       sections: [
    { name: 'New Leads', cap: 15 }, { name: 'Attempt 1', cap: 15 }, { name: 'Attempt 2', cap: 10 }, { name: 'Attempt 3-5', cap: 10 } ] },
  { time: '6:00 PM',  hour: 18, tag: 'Evening contact',     sections: [
    { name: 'New Leads', cap: 15 }, { name: 'Attempt 1', cap: 15 }, { name: 'Attempt 2', cap: 10 }, { name: 'Cold Follow Up', cap: 10 } ] },
  { time: '7:00 PM',  hour: 19, tag: 'Last push',           sections: [
    { name: 'New Leads', cap: 15 }, { name: 'Attempt 1', cap: 12 }, { name: 'Attempt 3-5', cap: 10 }, { name: 'Attempt 6+', cap: 8 } ] },
  { time: '8:00 PM',  hour: 20, tag: 'End-of-day report',   sections: [], report: true },
];

const SEG_COLOR: Record<string, string> = {
  'Cold Follow Up': '#0a84ff',
  'New Leads':      '#64d2ff',
  'Attempt 1':      '#bf5af2',
  'Attempt 2':      '#bf5af2',
  'Attempt 3-5':    '#bf5af2',
  'Attempt 6+':     '#7c7c9c',
};
const segColor = (n: string) => SEG_COLOR[n] || '#7a7a9a';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function SarahSchedule() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000); // refresh "now" every minute
    return () => clearInterval(id);
  }, []);

  const etNow   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const curHour = etNow.getHours();
  const curMin  = etNow.getMinutes();
  const day     = etNow.getDay();           // 0 = Sun
  const isSunday = day === 0;
  const callWindows = SCHEDULE.filter(w => !w.report);

  // Total leads Sarah may dial in a full day (sum of caps across call windows).
  const dailyCapacity = callWindows.reduce((s, w) => s + w.sections.reduce((a, x) => a + x.cap, 0), 0);

  // Status per window: done | active (this hour) | next | upcoming | off
  const nextWindow = !isSunday ? callWindows.find(w => w.hour > curHour) : undefined;
  function statusOf(w: Window): 'done' | 'active' | 'next' | 'upcoming' | 'off' {
    if (isSunday) return 'off';
    if (curHour === w.hour) return 'active';
    if (curHour > w.hour)   return 'done';
    if (nextWindow && w.hour === nextWindow.hour) return 'next';
    return 'upcoming';
  }

  const nextLabel = isSunday
    ? 'Sunday — Sarah is off. Resumes Monday 9:00 AM ET.'
    : curHour < 9
      ? 'First batch at 9:00 AM ET.'
      : nextWindow
        ? `Next batch: ${nextWindow.time} ET — ${nextWindow.sections.map(s => s.name).join(', ')}`
        : 'Day complete — resumes tomorrow 9:00 AM ET.';

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">

      {/* intro */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div className="text-[15px] font-semibold text-textb">Sarah's Daily Schedule</div>
          <div className="text-[11px] text-dimtext mt-0.5">
            Mon–Sat, 9 AM–8 PM ET. She dials one section at a time, up to each cap, ~90s apart.
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-dimtext">Today · {DAYS[day]}</div>
          <div className="text-[12px] font-medium" style={{ color: isSunday ? '#7a7a9a' : '#30d158' }}>
            {isSunday ? 'Off today' : `${String(curHour).padStart(2, '0')}:${String(curMin).padStart(2, '0')} ET`}
          </div>
        </div>
      </div>

      {/* next-up banner */}
      <div
        className="flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5"
        style={{ background: isSunday ? 'rgba(255,255,255,0.02)' : 'rgba(48,209,88,0.05)', borderColor: isSunday ? 'rgba(255,255,255,0.07)' : 'rgba(48,209,88,0.22)' }}
      >
        {isSunday ? <Moon size={14} className="text-dimtext flex-shrink-0" /> : <ArrowRight size={14} style={{ color: '#30d158' }} className="flex-shrink-0" />}
        <span className="text-[12px]" style={{ color: isSunday ? '#7a7a9a' : '#9febb4' }}>{nextLabel}</span>
        <span className="ml-auto text-[10px] text-dimtext flex-shrink-0">up to {dailyCapacity} dials/day</span>
      </div>

      {/* timeline */}
      <div className="flex flex-col">
        {SCHEDULE.map((w, i) => {
          const st = statusOf(w);
          const isActive = st === 'active';
          const isNext   = st === 'next';
          const isDone   = st === 'done';
          const accent   = w.report ? '#ff9f0a' : isActive ? '#30d158' : isNext ? '#64d2ff' : '#52526e';
          const total    = w.sections.reduce((a, s) => a + s.cap, 0);
          return (
            <div key={w.time} className="flex gap-3">
              {/* rail */}
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 14 }}>
                <div
                  className="rounded-full mt-1.5"
                  style={{
                    width: isActive ? 11 : 9, height: isActive ? 11 : 9,
                    background: accent,
                    boxShadow: isActive ? `0 0 8px ${accent}` : 'none',
                    opacity: isDone ? 0.4 : 1,
                  }}
                />
                {i < SCHEDULE.length - 1 && <div className="flex-1 w-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />}
              </div>

              {/* card */}
              <div
                className="flex-1 rounded-lg border mb-2.5 px-3.5 py-2.5 transition-colors"
                style={{
                  borderColor: isActive ? 'rgba(48,209,88,0.35)' : isNext ? 'rgba(100,210,255,0.25)' : 'rgba(255,255,255,0.06)',
                  background: isActive ? 'rgba(48,209,88,0.05)' : 'rgba(255,255,255,0.012)',
                  opacity: isDone ? 0.55 : 1,
                }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Clock size={12} style={{ color: accent }} className="flex-shrink-0" />
                  <span className="text-[13px] font-semibold text-textb">{w.time}</span>
                  <span className="text-[10px] text-dimtext">{w.tag}</span>
                  {isActive && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(48,209,88,0.15)', color: '#30d158' }}>RUNNING NOW</span>}
                  {isNext   && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(100,210,255,0.12)', color: '#64d2ff' }}>NEXT</span>}
                  {isDone   && <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(255,255,255,0.05)', color: '#52526e' }}>done</span>}
                  {!w.report && <span className="ml-auto text-[10px] text-dimtext flex items-center gap-1"><Phone size={9} /> up to {total}</span>}
                </div>

                {w.report ? (
                  <div className="text-[10.5px] text-dimtext mt-1.5">Telegram end-of-day recap — calls, conversations, hot/warm/cold, and tomorrow's plan.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {w.sections.map(s => {
                      const c = segColor(s.name);
                      return (
                        <span key={s.name} className="text-[9.5px] px-1.5 py-0.5 rounded-sm flex items-center gap-1" style={{ background: `${c}14`, color: c, border: `1px solid ${c}33` }}>
                          {s.name} <span className="opacity-70">· {s.cap}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* how it works */}
      <div className="rounded-lg border border-border2 px-3.5 py-3" style={{ background: 'rgba(255,255,255,0.012)' }}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-textb mb-2"><Info size={12} className="text-ncyan" /> How Sarah works the list</div>
        <ul className="text-[11px] text-dimtext leading-relaxed list-disc pl-4 space-y-1">
          <li>Sarah is the <span className="text-jtext">qualifier</span> — she works New leads, the no-contact attempt ladder, and Cold. The moment a lead turns <span style={{ color: '#ff453a' }}>Hot</span> or <span style={{ color: '#ff9f0a' }}>Warm</span>, it's handed to <span className="text-jtext">you</span> to make the offer — she stops auto-calling it.</li>
          <li>She calls a <span className="text-jtext">section at a time</span> (e.g. all New, then Attempt 1) — each dials up to its cap, then ~90s before the next.</li>
          <li>Attempt cadence: <span style={{ color: '#64d2ff' }}>New</span> &amp; <span style={{ color: '#bf5af2' }}>Attempt 1</span> twice a day, <span style={{ color: '#bf5af2' }}>Attempt 2</span> daily, <span style={{ color: '#bf5af2' }}>Attempt 3-5</span> every other day, <span style={{ color: '#7c7c9c' }}>Attempt 6+</span> weekly → then it ages to <span style={{ color: '#0a84ff' }}>Cold</span> (every 3 days).</li>
          <li>Never before 9 AM, after 8 PM, or on Sundays. All times America/New_York.</li>
        </ul>
      </div>

    </motion.div>
  );
}
