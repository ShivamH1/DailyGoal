import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_KEYS, istDateISO, istNow, resolveNow, validateWeek,
  emptyWeek, minutesToLabel, formatTime, weekFromDoc, gateWeek, laneVarFor,
} from '../schedule.js';

/* A fixture, not the app's week. The app no longer has one. */
const day = (blocks) => ({ title: '', tag: '', note: '', blocks });
const WEEK = {
  ...Object.fromEntries(DAY_KEYS.map((k) => [k, day([])])),
  thu: day([
    { start: 405, end: 465, label: 'Study', subject: 'Deep Learning', lane: 'focus' },
    { start: 465, end: 525, label: 'Breakfast', lane: 'rest' },
    { start: 1155, end: 1215, label: 'Workout', lane: 'move' },
  ]),
  fri: day([{ start: 390, end: 405, label: 'Wake up', lane: 'rest' }]),
  /* Deliberately placed one day after fri: from fri, walking forward finds
     sat immediately and walking backward finds thu immediately, so the two
     directions land on different, distinguishable days. Without this, fri
     could not tell a forward search from a backward one. */
  sat: day([{ start: 1000, end: 1040, label: 'Lunch', lane: 'rest' }]),
};

test('minutesToLabel keeps the twelve-hour, no-meridiem style already on the page', () => {
  /* The existing schedule reads '9:30 - 6:30' for 570-1110. Changing to a
     24-hour clock here would silently restyle every row. */
  assert.equal(minutesToLabel(405), '6:45');
  assert.equal(minutesToLabel(1110), '6:30');
  assert.equal(minutesToLabel(1380), '11:00');
  assert.equal(minutesToLabel(720), '12:00');
  assert.equal(minutesToLabel(0), '12:00');
});

test('formatTime derives the range and never stores it', () => {
  assert.equal(formatTime({ start: 405, end: 465 }), '6:45 – 7:45');
});

test('formatTime honours an explicit override for a block that is not a range', () => {
  /* 'Morning', '8:15 onwards' — real cases in the schedule this replaces. */
  assert.equal(formatTime({ start: 540, end: 780, timeText: 'Morning' }), 'Morning');
});

test('resolveNow finds the block containing the current minute', () => {
  const r = resolveNow(WEEK, 'thu', 420);
  assert.equal(r.state, 'now');
  assert.equal(r.block.subject, 'Deep Learning');
});

test('a block is inclusive of its start and exclusive of its end', () => {
  assert.equal(resolveNow(WEEK, 'thu', 405).block.label, 'Study');
  assert.equal(resolveNow(WEEK, 'thu', 465).block.label, 'Breakfast');
});

test('a gap reports the next block rather than nothing', () => {
  const r = resolveNow(WEEK, 'thu', 1130);
  assert.equal(r.state, 'next');
  assert.equal(r.block.start, 1155);
});

test('before the first block of the day it reports that block as next', () => {
  /* Distinguishes "find the first upcoming block" from "find any upcoming
     block" — a find-from-index-1 or a filter-then-take-the-last mutant both
     still pass the gap test above, because that one asks for block index 2,
     not index 0. */
  const r = resolveNow(WEEK, 'thu', 60);
  assert.equal(r.state, 'next');
  assert.equal(r.block.start, 405);
});

test('after the last block it rolls into the following day', () => {
  const r = resolveNow(WEEK, 'thu', 1430);
  assert.equal(r.state, 'next');
  assert.equal(r.dayKey, 'fri');
  assert.equal(r.block.start, 390);
});

test('it skips over empty days rather than stopping at the first one', () => {
  /* New and load-bearing: a user may well plan four days and leave three
     blank. The old implementation looked exactly one day ahead, so an empty
     tomorrow produced a crash rather than a Wednesday. Starts from sat, not
     fri, so the walk crosses four blank days (sun, mon, tue, wed) rather
     than reaching the now-populated sat in one step. */
  const r = resolveNow(WEEK, 'sat', 1439);
  assert.equal(r.state, 'next');
  assert.equal(r.dayKey, 'thu');
  assert.equal(r.block.start, 405);
});

test('the walk to find "next" moves forward through the week, never backward', () => {
  /* From fri, forward reaches sat in one step; backward would reach thu in
     one step. The two answers differ only because sat now carries a block —
     without it, both directions could land on the same day by coincidence
     and this mutation would go undetected. */
  const r = resolveNow(WEEK, 'fri', 1439);
  assert.equal(r.state, 'next');
  assert.equal(r.dayKey, 'sat');
  assert.equal(r.block.start, 1000);
});

test('an entirely empty week resolves to null instead of looping forever', () => {
  assert.equal(resolveNow(emptyWeek(), 'mon', 600), null);
});

test('resolveNow tolerates a day key the week does not define', () => {
  assert.equal(resolveNow({}, 'mon', 600), null);
});

test('emptyWeek gives every day its own blocks array, not one shared reference', () => {
  /* A refactor that hoists the day literal out of the map would make every
     day alias the same object — editing Monday would silently edit Tuesday
     too, invisibly, because nothing else re-reads the constant. */
  const w = emptyWeek();
  w.mon.blocks.push({ start: 0, end: 10, label: 'x', lane: 'rest' });
  assert.equal(w.tue.blocks.length, 0);
});

test('istNow reads Kolkata time regardless of process timezone', () => {
  assert.deepEqual(istNow(new Date('2026-08-20T01:15:00Z')), { dayKey: 'thu', minutes: 405 });
});

test('istNow rolls the weekday forward when UTC is still on the previous day', () => {
  assert.equal(istNow(new Date('2026-08-19T20:00:00Z')).dayKey, 'thu');
});

test('istDateISO files a tick under the Kolkata date, not the device one', () => {
  assert.equal(istDateISO(new Date('2026-08-19T20:00:00Z')), '2026-08-20');
  assert.equal(istDateISO(new Date('2026-08-20T18:29:00Z')), '2026-08-20');
  assert.equal(istDateISO(new Date('2026-08-20T18:30:00Z')), '2026-08-21');
});

const LANES = ['focus', 'rest', 'move'];

test('validateWeek accepts a well-formed week', () => {
  assert.deepEqual(validateWeek(WEEK, LANES), { ok: true, errors: [] });
});

test('validateWeek accepts an entirely empty week', () => {
  /* The state every new account starts in. */
  assert.equal(validateWeek(emptyWeek(), LANES).ok, true);
});

test('validateWeek rejects a block that ends before it starts', () => {
  const w = { ...emptyWeek(), mon: day([{ start: 600, end: 500, label: 'x', lane: 'rest' }]) };
  assert.equal(validateWeek(w, LANES).ok, false);
  assert.match(validateWeek(w, LANES).errors[0], /mon/);
});

test('validateWeek rejects minutes outside the day', () => {
  for (const b of [{ start: -1, end: 60 }, { start: 0, end: 1441 }]) {
    const w = { ...emptyWeek(), mon: day([{ ...b, label: 'x', lane: 'rest' }]) };
    assert.equal(validateWeek(w, LANES).ok, false);
  }
});

test('validateWeek rejects overlapping blocks', () => {
  const w = { ...emptyWeek(), mon: day([
    { start: 400, end: 500, label: 'a', lane: 'rest' },
    { start: 450, end: 600, label: 'b', lane: 'rest' },
  ]) };
  assert.equal(validateWeek(w, LANES).ok, false);
  assert.match(validateWeek(w, LANES).errors[0], /overlap/i);
});

test('validateWeek rejects a lane the profile does not define', () => {
  /* The check that matters most in the next project: a language model will
     invent a lane name, and an unknown lane renders as an uncoloured,
     unlabelled dot. */
  const w = { ...emptyWeek(), mon: day([{ start: 0, end: 60, label: 'x', lane: 'cricket' }]) };
  assert.equal(validateWeek(w, LANES).ok, false);
  assert.match(validateWeek(w, LANES).errors[0], /cricket/);
});

test('validateWeek rejects a block with no label', () => {
  const w = { ...emptyWeek(), mon: day([{ start: 0, end: 60, label: '  ', lane: 'rest' }]) };
  assert.equal(validateWeek(w, LANES).ok, false);
});

test('validateWeek rejects a start or end that is not a whole number of minutes', () => {
  /* '9:30' as a start is precisely what a generative source emits when it
     forgets the minutes-from-midnight convention. Without this guard, the
     numeric comparisons below it silently no-op on NaN and the block passes. */
  const w = { ...emptyWeek(), mon: day([{ start: '9:30', end: 600, label: 'x', lane: 'rest' }]) };
  assert.equal(validateWeek(w, LANES).ok, false);
  assert.match(validateWeek(w, LANES).errors[0], /whole minutes/);
});

test('validateWeek does not call a merely out-of-order, non-overlapping pair an "overlap"', () => {
  /* 500-600 then 100-200: listed out of order, but the two spans never
     intersect. The verdict (reject) is correct either way; the wording is
     not, if it says "overlap" for two blocks that never touch in time. */
  const w = { ...emptyWeek(), mon: day([
    { start: 500, end: 600, label: 'a', lane: 'rest' },
    { start: 100, end: 200, label: 'b', lane: 'rest' },
  ]) };
  const { ok, errors } = validateWeek(w, LANES);
  assert.equal(ok, false);
  assert.doesNotMatch(errors.join(' | '), /overlap/i);
});

test('validateWeek never throws when laneKeys is not an array', () => {
  /* new Set(x) throws on any non-iterable x, and the only real caller of
     this function passes profile.lanes.map(...) — a computation that can
     fail upstream and hand this function something other than an array.
     A trust boundary that throws on bad input is not a trust boundary. */
  const w = emptyWeek();
  for (const bad of [null, undefined, {}, 5, () => {}]) {
    assert.doesNotThrow(() => validateWeek(w, bad));
  }
});

test('validateWeek rejects a week that is not a plain object', () => {
  for (const bad of [null, undefined, 'mon', 42, [1, 2, 3], () => {}, new Date()]) {
    const { ok, errors } = validateWeek(bad, LANES);
    assert.equal(ok, false, `expected reject for ${String(bad)}`);
    assert.ok(errors.length >= 1);
  }
});

test('validateWeek rejects a day that is present but not an object', () => {
  for (const bad of [null, 'monday', 42, [1, 2, 3], () => {}]) {
    const w = { ...emptyWeek(), mon: bad };
    assert.equal(validateWeek(w, LANES).ok, false, `expected reject for mon = ${String(bad)}`);
  }
});

test('validateWeek reports every problem, not just the first', () => {
  /* An editor showing one error at a time turns fixing an AI-generated week
     into a guessing game. */
  const w = { ...emptyWeek(), mon: day([
    { start: 100, end: 50, label: '', lane: 'nope' },
  ]) };
  assert.ok(validateWeek(w, LANES).errors.length >= 3);
});

/* ---------- the validator/renderer contract ----------
   Everything below exists to keep one promise: anything validateWeek calls
   valid must render without throwing. Each gap found in review was a crash
   that reported success. */

test('validateWeek rejects a timeText that is not a string', () => {
  /* formatTime hands its result straight to .split(' – ') in app.js. A
     number there throws a TypeError inside the day render, which in
     startApp() takes the rest of the signed-in app down with it. The
     validator type-checked start/end/label/lane and nothing else, so a
     week with timeText: 930 was declared valid and then crashed. */
  const w = { ...emptyWeek(), mon: day([{ start: 0, end: 60, label: 'x', lane: 'rest', timeText: 930 }]) };
  const { ok, errors } = validateWeek(w, LANES);
  assert.equal(ok, false);
  assert.match(errors.join(' | '), /mon\[0\]/);
  assert.match(errors.join(' | '), /timeText/i);
});

test('validateWeek still accepts a block with no timeText at all', () => {
  /* timeText is optional — the range is derived. Rejecting its absence
     would fail every ordinary block. */
  const w = { ...emptyWeek(), mon: day([{ start: 0, end: 60, label: 'x', lane: 'rest' }]) };
  assert.equal(validateWeek(w, LANES).ok, true);
});

test('formatTime never returns a non-string', () => {
  /* The other half of the same fix: the validator is a gate, not a
     guarantee — formatTime is also reached from the NOW banner, and a
     document that predates the gate is still in someone's localStorage. */
  for (const bad of [930, null, {}, [], true, () => {}]) {
    const out = formatTime({ start: 405, end: 465, timeText: bad });
    assert.equal(typeof out, 'string', `expected a string for timeText ${String(bad)}`);
  }
  /* An unusable override falls back to the derived range rather than to ''. */
  assert.equal(formatTime({ start: 405, end: 465, timeText: 930 }), '6:45 – 7:45');
});

test('weekFromDoc falls back to an empty week for every unusable document', () => {
  /* The gate app.js applied character-for-character in two places. Both
     sites now call this, so there is one decision to test instead of two
     to keep in step. */
  for (const doc of [null, undefined, {}, { value: null }, { value: undefined }]) {
    assert.deepEqual(weekFromDoc(doc, LANES), emptyWeek(), `expected empty for ${JSON.stringify(doc)}`);
  }
});

test('weekFromDoc falls back to an empty week when the value fails validation', () => {
  const bad = { ...emptyWeek(), mon: day([{ start: 100, end: 50, label: '', lane: 'nope' }]) };
  assert.deepEqual(weekFromDoc({ value: bad, u: '2026-01-01T00:00:00.000Z' }, LANES), emptyWeek());
});

test('weekFromDoc returns the stored week itself, not a copy', () => {
  /* Identity, not deep equality: the caller compares what it gets back
     against doc.value to decide whether it is rendering the real week or a
     fallback, and commitSchedule refuses to overwrite storage on the
     strength of that answer. A defensive copy here would make every load
     look like a fallback and silently disable saving. */
  const good = { ...emptyWeek(), mon: day([{ start: 400, end: 500, label: 'a', lane: 'rest' }]) };
  const doc = { value: good, u: '2026-01-01T00:00:00.000Z' };
  assert.equal(weekFromDoc(doc, LANES), good);
});

test('weekFromDoc validates against the lanes it is given, not a fixed set', () => {
  const w = { ...emptyWeek(), mon: day([{ start: 0, end: 60, label: 'x', lane: 'rest' }]) };
  assert.equal(weekFromDoc({ value: w }, LANES), w);
  assert.deepEqual(weekFromDoc({ value: w }, ['focus']), emptyWeek());
});

test('gateWeek hands back the stored week itself and does not call it a fallback', () => {
  const good = { ...emptyWeek(), mon: day([{ start: 400, end: 500, label: 'a', lane: 'rest' }]) };
  const doc = { value: good, u: '2026-01-01T00:00:00.000Z' };
  const gated = gateWeek(doc, LANES);
  assert.equal(gated.week, good);          /* identity: the real week, not a copy */
  assert.equal(gated.isFallback, false);
});

test('gateWeek reports a fallback for a stored week it cannot read', () => {
  const bad = { ...emptyWeek(), mon: day([{ start: 100, end: 50, label: '', lane: 'nope' }]) };
  const gated = gateWeek({ value: bad, u: '2026-01-01T00:00:00.000Z' }, LANES);
  assert.deepEqual(gated.week, emptyWeek());
  assert.equal(gated.isFallback, true);
});

test('gateWeek does not call a brand-new account a fallback', () => {
  /* "Empty because this account is new" and "empty because your stored week
     could not be read" render identically and must not share a flag: app.js
     refuses to save only in the second, so collapsing them would leave a new
     account unable to write its first week. */
  for (const doc of [null, undefined, {}, { value: null }, { value: undefined }]) {
    const gated = gateWeek(doc, LANES);
    assert.deepEqual(gated.week, emptyWeek(), `expected empty for ${JSON.stringify(doc)}`);
    assert.equal(gated.isFallback, false, `expected not a fallback for ${JSON.stringify(doc)}`);
  }
});

test('gateWeek re-answers when the lane set changes, both ways, for the same document', () => {
  /* The bug regateWeek exists for. A week using a lane the profile does not
     define is refused; adding that lane — the exact recovery validateWeek's
     "unknown lane" error prompts — makes the very same stored document
     readable, and nothing about the document changed. A gate answered once
     and cached would keep the week blank and keep refusing to save it.
     The reverse direction is tested too: dropping the lane again must put
     the flag back up, so the caller stops writing a placeholder back over a
     document that is once again unreadable. */
  const doc = { value: { ...emptyWeek(), mon: day([{ start: 0, end: 60, label: 'x', lane: 'foo' }]) } };

  const without = gateWeek(doc, LANES);
  assert.equal(without.isFallback, true);
  assert.deepEqual(without.week, emptyWeek());

  const withFoo = gateWeek(doc, [...LANES, 'foo']);
  assert.equal(withFoo.isFallback, false);
  assert.equal(withFoo.week, doc.value);

  assert.equal(gateWeek(doc, LANES).isFallback, true);
});

test('laneVarFor gives each lane the colour of its position in the profile', () => {
  const lanes = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }];
  assert.equal(laneVarFor(lanes, 'a'), 'var(--lane-pos-1)');
  assert.equal(laneVarFor(lanes, 'c'), 'var(--lane-pos-3)');
  assert.equal(laneVarFor(lanes, 'e'), 'var(--lane-pos-5)');
});

test('laneVarFor wraps past the fifth lane instead of naming a colour that does not exist', () => {
  /* styles.css defines --lane-pos-1..5 and nothing more, while
     profileEditor.js sets no upper bound on lane count. --lane-pos-6 is not
     an undefined property, it is an INVALID substitution, so
     background: var(--lane-i, var(--lane-pos-5)) does not fall back and the
     dot renders with no colour at all. The legend already wraps modulo 5
     (.legend span:nth-child(5n+k)), so the row has to wrap the same way or
     row and legend disagree — and position-is-the-colour is the whole
     contract of this scheme. */
  const lanes = Array.from({ length: 12 }, (_, i) => ({ key: `l${i}` }));
  assert.equal(laneVarFor(lanes, 'l5'), 'var(--lane-pos-1)');
  assert.equal(laneVarFor(lanes, 'l6'), 'var(--lane-pos-2)');
  assert.equal(laneVarFor(lanes, 'l9'), 'var(--lane-pos-5)');
  assert.equal(laneVarFor(lanes, 'l10'), 'var(--lane-pos-1)');
  for (let i = 0; i < 12; i++) {
    assert.match(laneVarFor(lanes, `l${i}`), /^var\(--lane-pos-[1-5]\)$/);
  }
});

test('laneVarFor falls back to the fifth colour for a lane the profile does not define', () => {
  const lanes = [{ key: 'a' }, { key: 'b' }];
  assert.equal(laneVarFor(lanes, 'gone'), 'var(--lane-pos-5)');
  assert.equal(laneVarFor(lanes, undefined), 'var(--lane-pos-5)');
});

test('laneVarFor never throws when lanes is not an array of lane objects', () => {
  /* Same trust-boundary reasoning as validateWeek's laneKeys guard: this is
     handed profile.lanes, and a boundary that throws on bad input is not a
     boundary. */
  for (const bad of [null, undefined, {}, 5, 'lanes']) {
    assert.equal(laneVarFor(bad, 'a'), 'var(--lane-pos-5)');
  }
  assert.equal(laneVarFor([null, { key: 'a' }], 'a'), 'var(--lane-pos-2)');
});
