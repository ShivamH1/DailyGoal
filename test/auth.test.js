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
