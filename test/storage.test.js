import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProgress, saveProgress, loadPending, markPending, clearPending,
  setNamespace, getNamespace, keyFor, migrateLegacy,
  loadDoc, saveDoc, markDocPending, loadDocPending, clearDocPending,
} from '../storage.js';

/* Minimal stand-in for the Web Storage API — only the four members
   storage.js actually uses. */
const fakeStore = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
};

test('loadProgress returns an empty object when nothing is stored', () => {
  assert.deepEqual(loadProgress(fakeStore()), {});
});

test('loadProgress discards malformed JSON instead of throwing', () => {
  const s = fakeStore({ 'weekly-innings-progress': '{not json' });
  assert.deepEqual(loadProgress(s), {});
});

test('loadProgress discards a payload that is not an object', () => {
  const s = fakeStore({ 'weekly-innings-progress': '"a string"' });
  assert.deepEqual(loadProgress(s), {});
});

test('saveProgress round-trips through loadProgress', () => {
  const s = fakeStore();
  saveProgress({ '2026-08-20': { s: 1, w: 1 } }, s);
  assert.deepEqual(loadProgress(s), { '2026-08-20': { s: 1, w: 1 } });
});

test('markPending unions without duplicating', () => {
  const s = fakeStore();
  markPending(['2026-08-20'], s);
  markPending(['2026-08-20', '2026-08-21'], s);
  assert.deepEqual(loadPending(s).sort(), ['2026-08-20', '2026-08-21']);
});

test('clearPending removes only the named dates', () => {
  const s = fakeStore();
  markPending(['2026-08-20', '2026-08-21'], s);
  clearPending(['2026-08-20'], s);
  assert.deepEqual(loadPending(s), ['2026-08-21']);
});

test('a write failure is swallowed rather than crashing a tick', () => {
  const s = fakeStore();
  s.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.doesNotThrow(() => saveProgress({ '2026-08-20': { s: 1 } }, s));
});

test('saveProgress reports the failure rather than only swallowing it', () => {
  /* Quota, Lockdown Mode, an embedded context, storage switched off — the
     caller has to be able to tell, or it shows "saved" over a lost tick. */
  const s = fakeStore();
  s.setItem = () => { throw new Error('SecurityError'); };
  assert.equal(saveProgress({ '2026-08-20': { s: 1 } }, s), false);
});

test('a successful saveProgress reports true', () => {
  assert.equal(saveProgress({ '2026-08-20': { s: 1 } }, fakeStore()), true);
});

test('with no namespace the legacy keys are used', () => {
  /* Nothing may move until we know which account we are. */
  setNamespace(null);
  assert.equal(keyFor('progress'), 'weekly-innings-progress');
  assert.equal(keyFor('pending'), 'weekly-innings-pending');
});

test('a namespace scopes every key to the account', () => {
  setNamespace('u1');
  assert.equal(keyFor('progress'), 'wi:u1:progress');
  assert.equal(getNamespace(), 'u1');
  setNamespace(null);
});

test('two accounts in one browser cannot see each other', () => {
  /* The whole reason this exists: two Google accounts on one laptop used to
     share weekly-innings-progress and silently overwrite one another. */
  const store = fakeStore();
  setNamespace('u1');
  saveProgress({ '2026-08-20': { s: 1 } }, store);
  setNamespace('u2');
  assert.deepEqual(loadProgress(store), {});
  saveProgress({ '2026-08-21': { w: 1 } }, store);
  setNamespace('u1');
  assert.deepEqual(loadProgress(store), { '2026-08-20': { s: 1 } });
  setNamespace(null);
});

test('migrateLegacy moves the old keys into the account and removes them', () => {
  const store = fakeStore({
    'weekly-innings-progress': JSON.stringify({ '2026-08-20': { s: 1, w: 1 } }),
    'weekly-innings-pending': JSON.stringify(['2026-08-20']),
  });
  assert.equal(migrateLegacy('u1', store), true);
  setNamespace('u1');
  assert.deepEqual(loadProgress(store), { '2026-08-20': { s: 1, w: 1 } });
  assert.deepEqual(loadPending(store), ['2026-08-20']);
  assert.equal(store._dump()['weekly-innings-progress'], undefined);
  assert.equal(store._dump()['weekly-innings-pending'], undefined);
  setNamespace(null);
});

test('migrateLegacy refuses to overwrite an account that already has data', () => {
  /* Signing in as a second account on a laptop that still holds the first
     account's pre-migration data must not graft one onto the other. */
  const store = fakeStore({ 'weekly-innings-progress': JSON.stringify({ '2026-01-01': { s: 1 } }) });
  setNamespace('u2');
  saveProgress({ '2026-08-20': { w: 1 } }, store);
  setNamespace(null);
  assert.equal(migrateLegacy('u2', store), false);
  setNamespace('u2');
  assert.deepEqual(loadProgress(store), { '2026-08-20': { w: 1 } });
  setNamespace(null);
});

test('migrateLegacy is a no-op when there is nothing to move', () => {
  assert.equal(migrateLegacy('u1', fakeStore()), false);
});

test('migrateLegacy does not throw when localStorage is unavailable', () => {
  /* Safari Lockdown Mode, storage fully disabled, or embedded contexts can
     throw a SecurityError on mere ACCESS to globalThis.localStorage, not just
     on getItem/setItem — migrateLegacy calls with no explicit store must not
     let that access escape uncaught. */
  const savedStorage = globalThis.localStorage;
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage off'); },
    });
    assert.doesNotThrow(() => migrateLegacy('u1'));
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: savedStorage,
    });
  }
});

test('migrateLegacy keeps the legacy data when the new key cannot be written', () => {
  /* Quota-exceeded is the realistic shape here, and a migration is exactly
     when it bites: for a moment the progress object is stored twice. setItem
     throws while getItem and removeItem keep working — deleting frees space
     rather than consuming it, so the cleanup would happily succeed and take
     the only surviving copy with it. */
  const legacy = { '2026-08-20': { w: 1 }, '2026-08-21': { w: 2 } };
  const store = fakeStore({ 'weekly-innings-progress': JSON.stringify(legacy) });
  const realSet = store.setItem;
  store.setItem = (k, v) => {
    if (k.startsWith('wi:')) throw new Error('QuotaExceededError');
    return realSet(k, v);
  };

  assert.equal(migrateLegacy('u1', store), false, 'must report failure, not success');
  assert.deepEqual(
    JSON.parse(store._dump()['weekly-innings-progress']), legacy,
    'the legacy history must still be there to retry from',
  );
});

test('migrateLegacy is independent of whatever the module namespace holds', () => {
  /* migrateLegacy takes uid as an explicit argument and never consults
     getNamespace()/keyFor's default namespace — every key it touches is
     either a LEGACY.* constant or keyFor(name, uid) with uid passed
     explicitly. That is what makes migrate-then-setNamespace and
     setNamespace-then-migrate equivalent in app.js's startApp(); it is not,
     as an earlier draft of this plan claimed, that calling setNamespace
     first would make migrateLegacy see an account that already has progress
     and refuse to move it. Pinned here so a future rewrite that starts
     reading module state instead of the uid argument fails loudly instead
     of silently reading the wrong account's keys. */
  const store = fakeStore({
    'weekly-innings-progress': JSON.stringify({ '2026-08-20': { s: 1 } }),
  });
  setNamespace('someone-else');
  assert.equal(migrateLegacy('u1', store), true);
  setNamespace('u1');
  assert.deepEqual(loadProgress(store), { '2026-08-20': { s: 1 } });
  setNamespace(null);
});

test('a half-written migration can still be retried on the next sign-in', () => {
  /* The skip guard tests the progress key, so progress must be the last thing
     written. If a failure could leave progress populated but pending missing,
     every later attempt would see a migrated account and skip — stranding the
     unsynced dates permanently. */
  const legacy = { '2026-08-20': { w: 1 } };
  const store = fakeStore({
    'weekly-innings-progress': JSON.stringify(legacy),
    'weekly-innings-pending': JSON.stringify(['2026-08-20']),
  });
  const realSet = store.setItem;
  let failPending = true;
  store.setItem = (k, v) => {
    if (failPending && k === 'wi:u1:pending') throw new Error('QuotaExceededError');
    return realSet(k, v);
  };

  assert.equal(migrateLegacy('u1', store), false);
  setNamespace('u1');
  assert.deepEqual(loadProgress(store), {}, 'nothing half-migrated');
  setNamespace(null);

  failPending = false;
  assert.equal(migrateLegacy('u1', store), true, 'the retry must not be skipped');
  setNamespace('u1');
  assert.deepEqual(loadProgress(store), legacy);
  assert.deepEqual(loadPending(store), ['2026-08-20']);
  setNamespace(null);
});

test('keyFor refuses to invent a key for a document with no account', () => {
  /* Documents only exist for a signed-in user. Falling back to a shared
     'wi::profile' would give every signed-out state one bucket, which is the
     bug namespacing exists to remove, not a smaller version of it. */
  setNamespace(null);
  assert.throws(() => keyFor('profile'), /namespace/);
});

test('documents round-trip inside the account namespace', () => {
  const store = fakeStore();
  setNamespace('u1');
  assert.equal(saveDoc('profile', { value: { season: 'S' }, u: 'T' }, store), true);
  assert.deepEqual(loadDoc('profile', store), { value: { season: 'S' }, u: 'T' });
  assert.equal(store._dump()['wi:u1:profile'] !== undefined, true);
  setNamespace(null);
});

test('loadDoc returns null for an account that has never saved one', () => {
  setNamespace('u1');
  assert.equal(loadDoc('schedule', fakeStore()), null);
  setNamespace(null);
});

test('the document queue records the stamp each write queued', () => {
  /* Unlike a date, a kind does not identify a write — so the marker carries
     the u stamp of the envelope it queued, and the flush can tell "this
     write is still here to send" from a flag that has outlived it. Clearing
     is by kind alone: whatever stamp the marker holds, clearing 'profile'
     must leave no profile marker behind. */
  const store = fakeStore();
  setNamespace('u1');
  markDocPending('profile', 'T1', store);
  markDocPending('schedule', 'T2', store);
  assert.deepEqual(
    loadDocPending(store).sort((a, b) => a.kind.localeCompare(b.kind)),
    [{ kind: 'profile', u: 'T1' }, { kind: 'schedule', u: 'T2' }],
  );
  clearDocPending(['profile'], store);
  assert.deepEqual(loadDocPending(store), [{ kind: 'schedule', u: 'T2' }]);
  setNamespace(null);
});

test('re-marking a kind keeps one marker, carrying the newest stamp', () => {
  /* Two edits before a flush are one queued write — the later one. A marker
     per edit would let the flush clear or drop against the wrong stamp. */
  const store = fakeStore();
  setNamespace('u1');
  markDocPending('profile', 'T1', store);
  markDocPending('profile', 'T2', store);
  assert.deepEqual(loadDocPending(store), [{ kind: 'profile', u: 'T2' }]);
  setNamespace(null);
});

test('a legacy bare-string marker reads as a marker with an unknown stamp', () => {
  /* Every build before the stamp existed wrote plain kind strings. A device
     that queued one offline and then updated must still flush it — an
     unknown stamp means "push what is here", never "stale". Clearing by
     kind reaches it the same as a stamped marker. */
  const store = fakeStore({ 'wi:u1:doc-pending': JSON.stringify(['profile', 'schedule']) });
  setNamespace('u1');
  assert.deepEqual(
    loadDocPending(store).sort((a, b) => a.kind.localeCompare(b.kind)),
    [{ kind: 'profile', u: null }, { kind: 'schedule', u: null }],
  );
  clearDocPending(['profile'], store);
  assert.deepEqual(loadDocPending(store), [{ kind: 'schedule', u: null }]);
  setNamespace(null);
});
