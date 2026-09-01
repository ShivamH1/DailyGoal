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

/* config.js is generated from .env and gitignored, so what it holds on any
   machine is unknowable from this repo — a fresh checkout carries only
   config.example.js's placeholders. Every read of the two values in this
   module and in sync.js therefore goes through this one source, whose
   default is exactly the static import above. In the browser it is never
   anything else. The override has a single caller, the test harness: the
   suite must pass on a checkout where nobody has configured anything, so a
   test that needs a configured (or deliberately unconfigured) app states
   that, instead of inheriting whatever this machine's generated file
   happens to hold. The seam lives here rather than in sync.js because
   sync.js already imports this module for accessToken, and the two "is
   this build configured" gates must answer from the same values — a
   sign-in gate that disagrees with the sync tier would let one of them
   act on a configuration the other denies exists. */
let cfg = { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
export const activeConfig = () => cfg;
export function setConfigForTests(next) {
  cfg = next && typeof next === 'object'
    ? { url: String(next.url || ''), key: String(next.key || '') }
    : { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}

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

export function clearVerifier(store) {
  try { (store || defaultStore()).removeItem(VERIFIER_KEY); } catch { /* storage off */ }
}

export function readVerifier(store) {
  try { return (store || defaultStore()).getItem(VERIFIER_KEY); } catch { return null; }
}

/* Same normalisation as sync.js: the dashboard hands out the project URL with
   /rest/v1/ already appended, and these routes append their own path. */
const normalizeBase = (url) =>
  String(url || '').replace(/\/+$/, '').replace(/(\/rest(\/v1)?)+$/, '');

/* Read at call time, through cfg — a module-scope constant here would keep
   answering from whatever config the module loaded with, silently ignoring
   the seam above. Nothing outside this file imports it. */
const authBase = () => normalizeBase(cfg.url);

export const isAuthConfigured = () =>
  Boolean(cfg.url && cfg.key && !cfg.url.includes('<'));

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
  base = authBase(),
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
  base = authBase(),
  apikey = cfg.key,
  fetchImpl = globalThis.fetch,
  store,
  now = Date.now(),
} = {}) {
  const code = new URL(href).searchParams.get('code');
  if (!code) return null;

  const verifier = readVerifier(store);
  if (!verifier) throw new Error('sign-in state missing — start sign-in again');

  /* The verifier is spent the moment its code is presented, however that
     turns out, so every exit drops it rather than only the successful one.
     A refused exchange used to leave it behind: a dead secret in storage
     indefinitely, and the next stray ?code= — a bookmarked redirect being
     reloaded, someone else's pasted link — then looked like a sign-in in
     progress instead of the "start sign-in again" it is. In a finally, so a
     path added later cannot forget. */
  try {
    const res = await fetchImpl(`${base}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { apikey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text?.() ?? ''}`);

    const session = sessionFromTokenResponse(await res.json(), now);
    if (!session) throw new Error('sign-in failed: no token in response');
    clearSession(store);
    saveSession(session, store);
    return session;
  } finally {
    clearVerifier(store);
  }
}

/* ---------- email and password ----------
   The whole of what this app asks of an identity provider: a way to make an
   account and a way to get a session for one. Both hand back the same token
   response the refresh path already understands, so everything downstream —
   storage, expiry, single-flight refresh, authedFetch's bearer — is
   untouched by which of the three routes produced the session.

   A password is an argument here and nothing else. It goes into a request
   body and is dropped: never stored, never logged, never in a URL, and never
   put on the wire at all when it cannot succeed. */

export const MIN_PASSWORD = 8;

/* One message for every way a sign-in can be refused, because the
   alternatives are worse than unhelpful: "no account with that email" turns
   the form into a test for whether an address is registered here, and "email
   not confirmed" answers the same question for a subset. Supabase already
   answers both with an identical 400; this is us not decorating it. */
export const CREDENTIALS_MESSAGE = 'Email or password is incorrect';

/* Same reasoning for registration, where the leak is sharper: with
   auto-confirm on, Supabase says "User already registered" outright. */
export const SIGNUP_REFUSED_MESSAGE =
  "That email can't be registered. If you already have an account, sign in instead.";

/* A 429 is the one refusal that must NOT read as bad credentials: it tells
   someone who typed their password correctly that they did not, and invites
   them to keep trying, which is the only thing that cannot help. */
export const RATE_LIMIT_MESSAGE = 'Too many attempts. Wait a minute and try again.';

export const isCredentialsError = (err) =>
  err instanceof Error && err.message === CREDENTIALS_MESSAGE;

/* Length only. Composition rules ("one capital, one symbol") push people
   towards Password1! and away from the length that actually costs an
   attacker anything; the server holds the same minimum, which is the rule
   that counts — this one saves a round trip and a doomed password's trip
   over the wire. */
export const passwordProblem = (password) =>
  (typeof password === 'string' && password.length >= MIN_PASSWORD)
    ? ''
    : `Use at least ${MIN_PASSWORD} characters`;

/* Trimmed, because a keyboard that pads is not a different account and the
   server would treat " me@test " as one. Not otherwise validated: address
   syntax is the server's business, and a client-side pattern that thinks it
   knows better is how valid addresses get refused. */
const credentials = (email, password) =>
  JSON.stringify({ email: String(email || '').trim(), password: String(password || '') });

const refusal = (status, generic) => {
  if (status === 429) return RATE_LIMIT_MESSAGE;
  return status >= 400 && status < 500 ? generic : `auth request failed: ${status}`;
};

export async function signIn({
  email, password,
  base = authBase(), apikey = cfg.key,
  fetchImpl = globalThis.fetch, store, now = Date.now(),
} = {}) {
  const res = await fetchImpl(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json' },
    body: credentials(email, password),
  });
  if (!res.ok) throw new Error(refusal(res.status, CREDENTIALS_MESSAGE));
  const session = sessionFromTokenResponse(await res.json(), now);
  if (!session) throw new Error('sign-in failed: no token in response');
  saveSession(session, store);
  return session;
}

/* Returns { session, needsConfirmation } rather than a session, because the
   response has two legitimate shapes and they mean opposite things. With
   confirmation off the account is live and a token comes back. With it on
   the body carries a user and NO token — signing that in would put an
   account on screen that cannot read or write a single row, so it is
   reported as pending and the form says to check the inbox instead. */
export async function signUp({
  email, password,
  base = authBase(), apikey = cfg.key,
  fetchImpl = globalThis.fetch, store, now = Date.now(),
} = {}) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const res = await fetchImpl(`${base}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json' },
    body: credentials(email, password),
  });
  if (!res.ok) throw new Error(refusal(res.status, SIGNUP_REFUSED_MESSAGE));
  const session = sessionFromTokenResponse(await res.json(), now);
  if (!session) return { session: null, needsConfirmation: true };
  saveSession(session, store);
  return { session, needsConfirmation: false };
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
  base = authBase(),
  apikey = cfg.key,
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
      /* A rejected fetch resolves to null but — unlike refresh()'s own !ok
         branch — leaves the session in storage. sync.js's authedFetch reads
         that difference: token null with a surviving session is
         "unreachable", token null with none is "signed out". Clearing here
         would erase the only evidence that the server never rejected
         anything. */
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
  base = authBase(), apikey = cfg.key,
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
