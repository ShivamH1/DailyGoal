import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDeadline, formatDates } from '../deadlines.js';

/* The owner's real dates, now a fixture rather than a module constant. */
const FIXTURE = [
  { label: 'EC-1', dates: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'] },
  { label: 'EC-2', dates: ['2026-09-19', '2026-09-20', '2026-09-26', '2026-09-27'] },
  { label: 'EC-3', dates: ['2026-12-05', '2026-12-06', '2026-12-12', '2026-12-13'] },
];

test('nextDeadline finds the nearest upcoming date across all groups', () => {
  const n = nextDeadline(FIXTURE, '2026-08-20');
  assert.equal(n.label, 'EC-1');
  assert.equal(n.date, '2026-08-24');
  assert.equal(n.days, 4);
});

test('a date equal to today reports zero days, not the following one', () => {
  const n = nextDeadline(FIXTURE, '2026-08-26');
  assert.equal(n.date, '2026-08-26');
  assert.equal(n.days, 0);
});

test('between two windows it skips to the next group', () => {
  assert.equal(nextDeadline(FIXTURE, '2026-09-01').label, 'EC-2');
});

test('after the last one it returns null rather than a negative countdown', () => {
  assert.equal(nextDeadline(FIXTURE, '2027-01-01'), null);
});

test('a user with no deadlines gets null, not an error', () => {
  /* The default for every new account. */
  assert.equal(nextDeadline([], '2026-08-20'), null);
  assert.equal(nextDeadline(undefined, '2026-08-20'), null);
});

test('formatDates collapses a contiguous run into a span', () => {
  assert.equal(formatDates(FIXTURE[0].dates), '24–28 Aug 2026');
});

test('formatDates lists non-contiguous dates instead of faking a span', () => {
  assert.equal(formatDates(FIXTURE[1].dates), '19, 20, 26, 27 Sep 2026');
});

test('formatDates handles a run that crosses a month boundary', () => {
  /* The old implementation took the month from the first date and applied it
     to every day number, so a window spanning a month boundary printed dates
     that do not exist. */
  assert.equal(formatDates(['2026-08-31', '2026-09-01']), '31 Aug – 1 Sep 2026');
});
