'use client';

import { ExternalLink, MapPin, Landmark, FileText, Gavel, Receipt } from 'lucide-react';

// ── Orlando-metro (MSA) county record portals ────────────────────────────────
// Only Florida, only Orange + the surrounding Orlando counties. Every URL below
// is a verified live portal. Each source is tagged with the distress signal it
// surfaces so you click the right one for the list you want.
type Kind = 'records' | 'court' | 'tax';
interface Source { label: string; url: string; kind: Kind; purpose: string }
interface County { name: string; seat: string; circuit: string; accent: string; sources: Source[] }

const KIND_META: Record<Kind, { Icon: React.ElementType; tone: string }> = {
  records: { Icon: FileText, tone: '#4ade80' },
  court:   { Icon: Gavel,    tone: '#a78bfa' },
  tax:     { Icon: Receipt,  tone: '#fbbf24' },
};

const COUNTIES: County[] = [
  {
    name: 'Orange', seat: 'Orlando', circuit: '9th Judicial Circuit', accent: '#4ade80',
    sources: [
      { label: 'Official Records', url: 'https://selfservice.or.occompt.com/ssweb/user/disclaimer', kind: 'records', purpose: 'Lis Pendens (pre-foreclosure), liens, deeds' },
      { label: 'Court Records',    url: 'https://myeclerk.myorangeclerk.com/',                       kind: 'court',   purpose: 'Probate, evictions, divorce' },
      { label: 'Tax Deed Sales',   url: 'https://www.occompt.com/191/Tax-Deed-Sales',                kind: 'tax',     purpose: 'Tax-delinquent properties' },
    ],
  },
  {
    name: 'Seminole', seat: 'Sanford', circuit: '18th Judicial Circuit', accent: '#60a5fa',
    sources: [
      { label: 'Official Records',   url: 'https://recording.seminoleclerk.org/',                 kind: 'records', purpose: 'Lis Pendens, liens, deeds' },
      { label: 'Court Case Search',  url: 'https://www.seminoleclerk.org/search-for-a-court-case/', kind: 'court',   purpose: 'Probate, evictions, divorce' },
    ],
  },
  {
    name: 'Osceola', seat: 'Kissimmee', circuit: '9th Judicial Circuit', accent: '#f472b6',
    sources: [
      { label: 'Official Records',  url: 'https://officialrecords.osceolaclerk.org/searchng_ssl/', kind: 'records', purpose: 'Lis Pendens, liens, deeds' },
      { label: 'Court Case Query',  url: 'https://ninthcircuit.org/resources/case-query',          kind: 'court',   purpose: 'Probate, evictions, divorce' },
      { label: 'Tax Deeds',         url: 'https://osceolaclerk.com/tax-deeds/',                    kind: 'tax',     purpose: 'Tax-delinquent properties' },
    ],
  },
  {
    name: 'Lake', seat: 'Tavares', circuit: '5th Judicial Circuit', accent: '#fb923c',
    sources: [
      { label: 'Official Records', url: 'https://officialrecords.lakecountyclerk.org/', kind: 'records', purpose: 'Lis Pendens, liens, deeds' },
      { label: 'Court Records',    url: 'https://courtrecords.lakecountyclerk.org/',    kind: 'court',   purpose: 'Probate, evictions, divorce' },
    ],
  },
];

export function CountySources() {
  return (
    <div className="rounded-lg p-5 flex flex-col gap-4" style={{ background: 'rgba(12,12,24,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-start gap-3">
        <span className="inline-flex w-7 h-7 rounded-md items-center justify-center flex-shrink-0" style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.3)' }}>
          <Landmark size={14} style={{ color: '#4ade80' }} />
        </span>
        <div>
          <div className="text-[13px] font-bold text-textb">Pull a county list</div>
          <div className="text-[11px] text-dimtext">Jump straight to the Orlando-area record portals. Click a source, export the list, then bring it back to Step 1.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {COUNTIES.map(c => (
          <div key={c.name} className="rounded-md p-3 flex flex-col gap-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${c.accent}22` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <MapPin size={12} style={{ color: c.accent }} />
                <span className="text-[13px] font-bold text-textb">{c.name} County</span>
                <span className="text-[10px] text-dimtext">· {c.seat}</span>
              </div>
              <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: c.accent, background: `${c.accent}18` }}>{c.circuit.replace(' Judicial Circuit', ' Cir.')}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              {c.sources.map(s => {
                const { Icon, tone } = KIND_META[s.kind];
                return (
                  <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
                    className="group flex items-center gap-2 rounded px-2.5 py-2 transition-all"
                    style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <Icon size={13} style={{ color: tone }} className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-textb flex items-center gap-1">
                        {s.label}
                        <ExternalLink size={10} className="text-dimtext opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="text-[10px] text-dimtext truncate">{s.purpose}</div>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 text-[10px] text-dimtext flex-wrap">
        <span className="flex items-center gap-1"><FileText size={11} style={{ color: '#4ade80' }} /> Official Records — liens & pre-foreclosure</span>
        <span className="flex items-center gap-1"><Gavel size={11} style={{ color: '#a78bfa' }} /> Court — probate & evictions</span>
        <span className="flex items-center gap-1"><Receipt size={11} style={{ color: '#fbbf24' }} /> Tax — delinquent properties</span>
      </div>
    </div>
  );
}
