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
