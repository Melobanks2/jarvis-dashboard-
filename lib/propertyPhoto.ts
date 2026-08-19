/**
 * propertyPhoto.ts — one photo per property, uploaded by hand.
 *
 * Street View was the obvious answer and it does not work here: 45% of the
 * addresses on file are a street name with no city, state or ZIP ("1247
 * Wexford Way"), and no lookup service can resolve those. Zillow has no public
 * photo API and blocks scraping. So the photo is something Chris attaches.
 *
 * No table: the object path IS the key. A lead's photo lives at
 * property-photos/<last-10-phone-digits>, so the public URL is derivable from
 * the phone number alone and nothing has to be joined or kept in sync.
 */

import { supabase } from '@/lib/supabase';

const BUCKET = 'property-photos';

export const phoneKey = (p?: string | null) =>
  String(p || '').replace(/\D/g, '').slice(-10);

/** Public URL for a lead's photo. Returns null without a usable phone. */
export function photoUrlFor(phone?: string | null, bust?: string | number): string | null {
  const k = phoneKey(phone);
  if (!k) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(k);
  if (!data?.publicUrl) return null;
  // Storage sets long cache headers; a changing suffix makes a replacement
  // show up immediately instead of after the CDN expires it.
  return bust ? `${data.publicUrl}?v=${bust}` : data.publicUrl;
}

export interface UploadResult { ok: boolean; url?: string; error?: string }

/** Upload (or replace) the photo for a lead. */
export async function uploadPropertyPhoto(phone: string | null | undefined, file: File): Promise<UploadResult> {
  const k = phoneKey(phone);
  if (!k) return { ok: false, error: 'This lead has no usable phone number.' };
  if (!file.type.startsWith('image/')) return { ok: false, error: 'That file is not an image.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'Image is over 5 MB — try a smaller one.' };

  const { error } = await supabase.storage.from(BUCKET).upload(k, file, {
    upsert: true, contentType: file.type, cacheControl: '3600',
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, url: photoUrlFor(phone, Date.now()) || undefined };
}

export async function removePropertyPhoto(phone?: string | null): Promise<UploadResult> {
  const k = phoneKey(phone);
  if (!k) return { ok: false, error: 'No phone key' };
  const { error } = await supabase.storage.from(BUCKET).remove([k]);
  return error ? { ok: false, error: error.message } : { ok: true };
}
