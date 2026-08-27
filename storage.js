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
export const keyFor = (name, ns = namespace) => (ns ? `wi:${ns}:${name}` : LEGACY[name]);

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
