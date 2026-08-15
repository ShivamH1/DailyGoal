/* The localStorage tier. Always written synchronously on every tick, so the
   app is correct and instant with no network at all. */

const PROGRESS_KEY = 'weekly-innings-progress';
const PENDING_KEY = 'weekly-innings-pending';

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

export const loadProgress = (store) => read(PROGRESS_KEY, {}, store);
export const saveProgress = (progress, store) => write(PROGRESS_KEY, progress, store);

export function loadPending(store) {
  const v = read(PENDING_KEY, [], store);
  return Array.isArray(v) ? v : [];
}

export function markPending(dates, store) {
  write(PENDING_KEY, [...new Set([...loadPending(store), ...dates])], store);
}

export function clearPending(dates, store) {
  const gone = new Set(dates);
  write(PENDING_KEY, loadPending(store).filter((d) => !gone.has(d)), store);
}
