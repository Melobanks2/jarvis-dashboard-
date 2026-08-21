'use client';

/**
 * Login — password once, then Touch ID forever.
 *
 * Replaces the browser's basic-auth dialog, which could not be satisfied by a
 * biometric and re-prompted constantly. If a passkey is registered, the page
 * offers it first and tries it automatically, so the usual visit is: open the
 * link, touch the sensor, you're in.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const b64url = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const supported = typeof window !== 'undefined' && !!window.PublicKeyCredential;

  const passkeyLogin = useCallback(async (silent = false) => {
    setErr(null); setBusy(true);
    try {
      const optRes = await fetch('/api/auth/passkey?action=login-options', { method: 'POST' });
      if (!optRes.ok) throw new Error((await optRes.json()).error || 'No passkey');
      const opt = await optRes.json();

      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: fromB64url(opt.challenge),
          rpId: opt.rpId,
          allowCredentials: (opt.allowCredentials || []).map((c: { id: string }) => ({
            type: 'public-key' as const, id: fromB64url(c.id),
          })),
          userVerification: 'required',
          timeout: opt.timeout,
        },
      }) as PublicKeyCredential | null;
      if (!cred) throw new Error('Cancelled');

      const r = cred.response as AuthenticatorAssertionResponse;
      const verify = await fetch('/api/auth/passkey?action=login-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cred.id,
          authenticatorData: b64url(r.authenticatorData),
          clientDataJSON: b64url(r.clientDataJSON),
          signature: b64url(r.signature),
        }),
      });
      if (!verify.ok) throw new Error((await verify.json()).error || 'Passkey rejected');
      router.replace(next);
      router.refresh();
    } catch (e) {
      // A silent auto-attempt that fails should not shout — the password form
      // is right there.
      if (!silent) setErr((e as Error).message);
    } finally { setBusy(false); }
  }, [next, router]);

  useEffect(() => {
    fetch('/api/auth/passkey').then(r => r.json()).then(j => {
      if (j.count > 0) {
        setHasPasskey(true);
        if (supported) passkeyLogin(true);   // offer the sensor straight away
      }
    }).catch(() => {});
  }, [supported, passkeyLogin]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Wrong password');
      router.replace(next);
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function registerPasskey() {
    setErr(null); setNote(null); setBusy(true);
    try {
      const optRes = await fetch('/api/auth/passkey?action=register-options', { method: 'POST' });
      if (!optRes.ok) throw new Error((await optRes.json()).error || 'Sign in first');
      const opt = await optRes.json();

      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: fromB64url(opt.challenge),
          rp: opt.rp,
          user: { ...opt.user, id: fromB64url(opt.user.id) },
          pubKeyCredParams: opt.pubKeyCredParams,
          authenticatorSelection: opt.authenticatorSelection,
          excludeCredentials: (opt.excludeCredentials || []).map((c: { id: string }) => ({
            type: 'public-key' as const, id: fromB64url(c.id),
          })),
          timeout: opt.timeout,
          attestation: 'none',
        },
      }) as PublicKeyCredential | null;
      if (!cred) throw new Error('Cancelled');

      const r = cred.response as AuthenticatorAttestationResponse;
      const verify = await fetch('/api/auth/passkey?action=register-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cred.id,
          attestationObject: b64url(r.attestationObject),
          clientDataJSON: b64url(r.clientDataJSON),
          label: navigator.platform || 'This device',
        }),
      });
      if (!verify.ok) throw new Error((await verify.json()).error || 'Could not save it');
      setHasPasskey(true);
      setNote('Saved. Next time just touch the sensor.');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{
      minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24,
      background: 'var(--bg, #06080c)',
    }}>
      <div style={{
        width: '100%', maxWidth: 380, borderRadius: 22, padding: '30px 28px',
        background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.10)',
        backdropFilter: 'blur(24px)', boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
      }}>
        <div style={{ fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: '#64d2ff', fontWeight: 600 }}>
          Jarvis
        </div>
        <h1 style={{ margin: '8px 0 22px', fontSize: 25, letterSpacing: -0.5, color: '#f5f5f7', fontWeight: 650 }}>
          Command Center
        </h1>

        {hasPasskey && supported && (
          <button type="button" onClick={() => passkeyLogin(false)} disabled={busy}
            style={{
              width: '100%', padding: '13px 16px', borderRadius: 13, marginBottom: 16,
              background: 'rgba(100,210,255,0.16)', border: '1px solid rgba(100,210,255,0.4)',
              color: '#64d2ff', fontSize: 15, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
            }}>
            {busy ? 'Waiting…' : 'Unlock with Touch ID'}
          </button>
        )}

        <form onSubmit={submit}>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" autoFocus={!hasPasskey} autoComplete="current-password"
            style={{
              width: '100%', padding: '13px 15px', borderRadius: 13, fontSize: 16,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.13)',
              color: '#f5f5f7', outline: 'none', marginBottom: 12,
            }} />
          <button type="submit" disabled={busy || !password}
            style={{
              width: '100%', padding: '13px 16px', borderRadius: 13,
              background: password ? '#0a84ff' : 'rgba(255,255,255,0.07)',
              border: 'none', color: password ? '#fff' : '#8e8e93',
              fontSize: 15, fontWeight: 600, cursor: busy || !password ? 'default' : 'pointer',
            }}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>

        {err && (
          <div style={{ marginTop: 14, fontSize: 13, color: '#ff6b5e', textAlign: 'center' }}>{err}</div>
        )}
        {note && (
          <div style={{ marginTop: 14, fontSize: 13, color: '#30d158', textAlign: 'center' }}>{note}</div>
        )}

        {supported && !hasPasskey && (
          <button type="button" onClick={registerPasskey} disabled={busy}
            style={{
              width: '100%', marginTop: 18, padding: '11px 14px', borderRadius: 12,
              background: 'transparent', border: '1px dashed rgba(255,255,255,0.2)',
              color: '#8e8e93', fontSize: 13, cursor: 'pointer',
            }}>
            Set up Touch ID / Face ID
          </button>
        )}

        <div style={{ marginTop: 18, fontSize: 11.5, color: '#6e6e73', textAlign: 'center', lineHeight: 1.5 }}>
          Stays signed in for 30 days on this device.
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
