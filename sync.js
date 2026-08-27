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

/* Thrown by authedFetch when there is no session to attach a token from —
   never for a request that was sent and failed. Callers that need to tell a
   dead session from a flaky connection (app.js's flushSync) branch on this
   exact message via isAuthError rather than re-deriving it, so the two stay
   in sync by construction. */
export const AUTH_ERROR_MESSAGE = 'not signed in';
export const isAuthError = (err) => err instanceof Error && err.message === AUTH_ERROR_MESSAGE;

/* PostgREST can reject a token this client still believes in — a clock skew,
   or simply an app left open past the hour. One forced refresh and one retry;
   a second 401 is a real failure and is thrown, because retrying it again
   would be a loop rather than a recovery. */
export async function authedFetch(url, opts = {}, { fetchImpl = globalThis.fetch, getToken = accessToken } = {}) {
  let token = await getToken();
  if (!token) throw new Error(AUTH_ERROR_MESSAGE);
  let res = await fetchImpl(url, { ...opts, headers: headers(token, opts.headers), ...deadline() });
  if (res.status !== 401) return res;
  token = await getToken({ force: true });
  if (!token) throw new Error(AUTH_ERROR_MESSAGE);
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
  /* JSON.stringify DROPS an undefined value rather than erroring, so without
     this the field would simply be missing from the body and the write would
     look like it succeeded. updated_at carries no column default precisely so
     a stale offline edit cannot outrank a newer one; a silently absent one
     hands that protection back. */
  if (updatedAt == null) throw new Error(`push ${kind} failed: no timestamp`);
  /* on_conflict names the target explicitly. PostgREST's default upsert
     "operates based on the primary key columns, so you must specify all of
     them" — and we deliberately do not send user_id, because it defaults to
     auth.uid() and the client has no business asserting whose row this is.
     Naming the target in the query string satisfies the rule without putting
     a uid in the body. */
  const res = await authedFetch(`${BASE}/rest/v1/${table}?on_conflict=user_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ [field]: value, updated_at: updatedAt }),
  }, opts);
  if (!res.ok) {
    /* Read the body in its own right. Awaiting it inside the throw meant a
       body that failed to read replaced the real error with its own, losing
       both the status and which document it was. */
    let detail = '';
    try { detail = await res.text(); } catch { /* keep the status */ }
    throw new Error(`push ${kind} failed: ${res.status} ${detail}`.trim());
  }
}
