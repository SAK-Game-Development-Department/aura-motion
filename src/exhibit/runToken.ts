// Play tokens for the shared ranking: issued when a play starts, signed with a
// server secret (HMAC-SHA256), redeemable once and only after the play could
// have finished. Web Crypto only (runs in Pages Functions and in tests).

export interface RunClaims {
  nonce: string;
  /** Issue time (unix ms). */
  at: number;
  stage: string;
}

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

export function newNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(12)));
}

export async function signRun(secret: string, c: RunClaims): Promise<string> {
  const body = `${c.nonce}.${c.at}.${c.stage}`;
  return `${body}.${await hmac(secret, body)}`;
}

/** The claims if the signature is valid, else null. */
export async function verifyRun(secret: string, token: string): Promise<RunClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [nonce, at, stage, sig] = parts as [string, string, string, string];
  const expect = await hmac(secret, `${nonce}.${at}.${stage}`);
  if (expect.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  const t = Number(at);
  return Number.isFinite(t) ? { nonce, at: t, stage } : null;
}

/** A play lasts 90 s: a token is redeemable from 60 s to 20 min after it was issued. */
export const RUN_MIN_AGE_MS = 60_000;
export const RUN_MAX_AGE_MS = 20 * 60_000;
