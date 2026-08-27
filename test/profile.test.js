import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LANES, CORE_TICK_KEYS, defaultProfile, normalizeProfile, mergeDoc, newTickKey,
} from '../profile.js';

test('a new profile has lanes and ticks but no words put in the user\'s mouth', () => {
  /* Defaults where a default is honest, blank where it would be an
     invention. A made-up ground rule is worse than no ground rule. */
  const p = defaultProfile();
  assert.equal(p.lanes.length, DEFAULT_LANES.length);
  assert.deepEqual(p.ticks.map((t) => t.key), CORE_TICK_KEYS);
  assert.deepEqual(p.rules, []);
  assert.deepEqual(p.deadlines, []);
  assert.equal(p.season, '');
  assert.equal(p.onboarded, false);
});

test('defaultProfile hands back a fresh copy each time', () => {
  /* Shared array references across accounts would let one user's rename
     appear in another's session. */
  const a = defaultProfile();
  a.lanes[0].name = 'CHANGED';
  assert.notEqual(defaultProfile().lanes[0].name, 'CHANGED');
});

test('normalizeProfile repairs anything that is not a profile', () => {
  for (const junk of [null, undefined, 42, 'x', []]) {
    assert.deepEqual(normalizeProfile(junk), defaultProfile());
  }
});

test('the three core ticks are always present, in order, and marked core', () => {
  /* They map to real columns. A profile that lost one would leave the
     scorecard unable to render a habit the database still stores. */
  const p = normalizeProfile({ ticks: [{ key: 'w', label: 'Gym' }] });
  assert.deepEqual(p.ticks.slice(0, 3).map((t) => t.key), CORE_TICK_KEYS);
  assert.equal(p.ticks.find((t) => t.key === 'w').label, 'Gym');
  assert.equal(p.ticks.every((t, i) => (i < 3 ? t.core === true : t.core === false)), true);
});

test('core ticks cannot be deleted by omission or duplicated by collision', () => {
  const p = normalizeProfile({ ticks: [{ key: 's', label: 'A' }, { key: 's', label: 'B' }] });
  assert.equal(p.ticks.filter((t) => t.key === 's').length, 1);
  assert.equal(p.ticks.find((t) => t.key === 's').label, 'A');
});

test('extra ticks survive normalisation and keep their keys', () => {
  const p = normalizeProfile({ ticks: [{ key: 'k1', label: 'Read' }] });
  const extra = p.ticks.filter((t) => !t.core);
  assert.deepEqual(extra.map((t) => t.key), ['k1']);
  assert.equal(extra[0].label, 'Read');
});

test('a tick with no label is dropped rather than rendered blank', () => {
  const p = normalizeProfile({ ticks: [{ key: 'k1', label: '   ' }, { key: 'k2', label: 'Ok' }] });
  assert.deepEqual(p.ticks.filter((t) => !t.core).map((t) => t.key), ['k2']);
});

test('lanes fall back to the defaults when the list is emptied', () => {
  /* Every schedule block names a lane. With no lanes there is nothing for a
     block to point at, so an empty list is a broken state, not a choice. */
  assert.deepEqual(normalizeProfile({ lanes: [] }).lanes, DEFAULT_LANES);
});

test('duplicate lane keys collapse to the first', () => {
  const p = normalizeProfile({ lanes: [{ key: 'a', name: 'One' }, { key: 'a', name: 'Two' }] });
  assert.deepEqual(p.lanes, [{ key: 'a', name: 'One' }]);
});

test('rules and deadlines keep only well-formed entries', () => {
  const p = normalizeProfile({
    rules: [{ title: 'Never miss twice', body: 'One day is a rain delay.' }, { title: '' }, 'nope'],
    deadlines: [{ label: 'EC-1', dates: ['2026-08-25', '2026-08-24'] }, { label: 'x', dates: [] }, { dates: ['2026-01-01'] }],
  });
  assert.deepEqual(p.rules.map((r) => r.title), ['Never miss twice']);
  assert.deepEqual(p.deadlines.map((d) => d.label), ['EC-1']);
  /* Sorted on the way in, so nothing downstream has to re-sort to format a
     span correctly. */
  assert.deepEqual(p.deadlines[0].dates, ['2026-08-24', '2026-08-25']);
});

test('newTickKey never collides with an existing key', () => {
  const ticks = [{ key: 's' }, { key: 'w' }, { key: 'z' }, { key: 'k1' }];
  const k = newTickKey(ticks);
  assert.equal(ticks.some((t) => t.key === k), false);
  assert.match(k, /^[a-z0-9]+$/);
});

test('mergeDoc lets the newer timestamp win the whole document', () => {
  const a = { value: { season: 'A' }, u: '2026-08-20T00:00:00.000Z' };
  const b = { value: { season: 'B' }, u: '2026-08-21T00:00:00.000Z' };
  assert.equal(mergeDoc(a, b).value.season, 'B');
  assert.equal(mergeDoc(b, a).value.season, 'B');
});

test('mergeDoc keeps the local document when timestamps tie', () => {
  /* Same rule as mergeProgress: remote must be strictly newer to win. A tie
     is almost always the same write coming back, and preferring local avoids
     a pointless re-render. */
  const a = { value: { season: 'local' }, u: 'T' };
  const b = { value: { season: 'remote' }, u: 'T' };
  assert.equal(mergeDoc(a, b).value.season, 'local');
});

test('mergeDoc handles either side being absent', () => {
  const a = { value: { season: 'A' }, u: 'T' };
  assert.equal(mergeDoc(a, null), a);
  assert.equal(mergeDoc(null, a), a);
  assert.equal(mergeDoc(null, null), null);
});
