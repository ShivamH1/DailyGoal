import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRow, fromRows, pull, push, normalizeBase, authedFetch, isAuthError, pullDoc, pushDoc } from '../sync.js';

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

test('pushDoc does not mutate the document it is given, even when the request fails', async () => {
  /* pushDoc has no local-storage side effects at all — it only ever throws.
     A failed push must not be able to corrupt the caller's in-memory local
     document, which is what keeps local-first "local wins the right to
     exist" true even when the network rejects the write. */
  const value = { season: 'S' };
  const before = JSON.stringify(value);
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await assert.rejects(() => pushDoc('profile', value, 'T', { fetchImpl, getToken: tok() }));
  assert.equal(JSON.stringify(value), before);
});

test('pullDoc makes no request and rejects when there is no token', async () => {
  /* Document reads go through authedFetch rather than a second, ad-hoc auth
     path — so a dead session must fail the same way pull() already does,
     before any request is sent. */
  let called = false;
  await assert.rejects(
    () => pullDoc('profile', { fetchImpl: async () => { called = true; }, getToken: async () => null }),
    (err) => isAuthError(err)
  );
  assert.equal(called, false);
});

test('pushDoc refreshes the token once on a 401 and retries, like push()', async () => {
  /* Proves pushDoc is riding authedFetch's existing refresh-retry rather than
     a bespoke implementation that could drift from it. */
  let calls = 0;
  const fetchImpl = async (_url, opts) => {
    calls++;
    if (calls === 1) return { ok: false, status: 401, text: async () => 'JWT expired' };
    assert.equal(opts.headers.Authorization, 'Bearer NEW');
    return { ok: true, status: 200, text: async () => '' };
  };
  const getToken = async ({ force } = {}) => (force ? 'NEW' : 'OLD');
  await pushDoc('profile', { season: 'S' }, 'T', { fetchImpl, getToken });
  assert.equal(calls, 2);
});

test('pushDoc names its conflict target instead of hoping PostgREST infers it', async () => {
  /* PostgREST's rule: "By default, upsert operates based on the primary key
     columns, so you must specify all of them." We deliberately do not send
     user_id — it is the primary key and defaults to auth.uid(), and the client
     should not be trusted to state whose row this is. Naming the target in the
     query string satisfies the rule without putting the uid in the body. */
  let seen = '';
  const fetchImpl = async (url) => { seen = url; return { ok: true, status: 200 }; };
  await pushDoc('profile', { season: 'x' }, '2026-08-27T00:00:00.000Z',
    { fetchImpl, getToken: async () => 'AT' });
  assert.match(seen, /[?&]on_conflict=user_id\b/);
});

test('pushDoc refuses to send a document with no timestamp', async () => {
  /* updated_at carries no column default precisely so a stale offline edit
     cannot outrank a newer one. JSON.stringify DROPS an undefined value
     rather than erroring, so without this guard the field would simply be
     absent from the body and the write would look like it worked. */
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, status: 200 }; };
  await assert.rejects(
    () => pushDoc('profile', { season: 'x' }, undefined, { fetchImpl, getToken: async () => 'AT' }),
    /timestamp/,
  );
  assert.equal(called, false, 'nothing should reach the network');
});

test('a failing pushDoc still says which document and status when the body cannot be read', async () => {
  /* res.text() sat inside the throw expression, so a body that failed to read
     replaced the real error with its own and lost both the status and which
     document it was. */
  const fetchImpl = async () => ({
    ok: false, status: 500, text: async () => { throw new Error('body blew up'); },
  });
  await assert.rejects(
    () => pushDoc('profile', {}, '2026-08-27T00:00:00.000Z', { fetchImpl, getToken: async () => 'AT' }),
    /push profile failed: 500/,
  );
});
