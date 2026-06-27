'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Rocket, FileText, FileSignature, Send, Eye, Check, AlertTriangle,
  Target, History, ArrowLeft, Loader2, ExternalLink,
} from 'lucide-react';
import { GlassCard, SectionTitle } from '@/components/ui/GlassCard';
import { useApp } from '@/lib/AppContext';
import { usePipeline, Lead } from '@/lib/hooks/usePipeline';

// Stages where a deal is "armed" — close enough to paper a contract.
const ARMED_STAGES = ['Decision Pending', 'Contract Sent', 'Under Contract', 'Hot Follow Up'];

type Kind = 'psa' | 'rbp' | 'other';
interface Template { id: string; name: string; kind: Kind; }
interface Doc { id: string; name: string; status: string; createdAt?: string; recipients?: string[]; }

// Field profiles differ by contract type. RBP (novation / Retail Buyer Program)
// has NO earnest money and a different close basis than a straight PSA.
interface Field { key: string; label: string; def: string; }
const PROFILES: Record<'psa' | 'rbp', Field[]> = {
  psa: [
    { key: 'price',    label: 'Purchase price',   def: '' },
    { key: 'emd',      label: 'Earnest money',    def: '$1,000' },
    { key: 'insp',     label: 'Inspection days',  def: '10' },
    { key: 'close',    label: 'Close date',       def: 'On or before 30 days' },
    { key: 'fee',      label: 'Assignment fee',   def: '$15,000' },
    { key: 'title',    label: 'Title / closing co.', def: '' },
  ],
  rbp: [
    { key: 'sellerPrice', label: "Seller's agreed price", def: '' },
    { key: 'retail',      label: 'Retail resale price',   def: '' },
    { key: 'spread',      label: 'Your spread',           def: '' },
    { key: 'emd',         label: 'Earnest money',         def: '$0' },
    { key: 'insp',        label: 'Inspection days',       def: '0' },
    { key: 'close',       label: 'Close date',            def: 'On/before end-buyer close' },
  ],
};

// Backend lives on the VPS dialer-server (Vercel Hobby is at its 12-function cap),
// same host the pipeline/leads data comes from.
const CONTRACT_API = 'https://api.jarviscommandcenter.space/dialer/contract';
const GHL_DOCS_URL = 'https://app.gohighlevel.com/v2/location/AymErWPrH9U1ddRouslC/payments/documents-contracts';

const money = (n: number | null) => (n ? `$${Math.round(n).toLocaleString()}` : '');

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const map: Record<string, [string, string]> = {
    completed: ['rgba(0,255,136,0.12)', '#00ff88'],
    signed:    ['rgba(0,255,136,0.12)', '#00ff88'],
    viewed:    ['rgba(0,170,255,0.12)', '#00aaff'],
    sent:      ['rgba(0,170,255,0.12)', '#00aaff'],
    draft:     ['rgba(255,255,255,0.06)', '#8a8aa0'],
    declined:  ['rgba(255,51,102,0.12)', '#ff3366'],
  };
  const [bg, fg] = map[s] || ['rgba(255,255,255,0.06)', '#8a8aa0'];
  return (
    <span className="text-[9px] px-2 py-0.5 rounded-sm font-medium" style={{ background: bg, color: fg }}>
      {status || '—'}
    </span>
  );
}

export function ContractCannon() {
  const { refreshKey } = useApp();
  const { data, loading: pipeLoading } = usePipeline(refreshKey);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [docs, setDocs]           = useState<Doc[]>([]);
  const [tplId, setTplId]         = useState('');
  const [deal, setDeal]           = useState<Lead | null>(null);
  const [vals, setVals]           = useState<Record<string, string>>({});
  const [stage, setStage]         = useState<'build' | 'review'>('build');
  const [firing, setFiring]       = useState(false);
  const [fired, setFired]         = useState<null | { ok: boolean; msg: string }>(null);

  // Load templates + recent documents once.
  useEffect(() => {
    fetch(`${CONTRACT_API}/templates`).then(r => r.json())
      .then(d => { if (d.templates) { setTemplates(d.templates); if (!tplId && d.templates[0]) setTplId(d.templates[0].id); } })
      .catch(() => {});
    refreshDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshDocs() {
    fetch(`${CONTRACT_API}/documents?limit=12`).then(r => r.json())
      .then(d => { if (d.documents) setDocs(d.documents); })
      .catch(() => {});
  }

  const armed = useMemo(() => {
    const leads = data?.leads || [];
    return leads.filter(l => ARMED_STAGES.includes(l.stage) && l.contactId).slice(0, 12);
  }, [data]);

  const tpl  = templates.find(t => t.id === tplId);
  const kind: 'psa' | 'rbp' = tpl?.kind === 'rbp' ? 'rbp' : 'psa';
  const profile = PROFILES[kind];

  // When template or deal changes, reset field defaults (pre-fill price from the deal).
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of profile) next[f.key] = f.def;
    if (deal) {
      const p = deal.purchasePrice ?? deal.askingPrice ?? deal.value ?? null;
      if (kind === 'psa' && p) next.price = money(p);
      if (kind === 'rbp' && p) next.sellerPrice = money(p);
    }
    setVals(next);
    setStage('build');
    setFired(null);
  }, [tplId, deal, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fire() {
    if (!deal || !tpl) return;
    setFiring(true); setFired(null);
    try {
      const r = await fetch(`${CONTRACT_API}/fire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fire',
          templateId: tpl.id,
          contactId: deal.contactId,
          meta: { seller: deal.name, address: deal.address, templateName: tpl.name },
        }),
      });
      const d = await r.json();
      if (d.ok) { setFired({ ok: true, msg: `Sent to ${deal.name} for signature.` }); refreshDocs(); }
      else setFired({ ok: false, msg: d.error || 'Send failed.' });
    } catch (e: any) {
      setFired({ ok: false, msg: e.message || 'Send failed.' });
    } finally { setFiring(false); }
  }

  const psaTemplates = templates.filter(t => t.kind === 'psa');
  const rbpTemplates = templates.filter(t => t.kind === 'rbp');
  const otherTemplates = templates.filter(t => t.kind === 'other');

  return (
    <div className="space-y-5">
      {/* Merge-field setup notice */}
      <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-sm"
           style={{ background: 'rgba(255,136,0,0.07)', border: '1px solid rgba(255,136,0,0.2)' }}>
        <AlertTriangle size={14} style={{ color: '#ff8800', marginTop: 1 }} />
        <p className="text-[10px] leading-relaxed" style={{ color: '#d8b88a' }}>
          The numbers below show what each contract needs. Auto-filling them into the PDF needs
          merge fields set up on your GHL templates (one-time). Until then, <b>Fire</b> sends the chosen
          template to the seller as-is — review it first.
        </p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Armed deals', val: armed.length, c: '#00ff88' },
          { label: 'Templates',   val: templates.length, c: '#00aaff' },
          { label: 'Awaiting sig', val: docs.filter(d => ['sent', 'viewed'].includes((d.status || '').toLowerCase())).length, c: '#ffd700' },
          { label: 'Completed',    val: docs.filter(d => ['completed', 'signed'].includes((d.status || '').toLowerCase())).length, c: '#00ff88' },
        ].map(m => (
          <div key={m.label} className="rounded-sm px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="text-[9px] uppercase tracking-wider" style={{ color: '#52526e' }}>{m.label}</div>
            <div className="text-xl font-bold font-orbitron" style={{ color: m.c }}>{m.val}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Armed deals */}
        <GlassCard accent="green" className="lg:col-span-2">
          <SectionTitle accent="green" badge={`${armed.length}`}>Armed deals</SectionTitle>
          {pipeLoading ? (
            <div className="flex items-center gap-2 text-[10px] py-6 justify-center" style={{ color: '#52526e' }}>
              <Loader2 size={13} className="animate-spin" /> Loading pipeline…
            </div>
          ) : armed.length === 0 ? (
            <div className="text-[10px] py-6 text-center" style={{ color: '#52526e' }}>No deals in a contract-ready stage yet.</div>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
              {armed.map(l => {
                const sel = deal?.id === l.id;
                return (
                  <button key={l.id} onClick={() => setDeal(l)}
                    className="w-full text-left rounded-sm px-2.5 py-2 transition-colors"
                    style={{ background: sel ? 'rgba(0,255,136,0.08)' : 'rgba(255,255,255,0.02)',
                             border: `1px solid ${sel ? 'rgba(0,255,136,0.35)' : 'rgba(255,255,255,0.05)'}` }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium truncate" style={{ color: sel ? '#00ff88' : '#c4c4d6' }}>{l.name}</span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-sm shrink-0" style={{ background: 'rgba(255,255,255,0.05)', color: '#8a8aa0' }}>{l.stage}</span>
                    </div>
                    <div className="text-[9px] truncate mt-0.5" style={{ color: '#52526e' }}>
                      {l.address || 'No address'}{(l.purchasePrice || l.askingPrice) ? ` · ${money(l.purchasePrice ?? l.askingPrice)}` : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Launch console */}
        <GlassCard accent="gold" className="lg:col-span-3">
          <SectionTitle accent="gold" badge={kind === 'rbp' ? 'NOVATION' : 'PSA'}>Launch console</SectionTitle>

          {stage === 'build' && (
            <div className="space-y-3">
              {/* Template picker */}
              <div>
                <label className="text-[9px] uppercase tracking-wider block mb-1" style={{ color: '#52526e' }}>Contract template</label>
                <select value={tplId} onChange={e => setTplId(e.target.value)}
                  className="w-full text-[11px] rounded-sm px-2.5 py-2 outline-none"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#c4c4d6' }}>
                  {rbpTemplates.length > 0 && (
                    <optgroup label="Novation / Retail Buyer Program">
                      {rbpTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  )}
                  {psaTemplates.length > 0 && (
                    <optgroup label="Purchase & Sale">
                      {psaTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  )}
                  {otherTemplates.length > 0 && (
                    <optgroup label="Other">
                      {otherTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Deal-specific fields (profile depends on contract kind) */}
              <div className="grid grid-cols-2 gap-2">
                {profile.map(f => (
                  <div key={f.key}>
                    <label className="text-[9px] uppercase tracking-wider block mb-1" style={{ color: '#52526e' }}>{f.label}</label>
                    <input value={vals[f.key] || ''} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.def || '—'}
                      className="w-full text-[11px] rounded-sm px-2.5 py-1.5 outline-none"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }} />
                  </div>
                ))}
              </div>

              {/* Recipient line */}
              <div className="flex items-center gap-2 text-[10px] px-2.5 py-2 rounded-sm"
                   style={{ background: 'rgba(0,170,255,0.05)', border: '1px solid rgba(0,170,255,0.15)' }}>
                <Send size={11} style={{ color: '#00aaff' }} />
                <span style={{ color: '#8abbe0' }}>
                  {deal ? <>Sends to <b style={{ color: '#bcd8f0' }}>{deal.name}</b>{deal.address ? ` · ${deal.address}` : ''}</> : 'Pick an armed deal on the left first.'}
                </span>
              </div>

              <button disabled={!deal || !tpl} onClick={() => setStage('review')}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm text-[11px] font-semibold transition-opacity"
                style={{ background: !deal || !tpl ? 'rgba(255,255,255,0.05)' : 'rgba(255,215,0,0.14)',
                         border: `1px solid ${!deal || !tpl ? 'rgba(255,255,255,0.08)' : 'rgba(255,215,0,0.4)'}`,
                         color: !deal || !tpl ? '#52526e' : '#ffd700', cursor: !deal || !tpl ? 'not-allowed' : 'pointer' }}>
                <Eye size={13} /> Review before sending
              </button>
            </div>
          )}

          {stage === 'review' && deal && tpl && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {kind === 'rbp' ? <FileSignature size={15} style={{ color: '#ffd700' }} /> : <FileText size={15} style={{ color: '#00aaff' }} />}
                <div className="min-w-0">
                  <div className="text-[12px] font-medium truncate" style={{ color: '#e8e8f0' }}>{tpl.name}</div>
                  <div className="text-[9px] truncate" style={{ color: '#52526e' }}>{deal.name}{deal.address ? ` · ${deal.address}` : ''}</div>
                </div>
                <span className="ml-auto text-[8px] px-2 py-0.5 rounded-sm shrink-0" style={{ background: 'rgba(255,136,0,0.12)', color: '#ff8800' }}>not sent yet</span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {profile.map(f => (
                  <div key={f.key} className="rounded-sm px-2.5 py-1.5" style={{ background: 'rgba(255,255,255,0.025)' }}>
                    <div className="text-[8px] uppercase tracking-wider" style={{ color: '#52526e' }}>{f.label}</div>
                    <div className="text-[11px] font-medium" style={{ color: '#e8e8f0' }}>{vals[f.key] || '—'}</div>
                  </div>
                ))}
              </div>

              <a href={GHL_DOCS_URL} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 py-2 rounded-sm text-[10px] font-medium"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', color: '#8abbe0' }}>
                <Eye size={12} /> Open template in GHL <ExternalLink size={10} />
              </a>

              {fired && (
                <div className="flex items-center gap-2 text-[10px] px-2.5 py-2 rounded-sm"
                     style={{ background: fired.ok ? 'rgba(0,255,136,0.08)' : 'rgba(255,51,102,0.08)',
                              border: `1px solid ${fired.ok ? 'rgba(0,255,136,0.3)' : 'rgba(255,51,102,0.3)'}` }}>
                  {fired.ok ? <Check size={12} style={{ color: '#00ff88' }} /> : <AlertTriangle size={12} style={{ color: '#ff3366' }} />}
                  <span style={{ color: fired.ok ? '#00ff88' : '#ff8a9c' }}>{fired.msg}</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setStage('build')}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-sm text-[11px] font-medium"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', color: '#c4c4d6' }}>
                  <ArrowLeft size={12} /> Edit
                </button>
                <button disabled={firing || (fired?.ok ?? false)} onClick={fire}
                  className="col-span-2 flex items-center justify-center gap-2 py-2.5 rounded-sm text-[11px] font-semibold"
                  style={{ background: fired?.ok ? 'rgba(0,255,136,0.14)' : 'rgba(255,51,102,0.16)',
                           border: `1px solid ${fired?.ok ? 'rgba(0,255,136,0.4)' : 'rgba(255,51,102,0.45)'}`,
                           color: fired?.ok ? '#00ff88' : '#ff5a78', cursor: firing ? 'wait' : 'pointer' }}>
                  {firing ? <><Loader2 size={13} className="animate-spin" /> Sending…</>
                    : fired?.ok ? <><Check size={13} /> Fired</>
                    : <><Rocket size={13} /> Fire contract</>}
                </button>
              </div>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Recently fired */}
      <GlassCard accent="cyan">
        <SectionTitle accent="cyan" badge={`${docs.length}`}>Recently fired</SectionTitle>
        {docs.length === 0 ? (
          <div className="text-[10px] py-4 text-center" style={{ color: '#52526e' }}>No documents yet.</div>
        ) : (
          <div className="space-y-1">
            {docs.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-sm" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="min-w-0">
                  <div className="text-[11px] truncate" style={{ color: '#c4c4d6' }}>{d.name}</div>
                  {d.recipients?.length ? <div className="text-[9px] truncate" style={{ color: '#52526e' }}>{d.recipients.join(', ')}</div> : null}
                </div>
                <StatusPill status={d.status} />
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
