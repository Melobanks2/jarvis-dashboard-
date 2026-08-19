/**
 * propertyPhoto.ts — up to 8 photos per property, uploaded by hand.
 *
 * Street View was the obvious answer and it does not work here: 45% of the
 * addresses on file are a street name with no city, state or ZIP ("1247
 * Wexford Way"), and no lookup service can resolve those. Zillow has no public
 * photo API and blocks scraping. So the photos are something Chris attaches —
 * the same way he does in the Deal Room.
 *
 * No table: the object path IS the key. A lead's photos live in
 * property-photos/<last-10-phone-digits>/p1.jpg … p8.jpg, so everything is
 * derivable from the phone number alone and nothing has to be joined or kept
 * in sync. Slot number is the display order, which makes "make this the front
 * photo" a swap of two objects rather than a rewrite of the whole set.
 */

import { supabase } from '@/lib/supabase';

const BUCKET   = 'property-photos';
export const MAX_PHOTOS = 8;

export const phoneKey = (p?: string | null) =>
  String(p || '').replace(/\D/g, '').slice(-10);

const slotName = (n: number) => `p${n}.jpg`;
const slotOf   = (name: string) => Number(/^p(\d+)\.jpg$/.exec(name)?.[1] || 0);

/* ── which leads have photos at all ───────────────────────────────────────
   A screen of the Leads board renders 156 cards. Asking Storage to list each
   one is 156 round-trips to learn that 150 of them have nothing. Storage's
   root listing returns the folder names — one call that answers "does this
   lead have any photos" for every card at once. Only the handful that say yes
   pay for a detail listing, and that result is cached too. */

let indexPromise: Promise<Set<string>> | null = null;
const detailCache = new Map<string, Photo[]>();

export function photoIndex(): Promise<Set<string>> {
  if (!indexPromise) {
    indexPromise = supabase.storage.from(BUCKET).list('', { limit: 1000 })
      .then(({ data }) => new Set((data || []).map(o => o.name).filter(Boolean)))
      .catch(() => new Set<string>());
  }
  return indexPromise;
}

/** Drop cached answers for one lead after it changes. */
export function invalidatePhotos(phone?: string | null) {
  const k = phoneKey(phone);
  if (k) detailCache.delete(k);
  indexPromise = null;
}

export interface Photo {
  slot: number;
  url: string;
}

/**
 * Every photo on file for a lead, front photo first.
 *
 * The cache-buster comes from the object's own updated_at rather than a clock
 * read: swapping two slots changes what lives at a URL without changing the
 * URL, and Storage sets a long max-age. Without this a reorder looks like it
 * did nothing until the CDN expires.
 */
export async function listPropertyPhotos(phone?: string | null, opts?: { fresh?: boolean }): Promise<Photo[]> {
  const k = phoneKey(phone);
  if (!k) return [];

  if (!opts?.fresh) {
    const hit = detailCache.get(k);
    if (hit) return hit;
    if (!(await photoIndex()).has(k)) { detailCache.set(k, []); return []; }
  }

  const { data, error } = await supabase.storage.from(BUCKET).list(k, { limit: MAX_PHOTOS * 2 });
  if (error || !data) return [];

  const out = data
    .map(o => ({ slot: slotOf(o.name), name: o.name, v: o.updated_at || o.created_at || '' }))
    .filter(o => o.slot > 0)
    .sort((a, b) => a.slot - b.slot)
    .map(o => {
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(`${k}/${o.name}`);
      const url = pub?.publicUrl || '';
      return { slot: o.slot, url: o.v ? `${url}?v=${encodeURIComponent(o.v)}` : url };
    })
    .filter(p => !!p.url);

  detailCache.set(k, out);
  return out;
}

/**
 * Shrink to something worth looking at but cheap to move.
 *
 * Phone photos are 3-4 MB and 4000px wide; nobody needs that on a card. 1400px
 * at q0.78 lands around 200 KB and still holds up full-screen. Failing the
 * canvas step falls back to the original file rather than dropping the upload.
 */
function compress(file: File): Promise<Blob> {
  return new Promise(resolve => {
    if (!file.type.startsWith('image/') || file.type === 'image/heic') return resolve(file);
    const rd = new FileReader();
    rd.onerror = () => resolve(file);
    rd.onload = e => {
      const img = new Image();
      img.onerror = () => resolve(file);
      img.onload = () => {
        const max = 1400;
        let { width: w, height: h } = img;
        if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        if (!ctx) return resolve(file);
        ctx.drawImage(img, 0, 0, w, h);
        cv.toBlob(b => resolve(b || file), 'image/jpeg', 0.78);
      };
      img.src = String(e.target?.result || '');
    };
    rd.readAsDataURL(file);
  });
}

export interface UploadResult { ok: boolean; added?: number; error?: string }

/** Add photos to the first free slots. Silently stops at MAX_PHOTOS. */
export async function addPropertyPhotos(phone: string | null | undefined, files: File[]): Promise<UploadResult> {
  const k = phoneKey(phone);
  if (!k) return { ok: false, error: 'This lead has no usable phone number.' };

  const existing = await listPropertyPhotos(phone, { fresh: true });
  const taken    = new Set(existing.map(p => p.slot));
  const free     = Array.from({ length: MAX_PHOTOS }, (_, i) => i + 1).filter(n => !taken.has(n));
  if (!free.length) return { ok: false, error: `Already at ${MAX_PHOTOS} photos — remove one first.` };

  const usable = files.filter(f => f.type.startsWith('image/')).slice(0, free.length);
  if (!usable.length) return { ok: false, error: 'No images in that selection.' };

  let added = 0;
  let firstError: string | null = null;

  for (let i = 0; i < usable.length; i++) {
    const body = await compress(usable[i]);
    if (body.size > 5 * 1024 * 1024) { firstError = firstError || 'One image is over 5 MB even compressed.'; continue; }
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${k}/${slotName(free[i])}`, body, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
    if (error) firstError = firstError || error.message;
    else added++;
  }

  invalidatePhotos(phone);
  if (!added) return { ok: false, error: firstError || 'Upload failed.' };
  return { ok: true, added, error: firstError || undefined };
}

export async function removePropertyPhoto(phone: string | null | undefined, slot: number): Promise<UploadResult> {
  const k = phoneKey(phone);
  if (!k) return { ok: false, error: 'No phone key' };
  const { error } = await supabase.storage.from(BUCKET).remove([`${k}/${slotName(slot)}`]);
  invalidatePhotos(phone);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Delete every photo for a lead. */
export async function clearPropertyPhotos(phone?: string | null): Promise<UploadResult> {
  const k = phoneKey(phone);
  if (!k) return { ok: false, error: 'No phone key' };
  const photos = await listPropertyPhotos(phone, { fresh: true });
  if (!photos.length) return { ok: true };
  const { error } = await supabase.storage.from(BUCKET).remove(photos.map(p => `${k}/${slotName(p.slot)}`));
  invalidatePhotos(phone);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Promote a photo to the front of the card.
 *
 * Swaps it with whatever currently holds the lowest slot, via a scratch name —
 * move() refuses to overwrite, so the two objects cannot simply trade places.
 */
export async function makeFrontPhoto(phone: string | null | undefined, slot: number): Promise<UploadResult> {
  const k = phoneKey(phone);
  if (!k) return { ok: false, error: 'No phone key' };

  const photos = await listPropertyPhotos(phone, { fresh: true });
  const front  = photos[0];
  if (!front || front.slot === slot) return { ok: true };

  const st = supabase.storage.from(BUCKET);
  const tmp = `${k}/.swap.jpg`;
  const a = `${k}/${slotName(front.slot)}`;
  const b = `${k}/${slotName(slot)}`;

  // move() refuses to overwrite, so a swap interrupted halfway would jam every
  // later reorder on a stranded scratch object. Clear it first.
  await st.remove([tmp]);

  let r = await st.move(b, tmp);      if (r.error) return { ok: false, error: r.error.message };
  r = await st.move(a, b);            if (r.error) { await st.move(tmp, b); return { ok: false, error: r.error.message }; }
  r = await st.move(tmp, a);          if (r.error) return { ok: false, error: r.error.message };
  invalidatePhotos(phone);
  return { ok: true };
}
