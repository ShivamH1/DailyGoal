/* Supabase Auth over plain fetch. No SDK, for the same reason sync.js has
   none: one flow, three endpoints, and a bundle we would otherwise have to
   cache offline.

   The endpoints here were verified against the live project rather than read
   from the docs. Supabase's published REST auth documentation describes the
   OAuth *server* flow — Supabase acting as a provider for third-party apps —
   which is a different feature with different routes. Social login lives at
   /auth/v1/authorize?provider=…, and the PKCE exchange is grant_type=pkce
   (grant_type=authorization_code is rejected as unsupported). */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const randomSource = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/* 32 bytes → 43 base64url characters, the low end of RFC 7636's 43-128. */
export function makeVerifier(randomBytes = randomSource) {
  return base64url(randomBytes(32));
}

export async function makeChallenge(verifier, subtle = globalThis.crypto.subtle) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

const SESSION_KEY = 'wi:session';
const VERIFIER_KEY = 'wi:pkce-verifier';

/* The session is NOT namespaced by user: it is the thing that decides which
   user we are. Everything else keys off it. */
const defaultStore = () => globalThis.localStorage;

function readJSON(key, store) {
  try {
    const raw = (store || defaultStore()).getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value, store) {
  try {
    (store || defaultStore()).setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const HOUR_MS = 3_600_000;

export function sessionFromTokenResponse(json, now = Date.now()) {
  if (!json || !json.access_token) return null;
  /* expires_in is a duration, so it survives a skewed device clock; the
     server's own expires_at does not, and this app runs on phones. */
  const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : HOUR_MS;
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token || '',
    expires_at: now + ttl,
    user_id: json.user?.id || '',
    email: json.user?.email || '',
  };
}

export const saveSession = (session, store) => writeJSON(SESSION_KEY, session, store);

export function loadSession(store) {
  const s = readJSON(SESSION_KEY, store);
  /* A stored object that is not a session is corruption, not a session with
     missing fields — treat it as signed out rather than half-authenticating. */
  return s && typeof s.access_token === 'string' && s.access_token ? s : null;
}

export function clearSession(store) {
  try {
    const s = store || defaultStore();
    s.removeItem(SESSION_KEY);
    s.removeItem(VERIFIER_KEY);
  } catch { /* storage off */ }
}

export function expiresSoon(session, now = Date.now(), skewMs = 60_000) {
  if (!session || typeof session.expires_at !== 'number') return true;
  return session.expires_at - now <= skewMs;
}

export const currentUserId = (store) => loadSession(store)?.user_id || null;

export function saveVerifier(verifier, store) {
  try { (store || defaultStore()).setItem(VERIFIER_KEY, verifier); return true; } catch { return false; }
}

export function readVerifier(store) {
  try { return (store || defaultStore()).getItem(VERIFIER_KEY); } catch { return null; }
}
