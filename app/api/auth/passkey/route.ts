import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * Passkeys — Touch ID on the Mac, Face ID on the phone.
 *
 * WebAuthn, implemented directly rather than pulling a library, because the
 * only two things needed are: remember a public key at registration, and
 * verify one signature at login. The private key never leaves the device's
 * secure enclave, so a stolen credentials file cannot be used to sign in.
 *
 *   POST ?action=register-options   (must already be signed in)
 *   POST ?action=register-verify    store the credential
 *   POST ?action=login-options      public — returns a challenge
 *   POST ?action=login-verify       public — verify, issue a session
 *
 * Credentials live in data/passkeys.json next to the other local state. A
 * public key is not a secret; the challenge store is in-memory and one-use,
 * which is what actually prevents replay.
 */

const FILE = path.join(process.cwd(), 'data', 'passkeys.json');

interface Cred { id: string; publicKey: string; alg: number; label: string; createdAt: string }

async function readCreds(): Promise<Cred[]> {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')).credentials || []; }
  catch { return []; }
}
async function writeCreds(credentials: Cred[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ credentials }, null, 2));
}

// Challenges are single-use and short-lived. In memory is correct here: a
// restart invalidating a half-finished login is the safe direction to fail.
const challenges = new Map<string, number>();
const CHALLENGE_TTL_MS = 120_000;

function newChallenge(): string {
  const c = crypto.randomBytes(32).toString('base64url');
  challenges.set(c, Date.now() + CHALLENGE_TTL_MS);
  challenges.forEach((exp, k) => { if (exp < Date.now()) challenges.delete(k); });
  return c;
}
function takeChallenge(c: string): boolean {
  const exp = challenges.get(c);
  challenges.delete(c);            // one use, whatever the outcome
  return !!exp && exp > Date.now();
}

const b64url = (b: Buffer) => b.toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');

/** rpId must be the registrable domain, and must not include the port. */
function rpIdFrom(req: NextRequest): string {
  return req.nextUrl.hostname;
}

async function isSignedIn(req: NextRequest): Promise<boolean> {
  const PASS = process.env.DASHBOARD_PASS || '';
  return !!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value, PASS));
}

/**
 * Verify a WebAuthn assertion signature.
 * The signed message is authenticatorData || SHA256(clientDataJSON).
 */
function verifySignature(alg: number, publicKeyDer: Buffer, authData: Buffer, clientDataJSON: Buffer, sig: Buffer): boolean {
  const signed = Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
  try {
    const keyObj = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    if (alg === -7)   return crypto.verify('sha256', signed, { key: keyObj, dsaEncoding: 'der' }, sig);  // ES256
    if (alg === -257) return crypto.verify('sha256', signed, keyObj, sig);                               // RS256
    return false;
  } catch { return false; }
}

/**
 * Pull the credential id and COSE public key out of attestationObject's
 * authData. Attestation itself is not verified — for a single-user dashboard
 * the value is "this device can sign", not "this device is a genuine YubiKey".
 */
function parseAttestation(attestationObject: Buffer): { credId: Buffer; cose: Map<number, unknown> } | null {
  // authData sits inside a CBOR map. Rather than a full CBOR decoder, find the
  // 'authData' text key and read the byte string that follows it.
  const marker = Buffer.from('authData');
  const at = attestationObject.indexOf(marker);
  if (at < 0) return null;
  let p = at + marker.length;
  const type = attestationObject[p] >> 5;
  const info = attestationObject[p] & 0x1f;
  if (type !== 2) return null;                       // must be a byte string
  p += 1;
  let len = info;
  if (info === 24) { len = attestationObject[p]; p += 1; }
  else if (info === 25) { len = attestationObject.readUInt16BE(p); p += 2; }
  else if (info === 26) { len = attestationObject.readUInt32BE(p); p += 4; }
  else if (info > 26) return null;
  const authData = attestationObject.subarray(p, p + len);

  // authData: rpIdHash(32) flags(1) counter(4) aaguid(16) credIdLen(2) credId credPubKey
  if (authData.length < 55) return null;
  const credIdLen = authData.readUInt16BE(53);
  const credId = authData.subarray(55, 55 + credIdLen);
  const coseBytes = authData.subarray(55 + credIdLen);
  const cose = parseCoseKey(coseBytes);
  return cose ? { credId, cose } : null;
}

/** Minimal COSE_Key reader — only the fields needed to rebuild an EC2/RSA key. */
function parseCoseKey(buf: Buffer): Map<number, unknown> | null {
  const out = new Map<number, unknown>();
  let p = 0;
  const readLen = (info: number) => {
    if (info < 24) return info;
    if (info === 24) { const v = buf[p]; p += 1; return v; }
    if (info === 25) { const v = buf.readUInt16BE(p); p += 2; return v; }
    if (info === 26) { const v = buf.readUInt32BE(p); p += 4; return v; }
    return -1;
  };
  const major = buf[p] >> 5, info = buf[p] & 0x1f;
  if (major !== 5) return null;                      // must be a map
  p += 1;
  const n = readLen(info);
  if (n < 0) return null;

  for (let i = 0; i < n; i++) {
    // key: small int, possibly negative
    const km = buf[p] >> 5, ki = buf[p] & 0x1f;
    p += 1;
    let k = readLen(ki);
    if (km === 1) k = -1 - k;
    else if (km !== 0) return null;

    // value: int, negative int, or byte string
    const vm = buf[p] >> 5, vi = buf[p] & 0x1f;
    p += 1;
    if (vm === 0)      out.set(k, readLen(vi));
    else if (vm === 1) out.set(k, -1 - readLen(vi));
    else if (vm === 2) { const l = readLen(vi); out.set(k, buf.subarray(p, p + l)); p += l; }
    else return null;
  }
  return out;
}

/** COSE EC2 (P-256) or RSA → DER SPKI, so node crypto can import it. */
function coseToDer(cose: Map<number, unknown>): { der: Buffer; alg: number } | null {
  const kty = cose.get(1);
  const alg = Number(cose.get(3));
  if (kty === 2) {                                    // EC2 / P-256
    const x = cose.get(-2) as Buffer, y = cose.get(-3) as Buffer;
    if (!x || !y) return null;
    const prefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    return { der: Buffer.concat([prefix, Buffer.from([0x04]), x, y]), alg: alg || -7 };
  }
  if (kty === 3) {                                    // RSA
    const n = cose.get(-1) as Buffer, e = cose.get(-2) as Buffer;
    if (!n || !e) return null;
    const nb = n[0] & 0x80 ? Buffer.concat([Buffer.from([0]), n]) : n;
    const intOf = (b: Buffer) => Buffer.concat([Buffer.from([0x02]), lenOf(b.length), b]);
    const lenOf = (l: number): Buffer =>
      l < 128 ? Buffer.from([l])
      : l < 256 ? Buffer.from([0x81, l])
      : Buffer.from([0x82, l >> 8, l & 0xff]);
    const seq = Buffer.concat([intOf(nb), intOf(e)]);
    const rsaSeq = Buffer.concat([Buffer.from([0x30]), lenOf(seq.length), seq]);
    const bitStr = Buffer.concat([Buffer.from([0x03]), lenOf(rsaSeq.length + 1), Buffer.from([0]), rsaSeq]);
    const algId = Buffer.from('300d06092a864886f70d0101010500', 'hex');
    const outer = Buffer.concat([algId, bitStr]);
    return { der: Buffer.concat([Buffer.from([0x30]), lenOf(outer.length), outer]), alg: alg || -257 };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') || '';
  const rpId = rpIdFrom(req);

  try {
    if (action === 'register-options') {
      if (!(await isSignedIn(req))) {
        return NextResponse.json({ error: 'Sign in with your password first' }, { status: 401 });
      }
      const existing = await readCreds();
      return NextResponse.json({
        challenge: newChallenge(),
        rp: { id: rpId, name: 'Jarvis Command Center' },
        user: {
          id: Buffer.from('jarvis').toString('base64url'),
          name: process.env.DASHBOARD_USER || 'jarvis',
          displayName: 'Jarvis',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          // platform = the built-in enclave, which is what makes it Touch ID
          // rather than a prompt for a USB key.
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
        excludeCredentials: existing.map(c => ({ type: 'public-key', id: c.id })),
        timeout: 60000,
        attestation: 'none',
      });
    }

    if (action === 'register-verify') {
      if (!(await isSignedIn(req))) {
        return NextResponse.json({ error: 'Sign in with your password first' }, { status: 401 });
      }
      const { id, attestationObject, clientDataJSON, label } = await req.json();
      const client = JSON.parse(fromB64url(clientDataJSON).toString('utf8'));
      if (client.type !== 'webauthn.create') return NextResponse.json({ error: 'Wrong ceremony' }, { status: 400 });
      if (!takeChallenge(client.challenge)) return NextResponse.json({ error: 'Challenge expired — try again' }, { status: 400 });

      const parsed = parseAttestation(fromB64url(attestationObject));
      if (!parsed) return NextResponse.json({ error: 'Could not read the credential' }, { status: 400 });
      const der = coseToDer(parsed.cose);
      if (!der) return NextResponse.json({ error: 'Unsupported key type' }, { status: 400 });

      const creds = await readCreds();
      creds.push({
        id: String(id),
        publicKey: b64url(der.der),
        alg: der.alg,
        label: String(label || 'This device'),
        createdAt: new Date().toISOString(),
      });
      await writeCreds(creds);
      return NextResponse.json({ ok: true, count: creds.length });
    }

    if (action === 'login-options') {
      const creds = await readCreds();
      if (!creds.length) return NextResponse.json({ error: 'No passkey set up yet' }, { status: 404 });
      return NextResponse.json({
        challenge: newChallenge(),
        rpId,
        allowCredentials: creds.map(c => ({ type: 'public-key', id: c.id })),
        userVerification: 'required',
        timeout: 60000,
      });
    }

    if (action === 'login-verify') {
      const PASS = process.env.DASHBOARD_PASS;
      if (!PASS) return NextResponse.json({ error: 'Server has no password configured' }, { status: 503 });

      const { id, authenticatorData, clientDataJSON, signature } = await req.json();
      const client = JSON.parse(fromB64url(clientDataJSON).toString('utf8'));
      if (client.type !== 'webauthn.get') return NextResponse.json({ error: 'Wrong ceremony' }, { status: 400 });
      if (!takeChallenge(client.challenge)) return NextResponse.json({ error: 'Challenge expired — try again' }, { status: 400 });

      // The origin the browser signed must be this host. Without this check a
      // passkey phished on another domain could be replayed here.
      try {
        if (new URL(client.origin).hostname !== rpId) {
          return NextResponse.json({ error: 'Origin mismatch' }, { status: 400 });
        }
      } catch { return NextResponse.json({ error: 'Bad origin' }, { status: 400 }); }

      const cred = (await readCreds()).find(c => c.id === String(id));
      if (!cred) return NextResponse.json({ error: 'Unknown passkey' }, { status: 401 });

      const authData = fromB64url(authenticatorData);
      // Bit 2 of flags is User Verified — the biometric actually happened.
      if (!(authData[32] & 0x04)) {
        return NextResponse.json({ error: 'Biometric check did not pass' }, { status: 401 });
      }
      const ok = verifySignature(
        cred.alg, fromB64url(cred.publicKey), authData,
        fromB64url(clientDataJSON), fromB64url(signature),
      );
      if (!ok) return NextResponse.json({ error: 'Signature did not verify' }, { status: 401 });

      const token = await signSession(process.env.DASHBOARD_USER || 'jarvis', PASS);
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true, sameSite: 'lax',
        secure: req.nextUrl.protocol === 'https:',
        path: '/', maxAge: SESSION_DAYS * 86400,
      });
      return res;
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** GET — how many passkeys exist, so the UI knows whether to offer the button. */
export async function GET() {
  const creds = await readCreds();
  return NextResponse.json({
    count: creds.length,
    devices: creds.map(c => ({ label: c.label, createdAt: c.createdAt })),
  });
}
