// ── Shared CSV utilities (dependency-free, quote-aware) ──────────────────────
// Used by the Acquisitions "Lists" tab (county → XLeads → dial list). Mirrors the
// battle-tested parsing that MultiDialer already relies on.

// Quote-aware CSV line splitter (handles "Smith, John" style cells).
export function splitCSVLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

export interface Table { headers: string[]; rows: string[][] }

// Parse into { headers, rows }. Strips a UTF-8 BOM and blank lines.
export function parseTable(text: string): Table {
  const clean = (text || '').replace(/^﻿/, '').trim();
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const all = lines.map(splitCSVLine);
  return { headers: all[0], rows: all.slice(1) };
}

// Valid NANP phone: 10 digits (or 11 with leading 1), not starting with 0/1.
export function looksLikePhone(v: string): boolean {
  const d = (v || '').replace(/\D/g, '');
  if (d.length === 10) return d[0] !== '0' && d[0] !== '1';
  if (d.length === 11) return d[0] === '1' && d[1] !== '0' && d[1] !== '1';
  return false;
}

// Normalize to bare 10 digits (drop a leading US 1).
export function normalizePhone(v: string): string {
  const d = (v || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return d;
}

// Serialize rows to a CSV string (RFC-4180 quoting).
export function toCSV(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
}

// Trigger a browser download of text as a file.
export function downloadCSV(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Case/space-insensitive header finder. Returns first matching column index.
export function findCol(headers: string[], candidates: string[]): number {
  const norm = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const c of candidates) {
    const key = c.toLowerCase().replace(/[^a-z0-9]/g, '');
    const i = norm.indexOf(key);
    if (i !== -1) return i;
  }
  // partial (contains) fallback
  for (const c of candidates) {
    const key = c.toLowerCase().replace(/[^a-z0-9]/g, '');
    const i = norm.findIndex(h => h.includes(key));
    if (i !== -1) return i;
  }
  return -1;
}
