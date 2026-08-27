import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRow, fromRows, pull, push, normalizeBase, authedFetch, isAuthError } from '../sync.js';

const tok = (t = 'AT') => async () => t;

test('normalizeBase strips the /rest/v1 suffix the dashboard includes', () => {
  assert.equal(normalizeBase('https://abc.supabase.co/rest/v1/'), 'https://abc.supabase.co');
  assert.equal(normalizeBase('https://abc.supabase.co/rest/v1'), 'https://abc.supabase.co');
});

test('normalizeBase strips a bare trailing slash', () => {
  assert.equal(normalizeBase('https://abc.supabase.co/'), 'https://abc.supabase.co');
});

test('normalizeBase leaves an already-clean URL alone', () => {
  assert.equal(normalizeBase('https://abc.supabase.co'), 'https://abc.supabase.co');
});

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

test('toRow sends an explicit updated_at even when the record lacks one', () => {
  const row = toRow('2026-08-20', { s: 1 });
  assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('fromRows maps columns back to short keys', () => {
  const p = fromRows([{
    date: '2026-08-20', study: true, workout: false, sleep: true,
    note: null, updated_at: '2026-08-20T12:00:00.000Z',
  }]);
  assert.deepEqual(p, {
    '2026-08-20': { s: 1, w: 0, z: 1, note: '', x: {}, u: '2026-08-20T12:00:00.000Z' },
  });
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

test('push sends one batched upsert for all dates', async () => {
  let body;
  const fetchImpl = async (_url, opts) => { body = JSON.parse(opts.body); return { ok: true, text: async () => '' }; };
  await push(
    { '2026-08-20': { s: 1, u: 'a' }, '2026-08-21': { w: 1, u: 'b' } },
    ['2026-08-20', '2026-08-21'],
    { fetchImpl, getToken: tok() }
  );
  assert.equal(body.length, 2);
  assert.deepEqual(body.map((r) => r.date).sort(), ['2026-08-20', '2026-08-21']);
});

test('push asks PostgREST to merge duplicates rather than insert', async () => {
  let headers;
  const fetchImpl = async (_url, opts) => { headers = opts.headers; return { ok: true, text: async () => '' }; };
  await push({ '2026-08-20': { s: 1 } }, ['2026-08-20'], { fetchImpl, getToken: tok() });
  assert.match(headers.Prefer, /resolution=merge-duplicates/);
});

test('push throws on a non-2xx so the caller can requeue', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'no' });
  await assert.rejects(
    () => push({ '2026-08-20': { s: 1 } }, ['2026-08-20'], { fetchImpl, getToken: tok() }),
    /401/
  );
});

test('push with no dates makes no request at all', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, text: async () => '' }; };
  await push({}, [], { fetchImpl, getToken: tok() });
  assert.equal(called, false);
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

test('fromRows canonicalises PostgREST timestamps to the client format', () => {
  const fromPg = fromRows([{ date: '2026-08-20', study: true, workout: false, sleep: false, note: null, updated_at: '2026-08-20T12:00:00+00:00' }]);
  const fromJs = fromRows([{ date: '2026-08-20', study: true, workout: false, sleep: false, note: null, updated_at: '2026-08-20T12:00:00.000Z' }]);
  assert.equal(fromPg['2026-08-20'].u, fromJs['2026-08-20'].u);
  assert.equal(fromPg['2026-08-20'].u, '2026-08-20T12:00:00.000Z');
});

test('fromRows passes through a timestamp it cannot parse instead of throwing', () => {
  let p;
  assert.doesNotThrow(() => {
    p = fromRows([{ date: '2026-08-20', study: true, workout: false, sleep: false, note: null, updated_at: 'x' }]);
  });
  assert.equal(p['2026-08-20'].u, 'x');
});

test('a missing timestamp becomes empty so the record loses a merge', () => {
  const p = fromRows([{ date: '2026-08-20', study: true, workout: false, sleep: false, note: null, updated_at: null }]);
  assert.equal(p['2026-08-20'].u, '');
});

test('isAuthError recognises the dead-session error and nothing else', () => {
  /* flushSync's catch (app.js) needs to tell a revoked session from a flaky
     connection so it can stop retrying the one no retry will ever fix. A
     loose check (message contains "sign", instanceof TypeError, etc.) would
     also catch a real network failure and silently swallow retries for it. */
  assert.equal(isAuthError(new Error('not signed in')), true);
  assert.equal(isAuthError(new TypeError('Failed to fetch')), false);
  assert.equal(isAuthError(new Error('pull failed: 500')), false);
  assert.equal(isAuthError('not signed in'), false, 'a bare string is not an Error');
  assert.equal(isAuthError(null), false);
});

test('authedFetch throws an error isAuthError recognises when there is no token', async () => {
  await assert.rejects(
    () => authedFetch('https://x/y', {}, { getToken: async () => null }),
    (err) => isAuthError(err)
  );
});
