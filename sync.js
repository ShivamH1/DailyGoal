/* The Supabase tier, spoken to directly over PostgREST. No SDK: one table,
   two verbs, and a bundle we would otherwise have to cache offline. */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { accessToken } from './auth.js';

const TABLE = 'daily_progress';

/* A captive portal or a dead-zone handoff leaves a request that never settles.
   Without a deadline the init flush is sequenced behind a promise that never
   resolves, and the queued ticks it exists to send stay queued forever. */
const TIMEOUT_MS = 8000;
const deadline = () => (typeof AbortSignal?.timeout === 'function'
  ? { signal: AbortSignal.timeout(TIMEOUT_MS) } : {});

/* The Supabase dashboard shows the project URL with /rest/v1/ already
   appended. We add that path ourselves, so leaving it produces
   /rest/v1//rest/v1/... and every request fails with PGRST125. Defended
   here as well as in tools/make-config.mjs, because the value can also
   arrive from a Vercel environment variable that never passes through the
   generator's normalisation. */
export const normalizeBase = (url) =>
  String(url || '').replace(/\/+$/, '').replace(/(\/rest(\/v1)?)+$/, '');

const BASE = normalizeBase(SUPABASE_URL);

export const isConfigured = () =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('<'));

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
    /* Always explicit. Left to the column default, now() would stamp server
       receipt time, so a tick made offline on Monday and flushed on Wednesday
       would outrank a genuinely newer Tuesday edit from the other device. */
    updated_at: rec.u || new Date().toISOString(),
  };
}

/* PostgREST returns "…+00:00" where the client writes "…Z", and mergeProgress
   compares these as strings — so canonicalise on ingest. A row whose timestamp
   will not parse is passed through untouched rather than thrown on: one bad row
   must not abort the whole pull. Date.parse (not new Date) so that null becomes
   '' rather than the epoch, matching how mergeProgress treats a missing `u`. */
const canonicalTime = (v) => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? (v == null ? '' : String(v)) : new Date(t).toISOString();
};

export function fromRows(rows) {
  const out = {};
  for (const r of rows) {
    out[r.date] = {
      s: r.study ? 1 : 0,
      w: r.workout ? 1 : 0,
      z: r.sleep ? 1 : 0,
      note: r.note || '',
      x: r.extras || {},
      u: canonicalTime(r.updated_at),
    };
  }
  return out;
}

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
