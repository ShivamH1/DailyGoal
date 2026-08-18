import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEEK, DAY_KEYS, istDateISO, istNow, resolveNow } from '../schedule.js';

test('every day has blocks in ascending, non-overlapping order', () => {
  for (const key of DAY_KEYS) {
    const blocks = WEEK[key].blocks;
    assert.ok(blocks.length > 0, `${key} has no blocks`);
    for (let i = 0; i < blocks.length; i++) {
      assert.ok(blocks[i].end > blocks[i].start, `${key}[${i}] ends before it starts`);
      if (i > 0) assert.ok(blocks[i].start >= blocks[i - 1].end, `${key}[${i}] overlaps the previous block`);
    }
  }
});

test('every block carries a lane that maps to an existing CSS class', () => {
  const lanes = new Set(['rest', 'study', 'work', 'fit', 'cricket']);
  for (const key of DAY_KEYS) {
    for (const b of WEEK[key].blocks) assert.ok(lanes.has(b.lane), `${key}: bad lane ${b.lane}`);
  }
});

test('istNow reads Kolkata time regardless of process timezone', () => {
  // 2026-08-20T01:15:00Z is 06:45 IST on a Thursday.
  assert.deepEqual(istNow(new Date('2026-08-20T01:15:00Z')), { dayKey: 'thu', minutes: 405 });
});

test('istNow rolls the weekday forward when UTC is still on the previous day', () => {
  // 2026-08-19T20:00:00Z is 01:30 IST on Thursday.
  assert.equal(istNow(new Date('2026-08-19T20:00:00Z')).dayKey, 'thu');
});

test('resolveNow finds the block containing the current minute', () => {
  const r = resolveNow('thu', 420);           // 07:00, inside 6:45-7:45 study
  assert.equal(r.state, 'now');
  assert.match(r.block.label, /Study/);
  assert.equal(r.block.subject, 'Deep Learning');
});

test('a block is inclusive of its start and exclusive of its end', () => {
  // 6:45 exactly: study has begun.
  assert.equal(resolveNow('thu', 405).block.lane, 'study');
  // 7:45 exactly: study is over and breakfast has begun, back to back.
  assert.equal(resolveNow('thu', 465).state, 'now');
  assert.notEqual(resolveNow('thu', 465).block.lane, 'study');
});

test('a gap reports the next block rather than nothing', () => {
  const r = resolveNow('thu', 1130);          // 18:50, after work, before workout
  assert.equal(r.state, 'next');
  assert.equal(r.block.start, 1155);
});

test('before the first block of the day it reports that block as next', () => {
  const r = resolveNow('thu', 60);            // 01:00
  assert.equal(r.state, 'next');
  assert.equal(r.block.start, WEEK.thu.blocks[0].start);
});

test('after the last block it rolls over to the next day', () => {
  const r = resolveNow('thu', 1430);          // 23:50
  assert.equal(r.state, 'next');
  assert.equal(r.dayKey, 'fri');
  assert.equal(r.block.start, WEEK.fri.blocks[0].start);
});

test('sunday rolls over to monday', () => {
  assert.equal(resolveNow('sun', 1439).dayKey, 'mon');
});

test('weekend days carry the cricket block', () => {
  for (const key of ['sat', 'sun']) {
    const cricket = WEEK[key].blocks.find((b) => b.lane === 'cricket');
    assert.ok(cricket, `${key} is missing its match`);
    assert.equal(cricket.start, 930);   // 15:30
    assert.equal(cricket.end, 1170);    // 19:30
  }
});

test('wednesday is the only weekday with two study blocks', () => {
  const count = (k) => WEEK[k].blocks.filter((b) => b.lane === 'study').length;
  assert.equal(count('wed'), 2);
  for (const k of ['mon', 'tue', 'thu', 'fri']) assert.equal(count(k), 1);
});

test('saturday resolves the gap between the match and dinner', () => {
  const r = resolveNow('sat', 1185);          // 19:45 — match over at 19:30
  assert.equal(r.state, 'next');
  assert.equal(r.dayKey, 'sat');
  assert.equal(r.block.start, 1200);
  assert.match(r.block.label, /Dinner/);
});

test('sunday puts the lights out an hour before saturday does', () => {
  /* The differing weekend shapes: at 22:30 Saturday is still free time,
     Sunday has already started winding down for a 6:30 Monday. */
  const sun = resolveNow('sun', 1350);        // 22:30
  assert.equal(sun.state, 'now');
  assert.match(sun.block.label, /Lights out/);
  const sat = resolveNow('sat', 1350);
  assert.equal(sat.state, 'now');
  assert.match(sat.block.label, /Completely free/);
  assert.equal(resolveNow('sat', 1395).block.label, 'Lights out');   // 23:15
});

test('istDateISO files a tick under the Kolkata date, not the device one', () => {
  // 20:00Z on the 19th is already 01:30 on the 20th in IST.
  assert.equal(istDateISO(new Date('2026-08-19T20:00:00Z')), '2026-08-20');
  // 18:29Z on the 20th is 23:59 IST, still the 20th.
  assert.equal(istDateISO(new Date('2026-08-20T18:29:00Z')), '2026-08-20');
  // …one minute later it is the 21st in Pune while UTC is still on the 20th.
  assert.equal(istDateISO(new Date('2026-08-20T18:30:00Z')), '2026-08-21');
});
