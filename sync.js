/* The Supabase tier, spoken to directly over PostgREST. No SDK: one table,
   two verbs, and a bundle we would otherwise have to cache offline. */

import { SUPABASE_URL, SUPABASE_ANON_KEY, USER_ID } from './config.js';

const TABLE = 'daily_progress';

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
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && USER_ID && !SUPABASE_URL.includes('<'));

const headers = (extra = {}) => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

export function toRow(date, rec = {}) {
  return {
    date,
    study: !!rec.s,
    workout: !!rec.w,
    sleep: !!rec.z,
    note: rec.note || '',
    /* Always explicit. Left to the column default, now() would stamp server
       receipt time, so a tick made offline on Monday and flushed on Wednesday
       would outrank a genuinely newer Tuesday edit from the other device. */
    updated_at: rec.u || new Date().toISOString(),
    user_id: USER_ID,
  };
}

export function fromRows(rows) {
  const out = {};
  for (const r of rows) {
    out[r.date] = {
      s: r.study ? 1 : 0,
      w: r.workout ? 1 : 0,
      z: r.sleep ? 1 : 0,
      note: r.note || '',
      /* PostgREST returns "…+00:00" while the client writes "…Z". mergeProgress
         compares these as strings, so normalise on ingest rather than relying
         on '+' happening to sort below '.' and every digit. */
      u: new Date(r.updated_at).toISOString(),
    };
  }
  return out;
}

export async function pull({ fetchImpl = globalThis.fetch } = {}) {
  const url = `${BASE}/rest/v1/${TABLE}?select=*&user_id=eq.${USER_ID}`;
  const res = await fetchImpl(url, { headers: headers() });
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  return fromRows(await res.json());
}

export async function push(progress, dates, { fetchImpl = globalThis.fetch } = {}) {
  if (!dates.length) return;
  const body = JSON.stringify(dates.map((d) => toRow(d, progress[d])));
  const res = await fetchImpl(`${BASE}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body,
  });
  if (!res.ok) throw new Error(`push failed: ${res.status} ${await res.text()}`);
}
