import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sessionFromTokenResponse, saveSession, loadSession, clearSession,
  expiresSoon, currentUserId,
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

test('clearSession removes the session, and the dead key the OAuth build left', () => {
  /* wi:pkce-verifier is written by no build since the sign-in flow became
     email and password. A device that queued one before updating still has
     it in storage — a secret nothing can ever spend — so signing out on
     that device is what finally takes it away. */
  const store = fakeStore({ 'wi:pkce-verifier': 'v' });
  saveSession({ access_token: 'a', expires_at: 1, user_id: 'u' }, store);
  clearSession(store);
  assert.equal(loadSession(store), null);
  assert.equal(store.getItem('wi:pkce-verifier'), null);
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

test('clearSession does not throw when localStorage is unavailable', () => {
  /* Safari Lockdown Mode, storage fully disabled, or embedded contexts can
     throw a SecurityError when accessing globalThis.localStorage. clearSession
     must never propagate it. */
  const savedStorage = globalThis.localStorage;
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage off'); },
    });
    assert.doesNotThrow(() => clearSession());
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: savedStorage,
    });
  }
});

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

import { authView } from '../auth.js';

test('an unconfigured build says so rather than showing a dead form', () => {
  /* config.js is generated at build time. If it is missing or still holds
     placeholders there is no project to sign in to, and showing the form
     anyway invites someone to type a password into nothing. */
  assert.equal(authView(false, null), 'unconfigured');
  assert.equal(authView(false, { access_token: 'a' }), 'unconfigured');
});

test('no session shows the sign-in gate', () => {
  assert.equal(authView(true, null), 'signed-out');
});

test('a session shows the app', () => {
  assert.equal(authView(true, { access_token: 'a', user_id: 'u' }), 'app');
});

/* ---------- email + password ---------- */
import {
  signIn, signUp, passwordProblem, MIN_PASSWORD,
  CREDENTIALS_MESSAGE, SIGNUP_REFUSED_MESSAGE, RATE_LIMIT_MESSAGE, isCredentialsError,
} from '../auth.js';

const tokenResponse = (body = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u1', email: 'me@test' }, ...body }),
  text: async () => '',
});
const refused = (status, body) => ({ ok: false, status, text: async () => JSON.stringify(body), json: async () => body });

test('signIn exchanges the password for a session and stores it', async () => {
  const store = fakeStore();
  let seen = null;
  const session = await signIn({
    email: ' me@test ', password: 'correct horse',
    base: 'https://p.supabase.co', apikey: 'ANON',
    fetchImpl: async (url, opts) => { seen = { url, opts }; return tokenResponse(); },
    store, now: 0,
  });
  assert.match(seen.url, /\/auth\/v1\/token\?grant_type=password$/);
  assert.equal(seen.opts.headers.apikey, 'ANON');
  /* Trimmed: a keyboard that capitalises and pads is not a different
     account, and the server would treat " me@test " as one. */
  assert.deepEqual(JSON.parse(seen.opts.body), { email: 'me@test', password: 'correct horse' });
  assert.equal(session.access_token, 'AT');
  assert.deepEqual(loadSession(store), session);
});

test('signIn says the same thing for a wrong password as for an unknown email', async () => {
  /* Anything that distinguishes the two turns the sign-in form into a test
     for whether an address has an account here. Supabase answers both with
     the same 400; this pins that we do not decorate one of them. */
  const messages = [];
  for (const body of [{ error: 'invalid_grant', error_description: 'Invalid login credentials' },
                      { error: 'invalid_grant', error_description: 'Email not confirmed' }]) {
    await signIn({
      email: 'me@test', password: 'x'.repeat(MIN_PASSWORD),
      base: 'https://p', apikey: 'A', fetchImpl: async () => refused(400, body), store: fakeStore(), now: 0,
    }).catch((e) => messages.push(e.message));
  }
  assert.equal(messages.length, 2);
  assert.equal(messages[0], messages[1]);
  assert.equal(messages[0], CREDENTIALS_MESSAGE);
});

test('a server that broke is not reported as a wrong password', async () => {
  /* "Email or password is incorrect" sends the user to change something that
     was never wrong. A 500 is ours, not theirs. */
  let err = null;
  await signIn({
    email: 'me@test', password: 'x'.repeat(MIN_PASSWORD),
    base: 'https://p', apikey: 'A', fetchImpl: async () => refused(500, {}), store: fakeStore(), now: 0,
  }).catch((e) => { err = e; });
  assert.ok(err);
  assert.equal(isCredentialsError(err), false);
  assert.doesNotMatch(err.message, /password/i);
});

test('no password reaches storage, on success or on failure', async () => {
  const PASSWORD = 'correct horse battery';
  for (const res of [tokenResponse(), refused(400, {})]) {
    const store = fakeStore();
    await signIn({
      email: 'me@test', password: PASSWORD, base: 'https://p', apikey: 'A',
      fetchImpl: async () => res, store, now: 0,
    }).catch(() => {});
    assert.doesNotMatch(JSON.stringify(store._dump()), /correct horse/);
  }
});

test('signUp returns a session when the project confirms accounts itself', async () => {
  const store = fakeStore();
  let seen = null;
  const { session, needsConfirmation } = await signUp({
    email: 'new@test', password: 'x'.repeat(MIN_PASSWORD),
    base: 'https://p.supabase.co', apikey: 'ANON',
    fetchImpl: async (url, opts) => { seen = { url, opts }; return tokenResponse(); },
    store, now: 0,
  });
  assert.match(seen.url, /\/auth\/v1\/signup$/);
  assert.equal(needsConfirmation, false);
  assert.equal(session.access_token, 'AT');
  assert.deepEqual(loadSession(store), session);
});

test('signUp reports a pending confirmation rather than inventing a session', async () => {
  /* With confirmation on, the signup response carries a user and no token.
     Storing anything there would sign in an account that cannot yet act,
     and the form has to say "check your email" instead. */
  const store = fakeStore();
  const { session, needsConfirmation } = await signUp({
    email: 'new@test', password: 'x'.repeat(MIN_PASSWORD), base: 'https://p', apikey: 'A',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: 'u2', email: 'new@test' }), text: async () => '' }),
    store, now: 0,
  });
  assert.equal(session, null);
  assert.equal(needsConfirmation, true);
  assert.equal(loadSession(store), null);
});

test('a password below the minimum never leaves the device', async () => {
  let sent = false;
  await assert.rejects(signUp({
    email: 'new@test', password: 'x'.repeat(MIN_PASSWORD - 1), base: 'https://p', apikey: 'A',
    fetchImpl: async () => { sent = true; return tokenResponse(); }, store: fakeStore(), now: 0,
  }), new RegExp(`${MIN_PASSWORD} characters`));
  assert.equal(sent, false, 'a doomed password is not put on the wire');
});

test('signUp will not say whether an email is already registered', async () => {
  /* Supabase answers a taken address with 400 "User already registered"
     once auto-confirm is on. Passing that through makes the signup form an
     address-checker, so every refusal reads the same. */
  const messages = [];
  for (const body of [{ msg: 'User already registered' }, { msg: 'Signups not allowed for this instance' }]) {
    await signUp({
      email: 'taken@test', password: 'x'.repeat(MIN_PASSWORD), base: 'https://p', apikey: 'A',
      fetchImpl: async () => refused(400, body), store: fakeStore(), now: 0,
    }).catch((e) => messages.push(e.message));
  }
  assert.deepEqual(messages, [SIGNUP_REFUSED_MESSAGE, SIGNUP_REFUSED_MESSAGE]);
});

test('passwordProblem names the rule, and passes anything long enough', () => {
  assert.match(passwordProblem('short'), new RegExp(`${MIN_PASSWORD} characters`));
  assert.equal(passwordProblem('x'.repeat(MIN_PASSWORD)), '');
  assert.match(passwordProblem(undefined), new RegExp(`${MIN_PASSWORD} characters`));
});

test('being rate-limited is not reported as a wrong password either', async () => {
  /* Supabase throttles repeated attempts with a 429. Reading that as bad
     credentials tells someone who typed their password correctly that they
     did not — and invites them to keep trying, which is the one thing that
     cannot help. Both entry points say the same thing. */
  for (const call of [signIn, signUp]) {
    let err = null;
    await call({
      email: 'me@test', password: 'x'.repeat(MIN_PASSWORD), base: 'https://p', apikey: 'A',
      fetchImpl: async () => refused(429, { msg: 'over_request_rate_limit' }), store: fakeStore(), now: 0,
    }).catch((e) => { err = e; });
    assert.equal(err?.message, RATE_LIMIT_MESSAGE);
    assert.equal(isCredentialsError(err), false);
  }
});
