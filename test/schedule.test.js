import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_KEYS, istDateISO, istNow, resolveNow, validateWeek,
  emptyWeek, minutesToLabel, formatTime,
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

test('after the last block it rolls into the following day', () => {
  const r = resolveNow(WEEK, 'thu', 1430);
  assert.equal(r.state, 'next');
  assert.equal(r.dayKey, 'fri');
  assert.equal(r.block.start, 390);
});

test('it skips over empty days rather than stopping at the first one', () => {
  /* New and load-bearing: a user may well plan four days and leave three
     blank. The old implementation looked exactly one day ahead, so an empty
     tomorrow produced a crash rather than a Wednesday. */
  const r = resolveNow(WEEK, 'fri', 1439);
  assert.equal(r.state, 'next');
  assert.equal(r.dayKey, 'thu');
  assert.equal(r.block.start, 405);
});

test('an entirely empty week resolves to null instead of looping forever', () => {
  assert.equal(resolveNow(emptyWeek(), 'mon', 600), null);
});

test('resolveNow tolerates a day key the week does not define', () => {
  assert.equal(resolveNow({}, 'mon', 600), null);
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

test('validateWeek reports every problem, not just the first', () => {
  /* An editor showing one error at a time turns fixing an AI-generated week
     into a guessing game. */
  const w = { ...emptyWeek(), mon: day([
    { start: 100, end: 50, label: '', lane: 'nope' },
  ]) };
  assert.ok(validateWeek(w, LANES).errors.length >= 3);
});
