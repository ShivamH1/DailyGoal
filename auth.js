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

/* Same normalisation as sync.js: the dashboard hands out the project URL with
   /rest/v1/ already appended, and these routes append their own path. */
const normalizeBase = (url) =>
  String(url || '').replace(/\/+$/, '').replace(/(\/rest(\/v1)?)+$/, '');

export const AUTH_BASE = normalizeBase(SUPABASE_URL);

export const isAuthConfigured = () =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('<'));

export function authorizeUrl(base, { redirectTo, challenge, provider = 'google' }) {
  const q = new URLSearchParams({
    provider,
    redirect_to: redirectTo,
    code_challenge: challenge,
    code_challenge_method: 's256',
  });
  return `${base}/auth/v1/authorize?${q}`;
}

/* A spent authorisation code left in the address bar is replayed on every
   reload and rejected every time. Strip it — and the error fields, which
   would otherwise persist an error state the user has already seen. */
export function stripAuthParams(href) {
  const u = new URL(href);
  for (const k of ['code', 'state', 'error', 'error_code', 'error_description']) {
    u.searchParams.delete(k);
  }
  u.hash = '';
  return u.toString().replace(/\?$/, '');
}

export async function beginSignIn({
  base = AUTH_BASE,
  redirectTo = globalThis.location?.origin + globalThis.location?.pathname,
  store,
  navigate = (u) => { globalThis.location.assign(u); },
} = {}) {
  const verifier = makeVerifier();
  const challenge = await makeChallenge(verifier);
  /* Stored before navigating, never after: the redirect can happen at any
     point once assign() is called. */
  saveVerifier(verifier, store);
  const url = authorizeUrl(base, { redirectTo, challenge });
  navigate(url);
  return url;
}

export async function completeSignIn({
  href = globalThis.location?.href,
  base = AUTH_BASE,
  apikey = SUPABASE_ANON_KEY,
  fetchImpl = globalThis.fetch,
  store,
  now = Date.now(),
} = {}) {
  const code = new URL(href).searchParams.get('code');
  if (!code) return null;

  const verifier = readVerifier(store);
  if (!verifier) throw new Error('sign-in state missing — start sign-in again');

  const res = await fetchImpl(`${base}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text?.() ?? ''}`);

  const session = sessionFromTokenResponse(await res.json(), now);
  if (!session) throw new Error('sign-in failed: no token in response');
  clearSession(store);          /* drops the spent verifier */
  saveSession(session, store);
  return session;
}

/* Single-flight guard. The minute timer, a visibilitychange and a queued
   flush can all want a token in the same instant; two refreshes would race,
   and Supabase rotates the refresh token, so the loser's is already dead. */
let refreshing = null;

export function resetRefreshState() { refreshing = null; }

async function refresh({ session, base, apikey, fetchImpl, store, now }) {
  const res = await fetchImpl(`${base}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) {
    /* A refresh token the server rejects will be rejected again next minute.
       Signing out is the only exit that does not loop. */
    clearSession(store);
    return null;
  }
  const next = sessionFromTokenResponse(await res.json(), now);
  if (!next) { clearSession(store); return null; }
  /* Supabase omits `user` on a refresh response — carry the identity we
     already hold rather than losing the uid every hour. */
  if (!next.user_id) { next.user_id = session.user_id; next.email = session.email; }
  if (!next.refresh_token) next.refresh_token = session.refresh_token;
  saveSession(next, store);
  return next.access_token;
}

export function accessToken({
  force = false,
  base = AUTH_BASE,
  apikey = SUPABASE_ANON_KEY,
  fetchImpl = globalThis.fetch,
  store,
  now = Date.now(),
} = {}) {
  const session = loadSession(store);
  if (!session) return Promise.resolve(null);
  if (!force && !expiresSoon(session, now)) return Promise.resolve(session.access_token);
  if (!session.refresh_token) { clearSession(store); return Promise.resolve(null); }
  if (!refreshing) {
    refreshing = refresh({ session, base, apikey, fetchImpl, store, now })
      .catch(() => null)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/* Three states, not two. An unconfigured build must not render a sign-in
   button, because pressing it can only fail. */
export function authView(configured, session) {
  if (!configured) return 'unconfigured';
  return session ? 'app' : 'signed-out';
}

export async function signOut({
  base = AUTH_BASE, apikey = SUPABASE_ANON_KEY,
  fetchImpl = globalThis.fetch, store,
} = {}) {
  const session = loadSession(store);
  if (session?.access_token) {
    try {
      await fetchImpl(`${base}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey, Authorization: `Bearer ${session.access_token}` },
      });
    } catch {
      /* Offline. Signing out on this device must still work. */
    }
  }
  resetRefreshState();
  clearSession(store);
}
