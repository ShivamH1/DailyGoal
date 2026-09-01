/* The localStorage tier. Always written synchronously on every tick, so the
   app is correct and instant with no network at all. */

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
export const keyFor = (name, ns = namespace) => {
  if (ns) return `wi:${ns}:${name}`;
  /* Only the two pre-account keys have a meaning without a namespace.
     Anything else is a programming error — a document read before sign-in —
     and must be loud, not silently shared. */
  if (LEGACY[name]) return LEGACY[name];
  throw new Error(`no namespace set for "${name}"`);
};

const defaultStore = () => globalThis.localStorage;

function read(key, fallback, store) {
  try {
    const raw = (store || defaultStore()).getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed;
  } catch {
    /* Corrupt payload, private-mode restrictions, disabled storage — none of
       these are worth breaking the page over. Start clean instead. */
    return fallback;
  }
}

function write(key, value, store) {
  try {
    (store || defaultStore()).setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

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

/* Whole documents (profile, schedule) rather than per-date records. Same
   namespacing and the same pending-queue discipline as progress, just keyed
   by document kind instead of date. */
const DOC_PENDING_KEY = 'doc-pending';

export const loadDoc = (kind, store) => read(keyFor(kind), null, store);
export const saveDoc = (kind, doc, store) => write(keyFor(kind), doc, store);

/* Unlike the date queue, a document marker carries the `u` stamp of the write
   that armed it. A date names its own record: 'pending 2026-08-20' can only
   ever mean the record stored under that date. A kind does not — 'profile'
   means whatever profile is in storage when the flush finally runs, which is
   not necessarily the profile the flag was raised for. The two come apart
   whenever the local write fails but the (much smaller) queue write lands,
   and after a reload the flag then points at an OLDER stored envelope. Pushed,
   that moves the server row's updated_at backwards — PostgREST upserts are
   last-request-wins — and silently evicts a newer write made on another
   device. The stamp is what lets the flush tell "the queued write is still
   here to send" from "the write this flag recorded is gone".

   One marker per kind, not one per write: two edits before a single flush are
   one queued write — the later one — so re-marking replaces the stamp rather
   than adding a second entry to clear against. */
const str = (v) => (typeof v === 'string' ? v : '');

const marker = (m) => {
  /* A bare string is what every build before the stamp existed wrote. A
     device that queued one offline and then updated must still flush it, so
     it reads as a marker whose stamp is UNKNOWN — never as a stale one. */
  if (typeof m === 'string') return m ? { kind: m, u: null } : null;
  const kind = m && typeof m === 'object' ? str(m.kind) : '';
  return kind ? { kind, u: str(m.u) || null } : null;
};

export function loadDocPending(store) {
  const v = read(keyFor(DOC_PENDING_KEY), [], store);
  return (Array.isArray(v) ? v : []).map(marker).filter(Boolean);
}

export function markDocPending(kind, u, store) {
  const rest = loadDocPending(store).filter((m) => m.kind !== kind);
  write(keyFor(DOC_PENDING_KEY), [...rest, { kind, u: str(u) || null }], store);
}

export function clearDocPending(kinds, store) {
  const gone = new Set(kinds);
  write(keyFor(DOC_PENDING_KEY), loadDocPending(store).filter((m) => !gone.has(m.kind)), store);
}

/* One-off, on first sign-in: adopt the data written before accounts existed.
   Refuses when the account already has its own progress — a second account
   signing in on the same laptop must not inherit the first one's history.

   Every touch of globalThis.localStorage here goes through read/write (which
   guard their own store resolution) or through the try block below — never
   through a bare `store || defaultStore()` outside a try, because on Lockdown
   Mode and similar restricted contexts the *access* to globalThis.localStorage
   can throw, not just getItem/setItem/removeItem. */
export function migrateLegacy(uid, store) {
  if (!uid) return false;
  const legacy = read(LEGACY.progress, null, store);
  if (!legacy || !Object.keys(legacy).length) return false;
  if (Object.keys(read(keyFor('progress', uid), {}, store)).length) return false;

  /* Only delete the original once the copy is provably there. write() reports
     failure through its return value rather than throwing, and quota-exceeded
     is exactly the failure a migration invites, because for a moment the
     progress object is stored twice. Deleting frees space rather than using
     it, so the cleanup below would succeed even as the write failed and would
     take the last copy with it. Returning false leaves everything where it
     was, so the next sign-in can try again. */
  const pending = read(LEGACY.pending, [], store);
  if (Array.isArray(pending) && pending.length
      && !write(keyFor('pending', uid), pending, store)) return false;
  /* Progress is written LAST because the guard above tests the progress key.
     Any partial failure therefore leaves that key empty, so the next sign-in
     retries the whole migration instead of seeing a half-migrated account and
     skipping it forever. */
  if (!write(keyFor('progress', uid), legacy, store)) return false;
  try {
    const s = store || defaultStore();
    s.removeItem(LEGACY.progress);
    s.removeItem(LEGACY.pending);
  } catch { /* storage off */ }
  return true;
}
