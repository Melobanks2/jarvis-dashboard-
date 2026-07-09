'use client';

import { useEffect, useState } from 'react';
import { Calculator, RotateCcw } from 'lucide-react';

const CALC_KEY = 'acq_calc';
const DEFAULTS = { arv: '', repairs: '', pct: '70', spread: '15000' };

// Walk-up rungs as a fraction of MAO: opening → counter → ceiling.
const LADDER = [
  { mult: 0.85, label: 'First offer',   when: 'Say this when you present the number',                 color: '#4ade80' },
  { mult: 0.92, label: 'Counter',       when: 'After the pushback — "let me talk to my underwriter"', color: '#fbbf24' },
  { mult: 1.00, label: 'Ceiling · MAO', when: 'Your walk-away max — never go above this',             color: '#ff5a3c' },
];

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const num = (s: string) => parseFloat(String(s).replace(/[^0-9.]/g, '')) || 0;

// Module-level so it doesn't remount (and steal focus) on every keystroke.
function Field({ label, value, onChange, prefix, suffix }: {
  label: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] uppercase tracking-wider text-dimtext">{label}</label>
      <div className="flex items-center rounded-md px-2 py-1.5" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {prefix && <span className="text-[12px] text-dimtext mr-1">{prefix}</span>}
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="w-full bg-transparent text-[13px] text-textb outline-none min-w-0"
        />
        {suffix && <span className="text-[12px] text-dimtext ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

export function OfferCalculator() {
  const [c, setC] = useState(DEFAULTS);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const s = window.localStorage.getItem(CALC_KEY);
    if (s) { try { setC({ ...DEFAULTS, ...JSON.parse(s) }); } catch {} }
  }, []);

  const set = (k: string, v: string) => setC(prev => {
    const n = { ...prev, [k]: v };
    if (typeof window !== 'undefined') window.localStorage.setItem(CALC_KEY, JSON.stringify(n));
    return n;
  });
  const clear = () => { setC(DEFAULTS); if (typeof window !== 'undefined') window.localStorage.removeItem(CALC_KEY); };

  const arv = num(c.arv), repairs = num(c.repairs), pct = num(c.pct), spread = num(c.spread);
  const gross = arv * (pct / 100);
  const mao = gross - repairs - spread;
  const ready = arv > 0 && mao > 0;

  return (
    <div className="rounded-lg p-4 flex flex-col gap-3" style={{ background: 'rgba(8,16,11,0.7)', border: '1px solid rgba(74,222,128,0.25)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#4ade80' }}>
          <Calculator size={13} /> Offer Ladder
        </div>
        <button title="Reset" onClick={clear} className="text-dimtext hover:text-ngreen transition-colors"><RotateCcw size={11} /></button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="ARV"       value={c.arv}     onChange={(v) => set('arv', v)}     prefix="$" />
        <Field label="Repairs"   value={c.repairs} onChange={(v) => set('repairs', v)} prefix="$" />
        <Field label="Buy at"    value={c.pct}     onChange={(v) => set('pct', v)}     suffix="%" />
        <Field label="My spread" value={c.spread}  onChange={(v) => set('spread', v)}  prefix="$" />
      </div>

      {/* live formula */}
      <div className="text-[10px] text-dimtext leading-relaxed">
        {money(gross)} <span className="text-white/30">(ARV×{pct || 0}%)</span> − {money(repairs)} − {money(spread)} spread
      </div>

      {/* ceiling */}
      <div className="flex items-baseline justify-between rounded-md px-3 py-2" style={{ background: 'rgba(255,90,60,0.08)', border: '1px solid rgba(255,90,60,0.25)' }}>
        <span className="text-[10px] uppercase tracking-wider" style={{ color: '#ff5a3c' }}>Ceiling · MAO</span>
        <span className="text-[18px] font-bold" style={{ color: ready ? '#ff5a3c' : '#52526e' }}>{ready ? money(mao) : '—'}</span>
      </div>

      {/* ladder */}
      {ready ? (
        <div className="flex flex-col gap-2">
          {LADDER.map((r, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2" style={{ background: `${r.color}0f`, border: `1px solid ${r.color}44` }}>
              <div className="flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold flex-shrink-0" style={{ background: `${r.color}22`, color: r.color }}>{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[16px] font-bold" style={{ color: r.color }}>{money(mao * r.mult)}</span>
                  <span className="text-[9px] uppercase tracking-wider text-dimtext">{r.label}</span>
                </div>
                <div className="text-[10px] text-dimtext leading-snug">{r.when}</div>
              </div>
            </div>
          ))}
          <div className="text-[9px] text-dimtext italic">Tip: shave the last digits to an odd number when you say it — sounds underwriter-calculated.</div>
        </div>
      ) : (
        <div className="text-[11px] text-dimtext italic">
          {mao <= 0 && arv > 0
            ? 'Repairs + spread exceed the buy price — this one doesn\'t pencil.'
            : 'Enter ARV + repairs to see your three numbers.'}
        </div>
      )}
    </div>
  );
}
