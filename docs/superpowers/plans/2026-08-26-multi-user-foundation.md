# Multi-user Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a single-person habit tracker into an app any Google account can sign into, with its own data, its own settings and its own week.

**Architecture:** Google sign-in over Supabase Auth, spoken to directly with `fetch` and PKCE — no `supabase-js`, matching how `sync.js` already talks to PostgREST. `daily_progress` keeps its rows, its history and its per-date merge, and gains an `extras` column; two document tables (`user_profile`, `user_schedule`) sit beside it. Content that is currently hardcoded HTML and a hardcoded `WEEK` constant becomes per-user data, and `schedule.js` stops containing a week and becomes pure functions over one.

**Tech Stack:** Vanilla ES modules, no bundler, no runtime dependencies. `node --test` for tests. Supabase (Auth + PostgREST). Vercel static hosting.

**Spec:** `docs/superpowers/specs/2026-08-26-multi-user-foundation-design.md`

## Global Constraints

- **Zero runtime dependencies.** No npm package may be added to `package.json`. If a task seems to need one, stop and escalate.
- **No `supabase-js`.** All Supabase traffic is `fetch` against documented REST endpoints.
- **Tests are `node --test` only**, run with `npm test`. Baseline before this plan: **87 passing, 0 failing.**
  Each task states an expected running total. Treat the **delta** as the check and the total as a guide —
  add a case the plan did not anticipate and the totals downstream shift, which is fine. No task may reduce the passing count except by deliberately replacing a test whose subject it deleted, and such a replacement must be called out in the commit message.
- **Dependency injection is the testability seam.** Every network- or storage-touching function takes `{ fetchImpl = globalThis.fetch }` and/or an optional `store` argument, exactly as `sync.js` and `storage.js` already do.
- **Every user-authored string is rendered with `textContent`, never `innerHTML`.** With a session token in `localStorage` this is the control protecting the session, not a style preference. Schedule/profile text the user typed is user-authored.
- **`updated_at` is always sent explicitly by the client.** Never rely on a column default.
- **Never read, print, echo or commit `SECRET_KEY` or `DATABASE_URL` from `.env`.** Never `git add .env` or `config.js`.
- **Never run `git add -A`.** Stage named paths only. (A previous session swept an unrelated in-flight edit into a commit this way.)
- **IST correctness:** all "what day is it" and "what time is it" decisions go through `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'` and `hourCycle: 'h23'`. Never `getHours()` or local date parts.
- **Commits:** author `ShivamH1 <shivamhonra@gmail.com>` (the global git config — do not override with `-c`). Real dates. One commit per task minimum. Message style matches existing history: a short imperative subject, then prose explaining *why*, ending with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Branch:** `multi-user`.

## Blocking manual prerequisite

Tasks 1–4 are unit-testable without it, but **Task 5 cannot be verified end to end** until the project owner has:

1. Created a Google Cloud project, configured the OAuth consent screen, created an **OAuth 2.0 Web Application** client, and registered `https://<project-ref>.supabase.co/auth/v1/callback` as an authorised redirect URI.
2. In Supabase: Authentication → Providers → Google → enabled, with that client ID and secret. Authentication → URL Configuration → added `http://localhost:8080` and the production Vercel URL to the redirect allow list.

Verify with `GET {SUPABASE_URL}/auth/v1/settings` — `external.google` must be `true`. It is `false` as of 2026-08-26. **A URL absent from the allow list is silently rejected; that is the most common failure of this flow.**

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `auth.js` | create | PKCE, session persistence, token refresh, sign-in/out. No DOM. |
| `profile.js` | create | Profile + schedule documents: defaults, normalisation, merge. Pure. |
| `profileEditor.js` | create | DOM for editing season, rules, deadlines, lanes, ticks. |
| `weekEditor.js` | create | DOM for editing schedule blocks. |
| `onboarding.js` | create | The post-sign-in multi-step wizard. |
| `deadlines.js` | create | Replaces `exams.js`; pure functions over a user's deadline list. |
| `exams.js` | delete | Its content is one user's data. |
| `schedule.js` | modify | `WEEK` removed. Pure functions over an injected week + a validator. |
| `storage.js` | modify | Keys namespaced per account; one-time legacy migration. |
| `sync.js` | modify | Bearer token, 401→refresh→retry, `extras`, document push/pull, no `user_id`. |
| `app.js` | modify | Signed-out gate; renders from documents; orchestration only. |
| `index.html` | modify | Personal content removed; sections render from the profile. |
| `supabase/schema.sql` | modify | v2 schema, additive then cutover. |
| `tools/make-config.mjs` | modify | `USER_ID` dropped. |
| `sw.js` | modify | New modules in `SHELL`; cache `v6`. |

`app.js` is 531 lines and this plan adds substantially to the app. The wizard and both editors are separate modules precisely so it does not absorb them.

---

# Phase 1 — Auth

## Task 1: PKCE primitives

**Files:**
- Create: `auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `base64url(bytes: Uint8Array) → string`, `makeVerifier(randomBytes?) → string`, `makeChallenge(verifier: string, subtle?) → Promise<string>`.

- [ ] **Step 1: Write the failing test**

`test/auth.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64url, makeVerifier, makeChallenge } from '../auth.js';

test('base64url uses the URL alphabet and drops padding', () => {
  /* 0xFB 0xFF encodes to "+/8=" in standard base64; none of those three
     characters may survive, because the value goes in a query string. */
  assert.equal(base64url(new Uint8Array([0xfb, 0xff])), '-_8');
  assert.doesNotMatch(base64url(new Uint8Array([0xfb, 0xff, 0x00])), /[+/=]/);
});

test('makeVerifier returns 43 unreserved characters', () => {
  /* RFC 7636 requires 43-128 characters from [A-Za-z0-9-._~]. 32 random
     bytes base64url-encoded is exactly 43. */
  const v = makeVerifier(() => new Uint8Array(32).fill(0xff));
  assert.equal(v.length, 43);
  assert.match(v, /^[A-Za-z0-9\-._~]+$/);
});

test('makeVerifier draws exactly 32 bytes from the source it is given', () => {
  let asked = 0;
  makeVerifier((n) => { asked = n; return new Uint8Array(n); });
  assert.equal(asked, 32);
});

test('makeVerifier is different every call with real randomness', () => {
  assert.notEqual(makeVerifier(), makeVerifier());
});

test('makeChallenge matches the RFC 7636 appendix B vector', async () => {
  /* The published test vector. If this passes, our S256 derivation is the
     one Supabase will verify against — this is the single point where a
     silent mistake would surface only as a failed login in a browser. */
  const challenge = await makeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../auth.js'`.

- [ ] **Step 3: Write the implementation**

`auth.js`:

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 92 tests (87 baseline + 5).

- [ ] **Step 5: Commit**

```bash
git add auth.js test/auth.test.js
git commit -F - <<'MSG'
Derive PKCE verifiers and challenges

The S256 derivation is the one place in the sign-in flow where a mistake
would not surface until a real browser bounced off Google, so it is pinned
to RFC 7636's published appendix B vector rather than to our own output.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 2: Session persistence and expiry

**Files:**
- Modify: `auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: `base64url` (Task 1).
- Produces: `sessionFromTokenResponse(json, now?) → Session|null`, `saveSession(session, store?) → boolean`, `loadSession(store?) → Session|null`, `clearSession(store?) → void`, `expiresSoon(session, now?, skewMs?) → boolean`, `currentUserId(store?) → string|null`, `saveVerifier(v, store?)`, `readVerifier(store?)`.
  `Session = { access_token, refresh_token, expires_at /* ms epoch, local clock */, user_id, email }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/auth.test.js`:

```js
import {
  sessionFromTokenResponse, saveSession, loadSession, clearSession,
  expiresSoon, currentUserId, saveVerifier, readVerifier,
} from '../auth.js';

const fakeStore = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
};

test('sessionFromTokenResponse dates expiry from our clock, not the server field', () => {
  /* A device with a skewed clock would compute an expires_at it then
     disagrees with. expires_in is a duration and survives skew; the
     server's own expires_at does not. */
  const s = sessionFromTokenResponse(
    { access_token: 'a', refresh_token: 'r', expires_in: 3600,
      expires_at: 9999999999, user: { id: 'u1', email: 'x@y.z' } },
    1_000_000
  );
  assert.equal(s.expires_at, 1_000_000 + 3_600_000);
  assert.equal(s.user_id, 'u1');
  assert.equal(s.email, 'x@y.z');
});

test('sessionFromTokenResponse falls back to an hour when expires_in is absent', () => {
  const s = sessionFromTokenResponse({ access_token: 'a' }, 0);
  assert.equal(s.expires_at, 3_600_000);
});

test('sessionFromTokenResponse returns null for a response with no token', () => {
  assert.equal(sessionFromTokenResponse({ error: 'nope' }, 0), null);
  assert.equal(sessionFromTokenResponse(null, 0), null);
});

test('a session round-trips through the store', () => {
  const store = fakeStore();
  const s = sessionFromTokenResponse({ access_token: 'a', expires_in: 60, user: { id: 'u1' } }, 0);
  assert.equal(saveSession(s, store), true);
  assert.deepEqual(loadSession(store), s);
});

test('loadSession returns null rather than throwing on a corrupt payload', () => {
  assert.equal(loadSession(fakeStore({ 'wi:session': '{not json' })), null);
});

test('loadSession rejects a stored value that is not a session', () => {
  assert.equal(loadSession(fakeStore({ 'wi:session': '{"nope":1}' })), null);
});

test('clearSession removes the session and any half-finished sign-in', () => {
  const store = fakeStore();
  saveSession({ access_token: 'a', expires_at: 1, user_id: 'u' }, store);
  saveVerifier('v', store);
  clearSession(store);
  assert.equal(loadSession(store), null);
  assert.equal(readVerifier(store), null);
});

test('expiresSoon is true inside the skew window and false outside it', () => {
  const s = { access_token: 'a', expires_at: 100_000, user_id: 'u' };
  assert.equal(expiresSoon(s, 30_000), false);        // 70s left
  assert.equal(expiresSoon(s, 50_000), true);         // 50s left, inside 60s skew
  assert.equal(expiresSoon(s, 200_000), true);        // already expired
});

test('expiresSoon treats a missing session as needing a token', () => {
  assert.equal(expiresSoon(null, 0), true);
});

test('currentUserId reads through to the stored session', () => {
  const store = fakeStore();
  saveSession({ access_token: 'a', expires_at: 1, user_id: 'u9' }, store);
  assert.equal(currentUserId(store), 'u9');
  assert.equal(currentUserId(fakeStore()), null);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `sessionFromTokenResponse is not a function` (or the equivalent import error).

- [ ] **Step 3: Implement**

Append to `auth.js`:

```js
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
  const s = store || defaultStore();
  try { s.removeItem(SESSION_KEY); s.removeItem(VERIFIER_KEY); } catch { /* storage off */ }
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 102 tests.

- [ ] **Step 5: Commit**

```bash
git add auth.js test/auth.test.js
git commit -F - <<'MSG'
Persist a session and know when it is about to expire

Expiry is computed from expires_in against our own clock rather than from
the server's expires_at field. The duration survives a skewed device clock;
an absolute server timestamp does not, and this app's primary device is a
phone that can be hours out.

A stored object missing an access_token is treated as signed out rather than
as a session with holes in it. Half-authenticated is not a state worth
having.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 3: The sign-in round trip

**Files:**
- Modify: `auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: `makeVerifier`, `makeChallenge`, `saveVerifier`, `readVerifier`, `saveSession`, `sessionFromTokenResponse`.
- Produces: `authorizeUrl(base, { redirectTo, challenge, provider? }) → string`, `stripAuthParams(href) → string`, `beginSignIn(opts?) → Promise<string>` (returns the URL it navigates to), `completeSignIn(opts?) → Promise<Session|null>`, `isAuthConfigured() → boolean`, `AUTH_BASE` (normalised project URL).

- [ ] **Step 1: Write the failing tests**

Append to `test/auth.test.js`:

```js
import { authorizeUrl, stripAuthParams, beginSignIn, completeSignIn } from '../auth.js';

test('authorizeUrl targets the social-login route with an s256 challenge', () => {
  const u = new URL(authorizeUrl('https://p.supabase.co', {
    redirectTo: 'http://localhost:8080/', challenge: 'CHAL',
  }));
  assert.equal(u.pathname, '/auth/v1/authorize');
  assert.equal(u.searchParams.get('provider'), 'google');
  assert.equal(u.searchParams.get('redirect_to'), 'http://localhost:8080/');
  assert.equal(u.searchParams.get('code_challenge'), 'CHAL');
  assert.equal(u.searchParams.get('code_challenge_method'), 's256');
});

test('stripAuthParams removes the spent code and the error fields', () => {
  const clean = stripAuthParams('http://localhost:8080/?code=abc&error=x&error_description=y&keep=1#frag');
  assert.equal(clean, 'http://localhost:8080/?keep=1');
});

test('stripAuthParams leaves no dangling question mark', () => {
  assert.equal(stripAuthParams('http://localhost:8080/?code=abc'), 'http://localhost:8080/');
});

test('beginSignIn stores the verifier before navigating', async () => {
  const store = fakeStore();
  let went = '';
  const url = await beginSignIn({
    base: 'https://p.supabase.co', redirectTo: 'http://localhost:8080/',
    store, navigate: (u) => { went = u; },
  });
  const verifier = readVerifier(store);
  assert.ok(verifier && verifier.length >= 43, 'verifier was not stored');
  assert.equal(went, url);
  /* The challenge on the wire must be the S256 of the verifier we kept, or
     the exchange in completeSignIn fails with no useful message. */
  assert.equal(
    new URL(url).searchParams.get('code_challenge'),
    await makeChallenge(verifier)
  );
});

test('completeSignIn does nothing when there is no code in the URL', async () => {
  const s = await completeSignIn({ href: 'http://localhost:8080/', store: fakeStore() });
  assert.equal(s, null);
});

test('completeSignIn exchanges the code with grant_type=pkce', async () => {
  const store = fakeStore();
  saveVerifier('VERIFIER', store);
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u1' } }) };
  };
  const s = await completeSignIn({
    href: 'http://localhost:8080/?code=CODE', base: 'https://p.supabase.co',
    apikey: 'ANON', fetchImpl, store, now: 0,
  });
  assert.match(seen.url, /\/auth\/v1\/token\?grant_type=pkce$/);
  assert.deepEqual(JSON.parse(seen.opts.body), { auth_code: 'CODE', code_verifier: 'VERIFIER' });
  assert.equal(seen.opts.headers.apikey, 'ANON');
  assert.equal(s.access_token, 'AT');
  assert.deepEqual(loadSession(store), s);
});

test('completeSignIn discards the verifier once it has been spent', async () => {
  const store = fakeStore();
  saveVerifier('VERIFIER', store);
  const fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: 'AT', expires_in: 60, user: { id: 'u' } }) });
  await completeSignIn({ href: 'http://x/?code=C', base: 'https://p', apikey: 'A', fetchImpl, store, now: 0 });
  assert.equal(readVerifier(store), null);
});

test('completeSignIn throws when the verifier is missing', async () => {
  /* Landing on ?code= with no stored verifier means the sign-in began in a
     different browser or storage was cleared mid-flow. Silently returning
     null would leave the user staring at a sign-in button that just failed. */
  await assert.rejects(
    () => completeSignIn({ href: 'http://x/?code=C', store: fakeStore(), fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    /sign-in state/
  );
});

test('completeSignIn surfaces a rejected exchange instead of storing nothing quietly', async () => {
  const store = fakeStore();
  saveVerifier('V', store);
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => 'flow_state_not_found' });
  await assert.rejects(
    () => completeSignIn({ href: 'http://x/?code=C', base: 'https://p', apikey: 'A', fetchImpl, store }),
    /404/
  );
  assert.equal(loadSession(store), null);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `authorizeUrl is not a function`.

- [ ] **Step 3: Implement**

Append to `auth.js`:

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 111 tests.

- [ ] **Step 5: Commit**

```bash
git add auth.js test/auth.test.js
git commit -F - <<'MSG'
Complete the Google sign-in round trip

The verifier is written before navigation rather than after, because once
location.assign is called the page can be gone at any point.

A spent authorisation code is stripped from the address bar on return. Left
there it is replayed on every reload and rejected every time, which reads to
the user as an app that randomly signs them out.

Landing on ?code= with no stored verifier throws rather than returning null.
It means the flow started in another browser or storage was cleared mid-way,
and the honest response is an error the UI can show, not a sign-in button
that silently did nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 4: Token refresh and sign-out

**Files:**
- Modify: `auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: `loadSession`, `saveSession`, `clearSession`, `expiresSoon`, `sessionFromTokenResponse`.
- Produces: `accessToken(opts?) → Promise<string|null>`, `signOut(opts?) → Promise<void>`, `resetRefreshState()` (test seam — the single-flight guard is module state).

- [ ] **Step 1: Write the failing tests**

Append to `test/auth.test.js`:

```js
import { accessToken, signOut, resetRefreshState } from '../auth.js';

const okToken = (body) => async () => ({ ok: true, json: async () => body });

test('accessToken returns null when nobody is signed in', async () => {
  resetRefreshState();
  assert.equal(await accessToken({ store: fakeStore() }), null);
});

test('accessToken returns the stored token untouched when it is fresh', async () => {
  resetRefreshState();
  const store = fakeStore();
  saveSession({ access_token: 'FRESH', refresh_token: 'R', expires_at: 500_000, user_id: 'u' }, store);
  let called = false;
  const t = await accessToken({ store, now: 0, fetchImpl: async () => { called = true; } });
  assert.equal(t, 'FRESH');
  assert.equal(called, false, 'refreshed a token that had not expired');
});

test('accessToken refreshes inside the skew window and stores the new session', async () => {
  resetRefreshState();
  const store = fakeStore();
  saveSession({ access_token: 'OLD', refresh_token: 'RT', expires_at: 50_000, user_id: 'u' }, store);
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, json: async () => ({ access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600, user: { id: 'u' } }) };
  };
  const t = await accessToken({ store, now: 0, base: 'https://p', apikey: 'A', fetchImpl });
  assert.equal(t, 'NEW');
  assert.match(seen.url, /grant_type=refresh_token$/);
  assert.deepEqual(JSON.parse(seen.opts.body), { refresh_token: 'RT' });
  assert.equal(loadSession(store).access_token, 'NEW');
});

test('force refreshes even a token that looks fresh', async () => {
  /* This is the path a 401 from PostgREST takes: the token looks valid to us
     and the server disagrees, so our opinion has to be overridable. */
  resetRefreshState();
  const store = fakeStore();
  saveSession({ access_token: 'OLD', refresh_token: 'RT', expires_at: 999_999_999, user_id: 'u' }, store);
  const t = await accessToken({
    store, now: 0, base: 'https://p', apikey: 'A', force: true,
    fetchImpl: okToken({ access_token: 'NEW', expires_in: 60, user: { id: 'u' } }),
  });
  assert.equal(t, 'NEW');
});

test('two concurrent refreshes make one network call', async () => {
  /* A tick, a visibilitychange and the minute timer can all want a token in
     the same instant. Two refreshes would race, and the loser's refresh
     token is already rotated and therefore dead. */
  resetRefreshState();
  const store = fakeStore();
  saveSession({ access_token: 'OLD', refresh_token: 'RT', expires_at: 0, user_id: 'u' }, store);
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return { ok: true, json: async () => ({ access_token: 'NEW', expires_in: 3600, user: { id: 'u' } }) };
  };
  const [a, b] = await Promise.all([
    accessToken({ store, now: 1000, base: 'https://p', apikey: 'A', fetchImpl }),
    accessToken({ store, now: 1000, base: 'https://p', apikey: 'A', fetchImpl }),
  ]);
  assert.equal(calls, 1);
  assert.equal(a, 'NEW');
  assert.equal(b, 'NEW');
});

test('a rejected refresh signs the user out rather than looping', async () => {
  resetRefreshState();
  const store = fakeStore();
  saveSession({ access_token: 'OLD', refresh_token: 'RT', expires_at: 0, user_id: 'u' }, store);
  const t = await accessToken({
    store, now: 1000, base: 'https://p', apikey: 'A',
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'invalid' }),
  });
  assert.equal(t, null);
  assert.equal(loadSession(store), null);
});

test('a session with no refresh token signs out instead of calling the endpoint', async () => {
  resetRefreshState();
  const store = fakeStore();
  saveSession({ access_token: 'OLD', refresh_token: '', expires_at: 0, user_id: 'u' }, store);
  let called = false;
  assert.equal(await accessToken({ store, now: 1000, fetchImpl: async () => { called = true; } }), null);
  assert.equal(called, false);
  assert.equal(loadSession(store), null);
});

test('signOut clears locally even when the server call fails', async () => {
  /* Offline sign-out must still sign you out on this device. */
  const store = fakeStore();
  saveSession({ access_token: 'AT', expires_at: 1, user_id: 'u' }, store);
  await signOut({ store, base: 'https://p', apikey: 'A', fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(loadSession(store), null);
});

test('signOut revokes server-side when it can', async () => {
  const store = fakeStore();
  saveSession({ access_token: 'AT', expires_at: 1, user_id: 'u' }, store);
  let seen;
  await signOut({ store, base: 'https://p', apikey: 'A', fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true }; } });
  assert.match(seen.url, /\/auth\/v1\/logout$/);
  assert.equal(seen.opts.headers.Authorization, 'Bearer AT');
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `accessToken is not a function`.

- [ ] **Step 3: Implement**

Append to `auth.js`:

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 120 tests.

- [ ] **Step 5: Commit**

```bash
git add auth.js test/auth.test.js
git commit -F - <<'MSG'
Refresh the access token on demand, once at a time

Callers ask for a token and get a valid one; nothing else in the app has to
know that tokens expire. The refresh is single-flight because the minute
timer, a visibilitychange and a queued flush can all want one in the same
instant, and Supabase rotates refresh tokens — two concurrent refreshes mean
the loser is holding a token that is already dead.

force:true exists for the 401 path: PostgREST can reject a token we still
believe in, and our opinion has to be overridable by the server's.

A rejected refresh signs out rather than retrying. The same token will be
rejected again next minute, so a retry is a loop, not a recovery.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 5: The signed-out gate

**Files:**
- Modify: `auth.js` (add `authView`), `index.html`, `app.js`, `styles.css`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: `isAuthConfigured`, `loadSession`, `completeSignIn`, `beginSignIn`, `signOut`, `stripAuthParams`.
- Produces: `authView(configured: boolean, session: Session|null) → 'unconfigured'|'signed-out'|'app'`, and in `app.js` a `startApp()` that performs every render and timer the module currently performs at import time.

**Note on verification.** This project has no DOM test harness and this plan does not add one — that would mean a dependency, which the global constraints forbid. The decision logic is extracted into `authView` and unit-tested; the wiring is verified with `node --check` and by hand in a browser. Do not claim this task passes on unit tests alone.

- [ ] **Step 1: Write the failing test**

Append to `test/auth.test.js`:

```js
import { authView } from '../auth.js';

test('an unconfigured build says so rather than showing a dead button', () => {
  /* config.js is generated at build time. If it is missing or still holds
     placeholders, "Continue with Google" cannot work, and rendering it
     anyway produces a button that fails with a network error. */
  assert.equal(authView(false, null), 'unconfigured');
  assert.equal(authView(false, { access_token: 'a' }), 'unconfigured');
});

test('no session shows the sign-in gate', () => {
  assert.equal(authView(true, null), 'signed-out');
});

test('a session shows the app', () => {
  assert.equal(authView(true, { access_token: 'a', user_id: 'u' }), 'app');
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `authView is not a function`.

- [ ] **Step 3: Add `authView` to `auth.js`**

```js
/* Three states, not two. An unconfigured build must not render a sign-in
   button, because pressing it can only fail. */
export function authView(configured, session) {
  if (!configured) return 'unconfigured';
  return session ? 'app' : 'signed-out';
}
```

- [ ] **Step 4: Add the gate markup to `index.html`**

Insert immediately after `<div class="wrap">`'s `<header>` block, before `<main>`:

```html
      <!-- Shown when signed out. The app itself is hidden rather than
           unrendered: rendering is gated in app.js, so nothing below this
           point runs until there is a session. -->
      <section class="gate" id="authGate" hidden>
        <h2>Sign in to keep your streak</h2>
        <p>Your days, your schedule and your notes sync across every device you sign in on.</p>
        <button class="gate-btn" id="signInBtn" type="button">Continue with Google</button>
        <p class="gate-error" id="authError" role="alert"></p>
      </section>
```

Give `<main>` an id so it can be hidden: `<main id="appMain" hidden>`.

Add a sign-out control to the footer, before the export buttons:

```html
        <button id="signOutBtn" type="button" hidden>Sign out</button>
```

- [ ] **Step 5: Gate the app in `app.js`**

Add at the top of the imports:

```js
import {
  isAuthConfigured, loadSession, completeSignIn, beginSignIn, signOut,
  stripAuthParams, authView, currentUserId,
} from './auth.js';
```

Every statement `app.js` currently executes at module scope — `DAY_KEYS.forEach(renderDay)`, `renderNow()`, `showDay(...)`, `renderScorecard()`, `renderCalendar()`, `renderWeek()`, `renderExam()`, the async init IIFE, `setInterval(tick, 60000)`, the `online` and `visibilitychange` listeners — moves into a single function:

```js
function startApp() {
  DAY_KEYS.forEach(renderDay);
  renderNow();
  showDay(istNow().dayKey);
  progress = loadProgress();
  renderScorecard();
  renderCalendar();
  renderWeek();
  renderExam();
  initSync();                       /* the existing async IIFE, named */
  setInterval(tick, 60000);
  window.addEventListener('online', flushSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
    else if (loadPending().length) flushSync();
  });
}
```

`let progress = loadProgress();` becomes `let progress = {};` at module scope — reading storage before we know which account we are is exactly the bug namespacing exists to prevent (Task 8).

Service worker registration stays at module scope: caching the shell is useful signed out too.

Then the new entry point, replacing the old module-scope run:

```js
const gate = document.getElementById('authGate');
const appMain = document.getElementById('appMain');
const signOutBtn = document.getElementById('signOutBtn');
const authError = document.getElementById('authError');

function showView(view) {
  gate.hidden = view === 'app';
  appMain.hidden = view !== 'app';
  signOutBtn.hidden = view !== 'app';
  if (view === 'unconfigured') {
    /* textContent, not innerHTML — the rule holds for our own strings too,
       so there is never a second way of writing text on this page. */
    authError.textContent =
      'This build has no Supabase configuration. Run `npm run config` and reload.';
    document.getElementById('signInBtn').hidden = true;
  }
}

document.getElementById('signInBtn').addEventListener('click', async () => {
  authError.textContent = '';
  try {
    await beginSignIn({});
  } catch (e) {
    authError.textContent = 'Could not start sign-in. Check your connection and try again.';
  }
});

signOutBtn.addEventListener('click', async () => {
  await signOut({});
  location.reload();
});

(async () => {
  let session = null;
  try {
    session = await completeSignIn({});
    if (session) history.replaceState(null, '', stripAuthParams(location.href));
  } catch (e) {
    authError.textContent = 'Sign-in did not complete. Please try again.';
    history.replaceState(null, '', stripAuthParams(location.href));
  }
  session = session || loadSession();
  const view = authView(isAuthConfigured(), session);
  showView(view);
  if (view === 'app') startApp();
})();
```

- [ ] **Step 6: Style the gate in `styles.css`**

Add, using existing tokens only — no new colours:

```css
.gate { text-align: center; padding: 3rem 1rem; }
.gate h2 { font-family: var(--font-display); margin-bottom: .5rem; }
.gate p { color: var(--text-muted); max-width: 34ch; margin: 0 auto 1.5rem; }
.gate-btn {
  font: inherit; font-weight: 600; cursor: pointer;
  padding: .75rem 1.5rem; border-radius: 999px;
  background: var(--fill-strong); color: var(--color-bg); border: 0;
}
.gate-btn:focus-visible { outline: 2px solid var(--color-text); outline-offset: 2px; }
.gate-error { color: var(--warn); min-height: 1.2em; }
```

Confirm each token exists in `styles.css` before using it; if `--warn` or `--fill-strong` is named differently, use the actual name rather than inventing one.

- [ ] **Step 7: Verify**

```bash
npm test                 # expect 123 passing
node --check app.js
node --check auth.js
```

Then by hand — **this step is the deliverable, not the unit tests**:

```bash
npm run dev              # http://localhost:8080
```

- Signed out: the gate is visible, `<main>` is not, no console errors.
- Press **Continue with Google**. If Google is not yet enabled on the project, Supabase answers `provider is not enabled` — that is the expected result until the manual prerequisite is done, and it confirms the URL was built correctly.
- Once Google *is* enabled: sign in, land back on `/` with no `?code=` in the address bar, and see the app.
- Reload: still signed in.
- **Sign out, then reload: the gate is shown, not the app.**

- [ ] **Step 8: Commit**

```bash
git add auth.js app.js index.html styles.css test/auth.test.js
git commit -F - <<'MSG'
Gate the app behind a session

Everything app.js used to do at import time now runs from startApp(), called
only once there is a session. The important consequence is that progress is
no longer read from storage at module scope: reading before we know which
account we are is precisely the bug that namespacing exists to prevent, and
leaving it would have meant one user's data flashing up in another's window.

Three view states rather than two. A build with no config.js cannot sign
anyone in, and rendering the button anyway produces a control whose only
possible outcome is a network error, so that case says so instead.

The gate's decision logic is unit-tested; the wiring is not. This project has
no DOM harness and adding one would mean a dependency, so the browser check
in the plan is the verification, not a formality.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

# Phase 2 — Schema

## Task 6: Additive schema v2

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `user_profile(user_id uuid pk, data jsonb, updated_at timestamptz)` and `user_schedule(user_id uuid pk, week jsonb, updated_at timestamptz)`; column `daily_progress.extras jsonb`; policy `own_rows` on all three.

**This task is additive on purpose.** The existing `single_user` policy and the `anon` grants stay in place. The client cannot present a token until Task 10, and dropping anon here would leave the app broken for four tasks.

- [ ] **Step 1: Write the migration into `supabase/schema.sql`**

Replace the file's contents with the v2 schema, keeping the existing v1 statements at the top under a `-- v1` heading for the record, then:

```sql
-- ============================================================
-- v2 — multi-user. Additive; the v1 anon path is dropped in the
-- phase 3 section at the bottom, not here.
-- ============================================================

alter table daily_progress add column if not exists extras jsonb;
alter table daily_progress alter column user_id set default auth.uid();

create policy own_rows on daily_progress
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on daily_progress to authenticated;

create table if not exists user_profile (
  user_id    uuid primary key references auth.users on delete cascade default auth.uid(),
  data       jsonb       not null default '{}'::jsonb,
  -- No default. The client always sends this explicitly: now() would stamp
  -- server receipt time, so an edit made offline on Monday and flushed on
  -- Wednesday would outrank a genuinely newer Tuesday edit from another
  -- device. Same rule daily_progress already follows.
  updated_at timestamptz not null
);

create table if not exists user_schedule (
  user_id    uuid primary key references auth.users on delete cascade default auth.uid(),
  week       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null
);

alter table user_profile  enable row level security;
alter table user_schedule enable row level security;

create policy own_profile on user_profile
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_schedule on user_schedule
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- RLS decides which rows; the grant decides whether the table is reachable
-- at all. Without this PostgREST rejects before RLS is ever consulted —
-- the mistake this project already made once with anon.
grant select, insert, update, delete on user_profile  to authenticated;
grant select, insert, update, delete on user_schedule to authenticated;
```

- [ ] **Step 2: Apply it to the live project**

Preferred, if `psql` is installed — reads `DATABASE_URL` from `.env` **without printing it**:

```bash
DB=$(node --input-type=module -e '
import { readFileSync } from "node:fs";
const { parseEnv } = await import("./tools/make-config.mjs");
process.stdout.write(parseEnv(readFileSync(".env","utf8")).DATABASE_URL || "");
')
[ -n "$DB" ] || { echo "no DATABASE_URL in .env — use the Supabase SQL editor"; exit 1; }
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/schema.sql
```

If `psql` is unavailable, paste the v2 section into the Supabase dashboard SQL editor. **Never echo `$DB`.**

- [ ] **Step 3: Verify against the live database**

```bash
psql "$DB" -c "\d+ daily_progress" | grep extras
psql "$DB" -c "select tablename, policyname, roles from pg_policies
               where tablename in ('daily_progress','user_profile','user_schedule')
               order by tablename, policyname;"
```

Expected: `extras | jsonb`; and four policies — `single_user` (still present, roles `{public}`), `own_rows`, `own_profile`, `own_schedule` (roles `{authenticated}`).

- [ ] **Step 4: Confirm the app still works unchanged**

```bash
npm test        # expect 123 passing — no client code changed
npm run dev     # tick a day; it must still save and sync exactly as before
```

This is the point of an additive migration: nothing about the running app may change yet.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql
git commit -F - <<'MSG'
Add the multi-user tables without cutting anything over

Additive on purpose. The v1 single_user policy and the anon grants stay
alongside the new authenticated ones, because the client cannot present a
token until phase 3 — dropping anon here would leave the app broken for four
tasks with no way to verify anything in between.

updated_at carries no default on either new table. Left to now() it would
stamp server receipt time, so an edit made offline on Monday and flushed on
Wednesday would outrank a newer Tuesday edit from another device. The client
sends it explicitly, the same rule daily_progress already follows.

Both new tables get explicit grants as well as policies. RLS decides which
rows; the grant decides whether PostgREST will look at the table at all —
missing that distinction is the mistake this project already made once.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 7: Move the owner's existing rows

**Files:**
- Modify: `supabase/schema.sql` (append the migration, commented, as the record)

**Blocked on:** the owner having signed in with Google at least once (Task 5), so their `auth.users` row exists.

**This must run before Task 10 revokes `anon`.** After that revocation, the old rows are only reachable by a credential that no longer has access — recovering them would need the service key.

- [ ] **Step 1: Find the owner's new auth UID**

```bash
psql "$DB" -c "select id, email, created_at from auth.users order by created_at;"
```

- [ ] **Step 2: Count what exists now, so the migration can be checked rather than assumed**

```bash
psql "$DB" -c "select user_id, count(*), min(date), max(date) from daily_progress group by user_id;"
```

Record the count. It is the number that must survive.

- [ ] **Step 3: Move the rows**

```sql
-- <OLD_UUID> is USER_ID from .env; <NEW_UUID> is the id from step 1.
update daily_progress set user_id = '<NEW_UUID>' where user_id = '<OLD_UUID>';
```

- [ ] **Step 4: Verify the count is unchanged and now sits under one owner**

```bash
psql "$DB" -c "select user_id, count(*), min(date), max(date) from daily_progress group by user_id;"
```

Expected: a single row, the new UUID, with **exactly** the count from step 2 and the same date range.

- [ ] **Step 5: Verify in the app**

Sign in, and check the streak number and the calendar match what they showed before. If the streak has changed, stop — do not proceed to Task 8.

- [ ] **Step 6: Record it and commit**

Append to `supabase/schema.sql`:

```sql
-- Ran 2026-08-26: moved the owner's rows from the v1 hardcoded USER_ID onto
-- their Google account's uid. Kept here as the record; the UUIDs live in
-- .env and in auth.users, not in this file.
--   update daily_progress set user_id = '<new>' where user_id = '<old>';
```

```bash
git add supabase/schema.sql
git commit -F - <<'MSG'
Record the owner-row migration

The UUIDs are deliberately not written down here — one lives in .env and the
other in auth.users, and this file is committed.

Sequencing matters more than the statement does: this has to run before anon
is revoked, or the only credential that can still see those rows loses access
and recovering them needs the service key.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

# Phase 3 — Plumbing

## Task 8: Namespace storage per account

**Files:**
- Modify: `storage.js`
- Test: `test/storage.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `setNamespace(uid: string|null) → void`, `getNamespace() → string`, `keyFor(name: string, ns?: string) → string`, `migrateLegacy(uid: string, store?) → boolean`. Existing exports keep their signatures: `loadProgress(store?)`, `saveProgress(progress, store?)`, `loadPending(store?)`, `markPending(dates, store?)`, `clearPending(dates, store?)`.

- [ ] **Step 1: Write the failing tests**

Append to `test/storage.test.js`:

```js
import { setNamespace, getNamespace, keyFor, migrateLegacy } from '../storage.js';

test('with no namespace the legacy keys are used', () => {
  /* Nothing may move until we know which account we are. */
  setNamespace(null);
  assert.equal(keyFor('progress'), 'weekly-innings-progress');
  assert.equal(keyFor('pending'), 'weekly-innings-pending');
});

test('a namespace scopes every key to the account', () => {
  setNamespace('u1');
  assert.equal(keyFor('progress'), 'wi:u1:progress');
  assert.equal(getNamespace(), 'u1');
  setNamespace(null);
});

test('two accounts in one browser cannot see each other', () => {
  /* The whole reason this exists: two Google accounts on one laptop used to
     share weekly-innings-progress and silently overwrite one another. */
  const store = fakeStore();
  setNamespace('u1');
  saveProgress({ '2026-08-20': { s: 1 } }, store);
  setNamespace('u2');
  assert.deepEqual(loadProgress(store), {});
  saveProgress({ '2026-08-21': { w: 1 } }, store);
  setNamespace('u1');
  assert.deepEqual(loadProgress(store), { '2026-08-20': { s: 1 } });
  setNamespace(null);
});

test('migrateLegacy moves the old keys into the account and removes them', () => {
  const store = fakeStore({
    'weekly-innings-progress': JSON.stringify({ '2026-08-20': { s: 1, w: 1 } }),
    'weekly-innings-pending': JSON.stringify(['2026-08-20']),
  });
  assert.equal(migrateLegacy('u1', store), true);
  setNamespace('u1');
  assert.deepEqual(loadProgress(store), { '2026-08-20': { s: 1, w: 1 } });
  assert.deepEqual(loadPending(store), ['2026-08-20']);
  assert.equal(store._dump()['weekly-innings-progress'], undefined);
  assert.equal(store._dump()['weekly-innings-pending'], undefined);
  setNamespace(null);
});

test('migrateLegacy refuses to overwrite an account that already has data', () => {
  /* Signing in as a second account on a laptop that still holds the first
     account's pre-migration data must not graft one onto the other. */
  const store = fakeStore({ 'weekly-innings-progress': JSON.stringify({ '2026-01-01': { s: 1 } }) });
  setNamespace('u2');
  saveProgress({ '2026-08-20': { w: 1 } }, store);
  setNamespace(null);
  assert.equal(migrateLegacy('u2', store), false);
  setNamespace('u2');
  assert.deepEqual(loadProgress(store), { '2026-08-20': { w: 1 } });
  setNamespace(null);
});

test('migrateLegacy is a no-op when there is nothing to move', () => {
  assert.equal(migrateLegacy('u1', fakeStore()), false);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `setNamespace is not a function`.

- [ ] **Step 3: Implement**

Replace the key constants at the top of `storage.js`:

```js
/* Keys are scoped to the signed-in account. They were global, which meant two
   Google accounts in one browser shared one progress object and overwrote
   each other with no sign that anything had happened. */
const LEGACY = {
  progress: 'weekly-innings-progress',
  pending: 'weekly-innings-pending',
};

let namespace = '';

export function setNamespace(uid) { namespace = uid || ''; }
export function getNamespace() { return namespace; }

/* No namespace means no account is known yet, and the only safe answer is the
   pre-migration key — never a half-formed 'wi::progress' that two different
   signed-out states would share. */
export const keyFor = (name, ns = namespace) => (ns ? `wi:${ns}:${name}` : LEGACY[name]);
```

Replace the five exported functions' key references:

```js
export const loadProgress = (store) => read(keyFor('progress'), {}, store);
export const saveProgress = (progress, store) => write(keyFor('progress'), progress, store);

export function loadPending(store) {
  const v = read(keyFor('pending'), [], store);
  return Array.isArray(v) ? v : [];
}

export function markPending(dates, store) {
  write(keyFor('pending'), [...new Set([...loadPending(store), ...dates])], store);
}

export function clearPending(dates, store) {
  const gone = new Set(dates);
  write(keyFor('pending'), loadPending(store).filter((d) => !gone.has(d)), store);
}
```

And add the migration:

```js
/* One-off, on first sign-in: adopt the data written before accounts existed.
   Refuses when the account already has its own progress — a second account
   signing in on the same laptop must not inherit the first one's history. */
export function migrateLegacy(uid, store) {
  if (!uid) return false;
  const s = store || defaultStore();
  const legacy = read(LEGACY.progress, null, s);
  if (!legacy || !Object.keys(legacy).length) return false;
  if (Object.keys(read(keyFor('progress', uid), {}, s)).length) return false;

  write(keyFor('progress', uid), legacy, s);
  const pending = read(LEGACY.pending, [], s);
  if (Array.isArray(pending) && pending.length) write(keyFor('pending', uid), pending, s);
  try { s.removeItem(LEGACY.progress); s.removeItem(LEGACY.pending); } catch { /* storage off */ }
  return true;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 129 tests.

- [ ] **Step 5: Commit**

```bash
git add storage.js test/storage.test.js
git commit -F - <<'MSG'
Scope local storage to the signed-in account

The keys were global. Two Google accounts in one browser would have shared
one progress object and overwritten each other with nothing on screen to say
so — the same silent class of loss as the flush race fixed on main.

With no namespace set the legacy keys are still used, deliberately: no
account is known yet, and inventing 'wi::progress' would just give every
signed-out state a shared bucket instead of a global one.

migrateLegacy refuses when the account already holds progress. Adopting the
pre-account data is right for the owner's own device and wrong for anyone
else who signs in on it, and the difference is exactly whether that account
has a history of its own.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 9: Authenticate the sync layer

**Files:**
- Modify: `sync.js`
- Test: `test/sync.test.js`

**Interfaces:**
- Consumes: `accessToken` (Task 4).
- Produces: `authedFetch(url, opts, { fetchImpl?, getToken? }) → Promise<Response>`; `toRow(date, rec)` **without** `user_id` and **with** `extras`; `fromRows(rows)` yielding `x` (extras); `pull({ fetchImpl?, getToken? })`; `push(progress, dates, { fetchImpl?, getToken? })`; `isConfigured()` no longer requiring `USER_ID`.

**Deliberate test replacement.** Two existing tests in `test/sync.test.js` assert the old behaviour and are replaced, not deleted for convenience:
- `toRow maps short client keys onto column names` — `user_id` is gone from the row; the assertion is updated and an `extras` assertion added.
- `pull requests only this user and returns a progress object` — the client-side `user_id=eq.` filter is gone; the replacement asserts it is *absent*, which is the actual new requirement.
The `import { USER_ID } from '../config.js'` line goes with them.

- [ ] **Step 1: Rewrite the two tests and add the new ones**

Replace those two tests in `test/sync.test.js` with:

```js
const tok = (t = 'AT') => async () => t;

test('toRow no longer carries a client-supplied user_id', () => {
  /* The column defaults to auth.uid() and RLS checks it. A user_id sent by
     the client is at best redundant and at worst a value the client could
     get wrong. */
  const row = toRow('2026-08-20', { s: 1, w: 0, z: 1, note: 'SVMs', u: '2026-08-20T12:00:00.000Z' });
  assert.deepEqual(row, {
    date: '2026-08-20',
    study: true, workout: false, sleep: true,
    note: 'SVMs',
    extras: {},
    updated_at: '2026-08-20T12:00:00.000Z',
  });
  assert.equal('user_id' in row, false);
});

test('toRow carries user-defined extra ticks', () => {
  const row = toRow('2026-08-20', { s: 1, x: { k1: 1, k2: 0 } });
  assert.deepEqual(row.extras, { k1: 1, k2: 0 });
});

test('fromRows returns extras as an object even when the column is null', () => {
  /* Every row written before the column existed has extras null, and the
     renderer indexes into it. */
  const p = fromRows([{ date: '2026-08-20', study: true, workout: false, sleep: false, note: null, extras: null, updated_at: 'x' }]);
  assert.deepEqual(p['2026-08-20'].x, {});
});

test('pull filters by RLS rather than by a client-supplied user_id', () => {
  /* A client-side filter is not a security control and, once RLS is keyed to
     auth.uid(), not a correctness one either — it is just a way to fetch the
     wrong rows if it ever disagrees with the token. */
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ([]) };
  };
  return pull({ fetchImpl, getToken: tok() }).then(() => {
    assert.match(seen.url, /\/rest\/v1\/daily_progress\?select=\*$/);
    assert.doesNotMatch(seen.url, /user_id/);
    assert.equal(seen.opts.headers.Authorization, 'Bearer AT');
  });
});

test('a 401 refreshes the token once and retries', async () => {
  /* The failure most likely to reach a real user: the app is open past the
     hour, the token dies, and the next tick must not be lost. */
  let calls = 0;
  const forced = [];
  const fetchImpl = async (_url, opts) => {
    calls++;
    if (calls === 1) return { ok: false, status: 401, text: async () => 'JWT expired' };
    assert.equal(opts.headers.Authorization, 'Bearer NEW');
    return { ok: true, status: 200, text: async () => '' };
  };
  const getToken = async ({ force } = {}) => { forced.push(!!force); return force ? 'NEW' : 'OLD'; };
  await push({ '2026-08-20': { s: 1 } }, ['2026-08-20'], { fetchImpl, getToken });
  assert.equal(calls, 2);
  assert.deepEqual(forced, [false, true]);
});

test('a second 401 gives up rather than looping', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 401, text: async () => 'no' }; };
  await assert.rejects(
    () => push({ '2026-08-20': { s: 1 } }, ['2026-08-20'], { fetchImpl, getToken: async () => 'T' }),
    /401/
  );
  assert.equal(calls, 2);
});

test('no token means no request at all', async () => {
  /* Signed out, or a refresh that failed. Firing an unauthenticated request
     would 401 and be read as "offline", which is a different and misleading
     status line. */
  let called = false;
  await assert.rejects(
    () => pull({ fetchImpl: async () => { called = true; }, getToken: async () => null }),
    /signed in/
  );
  assert.equal(called, false);
});
```

Every other test in the file that calls `pull` or `push` needs `getToken: tok()` added to its options object. Update them; do not delete them.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL on the rewritten tests (`user_id` still present, `getToken` ignored).

- [ ] **Step 3: Implement**

In `sync.js`, replace the config import and `isConfigured`:

```js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { accessToken } from './auth.js';

export const isConfigured = () =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('<'));
```

Replace `headers` and add `authedFetch`:

```js
const headers = (token, extra = {}) => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  ...extra,
});

/* PostgREST can reject a token this client still believes in — a clock skew,
   or simply an app left open past the hour. One forced refresh and one retry;
   a second 401 is a real failure and is thrown, because retrying it again
   would be a loop rather than a recovery. */
export async function authedFetch(url, opts = {}, { fetchImpl = globalThis.fetch, getToken = accessToken } = {}) {
  let token = await getToken();
  if (!token) throw new Error('not signed in');
  let res = await fetchImpl(url, { ...opts, headers: headers(token, opts.headers), ...deadline() });
  if (res.status !== 401) return res;
  token = await getToken({ force: true });
  if (!token) throw new Error('not signed in');
  return fetchImpl(url, { ...opts, headers: headers(token, opts.headers), ...deadline() });
}
```

`toRow` drops `user_id` and gains `extras`:

```js
export function toRow(date, rec = {}) {
  return {
    date,
    study: !!rec.s,
    workout: !!rec.w,
    sleep: !!rec.z,
    note: rec.note || '',
    /* User-defined ticks. The definitions live in the profile; only the
       values live here, so renaming a tick touches no logged row. */
    extras: rec.x || {},
    updated_at: rec.u || new Date().toISOString(),
  };
}
```

`fromRows` gains `x: r.extras || {}`.

`pull` and `push` route through `authedFetch`:

```js
export async function pull(opts = {}) {
  const res = await authedFetch(`${BASE}/rest/v1/${TABLE}?select=*`, {}, opts);
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  return fromRows(await res.json());
}

export async function push(progress, dates, opts = {}) {
  if (!dates.length) return;
  const body = JSON.stringify(dates.map((d) => toRow(d, progress[d])));
  const res = await authedFetch(`${BASE}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body,
  }, opts);
  if (!res.ok) throw new Error(`push failed: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 134 tests.

- [ ] **Step 5: Commit**

```bash
git add sync.js test/sync.test.js
git commit -F - <<'MSG'
Send a user's token instead of the shared anon key

The client stops supplying user_id. The column defaults to auth.uid() and RLS
checks it, so a client-sent value is redundant at best and a way to write the
wrong row at worst. The pull filter goes with it: filtering client-side was
never a security control, and once RLS is keyed to the token it is not a
correctness one either — only a way to fetch the wrong rows if it and the
token ever disagree.

A 401 forces one refresh and one retry. This is the failure most likely to
reach a real user: the app is left open past the hour, the token dies, and
the next tick would otherwise be lost. A second 401 throws, because retrying
again is a loop and not a recovery.

Two tests were replaced rather than removed. Both asserted the behaviour this
commit deliberately changes — the user_id in the row, and the user_id in the
pull URL — and their replacements assert the absence, which is the new
requirement rather than merely the lack of the old one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 10: Cut over

**Files:**
- Modify: `app.js`, `tools/make-config.mjs`, `config.example.js`, `sw.js`, `supabase/schema.sql`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: `setNamespace`, `migrateLegacy` (Task 8), `currentUserId` (Task 2).
- Produces: nothing new. This is the phase boundary: after it, the anon path is gone.

- [ ] **Step 1: Bind storage to the account in `app.js`**

At the top of `startApp()`, **before** `progress = loadProgress()`:

```js
function startApp() {
  const uid = currentUserId();
  /* Order matters: adopt the pre-account data first, then point the namespace
     at it. Reversed, migrateLegacy would see an account that already has
     progress and correctly refuse to move anything. */
  migrateLegacy(uid);
  setNamespace(uid);
  progress = loadProgress();
  ...
}
```

Add `setNamespace, migrateLegacy` to the `./storage.js` import.

The sign-out handler already reloads the page, which clears the namespace with the module. Confirm it still does.

- [ ] **Step 2: Drop `USER_ID` from the config generator**

In `tools/make-config.mjs`: remove `USER_ID` from the generated file, and remove `['USER_ID']` from the `missing` array. In `config.example.js`, delete the `USER_ID` line and update the comment. Add to the generator's header comment:

```js
/* USER_ID is gone: rows are keyed to auth.uid() and RLS checks the token.
   A .env that still declares it is simply ignored. */
```

- [ ] **Step 3: Update `test/config.test.js`**

The `parseEnv` tests use `USER_ID` purely as a sample key name and stay as they are — `parseEnv` is generic. Only the last test needs a companion:

```js
test('the generator no longer emits USER_ID', async () => {
  /* Rows are keyed to auth.uid() now. A generated USER_ID would be a value
     nothing reads, which is how stale configuration outlives its meaning. */
  const src = await import('node:fs').then((fs) => fs.readFileSync('tools/make-config.mjs', 'utf8'));
  assert.doesNotMatch(src, /export const USER_ID/);
});
```

- [ ] **Step 4: Cache `auth.js` in the service worker**

In `sw.js`: add `'./auth.js'` to `SHELL`, and bump `const CACHE = 'weekly-innings-v6';`. Check the current value first — if it is not `v5`, bump from whatever it actually is rather than assuming.

- [ ] **Step 5: Revoke the anon path**

Append to `supabase/schema.sql` and run it:

```sql
-- ============================================================
-- Phase 3 cutover. Run ONLY after the owner's rows have been
-- migrated (Task 7) and the client authenticates (Tasks 8-9).
-- ============================================================
drop policy if exists single_user on daily_progress;
revoke all on daily_progress from anon;
```

- [ ] **Step 6: Verify the hole is closed**

```bash
# Read sb.txt-style values without printing them, then: anon alone must get nothing.
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "$URL/rest/v1/daily_progress?select=*"
```

Expected: `401` (or `200` with `[]` — either is acceptable, **a populated array is not**). If rows come back, stop and fix before continuing.

- [ ] **Step 7: Verify the app end to end**

```bash
npm test        # expect 135 passing
npm run dev
```

- Signed in: the streak and calendar match what they showed before Task 7.
- Tick a day; it saves and syncs.
- In DevTools → Application → Local Storage: the keys are `wi:<uid>:progress` and `wi:<uid>:pending`, and the old `weekly-innings-*` keys are gone.
- Sign out, sign in with a **different** Google account: an empty app. Sign back in as the first: the data is back.

- [ ] **Step 8: Commit**

```bash
git add app.js tools/make-config.mjs config.example.js sw.js supabase/schema.sql test/config.test.js
git commit -F - <<'MSG'
Cut over to per-account data and close the anon hole

Until now anyone who found the deployed URL held the only credential the
database checked. anon now has no grants and no policy that matches it.

migrateLegacy runs before setNamespace, not after. Reversed, it would look at
an account that already has progress — the very data it is about to move —
and correctly refuse to move anything, which would read as the owner's whole
history vanishing on first sign-in.

USER_ID leaves the generator. Rows are keyed to auth.uid() and checked
against the token; a generated USER_ID would be a value nothing reads, which
is how stale configuration outlives its meaning and misleads the next person.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

# Phase 4 — Profile

## Task 11: The profile document

**Files:**
- Create: `profile.js`
- Test: `test/profile.test.js`

**Interfaces:**
- Consumes: nothing. Pure module, no imports, like `progress.js`.
- Produces: `DEFAULT_LANES`, `CORE_TICK_KEYS = ['s','w','z']`, `defaultProfile() → Profile`, `normalizeProfile(raw) → Profile`, `mergeDoc(local, remote) → Doc`, `newTickKey(ticks) → string`.
  `Profile = { season: string, lanes: {key,name}[], ticks: {key,label,hint,core}[], rules: {title,body}[], deadlines: {label,dates:string[]}[], onboarded: boolean }`.
  `Doc = { value: any, u: string }` — `u` is an ISO timestamp, matching the `u` field `progress.js` already uses.

- [ ] **Step 1: Write the failing tests**

`test/profile.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LANES, CORE_TICK_KEYS, defaultProfile, normalizeProfile, mergeDoc, newTickKey,
} from '../profile.js';

test('a new profile has lanes and ticks but no words put in the user\'s mouth', () => {
  /* Defaults where a default is honest, blank where it would be an
     invention. A made-up ground rule is worse than no ground rule. */
  const p = defaultProfile();
  assert.equal(p.lanes.length, DEFAULT_LANES.length);
  assert.deepEqual(p.ticks.map((t) => t.key), CORE_TICK_KEYS);
  assert.deepEqual(p.rules, []);
  assert.deepEqual(p.deadlines, []);
  assert.equal(p.season, '');
  assert.equal(p.onboarded, false);
});

test('defaultProfile hands back a fresh copy each time', () => {
  /* Shared array references across accounts would let one user's rename
     appear in another's session. */
  const a = defaultProfile();
  a.lanes[0].name = 'CHANGED';
  assert.notEqual(defaultProfile().lanes[0].name, 'CHANGED');
});

test('normalizeProfile repairs anything that is not a profile', () => {
  for (const junk of [null, undefined, 42, 'x', []]) {
    assert.deepEqual(normalizeProfile(junk), defaultProfile());
  }
});

test('the three core ticks are always present, in order, and marked core', () => {
  /* They map to real columns. A profile that lost one would leave the
     scorecard unable to render a habit the database still stores. */
  const p = normalizeProfile({ ticks: [{ key: 'w', label: 'Gym' }] });
  assert.deepEqual(p.ticks.slice(0, 3).map((t) => t.key), CORE_TICK_KEYS);
  assert.equal(p.ticks.find((t) => t.key === 'w').label, 'Gym');
  assert.equal(p.ticks.every((t, i) => (i < 3 ? t.core === true : t.core === false)), true);
});

test('core ticks cannot be deleted by omission or duplicated by collision', () => {
  const p = normalizeProfile({ ticks: [{ key: 's', label: 'A' }, { key: 's', label: 'B' }] });
  assert.equal(p.ticks.filter((t) => t.key === 's').length, 1);
  assert.equal(p.ticks.find((t) => t.key === 's').label, 'A');
});

test('extra ticks survive normalisation and keep their keys', () => {
  const p = normalizeProfile({ ticks: [{ key: 'k1', label: 'Read' }] });
  const extra = p.ticks.filter((t) => !t.core);
  assert.deepEqual(extra.map((t) => t.key), ['k1']);
  assert.equal(extra[0].label, 'Read');
});

test('a tick with no label is dropped rather than rendered blank', () => {
  const p = normalizeProfile({ ticks: [{ key: 'k1', label: '   ' }, { key: 'k2', label: 'Ok' }] });
  assert.deepEqual(p.ticks.filter((t) => !t.core).map((t) => t.key), ['k2']);
});

test('lanes fall back to the defaults when the list is emptied', () => {
  /* Every schedule block names a lane. With no lanes there is nothing for a
     block to point at, so an empty list is a broken state, not a choice. */
  assert.deepEqual(normalizeProfile({ lanes: [] }).lanes, DEFAULT_LANES);
});

test('duplicate lane keys collapse to the first', () => {
  const p = normalizeProfile({ lanes: [{ key: 'a', name: 'One' }, { key: 'a', name: 'Two' }] });
  assert.deepEqual(p.lanes, [{ key: 'a', name: 'One' }]);
});

test('rules and deadlines keep only well-formed entries', () => {
  const p = normalizeProfile({
    rules: [{ title: 'Never miss twice', body: 'One day is a rain delay.' }, { title: '' }, 'nope'],
    deadlines: [{ label: 'EC-1', dates: ['2026-08-25', '2026-08-24'] }, { label: 'x', dates: [] }, { dates: ['2026-01-01'] }],
  });
  assert.deepEqual(p.rules.map((r) => r.title), ['Never miss twice']);
  assert.deepEqual(p.deadlines.map((d) => d.label), ['EC-1']);
  /* Sorted on the way in, so nothing downstream has to re-sort to format a
     span correctly. */
  assert.deepEqual(p.deadlines[0].dates, ['2026-08-24', '2026-08-25']);
});

test('newTickKey never collides with an existing key', () => {
  const ticks = [{ key: 's' }, { key: 'w' }, { key: 'z' }, { key: 'k1' }];
  const k = newTickKey(ticks);
  assert.equal(ticks.some((t) => t.key === k), false);
  assert.match(k, /^[a-z0-9]+$/);
});

test('mergeDoc lets the newer timestamp win the whole document', () => {
  const a = { value: { season: 'A' }, u: '2026-08-20T00:00:00.000Z' };
  const b = { value: { season: 'B' }, u: '2026-08-21T00:00:00.000Z' };
  assert.equal(mergeDoc(a, b).value.season, 'B');
  assert.equal(mergeDoc(b, a).value.season, 'B');
});

test('mergeDoc keeps the local document when timestamps tie', () => {
  /* Same rule as mergeProgress: remote must be strictly newer to win. A tie
     is almost always the same write coming back, and preferring local avoids
     a pointless re-render. */
  const a = { value: { season: 'local' }, u: 'T' };
  const b = { value: { season: 'remote' }, u: 'T' };
  assert.equal(mergeDoc(a, b).value.season, 'local');
});

test('mergeDoc handles either side being absent', () => {
  const a = { value: { season: 'A' }, u: 'T' };
  assert.equal(mergeDoc(a, null), a);
  assert.equal(mergeDoc(null, a), a);
  assert.equal(mergeDoc(null, null), null);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test` — FAIL, module not found.

- [ ] **Step 3: Implement `profile.js`**

```js
/* The per-user document. Pure, no imports — loaded identically by the browser
   and by node --test, like progress.js.

   Shape rules exist because this document is edited by hand, synced between
   devices, and in a later project written by a language model. Anything that
   reaches normalizeProfile is treated as untrusted. */

export const DEFAULT_LANES = [
  { key: 'focus',  name: 'Focus' },
  { key: 'work',   name: 'Work' },
  { key: 'move',   name: 'Movement' },
  { key: 'commit', name: 'Commitment' },
  { key: 'rest',   name: 'Rest' },
];

/* These three map to real columns in daily_progress and to the streak rule.
   They can be renamed; they cannot be removed. */
export const CORE_TICK_KEYS = ['s', 'w', 'z'];
const CORE_TICK_LABELS = { s: 'Study', w: 'Workout', z: 'Sleep' };

const clone = (v) => JSON.parse(JSON.stringify(v));
const str = (v) => (typeof v === 'string' ? v.trim() : '');

export const defaultProfile = () => ({
  season: '',
  lanes: clone(DEFAULT_LANES),
  ticks: CORE_TICK_KEYS.map((key) => ({ key, label: CORE_TICK_LABELS[key], hint: '', core: true })),
  rules: [],
  deadlines: [],
  onboarded: false,
});

export function normalizeProfile(raw) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const base = defaultProfile();

  const lanes = [];
  const laneSeen = new Set();
  for (const l of Array.isArray(p.lanes) ? p.lanes : []) {
    const key = str(l?.key);
    const name = str(l?.name);
    if (!key || !name || laneSeen.has(key)) continue;
    laneSeen.add(key);
    lanes.push({ key, name });
  }

  const given = new Map();
  for (const t of Array.isArray(p.ticks) ? p.ticks : []) {
    const key = str(t?.key);
    if (!key || given.has(key)) continue;      /* first wins */
    given.set(key, { key, label: str(t?.label), hint: str(t?.hint) });
  }

  const ticks = CORE_TICK_KEYS.map((key) => ({
    key,
    label: given.get(key)?.label || CORE_TICK_LABELS[key],
    hint: given.get(key)?.hint || '',
    core: true,
  }));
  for (const [key, t] of given) {
    /* A label-less extra tick would render as a nameless button. */
    if (CORE_TICK_KEYS.includes(key) || !t.label) continue;
    ticks.push({ ...t, core: false });
  }

  const rules = (Array.isArray(p.rules) ? p.rules : [])
    .filter((r) => r && typeof r === 'object' && str(r.title))
    .map((r) => ({ title: str(r.title), body: str(r.body) }));

  const deadlines = (Array.isArray(p.deadlines) ? p.deadlines : [])
    .filter((d) => d && typeof d === 'object' && str(d.label) && Array.isArray(d.dates) && d.dates.length)
    .map((d) => ({
      label: str(d.label),
      /* Sorted here so nothing downstream has to re-sort to decide whether a
         run of dates is contiguous. */
      dates: d.dates.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort(),
    }))
    .filter((d) => d.dates.length);

  return {
    season: str(p.season),
    lanes: lanes.length ? lanes : base.lanes,
    ticks,
    rules,
    deadlines,
    onboarded: p.onboarded === true,
  };
}

export function newTickKey(ticks) {
  const used = new Set((ticks || []).map((t) => t.key));
  for (let i = 1; ; i++) {
    const k = `k${i}`;
    if (!used.has(k)) return k;
  }
}

/* Whole-document last-write-wins, the same comparison mergeProgress uses.
   Weaker than the per-date merge, and deliberately so: profile edits are rare
   and deliberate, ticks are frequent and incidental, and the frequent case is
   the one that needed the stronger guarantee. A tie keeps local — remote must
   be strictly newer to win, or the same write coming back re-renders. */
export function mergeDoc(local, remote) {
  if (!local) return remote || null;
  if (!remote) return local;
  return (remote.u || '') > (local.u || '') ? remote : local;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 149 tests (+14).

- [ ] **Step 5: Commit**

```bash
git add profile.js test/profile.test.js
git commit -F - <<'MSG'
Model the per-user profile as a document that repairs itself

Everything reaching normalizeProfile is treated as untrusted. It is edited by
hand, synced between devices, and in the next project will be written by a
language model — three ways for the shape to go wrong, none of which should
be able to leave the app unable to render.

Defaults where a default is honest, blank where it would be an invention.
Lanes and the three core ticks ship with values because every schedule block
must name a lane and the ticks map to real columns; rules, deadlines and the
season line start empty, because putting words in a stranger's mouth is worse
than showing them nothing.

Core ticks survive omission, collision and reordering. They are the streak
and they are three columns, so a profile that lost one would leave the
scorecard unable to render a habit the database is still storing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 12: Sync the documents

**Files:**
- Modify: `sync.js`
- Test: `test/sync.test.js`

**Interfaces:**
- Consumes: `authedFetch`, `canonicalTime` (Task 9).
- Produces: `pullDoc(kind: 'profile'|'schedule', opts?) → Promise<Doc|null>`, `pushDoc(kind, value, updatedAt, opts?) → Promise<void>`.

**One thing to verify empirically, not assume.** These tables' primary key is `user_id`, which the client does *not* send — the column defaults to `auth.uid()`. Whether PostgREST's `resolution=merge-duplicates` infers that conflict target from a payload that omits it is the one behaviour in this plan not confirmed against the live database. **Step 4 verifies it.** If the upsert inserts a duplicate or errors, the documented fallback is to send `user_id` explicitly from the session; that is a legitimate difference from Task 9, because here `user_id` is the conflict target rather than a redundant filter.

- [ ] **Step 1: Write the failing tests**

Append to `test/sync.test.js`:

```js
import { pullDoc, pushDoc } from '../sync.js';

test('pullDoc reads the profile row and canonicalises its timestamp', async () => {
  let seen;
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, status: 200, json: async () => ([{ data: { season: 'S' }, updated_at: '2026-08-20T12:00:00+00:00' }]) };
  };
  const doc = await pullDoc('profile', { fetchImpl, getToken: tok() });
  assert.match(seen, /\/rest\/v1\/user_profile\?select=data,updated_at$/);
  assert.deepEqual(doc.value, { season: 'S' });
  assert.equal(doc.u, '2026-08-20T12:00:00.000Z');
});

test('pullDoc reads the schedule from its own table and column', async () => {
  let seen;
  const fetchImpl = async (url) => { seen = url; return { ok: true, status: 200, json: async () => ([]) }; };
  await pullDoc('schedule', { fetchImpl, getToken: tok() });
  assert.match(seen, /\/rest\/v1\/user_schedule\?select=week,updated_at$/);
});

test('pullDoc returns null for a user who has never saved one', async () => {
  /* Distinct from an empty document: null means "no row", which is what the
     onboarding wizard tests to decide whether to run. */
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ([]) });
  assert.equal(await pullDoc('profile', { fetchImpl, getToken: tok() }), null);
});

test('pushDoc upserts the document with an explicit updated_at', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, text: async () => '' }; };
  await pushDoc('profile', { season: 'S' }, '2026-08-20T12:00:00.000Z', { fetchImpl, getToken: tok() });
  assert.deepEqual(JSON.parse(seen.opts.body), { data: { season: 'S' }, updated_at: '2026-08-20T12:00:00.000Z' });
  assert.match(seen.opts.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal('user_id' in JSON.parse(seen.opts.body), false);
});

test('pushDoc throws on a non-2xx so the caller can requeue', async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, text: async () => 'conflict' });
  await assert.rejects(
    () => pushDoc('schedule', {}, 'T', { fetchImpl, getToken: tok() }),
    /409/
  );
});

test('an unknown document kind throws rather than building a URL from undefined', async () => {
  await assert.rejects(() => pullDoc('nope', { fetchImpl: async () => ({}), getToken: tok() }), /unknown document/);
});
```

- [ ] **Step 2: Run and confirm failure** — `pullDoc is not a function`.

- [ ] **Step 3: Implement**

Append to `sync.js`:

```js
/* Two document tables beside the per-date one. Both are read and written
   whole, which is why they are documents and not rows. */
const DOCS = {
  profile:  { table: 'user_profile',  field: 'data' },
  schedule: { table: 'user_schedule', field: 'week' },
};

const docSpec = (kind) => {
  const spec = DOCS[kind];
  if (!spec) throw new Error(`unknown document: ${kind}`);
  return spec;
};

export async function pullDoc(kind, opts = {}) {
  const { table, field } = docSpec(kind);
  const res = await authedFetch(`${BASE}/rest/v1/${table}?select=${field},updated_at`, {}, opts);
  if (!res.ok) throw new Error(`pull ${kind} failed: ${res.status}`);
  const rows = await res.json();
  /* No row is not an empty document: the wizard uses the difference to decide
     whether this account has ever been set up. */
  if (!rows.length) return null;
  return { value: rows[0][field], u: canonicalTime(rows[0].updated_at) };
}

export async function pushDoc(kind, value, updatedAt, opts = {}) {
  const { table, field } = docSpec(kind);
  const res = await authedFetch(`${BASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    /* user_id is omitted: it is the primary key and defaults to auth.uid().
       See the verification step in the plan — if PostgREST will not infer the
       conflict target from a payload that omits it, send it from the session. */
    body: JSON.stringify({ [field]: value, updated_at: updatedAt }),
  }, opts);
  if (!res.ok) throw new Error(`push ${kind} failed: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 4: Verify the upsert against the live database — do not skip**

With a real signed-in access token (copy it from `wi:session` in DevTools):

```bash
# First write: expect 201.
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/rest/v1/user_profile" \
  -H "apikey: $KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: resolution=merge-duplicates,return=minimal' \
  -d '{"data":{"season":"probe-1"},"updated_at":"2026-08-26T00:00:00.000Z"}'

# Second write, same user: expect 200 or 201, and exactly ONE row after.
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/rest/v1/user_profile" \
  -H "apikey: $KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: resolution=merge-duplicates,return=minimal' \
  -d '{"data":{"season":"probe-2"},"updated_at":"2026-08-26T00:00:01.000Z"}'

curl -s "$URL/rest/v1/user_profile?select=data" \
  -H "apikey: $KEY" -H "Authorization: Bearer $ACCESS_TOKEN"
```

Expected: one row, `{"season":"probe-2"}`.

If the second write errors (typically `42P10`, "no unique or exclusion constraint matching the ON CONFLICT specification"), apply the fallback: add `?on_conflict=user_id` to the URL in `pushDoc`. If that still fails, include `user_id` in the body from `currentUserId()` and update the test that asserts its absence — noting in the commit that it is the conflict target, not a filter.

Clean up: `curl -X DELETE "$URL/rest/v1/user_profile?user_id=eq.<uid>" …`

- [ ] **Step 5: Commit**

```bash
git add sync.js test/sync.test.js
git commit -F - <<'MSG'
Read and write the profile and schedule documents

Both are read and written whole, which is what makes them documents rather
than rows. No row is deliberately distinct from an empty document: the
onboarding wizard uses that difference to tell an account that has never been
set up from one that was set up and then cleared.

The upsert was verified against the live database rather than assumed. These
tables are keyed on user_id, which the client does not send — it defaults to
auth.uid() — and whether PostgREST infers that conflict target from a payload
omitting it is not something the docs settle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 13: Deadlines replace the hardcoded exams

**Files:**
- Create: `deadlines.js`, `test/deadlines.test.js`
- Delete: `exams.js`, `test/exams.test.js`
- Modify: `app.js`, `sw.js`

**Interfaces:**
- Consumes: `profile.deadlines` (Task 11).
- Produces: `nextDeadline(deadlines, todayIso) → { label, date, days } | null`, `formatDates(dates) → string`.

**Deliberate deletion.** `exams.js` holds one person's BITS WILP dates and `EXAMS` is exported as a constant — it *is* user data in a code file. `test/exams.test.js`'s seven tests are re-expressed in `test/deadlines.test.js` against an injected fixture; the same behaviours are still covered, so the passing count does not drop.

- [ ] **Step 1: Write `test/deadlines.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDeadline, formatDates } from '../deadlines.js';

/* The owner's real dates, now a fixture rather than a module constant. */
const FIXTURE = [
  { label: 'EC-1', dates: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'] },
  { label: 'EC-2', dates: ['2026-09-19', '2026-09-20', '2026-09-26', '2026-09-27'] },
  { label: 'EC-3', dates: ['2026-12-05', '2026-12-06', '2026-12-12', '2026-12-13'] },
];

test('nextDeadline finds the nearest upcoming date across all groups', () => {
  const n = nextDeadline(FIXTURE, '2026-08-20');
  assert.equal(n.label, 'EC-1');
  assert.equal(n.date, '2026-08-24');
  assert.equal(n.days, 4);
});

test('a date equal to today reports zero days, not the following one', () => {
  const n = nextDeadline(FIXTURE, '2026-08-26');
  assert.equal(n.date, '2026-08-26');
  assert.equal(n.days, 0);
});

test('between two windows it skips to the next group', () => {
  assert.equal(nextDeadline(FIXTURE, '2026-09-01').label, 'EC-2');
});

test('after the last one it returns null rather than a negative countdown', () => {
  assert.equal(nextDeadline(FIXTURE, '2027-01-01'), null);
});

test('a user with no deadlines gets null, not an error', () => {
  /* The default for every new account. */
  assert.equal(nextDeadline([], '2026-08-20'), null);
  assert.equal(nextDeadline(undefined, '2026-08-20'), null);
});

test('formatDates collapses a contiguous run into a span', () => {
  assert.equal(formatDates(FIXTURE[0].dates), '24–28 Aug 2026');
});

test('formatDates lists non-contiguous dates instead of faking a span', () => {
  assert.equal(formatDates(FIXTURE[1].dates), '19, 20, 26, 27 Sep 2026');
});

test('formatDates handles a run that crosses a month boundary', () => {
  /* The old implementation took the month from the first date and applied it
     to every day number, so a window spanning a month boundary printed dates
     that do not exist. */
  assert.equal(formatDates(['2026-08-31', '2026-09-01']), '31 Aug – 1 Sep 2026');
});
```

- [ ] **Step 2: Run and confirm failure** — module not found, and the month-boundary test will fail even after a naive port.

- [ ] **Step 3: Write `deadlines.js`**

Port `nextExam`/`formatExamDates` from `exams.js`, with three changes: the list is a parameter rather than a module constant; a missing or empty list returns `null`; and `formatDates` must not assume every date shares a month. Read `exams.js` before deleting it and keep its comments where they still apply.

- [ ] **Step 4: Rewire `app.js`**

`renderExam` becomes `renderDeadline`, reading `profile.deadlines` instead of importing `EXAMS`. Keep the existing behaviour of clearing the line — and the `title` — when there is nothing upcoming. With no deadlines at all the line is empty, which is the correct new-account state.

- [ ] **Step 5: Delete and update the shell**

```bash
git rm exams.js test/exams.test.js
```

In `sw.js`: replace `'./exams.js'` with `'./deadlines.js'` and `'./profile.js'` in `SHELL`. Leave the cache version for Task 20.

- [ ] **Step 6: Verify**

Run: `npm test` — expect 156 passing (−7 exam, +8 deadline). Confirm the count did not drop: seven exam tests left, eight deadline tests arrived.

- [ ] **Step 7: Commit**

```bash
git add deadlines.js test/deadlines.test.js app.js sw.js
git commit -F - <<'MSG'
Replace the hardcoded exams with a user's own deadlines

exams.js exported one person's BITS WILP dates as a module constant. That is
user data living in a code file, and it is the clearest example of the thing
this project is trying to stop doing.

The seven tests in test/exams.test.js are re-expressed against a fixture
rather than deleted; the same behaviours are still covered, and the same
dates still exercise them. Two new cases arrive with the move: an account
with no deadlines at all, which is now the default rather than impossible,
and a window that crosses a month boundary — the old formatter took the month
from the first date and applied it to every day number, so a run from 31 Aug
to 1 Sep printed a date that does not exist.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 14: Store and sync the profile

**Files:**
- Modify: `storage.js`, `app.js`
- Test: `test/storage.test.js`

**Interfaces:**
- Consumes: `keyFor` (Task 8), `pullDoc`/`pushDoc` (Task 12), `mergeDoc`/`normalizeProfile` (Task 11).
- Produces: `loadDoc(kind, store?) → Doc|null`, `saveDoc(kind, doc, store?) → boolean`, `markDocPending(kind, store?)`, `loadDocPending(store?) → string[]`, `clearDocPending(kinds, store?)`; and in `app.js` a module-level `profile` plus `commitProfile()`.

- [ ] **Step 1: Write the failing tests**

Append to `test/storage.test.js`:

```js
import { loadDoc, saveDoc, markDocPending, loadDocPending, clearDocPending } from '../storage.js';

test('keyFor refuses to invent a key for a document with no account', () => {
  /* Documents only exist for a signed-in user. Falling back to a shared
     'wi::profile' would give every signed-out state one bucket, which is the
     bug namespacing exists to remove, not a smaller version of it. */
  setNamespace(null);
  assert.throws(() => keyFor('profile'), /namespace/);
});

test('documents round-trip inside the account namespace', () => {
  const store = fakeStore();
  setNamespace('u1');
  assert.equal(saveDoc('profile', { value: { season: 'S' }, u: 'T' }, store), true);
  assert.deepEqual(loadDoc('profile', store), { value: { season: 'S' }, u: 'T' });
  assert.equal(store._dump()['wi:u1:profile'] !== undefined, true);
  setNamespace(null);
});

test('loadDoc returns null for an account that has never saved one', () => {
  setNamespace('u1');
  assert.equal(loadDoc('schedule', fakeStore()), null);
  setNamespace(null);
});

test('the document queue behaves like the date queue', () => {
  const store = fakeStore();
  setNamespace('u1');
  markDocPending('profile', store);
  markDocPending('profile', store);
  markDocPending('schedule', store);
  assert.deepEqual(loadDocPending(store).sort(), ['profile', 'schedule']);
  clearDocPending(['profile'], store);
  assert.deepEqual(loadDocPending(store), ['schedule']);
  setNamespace(null);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement in `storage.js`**

Tighten `keyFor` and add the document helpers:

```js
export const keyFor = (name, ns = namespace) => {
  if (ns) return `wi:${ns}:${name}`;
  /* Only the two pre-account keys have a meaning without a namespace.
     Anything else is a programming error — a document read before sign-in —
     and must be loud, not silently shared. */
  if (LEGACY[name]) return LEGACY[name];
  throw new Error(`no namespace set for "${name}"`);
};

const DOC_PENDING_KEY = 'doc-pending';

export const loadDoc = (kind, store) => read(keyFor(kind), null, store);
export const saveDoc = (kind, doc, store) => write(keyFor(kind), doc, store);

export function loadDocPending(store) {
  const v = read(keyFor(DOC_PENDING_KEY), [], store);
  return Array.isArray(v) ? v : [];
}

export function markDocPending(kind, store) {
  write(keyFor(DOC_PENDING_KEY), [...new Set([...loadDocPending(store), kind])], store);
}

export function clearDocPending(kinds, store) {
  const gone = new Set(kinds);
  write(keyFor(DOC_PENDING_KEY), loadDocPending(store).filter((k) => !gone.has(k)), store);
}
```

`read` returns its fallback for a missing key, so `loadDoc` returning `null` requires passing `null` as the fallback — check that `read` does not coerce it.

- [ ] **Step 4: Wire the profile into `app.js`**

Module scope:

```js
import { defaultProfile, normalizeProfile, mergeDoc } from './profile.js';

let profile = defaultProfile();
let profileDoc = null;
```

In `startApp()`, after `setNamespace(uid)`:

```js
profileDoc = loadDoc('profile');
profile = normalizeProfile(profileDoc?.value);
```

A commit path mirroring `commit()`:

```js
/* Same shape as commit(): stamp, write locally, queue, re-render. The stamp
   is what the flush compares against to decide whether an edit landed while
   its own push was in flight. */
function commitProfile() {
  profileDoc = { value: profile, u: new Date().toISOString() };
  if (!saveDoc('profile', profileDoc)) setSaveStatus('⚠ not saved', 'var(--warn)');
  markDocPending('profile');
  armFlush();
  renderProfile();
}
```

In the init pull, alongside the progress pull:

```js
const remote = await pullDoc('profile');
profileDoc = mergeDoc(profileDoc, remote);
profile = normalizeProfile(profileDoc?.value);
saveDoc('profile', profileDoc);
renderProfile();
```

- [ ] **Step 5: Flush documents with the same in-flight discipline as dates**

Add to `flushSync`, after the progress push and **using the same rule** — a document whose stamp moved while the push was in flight stays queued:

```js
const kinds = loadDocPending();
if (kinds.length) {
  /* Exactly the trap clearableDates exists for, one document at a time: the
     body is serialised before the await, so an edit made mid-flight must not
     be cleared by the push that never carried it. */
  const sent = kinds.map((k) => (k === 'profile' ? profileDoc : scheduleDoc)?.u);
  for (const [i, k] of kinds.entries()) {
    const doc = k === 'profile' ? profileDoc : scheduleDoc;
    await pushDoc(k, doc.value, doc.u);
    const now = k === 'profile' ? profileDoc : scheduleDoc;
    if (now?.u === sent[i]) clearDocPending([k]);
  }
}
```

**`scheduleDoc` does not exist until Task 18.** Write this task's version against
`profile` alone — declare `const docFor = (k) => (k === 'profile' ? profileDoc : null);`
and skip any kind for which it returns null. Task 18 extends `docFor`, and nothing
else in the loop changes. Do not leave a reference to an undeclared variable.

- [ ] **Step 6: Verify**

Run: `npm test` — expect 160 passing (+4). Then in a browser: sign in, confirm no console errors, and confirm a `wi:<uid>:profile` key appears in Local Storage after the init pull.

- [ ] **Step 7: Commit**

```bash
git add storage.js app.js test/storage.test.js
git commit -F - <<'MSG'
Store and sync the profile document

keyFor now throws rather than inventing a key when no account is set. Only
the two pre-account keys mean anything without a namespace; a document read
before sign-in is a programming error, and falling back to a shared
'wi::profile' would reproduce the exact bug namespacing removed, just with a
longer name.

The document flush copies the in-flight discipline from clearableDates. The
push body is serialised before the await, so an edit made while that push is
in flight was never carried by it, and clearing the queue on its return would
strand the newer value locally forever. That bug has already cost this
project once; it is not being re-introduced under a different name.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 15: Render the page from the profile

**Files:**
- Modify: `index.html`, `app.js`, `styles.css`

**Interfaces:**
- Consumes: `profile` (Task 14), `nextDeadline`/`formatDates` (Task 13).
- Produces: `renderProfile()` in `app.js`, rendering the season line, the ground rules, the legend and the tick labels.

**This is the task that removes the owner's content from the codebase.** Before deleting anything, capture it — Task 20 seeds it back as *their profile data*:

```bash
mkdir -p docs/superpowers
# Copy the six rules, the season line and the three tick labels out of
# index.html into a scratch file first. They become seed data, not code.
```

- [ ] **Step 1: Strip the personal content from `index.html`**

- The six `<div class="rule">` blocks inside `.rules` — delete their content; leave `<div class="rules" id="rulesList"></div>`.
- `<p class="season">Season 2026 · Pune</p>` → `<p class="season" id="seasonLine"></p>`.
- The footer's `<p>The Weekly Innings · Season 2026 · Pune</p>` → `<p id="footerLine">Weekly Innings</p>`.
- The three `<button class="tick">` elements keep their ids (`t-s`, `t-w`, `t-z`) — the scorecard wiring depends on them — but their `<span class="lbl">` and `<span class="hint">` are emptied and filled by `renderProfile`.
- The `.legend` spans → `<div class="legend" id="legendList"></div>`.
- The `<h2>Ground rules</h2>` section keeps its heading.

**Also in `app.js`, not `index.html`:** `renderWeek` hardcodes its four captions —
`Study days` out of **5**, `Workouts` out of 7, `Slept by 11` out of 7, `Best run`.
`Slept by 11` is one person's bedtime and the `/5` assumes a five-day study week.
Take the first three captions from `profile.ticks[].label` and make every
denominator 7; a user who studies six days a week is not at `6/5`.

- [ ] **Step 2: Write `renderProfile()` in `app.js`**

```js
/* Everything here is user-authored, so everything here is textContent. The
   only innerHTML left on this page is our own markup with our own entities. */
function renderProfile() {
  document.getElementById('seasonLine').textContent = profile.season;
  document.getElementById('footerLine').textContent =
    profile.season ? `Weekly Innings · ${profile.season}` : 'Weekly Innings';

  const rules = document.getElementById('rulesList');
  rules.textContent = '';
  if (!profile.rules.length) {
    const p = document.createElement('p');
    p.className = 'rules-empty';
    p.textContent = 'No ground rules yet. Add the handful of principles you actually want to hold yourself to.';
    rules.appendChild(p);
  } else {
    profile.rules.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'rule';
      const n = document.createElement('span');
      n.className = 'rule-n';
      n.setAttribute('aria-hidden', 'true');
      n.textContent = String(i + 1);
      const b = document.createElement('b');
      b.textContent = r.title;
      const p = document.createElement('p');
      p.textContent = r.body;
      el.append(n, b, p);
      rules.appendChild(el);
    });
  }

  const legend = document.getElementById('legendList');
  legend.textContent = '';
  for (const lane of profile.lanes) {
    const span = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = `d-${lane.key}`;
    span.append(dot, document.createTextNode(lane.name));
    legend.appendChild(span);
  }

  for (const t of profile.ticks) {
    const btn = document.getElementById(`t-${t.key}`);
    if (!btn) continue;                       /* extras are built in Task 16 */
    btn.querySelector('.lbl').textContent = t.label;
    btn.querySelector('.hint').textContent = t.hint;
  }
}
```

Call it from `startApp()` before `renderScorecard()`.

- [ ] **Step 3: Make lane colours data-driven in `styles.css`**

The stylesheet has fixed `.d-study`, `.d-work`, `.d-fit`, `.d-cricket`, `.d-rest` rules and matching `.lane-*` rules. Lane keys are now user data, so a fixed list cannot cover them.

Define a five-colour rotation on `.legend i` and `.lane-dot` by position rather than by key — `:nth-child(5n+1)` … `:nth-child(5n+5)` on the legend, and a `--lane-i` custom property set inline by the renderer for schedule rows. Keep the existing five token values; only how they are selected changes. Delete the `.d-study`/`.lane-study` style rules that name specific keys.

Verify the contrast floor still holds for whichever tokens end up on the rotation, and remember the decision already recorded on `main`: lane colour must **not** be the only carrier of lane identity, so the `role="img"` + `aria-label` on each lane dot stays, now reading its name from `profile.lanes`.

- [ ] **Step 4: Verify**

Run: `npm test` — expect 160 passing (no test changes; this task is DOM).
Run: `node --check app.js`

In a browser, signed in with an empty profile:
- The Ground rules section shows its empty-state sentence, not six rules about someone else's degree.
- The season line and footer show no invented location.
- The legend shows the five default lanes with distinguishable dots.
- Tick labels read Study / Workout / Sleep with no hint times.
- **No console errors**, and `document.querySelectorAll('.rule').length === 0`.

- [ ] **Step 5: Commit**

```bash
git add index.html app.js styles.css
git commit -F - <<'MSG'
Render the page from the profile instead of from one person's life

Six ground rules about Maths, ML and cricket, a season line naming a city,
and tick labels carrying one person's alarm times were all markup. They are
data now, and a new account sees empty states rather than someone else's
principles.

Every string this renders is user-authored, so every string is written with
textContent. That rule now protects a session token in localStorage, not just
the page, and this commit is where the amount of user-authored text on the
page grows sharply.

Lane colours are selected by position rather than by key, because lane keys
are user data and a stylesheet cannot enumerate them. The decision from the
organic redesign still stands underneath: colour is not the only carrier of
lane identity, so each dot keeps naming its lane in text.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 16: Editing the profile, and extra ticks

**Files:**
- Create: `profileEditor.js`
- Modify: `app.js`, `index.html`, `styles.css`, `progress.js`
- Test: `test/progress.test.js`

**Interfaces:**
- Consumes: `profile`, `commitProfile` (Task 14), `newTickKey`, `normalizeProfile` (Task 11).
- Produces: `mountProfileEditor({ root, getProfile, getLaneUsage, onChange }) → void` in `profileEditor.js`; `toCSV(progress, extras?)` in `progress.js` extended with extras columns.
  `getLaneUsage(laneKey)` returns the `Set<string>` of day names whose schedule still uses that lane — not a set of lane keys, which cannot name a day. In this task `app.js` passes `() => new Set()` — there is no schedule yet. Task 19 replaces it with the real source without touching this module. Because a name alone does not stop a wrongly-shaped closure from being wired in, `profileEditor.js` also verifies structurally, on first use, that whatever it is given actually returns nothing for a lane key that cannot exist — refusing to trust an answer that ignores its own argument, rather than silently refusing every deletion forever.

- [ ] **Step 1: Write the failing tests for the export change**

Extras are user data and must leave the app with everything else. Append to `test/progress.test.js`:

```js
test('toCSV includes a column per extra tick, in profile order', () => {
  /* Export is the escape hatch. A tick the user invented is exactly the kind
     of data that must not be silently dropped on the way out. */
  const progress = {
    '2026-08-20': { s: 1, w: 1, z: 0, note: 'SVMs', u: 'T', x: { k1: 1 } },
    '2026-08-21': { s: 1, w: 0, z: 1, u: 'T2' },
  };
  const csv = toCSV(progress, [{ key: 'k1', label: 'Read' }]);
  const [head, ...rows] = csv.trim().split('\n');
  assert.equal(head, 'date,study,workout,sleep,Read,note,updated_at');
  assert.match(rows[0], /^2026-08-20,1,1,0,1,SVMs,T$/);
  assert.match(rows[1], /^2026-08-21,1,0,1,0,,T2$/);
});

test('toCSV without extras is byte-identical to the old format', () => {
  /* Anyone with an existing exported file, or a spreadsheet built on it,
     must not have their columns move. */
  const csv = toCSV({ '2026-08-20': { s: 1, w: 1, z: 0, note: 'x', u: 'T' } });
  assert.equal(csv, 'date,study,workout,sleep,note,updated_at\n2026-08-20,1,1,0,x,T\n');
});

test('an extra tick label containing a comma is quoted', () => {
  const csv = toCSV({}, [{ key: 'k1', label: 'Read, daily' }]);
  assert.match(csv.split('\n')[0], /"Read, daily"/);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Extend `toCSV(progress, extras = [])` in `progress.js`**

Insert the extra columns between `sleep` and `note`, header cells run through the existing `csvField`, values as `1`/`0` read from `rec.x`. Preserve the no-extras output exactly.

- [ ] **Step 4: Build `profileEditor.js`**

A `<dialog>` or a disclosure section — do not add a routing layer. It edits, in order:

- **Season** — a single text input.
- **Ground rules** — add / edit title and body / delete / reorder.
- **Deadlines** — label plus a list of dates; validate `YYYY-MM-DD` and reject a group with no dates, matching `normalizeProfile`.
- **Lanes** — rename; add; delete, **but refuse to delete a lane any schedule block still uses** and say which day uses it. (Until Task 18 there is no schedule to check; write the guard against an injected `usedLaneKeys` set so it is ready and testable.)
- **Ticks** — rename the three core ticks and edit their hints; add an extra via `newTickKey`; delete an extra. **The three core ticks must have no delete control at all** — not a disabled one, and not one that fails on click.

Every change calls `onChange(nextProfile)`, which `app.js` binds to a function that assigns `profile` and calls `commitProfile()`. All text is set with `textContent` and read from `input.value`; nothing is interpolated into `innerHTML`.

- [ ] **Step 5: Render extra ticks in the scorecard**

`app.js` builds the extra tick buttons after the three fixed ones, wires them to `rec.x[key]`, and calls the existing `commit([selDate])`. `renderScorecard` sets `aria-pressed` from `rec.x?.[key]`.

**The streak does not change.** `computeStreak` and `growthVals` keep testing `s && w` only. Confirm no extras reference appears in `progress.js` outside `toCSV`.

Update the export click handler to pass the extras: `toCSV(progress, profile.ticks.filter((t) => !t.core))`.

- [ ] **Step 6: Verify**

Run: `npm test` — expect 163 passing (+3).

In a browser: add a rule, reload, it persists. Add an extra tick, tick it, reload, it is still ticked. **Confirm the streak number did not move when the extra tick was added or ticked.** Export CSV and confirm the new column is present and the three core columns have not shifted.

- [ ] **Step 7: Commit**

```bash
git add profileEditor.js app.js index.html styles.css progress.js test/progress.test.js
git commit -F - <<'MSG'
Let the user edit the profile, and add ticks of their own

Extras are stored per day in daily_progress.extras and defined in the
profile, so renaming a tick touches no logged row.

They deliberately do not feed the streak. If they did, adding a tick in
September would retroactively change whether August was complete, and every
stored day would quietly change meaning. computeStreak and growthVals still
test study && workout and nothing else.

toCSV gains a column per extra, between sleep and note, and its output with
no extras is byte-identical to before — anyone with an exported file or a
spreadsheet built on one keeps their columns where they were.

The three core ticks have no delete control rather than a disabled one. They
map to real columns and to the streak rule; offering an action that cannot
succeed is worse than not offering it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

# Phase 5 — The week

## Task 17: `schedule.js` stops containing a week

**Files:**
- Modify: `schedule.js`
- Test: `test/schedule.test.js`

**Interfaces:**
- Consumes: nothing. Stays pure and import-free.
- Produces: `DAY_KEYS`, `istNow(date?)`, `istDateISO(date?)` (all unchanged); `emptyWeek() → Week`; `minutesToLabel(m) → string`; `formatTime(block) → string`; `resolveNow(week, dayKey, minutes) → {state,dayKey,block}|null`; `validateWeek(week, laneKeys) → {ok, errors: string[]}`. **`WEEK` is removed.**

**Deliberate test replacement.** Roughly half of `test/schedule.test.js` asserts facts about one person's week — that Saturday has a cricket block from 930 to 1170, that Wednesday is the only weekday with two study blocks. Those are assertions about user data and go with `WEEK`. The behavioural tests — inclusive start, exclusive end, gap resolves forward, day rollover, IST correctness — are kept and re-pointed at a fixture. Net count rises, not falls.

- [ ] **Step 1: Rewrite `test/schedule.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_KEYS, istDateISO, istNow, resolveNow, validateWeek,
  emptyWeek, minutesToLabel, formatTime,
} from '../schedule.js';

/* A fixture, not the app's week. The app no longer has one. */
const day = (blocks) => ({ title: '', tag: '', note: '', blocks });
const WEEK = {
  ...Object.fromEntries(DAY_KEYS.map((k) => [k, day([])])),
  thu: day([
    { start: 405, end: 465, label: 'Study', subject: 'Deep Learning', lane: 'focus' },
    { start: 465, end: 525, label: 'Breakfast', lane: 'rest' },
    { start: 1155, end: 1215, label: 'Workout', lane: 'move' },
  ]),
  fri: day([{ start: 390, end: 405, label: 'Wake up', lane: 'rest' }]),
};

test('minutesToLabel keeps the twelve-hour, no-meridiem style already on the page', () => {
  /* The existing schedule reads '9:30 - 6:30' for 570-1110. Changing to a
     24-hour clock here would silently restyle every row. */
  assert.equal(minutesToLabel(405), '6:45');
  assert.equal(minutesToLabel(1110), '6:30');
  assert.equal(minutesToLabel(1380), '11:00');
  assert.equal(minutesToLabel(720), '12:00');
  assert.equal(minutesToLabel(0), '12:00');
});

test('formatTime derives the range and never stores it', () => {
  assert.equal(formatTime({ start: 405, end: 465 }), '6:45 – 7:45');
});

test('formatTime honours an explicit override for a block that is not a range', () => {
  /* 'Morning', '8:15 onwards' — real cases in the schedule this replaces. */
  assert.equal(formatTime({ start: 540, end: 780, timeText: 'Morning' }), 'Morning');
});

test('resolveNow finds the block containing the current minute', () => {
  const r = resolveNow(WEEK, 'thu', 420);
  assert.equal(r.state, 'now');
  assert.equal(r.block.subject, 'Deep Learning');
});

test('a block is inclusive of its start and exclusive of its end', () => {
  assert.equal(resolveNow(WEEK, 'thu', 405).block.label, 'Study');
  assert.equal(resolveNow(WEEK, 'thu', 465).block.label, 'Breakfast');
});

test('a gap reports the next block rather than nothing', () => {
  const r = resolveNow(WEEK, 'thu', 1130);
  assert.equal(r.state, 'next');
  assert.equal(r.block.start, 1155);
});

test('after the last block it rolls into the following day', () => {
  const r = resolveNow(WEEK, 'thu', 1430);
  assert.equal(r.state, 'next');
  assert.equal(r.dayKey, 'fri');
  assert.equal(r.block.start, 390);
});

test('it skips over empty days rather than stopping at the first one', () => {
  /* New and load-bearing: a user may well plan four days and leave three
     blank. The old implementation looked exactly one day ahead, so an empty
     tomorrow produced a crash rather than a Wednesday. */
  const r = resolveNow(WEEK, 'fri', 1439);
  assert.equal(r.state, 'next');
  assert.equal(r.dayKey, 'thu');
  assert.equal(r.block.start, 405);
});

test('an entirely empty week resolves to null instead of looping forever', () => {
  assert.equal(resolveNow(emptyWeek(), 'mon', 600), null);
});

test('resolveNow tolerates a day key the week does not define', () => {
  assert.equal(resolveNow({}, 'mon', 600), null);
});

test('istNow reads Kolkata time regardless of process timezone', () => {
  assert.deepEqual(istNow(new Date('2026-08-20T01:15:00Z')), { dayKey: 'thu', minutes: 405 });
});

test('istNow rolls the weekday forward when UTC is still on the previous day', () => {
  assert.equal(istNow(new Date('2026-08-19T20:00:00Z')).dayKey, 'thu');
});

test('istDateISO files a tick under the Kolkata date, not the device one', () => {
  assert.equal(istDateISO(new Date('2026-08-19T20:00:00Z')), '2026-08-20');
  assert.equal(istDateISO(new Date('2026-08-20T18:29:00Z')), '2026-08-20');
  assert.equal(istDateISO(new Date('2026-08-20T18:30:00Z')), '2026-08-21');
});

const LANES = ['focus', 'rest', 'move'];

test('validateWeek accepts a well-formed week', () => {
  assert.deepEqual(validateWeek(WEEK, LANES), { ok: true, errors: [] });
});

test('validateWeek accepts an entirely empty week', () => {
  /* The state every new account starts in. */
  assert.equal(validateWeek(emptyWeek(), LANES).ok, true);
});

test('validateWeek rejects a block that ends before it starts', () => {
  const w = { ...emptyWeek(), mon: day([{ start: 600, end: 500, label: 'x', lane: 'rest' }]) };
  assert.equal(validateWeek(w, LANES).ok, false);
  assert.match(validateWeek(w, LANES).errors[0], /mon/);
});

test('validateWeek rejects minutes outside the day', () => {
  for (const b of [{ start: -1, end: 60 }, { start: 0, end: 1441 }]) {
    const w = { ...emptyWeek(), mon: day([{ ...b, label: 'x', lane: 'rest' }]) };
    assert.equal(validateWeek(w, LANES).ok, false);
  }
});

test('validateWeek rejects overlapping blocks', () => {
  const w = { ...emptyWeek(), mon: day([
    { start: 400, end: 500, label: 'a', lane: 'rest' },
    { start: 450, end: 600, label: 'b', lane: 'rest' },
  ]) };
  assert.equal(validateWeek(w, LANES).ok, false);
  assert.match(validateWeek(w, LANES).errors[0], /overlap/i);
});

test('validateWeek rejects a lane the profile does not define', () => {
  /* The check that matters most in the next project: a language model will
     invent a lane name, and an unknown lane renders as an uncoloured,
     unlabelled dot. */
  const w = { ...emptyWeek(), mon: day([{ start: 0, end: 60, label: 'x', lane: 'cricket' }]) };
  assert.equal(validateWeek(w, LANES).ok, false);
  assert.match(validateWeek(w, LANES).errors[0], /cricket/);
});

test('validateWeek rejects a block with no label', () => {
  const w = { ...emptyWeek(), mon: day([{ start: 0, end: 60, label: '  ', lane: 'rest' }]) };
  assert.equal(validateWeek(w, LANES).ok, false);
});

test('validateWeek reports every problem, not just the first', () => {
  /* An editor showing one error at a time turns fixing an AI-generated week
     into a guessing game. */
  const w = { ...emptyWeek(), mon: day([
    { start: 100, end: 50, label: '', lane: 'nope' },
  ]) };
  assert.ok(validateWeek(w, LANES).errors.length >= 3);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Rewrite `schedule.js`**

Delete `WEEK` and its helper constants entirely. Keep `DAY_KEYS`, `istNow`, `istDateISO` byte-for-byte — they are correct and their comments explain hard-won detail. Add:

```js
export const emptyWeek = () =>
  Object.fromEntries(DAY_KEYS.map((k) => [k, { title: '', tag: '', note: '', blocks: [] }]));

/* Twelve-hour, no meridiem — the style already on the page ('9:30 – 6:30').
   A 24-hour clock here would silently restyle every row in the app. */
export function minutesToLabel(m) {
  const h = Math.floor(m / 60) % 12;
  return `${h === 0 ? 12 : h}:${String(m % 60).padStart(2, '0')}`;
}

/* Derived, never stored. A stored display string is a second source of truth
   for the same fact, and in the next project that fact comes from a language
   model — which will eventually emit a time contradicting its own start. */
export const formatTime = (b) =>
  b.timeText ? b.timeText : `${minutesToLabel(b.start)} – ${minutesToLabel(b.end)}`;

export function resolveNow(week, dayKey, minutes) {
  const blocks = week?.[dayKey]?.blocks || [];
  const current = blocks.find((b) => minutes >= b.start && minutes < b.end);
  if (current) return { state: 'now', dayKey, block: current };

  const upcoming = blocks.find((b) => b.start > minutes);
  if (upcoming) return { state: 'next', dayKey, block: upcoming };

  /* Walk forward for a day that actually has something in it. A user may
     plan four days and leave three blank, so looking exactly one day ahead —
     which is all the old single-week version needed — is not enough. */
  for (let i = 1; i <= 7; i++) {
    const key = DAY_KEYS[(DAY_KEYS.indexOf(dayKey) + i) % 7];
    const first = week?.[key]?.blocks?.[0];
    if (first) return { state: 'next', dayKey: key, block: first };
  }
  return null;                     /* nothing planned anywhere */
}

export function validateWeek(week, laneKeys) {
  const lanes = new Set(laneKeys || []);
  const errors = [];
  for (const key of DAY_KEYS) {
    const blocks = week?.[key]?.blocks;
    if (blocks === undefined) continue;
    if (!Array.isArray(blocks)) { errors.push(`${key}: blocks is not a list`); continue; }
    let prevEnd = -1;
    blocks.forEach((b, i) => {
      const at = `${key}[${i}]`;
      if (!Number.isInteger(b?.start) || !Number.isInteger(b?.end)) errors.push(`${at}: start and end must be whole minutes`);
      else {
        if (b.start < 0 || b.end > 1440) errors.push(`${at}: outside the day`);
        if (b.end <= b.start) errors.push(`${at}: ends before it starts`);
        if (b.start < prevEnd) errors.push(`${at}: overlaps the previous block`);
        prevEnd = b.end;
      }
      if (!String(b?.label || '').trim()) errors.push(`${at}: needs a label`);
      if (!lanes.has(b?.lane)) errors.push(`${at}: unknown lane "${b?.lane}"`);
    });
  }
  /* Every problem, not the first. Fixing a generated week one error at a
     time is a guessing game. */
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Verify**

Run: `npm test` — expect 168 passing (−16 week-specific, +21 behavioural). `app.js` will not yet compile against this; that is Task 18. **Do not patch `app.js` here** — keeping the two changes in separate commits is what makes either reviewable.

- [ ] **Step 5: Commit**

```bash
git add schedule.js test/schedule.test.js
git commit -F - <<'MSG'
Make schedule.js pure functions over a week rather than a week

Half of the old test file asserted facts about one person's life — that
Saturday holds a cricket match from 15:30 to 19:30, that Wednesday is the
only weekday with two study blocks. Those were assertions about user data and
they leave with the constant. The behavioural tests are kept and re-pointed
at a fixture, so inclusive-start, exclusive-end, gap-resolves-forward, day
rollover and the IST rules are all still covered.

resolveNow now walks forward for a day that has something in it. The old
version looked exactly one day ahead, which was sufficient when every day was
guaranteed full and is not once a user can plan four days and leave three
blank. An entirely empty week returns null rather than looping.

The display time is derived from start and end rather than stored beside
them. Two sources of truth for one fact is a bug waiting for a disagreement,
and in the next project that fact arrives from a language model.

validateWeek reports every problem rather than the first, because fixing a
generated week one error per attempt is a guessing game.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 18: The week as a stored document

**Files:**
- Modify: `app.js`, `index.html`
- Test: none new (DOM + wiring; the logic under it is covered by Task 17)

**Interfaces:**
- Consumes: `emptyWeek`, `resolveNow`, `formatTime`, `validateWeek` (Task 17); `loadDoc`/`saveDoc`/`markDocPending` (Task 14); `pullDoc`/`pushDoc` (Task 12).
- Produces: module-level `week` and `scheduleDoc` in `app.js`, plus `commitSchedule()`.

- [ ] **Step 1: Load the week alongside the profile**

Mirror the profile exactly. In `startApp()`:

```js
scheduleDoc = loadDoc('schedule');
week = scheduleDoc?.value && validateWeek(scheduleDoc.value, profile.lanes.map((l) => l.key)).ok
  ? scheduleDoc.value
  : emptyWeek();
```

An invalid stored week falls back to empty rather than rendering — a half-broken schedule is harder to recover from than an obviously empty one, and the editor can still repair it from the raw document.

`commitSchedule()` mirrors `commitProfile()`. Extend Task 14's `docFor` to
`(k) => (k === 'profile' ? profileDoc : k === 'schedule' ? scheduleDoc : null)`;
the flush loop itself does not change.

- [ ] **Step 2: Render from the document**

`rowHTML` takes the lane label from `profile.lanes` rather than the deleted `LANE_LABELS` constant, and its time cell comes from `formatTime(block)`.

**`rowHTML` currently builds its string with `innerHTML`, and every field in it is now user-authored.** Rewrite `renderDay` to build rows with `createElement` and `textContent`, the way `renderWeek` already builds the notes list. This is not optional and it is the security-relevant change in this task.

- [ ] **Step 3: Empty states**

- A day with no blocks: "Nothing planned for Thursday yet." plus the editor's add control.
- An entirely empty week: the day tabs still render; the panel carries a single call to action.
- `renderNow` with `resolveNow` returning `null`: the pill reads "Nothing scheduled" rather than throwing. **Check `nowKey` still short-circuits correctly** — it is built from `state|dayKey|blockDay|block.start` and `block` is now nullable.

- [ ] **Step 4: Verify**

Run: `npm test` — expect 168 passing.
Run: `node --check app.js`

In a browser with an empty week: every day tab renders its empty state, the NOW pill says nothing is scheduled, and there are no console errors. Then paste a valid week into `wi:<uid>:schedule` via DevTools, reload, and confirm the rows render with derived times.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -F - <<'MSG'
Render the week from a stored document

renderDay built its rows by string concatenation into innerHTML. Every field
in those rows is now typed by a user, so the rows are built with createElement
and textContent instead. With a session token in localStorage this is the
control protecting the session, and this commit is where the schedule stops
being our markup and becomes someone's input.

An invalid stored week falls back to empty rather than rendering what it can.
A half-broken schedule is harder to recognise and harder to recover from than
an obviously empty one, and the raw document is still there for the editor to
repair.

resolveNow can now return null, so the NOW pill has a fourth state. The
nowKey short-circuit that keeps VoiceOver from re-announcing every minute is
built from the block, so it had to learn about that too.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 19: The week editor

**Files:**
- Create: `weekEditor.js`
- Modify: `app.js`, `index.html`, `styles.css`

**Interfaces:**
- Consumes: `validateWeek`, `formatTime`, `minutesToLabel`, `DAY_KEYS` (Task 17); `profile.lanes`; `commitSchedule` (Task 18).
- Produces: `mountWeekEditor({ root, getWeek, getLanes, onChange }) → void`; `parseTimeInput(text) → number|null` (exported for testing).

- [ ] **Step 1: Write the failing tests for the one piece with real logic**

Create `test/weekEditor.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeInput } from '../weekEditor.js';

test('parseTimeInput accepts the twelve-hour style the page displays', () => {
  assert.equal(parseTimeInput('6:45 am'), 405);
  assert.equal(parseTimeInput('6:45 pm'), 1125);
  assert.equal(parseTimeInput('12:00 am'), 0);
  assert.equal(parseTimeInput('12:00 pm'), 720);
});

test('parseTimeInput accepts a 24-hour value too', () => {
  /* An <input type="time"> hands back '18:30' regardless of what the page
     displays, so both spellings have to parse. */
  assert.equal(parseTimeInput('18:30'), 1110);
  assert.equal(parseTimeInput('06:45'), 405);
});

test('parseTimeInput rejects nonsense rather than guessing', () => {
  for (const bad of ['', 'later', '25:00', '6:75', '-1:00', null, undefined]) {
    assert.equal(parseTimeInput(bad), null, `accepted ${bad}`);
  }
});

test('midnight at the end of a day is 1440, not 0', () => {
  /* A block running to midnight must not end before it starts. */
  assert.equal(parseTimeInput('24:00'), 1440);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Build `weekEditor.js`**

Per day: a list of blocks with add / edit / delete. Each block edits label, optional subject, optional detail, lane (a `<select>` over `profile.lanes`), start and end (`<input type="time">`), and an optional `timeText` override.

Rules:
- Blocks are **re-sorted by `start` on every change** — no manual reordering control, because the order is a fact about the times rather than a separate preference.
- On save, run `validateWeek` and show **every** error, next to the block it belongs to. Do not save an invalid week.
- Deleting the last block of a day leaves that day's empty state, not a broken day.
- All text via `textContent` / `input.value`.

- [ ] **Step 4: Wire the lane-deletion guard from Task 16**

`mountProfileEditor`'s `getLaneUsage` now has a real source: change `app.js` to pass `(laneKey) => new Set(DAY_KEYS.filter((k) => (week[k]?.blocks || []).some((b) => b.lane === laneKey)).map((k) => week[k]?.title || k))` — filtered to the days that actually use THIS lane, and named by each day's own user-authored title (falling back to its key only if a day has none), so the refusal names the day the way the user named it. Deleting a lane in use must be refused, naming a day that uses it.

- [ ] **Step 5: Verify**

Run: `npm test` — expect 172 passing (+4).

In a browser: build a three-block Monday, reload, it persists. Add an overlapping block and confirm it is refused with a message naming the overlap. Delete every block and confirm the empty state returns. Then confirm the NOW pill picks up a block you just added without a reload.

- [ ] **Step 6: Commit**

```bash
git add weekEditor.js app.js index.html styles.css test/weekEditor.test.js
git commit -F - <<'MSG'
Let the week be edited by hand

The editor is needed whether or not a schedule was generated: the next
project hands the week to a language model, and the useful response to one
wrong block is to fix that block, not to regenerate the week and lose the six
that were right.

Blocks re-sort by start time on every change rather than offering a reorder
control. Their order is a fact about their times, and letting the two
disagree would mean deciding which one the timeline believes.

parseTimeInput takes both spellings. The page displays twelve-hour times with
no meridiem, and <input type="time"> returns twenty-four-hour values
regardless, so anything that reads the field has to accept both. 24:00 parses
to 1440 rather than 0, or a block running to midnight would end before it
started.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

# Phase 6 — Onboarding and finish

## Task 20: The multi-step wizard

**Files:**
- Create: `onboarding.js`
- Modify: `profile.js`, `app.js`, `index.html`, `styles.css`
- Test: `test/profile.test.js`, `test/onboarding.test.js`

**Interfaces:**
- Consumes: `defaultProfile`, `normalizeProfile`, `newTickKey` (Task 11); `commitProfile` (Task 14).
- Produces: `STEPS` (ordered step descriptors), `stepValid(stepId, draft) → boolean`, `applyStep(draft, stepId, values) → Profile`, `mountOnboarding({ root, onDone }) → void`; and `profile.intent` added to the document shape.

**Why `intent` is collected now and used later.** This wizard is the form the schedule generator will read. Collecting wake time, sleep time, fixed commitments and goals here means project B adds a generation step rather than a second onboarding. It is stored, normalised and exported from day one; nothing in A reads it, and that is stated rather than hidden.

- [ ] **Step 1: Add `intent` to the profile, with tests**

Append to `test/profile.test.js`:

```js
test('a new profile has an empty intent rather than no intent', () => {
  /* The generator in the next project reads this. An absent key would make
     every caller there write the same guard. */
  const p = defaultProfile();
  assert.deepEqual(p.intent, { wake: null, sleep: null, busy: [], goals: '' });
});

test('normalizeProfile keeps wake and sleep only as whole minutes in range', () => {
  assert.equal(normalizeProfile({ intent: { wake: 390 } }).intent.wake, 390);
  for (const bad of ['6:30', -1, 1441, 6.5, null]) {
    assert.equal(normalizeProfile({ intent: { wake: bad } }).intent.wake, null, `accepted ${bad}`);
  }
});

test('normalizeProfile keeps only well-formed commitments', () => {
  const p = normalizeProfile({ intent: { busy: [
    { label: 'Work', days: ['mon', 'nope'], start: 570, end: 1110 },
    { label: '', days: ['tue'], start: 0, end: 60 },
    { label: 'Bad', days: ['wed'], start: 600, end: 500 },
  ] } });
  assert.equal(p.intent.busy.length, 1);
  assert.deepEqual(p.intent.busy[0].days, ['mon']);
});
```

Implement in `normalizeProfile`: `wake`/`sleep` must be integers in `[0, 1440]`, else `null`; `busy` entries need a label, at least one valid day key from `DAY_KEYS`, and `end > start`; `goals` is a trimmed string. **`profile.js` must stay import-free** — inline the seven day keys with a comment rather than importing `DAY_KEYS` from `schedule.js`.

- [ ] **Step 2: Write `test/onboarding.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, stepValid, applyStep } from '../onboarding.js';
import { defaultProfile } from '../profile.js';

test('the steps are ordered and each has an id and a title', () => {
  assert.ok(STEPS.length >= 4);
  for (const s of STEPS) {
    assert.equal(typeof s.id, 'string');
    assert.equal(typeof s.title, 'string');
  }
  assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length);
});

test('only the rhythm step can block progress', () => {
  /* Everything else is genuinely optional. A wizard that refuses to advance
     until you have invented a ground rule is how people abandon setup. */
  const draft = defaultProfile();
  for (const s of STEPS) {
    if (s.id === 'rhythm') continue;
    assert.equal(stepValid(s.id, draft), true, `${s.id} blocked an empty draft`);
  }
});

test('the rhythm step needs a wake time and a sleep time', () => {
  const draft = defaultProfile();
  assert.equal(stepValid('rhythm', draft), false);
  draft.intent.wake = 390;
  assert.equal(stepValid('rhythm', draft), false);
  draft.intent.sleep = 1380;
  assert.equal(stepValid('rhythm', draft), true);
});

test('applyStep returns a new normalised profile and does not mutate the draft', () => {
  const draft = defaultProfile();
  const next = applyStep(draft, 'basics', { season: '  Season 2026  ' });
  assert.equal(next.season, 'Season 2026');
  assert.equal(draft.season, '');
});

test('applyStep on the ticks step renames a core tick without removing it', () => {
  const next = applyStep(defaultProfile(), 'ticks', { labels: { s: 'Study hour' } });
  assert.equal(next.ticks.find((t) => t.key === 's').label, 'Study hour');
  assert.equal(next.ticks.filter((t) => t.core).length, 3);
});

test('applyStep ignores a step id it does not know rather than clearing the draft', () => {
  const draft = applyStep(defaultProfile(), 'basics', { season: 'S' });
  assert.deepEqual(applyStep(draft, 'nonsense', { anything: 1 }), draft);
});
```

- [ ] **Step 3: Run and confirm failure.**

- [ ] **Step 4: Build `onboarding.js`**

`STEPS`, in order:

| id | Asks | Blocking |
| --- | --- | --- |
| `basics` | What to call this season | no |
| `rhythm` | Wake time, sleep time, fixed commitments (label, days, hours) | **yes** |
| `ticks` | Confirm or rename the three core ticks; add extras | no |
| `lanes` | Rename or add lanes | no |
| `deadlines` | Exams, submissions, anything with a date | no |
| `rules` | Ground rules, in your own words | no |
| `done` | What happens next | no |

`applyStep` is a pure switch returning `normalizeProfile(next)`. `mountOnboarding` renders one step at a time with Back/Next, a progress indicator, and a **Skip setup** control that marks `onboarded: true` with defaults — someone who wants to look around first must not be trapped in a form.

The `done` step, in A, offers "Build my week" (opens the week editor). **This is the single step project B replaces**, and the code should carry a comment saying so.

- [ ] **Step 5: Trigger it from `app.js`**

After the init pull, if `!profile.onboarded`, mount the wizard over the app. On completion: `commitProfile()`, unmount, render.

Use `profile.onboarded`, **not** "is the profile empty" — a user who deliberately clears everything must not be dragged back through setup on the next launch.

- [ ] **Step 6: Verify**

Run: `npm test` — expect 181 passing (+9).

In a browser, with a second Google account: sign in → the wizard appears → walk it → land on an app carrying your own words. Sign out, sign in again: **no wizard**. Then check the first account is untouched.

- [ ] **Step 7: Commit**

```bash
git add onboarding.js profile.js app.js index.html styles.css test/profile.test.js test/onboarding.test.js
git commit -F - <<'MSG'
Ask a new account who they are, once

Only the rhythm step blocks progress, and only because wake and sleep times
are what every other decision hangs off. Everything else can be skipped and
filled in later — a wizard that will not advance until you have invented a
ground rule is how setup gets abandoned.

intent is collected here and read by nothing in this project. That is
deliberate and worth stating plainly: it is the input the schedule generator
needs, so gathering it now means the next project adds a step to this wizard
rather than a second one beside it.

The trigger is profile.onboarded rather than "the profile looks empty".
Someone who deliberately clears everything out should not be dragged back
through setup on their next launch.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Task 21: Shell, docs, and the acceptance run

**Files:**
- Modify: `sw.js`, `README.md`, `config.example.js`

- [ ] **Step 1: Bring the service worker up to date**

`SHELL` must list every module the app imports: `./`, `./styles.css`, `./app.js`, `./auth.js`, `./profile.js`, `./profileEditor.js`, `./weekEditor.js`, `./onboarding.js`, `./deadlines.js`, `./schedule.js`, `./storage.js`, `./sync.js`, `./progress.js`. `./exams.js` must be gone.

Bump `CACHE` to `weekly-innings-v7`. **Verify the list against the actual imports rather than against this plan:**

```bash
grep -ho "from '\./[a-z-]*\.js'" *.js | sort -u
```

Every file listed there must appear in `SHELL`. A module missing from the shell means the app half-loads offline, which is worse than not loading.

- [ ] **Step 2: Rewrite the README's setup section**

Replace the single-user instructions with: the Google Cloud OAuth steps, the Supabase provider and redirect-allow-list steps, the two environment variables (`SUPABASE_URL`/`PROJECT_URL`, `SUPABASE_ANON_KEY`/`PUBLIC_KEY` — `USER_ID` is gone), and the schema application order. State plainly that the app has real accounts now and that the anon key alone grants nothing.

- [ ] **Step 3: Restore the owner's content as data, not code**

The rules, season line and deadlines captured in Task 15 go back in through the profile editor, or via the console with the scratch file:

```js
// DevTools console, signed in as the owner.
// The file lives in the session scratchpad and is deliberately not committed:
// it is one person's content, which is the thing this project just removed
// from the codebase.
const seed = /* paste the captured JSON */;
localStorage.setItem(`wi:${JSON.parse(localStorage['wi:session']).user_id}:profile`,
  JSON.stringify({ value: seed, u: new Date().toISOString() }));
location.reload();
```

Then rebuild the week in the editor and confirm it syncs to the other device.

- [ ] **Step 4: Run the spec's success criteria — all six**

These are the acceptance gate. Record the actual output of each; do not report this task complete on any that were not run.

1. **A second account cannot see the first's data** — with account B's access token, `GET /rest/v1/daily_progress?select=*` returns only B's rows. Verify by token, not by looking at the UI.
2. **The owner's history survived** — the streak and calendar match the numbers recorded in Task 7 step 2.
3. **The anon key alone gets nothing** — the Task 10 step 6 check, re-run.
4. **Offline works** — signed in, aeroplane mode, force-quit, relaunch: the app opens, renders and accepts a tick; the tick syncs on reconnect.
5. **A token expiring mid-session loses nothing** — in DevTools set `wi:session`'s `expires_at` to `1`, then tick a day. Expect one refresh, the tick saved, no visible error.
6. **`npm test` green and no runtime dependencies** — `npm test`, then `node -e "const p=require('./package.json'); console.log(p.dependencies, p.devDependencies)"` must print `undefined undefined`.

- [ ] **Step 5: Commit and open the PR**

```bash
git add sw.js README.md config.example.js
git commit -F - <<'MSG'
Cache the new shell and document real setup

The shell list was verified against the app's actual imports rather than
against the plan. A module missing from it means the app half-loads offline,
which fails worse than not loading at all.

The README's setup section described a single-user app with a hardcoded
USER_ID. It now describes the Google Cloud client, the Supabase provider and
the redirect allow list — the last of which is the most common way this flow
fails, because an unlisted URL is rejected without explanation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG

git push -u origin multi-user
```

---

## Deferred, deliberately

Recorded so the next spec starts from what was decided, not from memory:

- **B — AI schedule generation.** A Vercel serverless function holding `MISTRAL_API_KEY`, called with plain `fetch` — no LangChain, no dependencies. Reads `profile.intent`, returns a week, and that week goes through `validateWeek` before it is stored: schema-valid JSON can still be a nonsense schedule. Replaces the `done` step of the onboarding wizard. **Must be gated on a logged-in user and rate-limited from its first deploy** — it spends the project owner's credits, and an open endpoint on a public URL is a bill.
- **C — Extras.** Exam mode (the week shifts during a user's own deadline windows), a weekly review reading the last seven days of ticks and notes, and a "never miss twice" nudge.
- **Guest mode** — considered and declined for A. One code path, and none of the merge-on-first-login data loss.
- **Block reminders** — need web-push, VAPID keys, a subscription table and a scheduler. A project, not a feature.
