import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRow, fromRows, pull, push, normalizeBase } from '../sync.js';
import { USER_ID } from '../config.js';

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

test('toRow maps short client keys onto column names', () => {
  const row = toRow('2026-08-20', { s: 1, w: 0, z: 1, note: 'SVMs', u: '2026-08-20T12:00:00.000Z' });
  assert.deepEqual(row, {
    date: '2026-08-20',
    study: true,
    workout: false,
    sleep: true,
    note: 'SVMs',
    updated_at: '2026-08-20T12:00:00.000Z',
    user_id: USER_ID,
  });
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
    '2026-08-20': { s: 1, w: 0, z: 1, note: '', u: '2026-08-20T12:00:00.000Z' },
  });
});

test('pull requests only this user and returns a progress object', async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return {
      ok: true,
      json: async () => ([{ date: '2026-08-20', study: true, workout: true, sleep: false, note: null, updated_at: 'x' }]),
    };
  };
  const p = await pull({ fetchImpl });
  assert.match(seen.url, /\/rest\/v1\/daily_progress\?select=\*&user_id=eq\./);
  assert.equal(seen.opts.headers.apikey.length > 0, true);
  assert.deepEqual(p['2026-08-20'].w, 1);
});

test('push sends one batched upsert for all dates', async () => {
  let body;
  const fetchImpl = async (_url, opts) => { body = JSON.parse(opts.body); return { ok: true, text: async () => '' }; };
  await push(
    { '2026-08-20': { s: 1, u: 'a' }, '2026-08-21': { w: 1, u: 'b' } },
    ['2026-08-20', '2026-08-21'],
    { fetchImpl }
  );
  assert.equal(body.length, 2);
  assert.deepEqual(body.map((r) => r.date).sort(), ['2026-08-20', '2026-08-21']);
});

test('push asks PostgREST to merge duplicates rather than insert', async () => {
  let headers;
  const fetchImpl = async (_url, opts) => { headers = opts.headers; return { ok: true, text: async () => '' }; };
  await push({ '2026-08-20': { s: 1 } }, ['2026-08-20'], { fetchImpl });
  assert.match(headers.Prefer, /resolution=merge-duplicates/);
});

test('push throws on a non-2xx so the caller can requeue', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'no' });
  await assert.rejects(
    () => push({ '2026-08-20': { s: 1 } }, ['2026-08-20'], { fetchImpl }),
    /401/
  );
});

test('push with no dates makes no request at all', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, text: async () => '' }; };
  await push({}, [], { fetchImpl });
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
