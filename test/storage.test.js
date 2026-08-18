import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProgress, saveProgress, loadPending, markPending, clearPending
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
