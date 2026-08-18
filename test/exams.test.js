import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMS, nextExam, formatExamDates } from '../exams.js';

test('the three evaluation components are present and ascending', () => {
  assert.deepEqual(EXAMS.map((e) => e.label), ['EC-1', 'EC-2', 'EC-3']);
  for (const ec of EXAMS) {
    assert.ok(ec.dates.length > 0, `${ec.label} has no dates`);
    assert.deepEqual(ec.dates, [...ec.dates].sort(), `${ec.label} is not ascending`);
  }
});

test('nextExam finds the nearest upcoming date across all groups', () => {
  const n = nextExam('2026-08-20');
  assert.equal(n.label, 'EC-1');
  assert.equal(n.date, '2026-08-24');
  assert.equal(n.days, 4);
});

test('a date equal to today reports zero days, not the following one', () => {
  const n = nextExam('2026-08-26');
  assert.equal(n.date, '2026-08-26');
  assert.equal(n.days, 0);
});

test('between two windows it skips to the next group', () => {
  const n = nextExam('2026-09-01');
  assert.equal(n.label, 'EC-2');
  assert.equal(n.date, '2026-09-19');
});

test('after the last exam it returns null rather than a negative countdown', () => {
  assert.equal(nextExam('2027-01-01'), null);
});

test('formatExamDates collapses a contiguous run into a span', () => {
  assert.equal(formatExamDates(['2026-08-24','2026-08-25','2026-08-26','2026-08-27','2026-08-28']), '24–28 Aug 2026');
});

test('formatExamDates lists non-contiguous dates instead of faking a span', () => {
  assert.equal(formatExamDates(['2026-09-19','2026-09-20','2026-09-26','2026-09-27']), '19, 20, 26, 27 Sep 2026');
});
