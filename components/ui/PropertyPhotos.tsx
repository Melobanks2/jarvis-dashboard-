'use client';

/**
 * PropertyPhotos — the Deal Room's photo cards, brought into Jarvis.
 *
 * Same shape Chris already knows: a photo band across the top of the card, up
 * to eight per property, arrows and dots to flip through them, and a strip to
 * manage them. The difference is where they live — the Deal Room keeps photos
 * in the browser's own storage, so they exist on one device. These go to
 * Supabase Storage, so a photo taken on his phone shows up on the laptop.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, ChevronLeft, ChevronRight, Star, Trash2, Plus } from 'lucide-react';
import {
  Photo, MAX_PHOTOS, listPropertyPhotos, addPropertyPhotos,
  removePropertyPhoto, makeFrontPhoto,
} from '@/lib/propertyPhoto';

/* ── shared state ─────────────────────────────────────────────────────── */

export function usePropertyPhotos(phone?: string | null) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setPhotos(await listPropertyPhotos(phone, { fresh: true }));
    setLoading(false);
  }, [phone]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    listPropertyPhotos(phone).then(p => { if (live) { setPhotos(p); setLoading(false); } });
    return () => { live = false; };
  }, [phone]);

  const add = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setErr(null);
    const r = await addPropertyPhotos(phone, files);
    if (r.error) setErr(r.error);
    await reload();
    setBusy(false);
  }, [phone, reload]);

  const remove = useCallback(async (slot: number) => {
    setBusy(true); setErr(null);
    const r = await removePropertyPhoto(phone, slot);
    if (!r.ok) setErr(r.error || 'Could not remove that photo.');
    await reload();
    setBusy(false);
  }, [phone, reload]);

  const promote = useCallback(async (slot: number) => {
    setBusy(true); setErr(null);
    const r = await makeFrontPhoto(phone, slot);
    if (!r.ok) setErr(r.error || 'Could not reorder.');
    await reload();
    setBusy(false);
  }, [phone, reload]);

  return { photos, loading, busy, err, add, remove, promote, reload, setErr };
}

/* ── the card band ────────────────────────────────────────────────────── */

const houseNumber = (address?: string | null) =>
  String(address || '').trim().split(/\s+/)[0]?.replace(/[^\w-]/g, '') || '?';

/**
 * The photo band that sits across the top of a deal card.
 *
 * Renders the placeholder even with no photos — an empty slot that says "add
 * photos" is what makes the feature discoverable; a card that only grows a
 * photo area once it has photos never gets its first one.
 */
export function PropertyBanner({
  phone, address, height = 132, radius = 22, className = '', hideWhenEmpty = false,
}: {
  phone?: string | null; address?: string | null;
  height?: number; radius?: number; className?: string;
  /** Boards render 156 cards. An empty gradient band on 150 of them is 150
   *  rows of nothing — those keep their thumbnail and gain the band once a
   *  photo exists. */
  hideWhenEmpty?: boolean;
}) {
  const ph = usePropertyPhotos(phone);
  const [idx, setIdx] = useState(0);
  const [manage, setManage] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [drop, setDrop] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const n = ph.photos.length;
  useEffect(() => { if (idx >= n) setIdx(0); }, [n, idx]);

  const step = (d: number, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    setIdx(i => (i + d + n) % n);
  };

  const current = ph.photos[idx];

  if (hideWhenEmpty && (ph.loading || n === 0)) return null;

  return (
    <>
      <div
        className={`relative group/ph overflow-hidden ${className}`}
        style={{ height, borderRadius: `${radius}px ${radius}px 0 0` }}
        onDragOver={e => { e.preventDefault(); setDrop(true); }}
        onDragLeave={() => setDrop(false)}
        onDrop={e => {
          e.preventDefault(); setDrop(false);
          ph.add(Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/')));
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; ph.add(f); }} />

        {current ? (
          <button
            onClick={e => { e.stopPropagation(); setLightbox(idx); }}
            className="absolute inset-0 w-full h-full cursor-zoom-in"
            title="View full size">
            <img src={current.url} alt="" className="w-full h-full object-cover"
              style={{ transition: 'transform .4s' }} />
          </button>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
            className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-1"
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))' }}
            title="Add photos of this property">
            <span className="text-[26px] font-semibold tracking-tight" style={{ color: 'rgba(235,235,245,0.22)' }}>
              {ph.busy ? '…' : houseNumber(address)}
            </span>
            <span className="text-[9px] uppercase tracking-[0.6px] flex items-center gap-1"
              style={{ color: 'rgba(100,210,255,0.75)' }}>
              <Camera size={9} /> {ph.busy ? 'uploading' : 'add photos'}
            </span>
          </button>
        )}

        {/* darkening under the controls so white glyphs survive a bright photo */}
        {n > 0 && (
          <div className="absolute inset-x-0 top-0 h-12 pointer-events-none opacity-0 group-hover/ph:opacity-100 transition-opacity"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45), transparent)' }} />
        )}

        {n > 1 && (
          <>
            <NavBtn side="left"  onClick={e => step(-1, e)} />
            <NavBtn side="right" onClick={e => step(1, e)} />
            <div className="absolute bottom-2 inset-x-0 flex justify-center gap-[5px] pointer-events-none">
              {ph.photos.map((_, i) => (
                <i key={i} className="w-[5px] h-[5px] rounded-full transition-colors"
                  style={{ background: i === idx ? '#fff' : 'rgba(255,255,255,0.5)', boxShadow: '0 0 2px rgba(0,0,0,0.6)' }} />
              ))}
            </div>
          </>
        )}

        {/* manage — always reachable, even at 8 photos */}
        <button
          onClick={e => { e.stopPropagation(); setManage(true); }}
          title="Manage photos"
          className="absolute top-2 right-2 h-7 px-2 rounded-lg flex items-center gap-1 text-[10px] font-medium opacity-0 group-hover/ph:opacity-100 transition-opacity"
          style={{
            background: 'rgba(20,20,32,0.72)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.16)', color: '#f5f5f7',
          }}>
          <Camera size={11} />{n > 0 && <span>{n}</span>}
        </button>

        {drop && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ background: 'rgba(10,132,255,0.22)', border: '2px dashed rgba(100,210,255,0.8)' }}>
            <span className="text-[11px] font-semibold text-textb">Drop to add</span>
          </div>
        )}
      </div>

      {manage && <PhotoManager phone={phone} address={address} ph={ph} onClose={() => setManage(false)} />}
      {lightbox !== null && (
        <Lightbox photos={ph.photos} start={lightbox} address={address} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

function NavBtn({ side, onClick }: { side: 'left' | 'right'; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick}
      title={side === 'left' ? 'Previous photo' : 'Next photo'}
      className="absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover/ph:opacity-90 hover:!opacity-100 transition-opacity"
      style={{
        [side]: 8, background: 'rgba(20,20,32,0.72)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.16)', color: '#f5f5f7',
      } as React.CSSProperties}>
      {side === 'left' ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
    </button>
  );
}

/* ── compact square, for list rows ────────────────────────────────────── */

export function PropertyThumb({
  phone, address, size = 44, radius = 8,
}: { phone?: string | null; address?: string | null; size?: number; radius?: number }) {
  const ph = usePropertyPhotos(phone);
  const [manage, setManage] = useState(false);
  const front = ph.photos[0];

  return (
    <>
      <div className="relative flex-shrink-0 group/th" style={{ width: size, height: size }}
        onClick={e => e.stopPropagation()}>
        <button
          onClick={e => { e.stopPropagation(); setManage(true); }}
          title={front ? `${ph.photos.length} photo${ph.photos.length === 1 ? '' : 's'} — click to manage` : 'Add photos'}
          className="w-full h-full overflow-hidden flex items-center justify-center"
          style={{
            borderRadius: radius,
            background: front ? 'rgba(255,255,255,0.04)' : 'rgba(100,210,255,0.08)',
            border: '1px solid var(--border2)',
          }}>
          {front
            ? <img src={front.url} alt="" className="w-full h-full object-cover" />
            : <span className="text-[10px] font-semibold" style={{ color: '#64d2ff' }}>
                {ph.busy ? '…' : houseNumber(address)}
              </span>}
        </button>
        {ph.photos.length > 1 && (
          <span className="absolute bottom-0.5 right-0.5 px-1 rounded text-[8px] font-semibold leading-[13px]"
            style={{ background: 'rgba(20,20,32,0.8)', color: '#f5f5f7', backdropFilter: 'blur(4px)' }}>
            {ph.photos.length}
          </span>
        )}
      </div>
      {manage && <PhotoManager phone={phone} address={address} ph={ph} onClose={() => setManage(false)} />}
    </>
  );
}

/* ── manager ──────────────────────────────────────────────────────────── */

type PhotoState = ReturnType<typeof usePropertyPhotos>;

function PhotoManager({ phone, address, ph, onClose }: {
  phone?: string | null; address?: string | null; ph: PhotoState; onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [drop, setDrop] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const n = ph.photos.length;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && lightbox === null) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, lightbox]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}>
        <motion.div
          className="relative w-full max-w-lg rounded-[18px] border border-border2 p-5"
          style={{ background: 'rgba(12,12,24,0.98)' }}
          initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
          onClick={e => e.stopPropagation()}
          onDragOver={e => { e.preventDefault(); setDrop(true); }}
          onDragLeave={() => setDrop(false)}
          onDrop={e => {
            e.preventDefault(); setDrop(false);
            ph.add(Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/')));
          }}>
          <button onClick={onClose} className="absolute top-4 right-4 text-dimtext hover:text-textb"><X size={15} /></button>

          <div className="text-[14px] font-semibold text-textb">Property photos</div>
          <div className="text-[11px] text-dimtext mt-0.5 mb-4">
            {address || 'This lead'} · <span className="text-dimtext">{n} of {MAX_PHOTOS}</span>
            {n > 0 && <span className="text-dimtext"> · first one shows on the card</span>}
          </div>

          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; ph.add(f); }} />

          <div className="flex flex-wrap gap-2.5">
            {ph.photos.map((p, i) => (
              <div key={p.slot} className="relative group/pt" style={{ width: 92, height: 72 }}>
                <button onClick={() => setLightbox(i)}
                  className="w-full h-full rounded-[10px] overflow-hidden border border-border2 cursor-zoom-in">
                  <img src={p.url} alt="" className="w-full h-full object-cover" />
                </button>

                {i === 0 ? (
                  <span className="absolute bottom-1 left-1 px-1.5 rounded text-[8px] font-semibold uppercase tracking-[0.4px] leading-[14px]"
                    style={{ background: 'rgba(10,132,255,0.92)', color: '#fff' }}>Front</span>
                ) : (
                  <button onClick={() => ph.promote(p.slot)} title="Make this the front photo"
                    className="absolute bottom-1 left-1 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover/pt:opacity-100 transition-opacity"
                    style={{ background: 'rgba(20,20,32,0.85)', border: '1px solid rgba(255,255,255,0.18)', color: '#ff9f0a' }}>
                    <Star size={10} />
                  </button>
                )}

                <button onClick={() => ph.remove(p.slot)} title="Remove this photo"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover/pt:opacity-100 transition-opacity"
                  style={{ background: 'rgba(255,69,58,0.95)', color: '#fff' }}>
                  <Trash2 size={9} />
                </button>
              </div>
            ))}

            {n < MAX_PHOTOS && (
              <button onClick={() => fileRef.current?.click()} disabled={ph.busy}
                className="rounded-[10px] flex flex-col items-center justify-center gap-0.5 transition-colors hover:border-cyan-400/50"
                style={{ width: 92, height: 72, border: '1.5px dashed var(--border2)', color: 'var(--dimtext)' }}
                title="Choose images">
                {ph.busy
                  ? <span className="text-[10px]">uploading…</span>
                  : <><Plus size={15} /><span className="text-[9px]">add</span></>}
              </button>
            )}
          </div>

          {ph.err && <div className="mt-3 text-[11px]" style={{ color: '#ff453a' }}>{ph.err}</div>}

          <div className="mt-4 pt-3 border-t border-border text-[10px] text-dimtext leading-relaxed">
            Drag images anywhere in this box to add them. They save to Jarvis, not to this
            browser — a photo added on the phone shows up on the laptop.
          </div>

          {drop && (
            <div className="absolute inset-0 rounded-[18px] flex items-center justify-center pointer-events-none"
              style={{ background: 'rgba(10,132,255,0.2)', border: '2px dashed rgba(100,210,255,0.85)' }}>
              <span className="text-[12px] font-semibold text-textb">Drop to add</span>
            </div>
          )}
        </motion.div>

        {lightbox !== null && (
          <Lightbox photos={ph.photos} start={lightbox} address={address} onClose={() => setLightbox(null)} />
        )}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

/* ── lightbox ─────────────────────────────────────────────────────────── */

function Lightbox({ photos, start, address, onClose }: {
  photos: Photo[]; start: number; address?: string | null; onClose: () => void;
}) {
  const [i, setI] = useState(start);
  const n = photos.length;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowRight') setI(v => (v + 1) % n);
      if (e.key === 'ArrowLeft')  setI(v => (v - 1 + n) % n);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [n, onClose]);

  if (typeof document === 'undefined' || !photos[i]) return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}>
      <button onClick={onClose} className="absolute top-5 right-5 text-dimtext hover:text-textb"><X size={20} /></button>

      <img src={photos[i].url} alt="" className="max-w-full max-h-[82vh] object-contain rounded-lg"
        onClick={e => e.stopPropagation()} />

      <div className="mt-3 text-[11px] text-dimtext">
        {address ? `${address} · ` : ''}{i + 1} of {n}
      </div>

      {n > 1 && (
        <>
          <button onClick={e => { e.stopPropagation(); setI(v => (v - 1 + n) % n); }}
            className="absolute left-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#f5f5f7' }}><ChevronLeft size={20} /></button>
          <button onClick={e => { e.stopPropagation(); setI(v => (v + 1) % n); }}
            className="absolute right-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#f5f5f7' }}><ChevronRight size={20} /></button>
        </>
      )}
    </motion.div>,
    document.body,
  );
}
