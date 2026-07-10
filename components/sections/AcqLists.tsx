'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Upload, Download, ArrowRight, ArrowDown, Phone, MapPin, User,
  CheckCircle2, AlertTriangle, FileSpreadsheet, ListChecks, Send, RotateCcw,
} from 'lucide-react';
import {
  parseTable, toCSV, downloadCSV, findCol, looksLikePhone, normalizePhone,
  type Table,
} from '@/lib/csv';
import { CountySources } from './CountySources';

// Personal power-dialer backend (same host the Live Dialer uses).
const ACQ_API = 'https://api.jarviscommandcenter.space/dialer/personal';

const today = () => new Date().toISOString().slice(0, 10);

// ── XLeads skip-trace import template (editable defaults) ─────────────────────
// These are sensible defaults for a standard skip-trace upload. The header names
// are editable in the UI so you can match XLeads' exact template.
type OutKey = 'first' | 'last' | 'address' | 'city' | 'state' | 'zip';
const OUT_FIELDS: { key: OutKey; label: string; header: string; auto: string[] }[] = [
  { key: 'first',   label: 'First Name',       header: 'First Name',       auto: ['first name', 'first', 'owner first', 'fname'] },
  { key: 'last',    label: 'Last Name',        header: 'Last Name',        auto: ['last name', 'last', 'owner last', 'lname', 'surname'] },
  { key: 'address', label: 'Property Address', header: 'Property Address', auto: ['property address', 'address', 'street address', 'street', 'situs address', 'situs'] },
  { key: 'city',    label: 'City',             header: 'City',             auto: ['city', 'property city', 'situs city'] },
  { key: 'state',   label: 'State',            header: 'State',            auto: ['state', 'property state', 'st'] },
  { key: 'zip',     label: 'Zip',              header: 'Zip',              auto: ['zip', 'zipcode', 'zip code', 'postal', 'postal code'] },
];

interface DialLead { name: string; phone: string; address: string; notes: string }

export function AcqLists({ onSessionStarted }: { onSessionStarted?: (sessionId: string) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <CountySources />
      <div className="flex items-center justify-center text-dimtext">
        <ArrowDown size={18} />
      </div>
      <Step1CountyToXLeads />
      <div className="flex items-center justify-center text-dimtext">
        <ArrowDown size={18} />
      </div>
      <Step2SkipTracedToDial onSessionStarted={onSessionStarted} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — County record → XLeads skip-trace format
// ─────────────────────────────────────────────────────────────────────────────
function Step1CountyToXLeads() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // mapping state
  const [srcMap, setSrcMap] = useState<Record<OutKey, number>>({ first: -1, last: -1, address: -1, city: -1, state: -1, zip: -1 });
  const [outHeaders, setOutHeaders] = useState<Record<OutKey, string>>(
    OUT_FIELDS.reduce((a, f) => ({ ...a, [f.key]: f.header }), {} as Record<OutKey, string>)
  );
  const [splitNameCol, setSplitNameCol] = useState<number>(-1); // -1 = direct first/last cols
  const [nameOrder, setNameOrder] = useState<'last-first' | 'first-last'>('last-first');

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const t = parseTable(ev.target?.result as string);
      if (!t.headers.length || !t.rows.length) { setErr('Could not read any rows from that CSV.'); setTable(null); return; }

      // auto-detect mapping
      const m: Record<OutKey, number> = { first: -1, last: -1, address: -1, city: -1, state: -1, zip: -1 };
      for (const f of OUT_FIELDS) m[f.key] = findCol(t.headers, f.auto);

      // If no separate first/last but there's a single owner/name column, use split mode.
      const ownerIdx = findCol(t.headers, ['owner name', 'owner', 'name', 'full name', 'contact', 'defendant', 'grantor']);
      if (m.first === -1 && m.last === -1 && ownerIdx !== -1) {
        setSplitNameCol(ownerIdx);
      } else {
        setSplitNameCol(-1);
      }
      setSrcMap(m);
      setTable(t);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // Split a full-name cell into { first, last } honoring comma + order toggle.
  const splitName = useCallback((raw: string): { first: string; last: string } => {
    const v = (raw || '').trim();
    if (!v) return { first: '', last: '' };
    if (v.includes(',')) { const [l, f] = v.split(',').map(s => s.trim()); return { first: f || '', last: l || '' }; }
    const toks = v.split(/\s+/);
    if (toks.length === 1) return { first: toks[0], last: '' };
    if (nameOrder === 'last-first') return { last: toks[0], first: toks.slice(1).join(' ') };
    return { first: toks[0], last: toks.slice(1).join(' ') };
  }, [nameOrder]);

  const outRows = useMemo(() => {
    if (!table) return [];
    return table.rows.map(cells => {
      let first = srcMap.first >= 0 ? (cells[srcMap.first] || '') : '';
      let last  = srcMap.last  >= 0 ? (cells[srcMap.last]  || '') : '';
      if (splitNameCol >= 0) { const s = splitName(cells[splitNameCol] || ''); first = s.first; last = s.last; }
      return [
        first, last,
        srcMap.address >= 0 ? (cells[srcMap.address] || '') : '',
        srcMap.city    >= 0 ? (cells[srcMap.city]    || '') : '',
        srcMap.state   >= 0 ? (cells[srcMap.state]   || '') : '',
        srcMap.zip     >= 0 ? (cells[srcMap.zip]     || '') : '',
      ];
    });
  }, [table, srcMap, splitNameCol, splitName]);

  const download = () => {
    const headers = OUT_FIELDS.map(f => outHeaders[f.key]);
    downloadCSV(`xleads-import-${today()}.csv`, toCSV(headers, outRows));
  };

  const options = table
    ? [{ v: -1, label: '— none —' }, ...table.headers.map((h, i) => ({ v: i, label: h || `Column ${i + 1}` }))]
    : [];

  return (
    <Card accent="#4ade80">
      <StepHeader n={1} Icon={FileSpreadsheet} title="County record → XLeads format"
        subtitle="Drop your raw county list. Map the columns, then download a file XLeads can skip-trace." accent="#4ade80" />

      <FilePick label="Choose county CSV" fileName={fileName} onClick={() => fileRef.current?.click()} accent="#4ade80" />
      <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={onFile} />

      {err && <Banner tone="error">{err}</Banner>}

      {table && (
        <>
          <div className="text-[11px] text-dimtext">{table.rows.length} rows loaded · {table.headers.length} columns</div>

          {/* Name handling */}
          <div className="rounded-md p-3 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-dimtext"><User size={12} /> Owner name</div>
            <label className="flex items-center gap-2 text-[12px] text-textb">
              <input type="checkbox" checked={splitNameCol >= 0}
                onChange={e => setSplitNameCol(e.target.checked ? (findCol(table.headers, ['owner name', 'owner', 'name', 'full name']) || 0) : -1)} />
              Split a single full-name column into First / Last
            </label>
            {splitNameCol >= 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <Field label="Name column">
                  <Select value={splitNameCol} onChange={v => setSplitNameCol(v)}
                    options={table.headers.map((h, i) => ({ v: i, label: h || `Column ${i + 1}` }))} />
                </Field>
                <Field label="Order in the file">
                  <div className="flex gap-1">
                    {(['last-first', 'first-last'] as const).map(o => (
                      <button key={o} onClick={() => setNameOrder(o)}
                        className="px-2.5 py-1 rounded text-[11px] font-medium"
                        style={nameOrder === o
                          ? { background: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.4)' }
                          : { background: 'rgba(255,255,255,0.03)', color: '#71717a', border: '1px solid rgba(255,255,255,0.08)' }}>
                        {o === 'last-first' ? 'Last First' : 'First Last'}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Field label="First name column"><Select value={srcMap.first} onChange={v => setSrcMap(s => ({ ...s, first: v }))} options={options} /></Field>
                <Field label="Last name column"><Select value={srcMap.last} onChange={v => setSrcMap(s => ({ ...s, last: v }))} options={options} /></Field>
              </div>
            )}
          </div>

          {/* Address block mapping + editable output headers */}
          <div className="rounded-md p-3 flex flex-col gap-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="text-[11px] uppercase tracking-wider text-dimtext">Column mapping · output header</div>
            {(['address', 'city', 'state', 'zip'] as OutKey[]).map(k => (
              <div key={k} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <Select value={srcMap[k]} onChange={v => setSrcMap(s => ({ ...s, [k]: v }))} options={options} />
                <ArrowRight size={12} className="text-dimtext" />
                <input value={outHeaders[k]} onChange={e => setOutHeaders(h => ({ ...h, [k]: e.target.value }))}
                  className="rounded px-2 py-1.5 text-[12px] text-textb w-full"
                  style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }} />
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[10px] text-dimtext">
              <span>Name → {outHeaders.first} / {outHeaders.last}</span><span /><span />
            </div>
          </div>

          <Preview headers={OUT_FIELDS.map(f => outHeaders[f.key])} rows={outRows.slice(0, 5)} />

          <PrimaryBtn onClick={download} Icon={Download} accent="#22c55e">
            Download XLeads CSV ({outRows.length} rows)
          </PrimaryBtn>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Skip-traced export → dial list
// ─────────────────────────────────────────────────────────────────────────────
function Step2SkipTracedToDial({ onSessionStarted }: { onSessionStarted?: (sessionId: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'best' | 'all'>('best');
  const [phoneCols, setPhoneCols] = useState<number[]>([]);
  const [nameIdx, setNameIdx] = useState(-1);
  const [firstIdx, setFirstIdx] = useState(-1);
  const [lastIdx, setLastIdx] = useState(-1);
  const [addrIdx, setAddrIdx] = useState(-1);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setNote(null); setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const t = parseTable(ev.target?.result as string);
      if (!t.headers.length || !t.rows.length) { setErr('Could not read any rows from that CSV.'); setTable(null); return; }

      // Detect phone columns: header hints ∪ content (≥50% of cells look like phones).
      const byHeader = t.headers
        .map((h, i) => ({ h: h.toLowerCase(), i }))
        .filter(({ h }) => /phone|mobile|cell|wireless|landline|\btel\b/.test(h) && !/type|status|carrier|dnc|score/.test(h))
        .map(({ i }) => i);
      const byContent: number[] = [];
      for (let c = 0; c < t.headers.length; c++) {
        let hit = 0, n = 0;
        for (const r of t.rows) { const v = r[c]; if (v) { n++; if (looksLikePhone(v)) hit++; } }
        if (n > 0 && hit / n >= 0.5) byContent.push(c);
      }
      const phones = Array.from(new Set([...byHeader, ...byContent])).sort((a, b) => a - b);

      setPhoneCols(phones);
      setNameIdx(findCol(t.headers, ['owner name', 'name', 'full name', 'contact', 'owner']));
      setFirstIdx(findCol(t.headers, ['first name', 'first', 'fname']));
      setLastIdx(findCol(t.headers, ['last name', 'last', 'lname']));
      setAddrIdx(findCol(t.headers, ['property address', 'address', 'street address', 'street', 'situs address', 'situs']));
      setTable(t);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const buildName = useCallback((cells: string[]): string => {
    if (nameIdx >= 0 && cells[nameIdx]) return cells[nameIdx];
    return [firstIdx >= 0 ? cells[firstIdx] : '', lastIdx >= 0 ? cells[lastIdx] : ''].filter(Boolean).join(' ');
  }, [nameIdx, firstIdx, lastIdx]);

  const { queue, skipped } = useMemo(() => {
    const q: DialLead[] = [];
    let skip = 0;
    if (!table) return { queue: q, skipped: skip };
    for (const cells of table.rows) {
      const name = buildName(cells);
      const address = addrIdx >= 0 ? (cells[addrIdx] || '') : '';
      const phones = Array.from(new Set(
        phoneCols.map(i => cells[i]).filter(looksLikePhone).map(normalizePhone)
      ));
      if (!phones.length) { skip++; continue; }
      if (mode === 'best') q.push({ name, phone: phones[0], address, notes: '' });
      else phones.forEach(p => q.push({ name, phone: p, address, notes: '' }));
    }
    return { queue: q, skipped: skip };
  }, [table, phoneCols, addrIdx, mode, buildName]);

  const downloadDial = () =>
    downloadCSV(`dial-list-${today()}.csv`, toCSV(['name', 'phone', 'address', 'notes'], queue.map(l => [l.name, l.phone, l.address, l.notes])));

  const loadIntoDialer = async () => {
    if (!queue.length) return;
    setSending(true); setNote(null);
    try {
      const r = await fetch(`${ACQ_API}/start-list`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: queue, name: fileName || `list-${today()}`, mode }),
      });
      if (r.status === 404) { setNote('The dialer needs a small backend endpoint before one-click dialing works — use "Download dial-ready CSV" for now.'); return; }
      const j = await r.json().catch(() => ({}));
      if (j.ok && j.sessionId) { onSessionStarted?.(j.sessionId); }
      else setNote(j.message || j.error || 'Could not start the session — the dial-ready CSV download still works.');
    } catch {
      setNote('Dialer service unreachable — use the dial-ready CSV download for now.');
    } finally { setSending(false); }
  };

  const reset = () => { setTable(null); setFileName(''); setErr(null); setNote(null); setPhoneCols([]); };

  return (
    <Card accent="#60a5fa">
      <StepHeader n={2} Icon={ListChecks} title="Skip-traced list → dial queue"
        subtitle="Drop the file XLeads gives back. It finds the phone numbers and builds your dial list." accent="#60a5fa" />

      <FilePick label="Choose skip-traced CSV" fileName={fileName} onClick={() => fileRef.current?.click()} accent="#60a5fa" />
      <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={onFile} />

      {err && <Banner tone="error">{err}</Banner>}

      {table && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-dimtext">{table.rows.length} rows ·</span>
            {phoneCols.length > 0
              ? <span className="text-ngreen flex items-center gap-1"><CheckCircle2 size={12} /> {phoneCols.length} phone column{phoneCols.length > 1 ? 's' : ''} detected</span>
              : <span className="flex items-center gap-1" style={{ color: '#f87171' }}><AlertTriangle size={12} /> no phone columns found</span>}
          </div>

          {/* dial mode */}
          <div className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-wider text-dimtext">When a person has several numbers</div>
            <div className="flex gap-2">
              {([
                { k: 'best', label: 'Best number only', hint: 'first valid number per person' },
                { k: 'all',  label: 'Dial all numbers',  hint: 'one attempt per number' },
              ] as const).map(o => (
                <button key={o.k} onClick={() => setMode(o.k)}
                  className="flex-1 rounded-md px-3 py-2 text-left transition-all"
                  style={mode === o.k
                    ? { background: 'rgba(96,165,250,0.14)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.45)' }
                    : { background: 'rgba(255,255,255,0.03)', color: '#c4c4d6', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="text-[12px] font-semibold">{o.label}</div>
                  <div className="text-[10px] text-dimtext">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <Preview headers={['Name', 'Phone', 'Address']} rows={queue.slice(0, 6).map(l => [l.name, l.phone, l.address])} />

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-ngreen font-semibold">{queue.length} dialable {mode === 'all' ? 'numbers' : 'leads'}</span>
            {skipped > 0 && <span className="text-dimtext">{skipped} skipped (no valid phone)</span>}
          </div>

          {note && <Banner tone="info">{note}</Banner>}

          <div className="flex flex-wrap gap-2">
            <PrimaryBtn onClick={downloadDial} Icon={Download} accent="#3b82f6" disabled={!queue.length}>
              Download dial-ready CSV
            </PrimaryBtn>
            <SecondaryBtn onClick={loadIntoDialer} Icon={Send} disabled={!queue.length || sending}>
              {sending ? 'Loading…' : 'Load into dialer'}
            </SecondaryBtn>
            <SecondaryBtn onClick={reset} Icon={RotateCcw}>Clear</SecondaryBtn>
          </div>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────
function Card({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div className="rounded-lg p-5 flex flex-col gap-4" style={{ background: 'rgba(12,12,24,0.7)', border: `1px solid ${accent}33` }}>
      {children}
    </div>
  );
}

function StepHeader({ n, Icon, title, subtitle, accent }: { n: number; Icon: React.ElementType; title: string; subtitle: string; accent: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex w-7 h-7 rounded-md items-center justify-center flex-shrink-0" style={{ background: `${accent}22`, border: `1px solid ${accent}55` }}>
        <Icon size={14} style={{ color: accent }} />
      </span>
      <div>
        <div className="text-[13px] font-bold text-textb">Step {n} · {title}</div>
        <div className="text-[11px] text-dimtext">{subtitle}</div>
      </div>
    </div>
  );
}

function FilePick({ label, fileName, onClick, accent }: { label: string; fileName: string; onClick: () => void; accent: string }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 px-4 py-3 rounded-lg text-[12px] font-semibold self-start transition-all"
      style={{ background: `${accent}18`, color: accent, border: `1px dashed ${accent}66` }}>
      <Upload size={14} /> {fileName || label}
    </button>
  );
}

function Preview({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-md overflow-x-auto" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <table className="w-full text-[11px]">
        <thead>
          <tr>{headers.map((h, i) => <th key={i} className="text-left px-2.5 py-1.5 text-dimtext font-medium whitespace-nowrap uppercase tracking-wider text-[9px]">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {headers.map((_, ci) => <td key={ci} className="px-2.5 py-1.5 text-jtext whitespace-nowrap max-w-[220px] truncate">{r[ci] || <span className="text-dimtext">—</span>}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-dimtext">{label}</span>
      {children}
    </div>
  );
}

function Select({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: { v: number; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(Number(e.target.value))}
      className="rounded px-2 py-1.5 text-[12px] text-textb w-full"
      style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', outline: 'none' }}>
      {options.map(o => <option key={o.v} value={o.v} style={{ background: '#12121e' }}>{o.label}</option>)}
    </select>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone: 'error' | 'info' }) {
  const c = tone === 'error' ? { bg: 'rgba(248,113,113,0.08)', fg: '#f87171', bd: 'rgba(248,113,113,0.2)' } : { bg: 'rgba(96,165,250,0.08)', fg: '#93c5fd', bd: 'rgba(96,165,250,0.25)' };
  return <div className="text-[11px] px-3 py-2 rounded-sm" style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}>{children}</div>;
}

function PrimaryBtn({ children, onClick, Icon, accent, disabled }: { children: React.ReactNode; onClick: () => void; Icon: React.ElementType; accent: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-2 px-5 py-2.5 rounded-md text-[13px] font-bold self-start transition-all disabled:opacity-50"
      style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, color: '#06140b' }}>
      <Icon size={14} /> {children}
    </button>
  );
}

function SecondaryBtn({ children, onClick, Icon, disabled }: { children: React.ReactNode; onClick: () => void; Icon: React.ElementType; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-2 px-4 py-2.5 rounded-md text-[12px] font-medium transition-all disabled:opacity-50"
      style={{ background: 'rgba(255,255,255,0.05)', color: '#c4c4d6', border: '1px solid rgba(255,255,255,0.12)' }}>
      <Icon size={13} /> {children}
    </button>
  );
}
