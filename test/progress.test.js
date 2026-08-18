import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  iso, addDays, weekStart, clearableDates, computeStreak, mergeProgress, weeklySummary, toCSV
} from '../progress.js';

test('iso formats local date parts, not UTC', () => {
  assert.equal(iso(new Date(2026, 7, 20, 23, 30)), '2026-08-20');
});

test('addDays crosses a month boundary', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-09-01', -1), '2026-08-31');
});

test('weekStart returns Monday for any day of that week', () => {
  assert.equal(weekStart('2026-08-20'), '2026-08-17'); // Thu -> Mon
  assert.equal(weekStart('2026-08-17'), '2026-08-17'); // Mon -> itself
  assert.equal(weekStart('2026-08-23'), '2026-08-17'); // Sun -> that Mon
});

test('weekStart walks a Sunday back across a month boundary', () => {
  /* The day === 0 ? -6 branch is the whole of weeklySummary's week, and a
     Sunday landing on the 1st or 2nd is the only time it leaves the month. */
  assert.equal(weekStart('2026-02-01'), '2026-01-26'); // Sun 1st -> prev Mon
  assert.equal(weekStart('2026-11-01'), '2026-10-26'); // Sun 1st, 31-day month
  assert.equal(weekStart('2026-08-02'), '2026-07-27'); // Sun 2nd
  assert.equal(weekStart('2026-03-01'), '2026-02-23'); // Sun 1st, out of Feb
});

test('streak counts back from today when today is complete', () => {
  const p = {
    '2026-08-20': { s: 1, w: 1 },
    '2026-08-19': { s: 1, w: 1 },
    '2026-08-18': { s: 1, w: 1 },
  };
  assert.equal(computeStreak(p, '2026-08-20'), 3);
});

test('an incomplete today does not break the streak', () => {
  const p = {
    '2026-08-20': { s: 1, w: 0 },
    '2026-08-19': { s: 1, w: 1 },
    '2026-08-18': { s: 1, w: 1 },
  };
  assert.equal(computeStreak(p, '2026-08-20'), 2);
});

test('sleep alone does not sustain a streak', () => {
  const p = {
    '2026-08-19': { s: 1, w: 0, z: 1 },
    '2026-08-18': { s: 1, w: 1 },
  };
  assert.equal(computeStreak(p, '2026-08-20'), 0);
});

test('merge takes the record with the later updated_at', () => {
  const local  = { '2026-08-20': { s: 1, w: 0, u: '2026-08-20T10:00:00.000Z' } };
  const remote = { '2026-08-20': { s: 1, w: 1, u: '2026-08-20T12:00:00.000Z' } };
  assert.deepEqual(mergeProgress(local, remote)['2026-08-20'].w, 1);
});

test('merge does not resurrect an untick from a stale device', () => {
  const local  = { '2026-08-20': { s: 0, w: 0, u: '2026-08-20T18:00:00.000Z' } };
  const remote = { '2026-08-20': { s: 1, w: 1, u: '2026-08-20T09:00:00.000Z' } };
  assert.deepEqual(mergeProgress(local, remote)['2026-08-20'].s, 0);
});

test('merge keeps dates present on only one side', () => {
  const local  = { '2026-08-19': { s: 1, u: 'a' } };
  const remote = { '2026-08-20': { w: 1, u: 'b' } };
  const m = mergeProgress(local, remote);
  assert.deepEqual(Object.keys(m).sort(), ['2026-08-19', '2026-08-20']);
});

test('a record with no timestamp loses to one that has it', () => {
  const local  = { '2026-08-20': { s: 1, w: 1 } };
  const remote = { '2026-08-20': { s: 0, w: 0, u: '2026-08-20T09:00:00.000Z' } };
  assert.equal(mergeProgress(local, remote)['2026-08-20'].s, 0);
});

test('weekly summary counts each habit and collects notes in order', () => {
  const p = {
    '2026-08-17': { s: 1, w: 1, z: 1, note: 'linear algebra' },
    '2026-08-18': { s: 1, w: 1, z: 0 },
    '2026-08-19': { s: 0, w: 1, z: 1, note: 'rest brain' },
  };
  const sum = weeklySummary(p, '2026-08-17');
  assert.equal(sum.study, 2);
  assert.equal(sum.workout, 3);
  assert.equal(sum.sleep, 2);
  assert.equal(sum.bestStreak, 2);
  assert.deepEqual(sum.notes, [
    { date: '2026-08-17', note: 'linear algebra' },
    { date: '2026-08-19', note: 'rest brain' },
  ]);
});

test('CSV escapes quotes and commas in notes', () => {
  const p = { '2026-08-20': { s: 1, w: 0, z: 1, note: 'SVMs, "kernels" too' } };
  const csv = toCSV(p);
  const [header, row] = csv.trim().split('\n');
  assert.equal(header, 'date,study,workout,sleep,note,updated_at');
  assert.equal(row, '2026-08-20,1,0,1,"SVMs, ""kernels"" too",');
});

test('CSV rows are sorted by date', () => {
  const p = { '2026-08-20': { s: 1 }, '2026-08-18': { s: 1 } };
  const rows = toCSV(p).trim().split('\n').slice(1);
  assert.match(rows[0], /^2026-08-18/);
});

test('a date untouched during the push is clearable', () => {
  const sent = ['2026-08-20T10:00:00.000Z'];
  const now = { '2026-08-20': { s: 1, u: '2026-08-20T10:00:00.000Z' } };
  assert.deepEqual(clearableDates(['2026-08-20'], sent, now), ['2026-08-20']);
});

test('a date re-ticked mid-flight stays queued', () => {
  /* The push body was serialised at 10:00; the workout tick landed at 10:00:30
     while the request was still open. Clearing it by date would strand it. */
  const sent = ['2026-08-20T10:00:00.000Z'];
  const now = { '2026-08-20': { s: 1, w: 1, u: '2026-08-20T10:00:30.000Z' } };
  assert.deepEqual(clearableDates(['2026-08-20'], sent, now), []);
});

test('a mixed batch clears only the dates that did not change', () => {
  const dates = ['2026-08-18', '2026-08-19', '2026-08-20'];
  const sent = ['a', 'b', 'c'];
  const now = {
    '2026-08-18': { u: 'a' },
    '2026-08-19': { u: 'b2' },   // changed while in flight
    '2026-08-20': { u: 'c' },
  };
  assert.deepEqual(clearableDates(dates, sent, now), ['2026-08-18', '2026-08-20']);
});

test('a date missing from the current progress is handled without throwing', () => {
  let out;
  assert.doesNotThrow(() => { out = clearableDates(['2026-08-20'], [undefined], {}); });
  assert.deepEqual(out, ['2026-08-20']);
  /* …and a record that has since gained a timestamp is not cleared. */
  assert.deepEqual(clearableDates(['2026-08-20'], [undefined], { '2026-08-20': { u: 'z' } }), []);
});

test('CSV quotes a note containing a newline', () => {
  /* csvField tests for /[",\n]/ but only the quote and the comma were ever
     asserted. An unquoted newline ends the row early and shifts every column
     after it — and the note column is writable from anywhere by design. */
  const p = { '2026-08-20': { s: 1, w: 1, z: 0, note: 'line one\nline two' } };
  const lines = toCSV(p).trim().split('\n');
  assert.equal(lines.length, 3);          // header + the row, split by its own newline
  assert.equal(lines[1], '2026-08-20,1,1,0,"line one');
  assert.equal(lines[2], 'line two",');
  assert.match(toCSV(p), /"line one\nline two"/);
});
