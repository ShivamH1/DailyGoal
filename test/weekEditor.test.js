import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockErrorKey, copyWeek, draftFromWeek, groupErrors, locateError, mountWeekEditor,
  laneDisplayName, missingLaneKeys, nextBlockTimes, parseTimeInput, sortBlocks,
} from '../weekEditor.js';
import { DAY_KEYS, validateWeek } from '../schedule.js';

test('parseTimeInput accepts the twelve-hour style the page displays', () => {
  assert.equal(parseTimeInput('6:45 am'), 405);
  assert.equal(parseTimeInput('6:45 pm'), 1125);
  assert.equal(parseTimeInput('12:00 am'), 0);
  assert.equal(parseTimeInput('12:00 pm'), 720);
});

test('parseTimeInput accepts a 24-hour value too', () => {
  /* An <input type="time"> hands back '18:30' regardless of what the page
     displays, so both spellings have to parse. */
  assert.equal(parseTimeInput('18:30'), 1110);
  assert.equal(parseTimeInput('06:45'), 405);
});

test('parseTimeInput rejects nonsense rather than guessing', () => {
  for (const bad of ['', 'later', '25:00', '6:75', '-1:00', null, undefined]) {
    assert.equal(parseTimeInput(bad), null, `accepted ${bad}`);
  }
});

test('midnight at the end of a day is 1440, not 0', () => {
  /* A block running to midnight must not end before it starts. */
  assert.equal(parseTimeInput('24:00'), 1440);
});

/* ---------- the rest of the pure logic ---------- */

test('sortBlocks orders by start and hands back a new array', () => {
  const blocks = [{ start: 600 }, { start: 540 }, { start: 1200 }];
  const sorted = sortBlocks(blocks);
  assert.deepEqual(sorted.map((b) => b.start), [540, 600, 1200]);
  /* The caller's own array is never reordered under it: app.js's `week` can
     be the cached scheduleDoc.value itself. */
  assert.deepEqual(blocks.map((b) => b.start), [600, 540, 1200]);
  assert.notEqual(sorted, blocks);
});

test('sortBlocks puts a block with an unreadable start last instead of scrambling', () => {
  /* Infinity - Infinity is NaN, and a NaN comparator lets sort() do
     anything at all — including dropping the readable blocks out of order. */
  const sorted = sortBlocks([{ start: 'nine' }, { start: 600 }, { start: null }, { start: 540 }]);
  assert.deepEqual(sorted.slice(0, 2).map((b) => b.start), [540, 600]);
  assert.equal(sorted.length, 4);
});

test('copyWeek shares no object with what it was given', () => {
  /* gateWeek returns doc.value BY IDENTITY, so anything this editor mutates
     in place would be mutating app.js's cached envelope — a half-finished
     edit already inside scheduleDoc, pushed on the next flush under the old
     timestamp. */
  const week = { mon: { title: 'Monday', blocks: [{ label: 'Work', lane: 'focus', start: 540, end: 600 }] } };
  const copy = copyWeek(week);
  assert.deepEqual(copy, week);
  assert.notEqual(copy, week);
  assert.notEqual(copy.mon, week.mon);
  assert.notEqual(copy.mon.blocks, week.mon.blocks);
  assert.notEqual(copy.mon.blocks[0], week.mon.blocks[0]);
});

test('draftFromWeek gives every day a blocks array without touching the original', () => {
  const week = { thu: { title: 'Thursday' } };          /* valid: a day may carry no blocks key */
  const draft = draftFromWeek(week);
  for (const key of DAY_KEYS) assert.ok(Array.isArray(draft[key].blocks), `${key} has no blocks array`);
  assert.equal(draft.thu.title, 'Thursday');
  assert.deepEqual(week, { thu: { title: 'Thursday' } });
});

test('draftFromWeek keeps block fields the editor does not edit', () => {
  /* block.effort is rendered by app.js and has no field in this editor. An
     editor that rebuilt blocks from a whitelist would delete it on save. */
  const draft = draftFromWeek({
    mon: { blocks: [{ label: 'Work', lane: 'focus', start: 540, end: 600, effort: { text: 'hard', cls: 'hi' } }] },
  });
  assert.deepEqual(draft.mon.blocks[0].effort, { text: 'hard', cls: 'hi' });
});

test('draftFromWeek sorts each day, so a stored week that is out of order opens in order', () => {
  const draft = draftFromWeek({ mon: { blocks: [{ start: 900 }, { start: 300 }] } });
  assert.deepEqual(draft.mon.blocks.map((b) => b.start), [300, 900]);
});

test('locateError reads back the position validateWeek writes', () => {
  assert.deepEqual(locateError('mon[2]: needs a label'), { dayKey: 'mon', index: 2, text: 'needs a label' });
  /* Not a block position: a whole-day or whole-week complaint, which must
     not be forced onto some row it is not about. */
  assert.equal(locateError('mon: blocks is not a list'), null);
  assert.equal(locateError('week must be an object'), null);
  /* Three letters are not enough — the day key has to be a real one. */
  assert.equal(locateError('xyz[0]: needs a label'), null);
});

test('groupErrors keeps every message, placed or not', () => {
  const { byBlock, general } = groupErrors([
    'mon[0]: needs a label',
    'mon[0]: unknown lane "gone"',
    'tue[1]: overlaps the previous block',
    'week must be an object',
  ]);
  assert.deepEqual(byBlock.get('mon[0]'), ['needs a label', 'unknown lane "gone"']);
  assert.deepEqual(byBlock.get('tue[1]'), ['overlaps the previous block']);
  assert.deepEqual(general, ['week must be an object']);
});

test('the errors validateWeek actually produces are all locatable', () => {
  /* The message format is schedule.js's, and locateError reads it by hand.
     Asserting against hand-written strings above would keep passing after
     that format drifted, with every error silently falling through to the
     general box; this runs the real validator over a week that breaks every
     per-block rule it has. */
  const week = {
    mon: { blocks: [
      { label: '', lane: 'nope', start: 600, end: 500 },
      { label: 'B', lane: 'focus', start: 100, end: 200, timeText: 7 },
      { label: 'C', lane: 'focus', start: 'x', end: 200 },
    ] },
  };
  const { ok, errors } = validateWeek(week, ['focus']);
  assert.equal(ok, false);
  assert.ok(errors.length >= 5, `expected several errors, got ${errors.length}`);
  const { general } = groupErrors(errors);
  assert.deepEqual(general, [], 'every per-block error must land on a block');
});

test('nextBlockTimes starts a new block after the day already ends', () => {
  assert.deepEqual(nextBlockTimes([]), { start: 540, end: 600 });
  assert.deepEqual(nextBlockTimes([{ end: 600 }, { end: 900 }]), { start: 900, end: 960 });
  /* Never past the end of the day, and never inverted. */
  assert.deepEqual(nextBlockTimes([{ end: 1440 }]), { start: 1380, end: 1440 });
});

/* ---------- driving the real editor, with no browser ----------
   The same hand-rolled DOM stand-in test/profileEditor.test.js already uses
   for the sibling editor, extended with <select>/<option> because this one
   has a lane picker. It is a few dozen lines of plain object literals, not a
   dependency — this repo has no runtime or dev dependencies and this adds
   none. mountWeekEditor takes `root` as a parameter and never touches
   `document` at module scope precisely so it can be driven here.

   These are the properties that could not be checked any other way: that the
   editor never mutates the object app.js handed it (gateWeek returns
   scheduleDoc.value by identity, so mutating it corrupts the cached envelope
   under its old timestamp), and that a refused save is never reported as a
   save. */
function makeDoc() {
  function createTextNode(text) {
    const node = { tagName: '#text', children: [], parentNode: null, textContent: String(text) };
    return node;
  }
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      parentNode: null,
      className: '',
      type: '',
      placeholder: '',
      disabled: false,
      open: false,
      _text: '',
      _value: '',
      listeners: {},
      attrs: {},
      setAttribute(name, v) { el.attrs[name] = String(v); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null; },
      get value() { return el._value; },
      set value(v) {
        /* A real <select> cannot hold a value none of its options carry — it
           reads back ''. The editor relies on that being true (it adds an
           option for an unknown lane precisely so the stored value stays
           visible), so the stand-in has to behave the same way or the test
           would be checking something the browser does not do. */
        if (el.tagName === 'SELECT' && !el.children.some((c) => c.tagName === 'OPTION' && c.value === String(v))) {
          el._value = '';
          return;
        }
        el._value = String(v);
      },
      get textContent() {
        return el.children.length ? el.children.map((c) => c.textContent).join('') : el._text;
      },
      set textContent(v) { el._text = String(v); el.children = []; },
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      append(...items) {
        for (const item of items) el.appendChild(typeof item === 'string' ? createTextNode(item) : item);
      },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      /* The event object carries preventDefault because <dialog>'s 'cancel'
         (what Escape fires) is cancellable and the editor cancels it while
         there are unsaved changes. A stand-in without it would let that
         guard pass here and throw in a browser. */
      dispatch(type) {
        const event = { target: el, defaultPrevented: false, preventDefault() { event.defaultPrevented = true; } };
        (el.listeners[type] || []).forEach((fn) => fn(event));
        return event;
      },
      showModal() { el.open = true; },
      close() { el.open = false; },
    };
    return el;
  }
  return { createElement, createTextNode };
}

function makeRoot() {
  const doc = makeDoc();
  const root = doc.createElement('div');
  root.ownerDocument = doc;
  return root;
}

function collect(el, out = []) {
  out.push(el);
  for (const c of el.children) collect(c, out);
  return out;
}
const findAll = (root, pred) => collect(root).filter(pred);
const byClass = (root, cls) => findAll(root, (el) => el.className === cls);
const button = (root, text) => findAll(root, (el) => el.tagName === 'BUTTON' && el.textContent === text)[0];
const control = (row, aria) => findAll(row, (el) => el.getAttribute('aria-label') === aria)[0];
const rows = (root) => byClass(root, 'wk-block');
const daySection = (root, dayKey) => byClass(root, 'wk-day')[DAY_KEYS.indexOf(dayKey)];
const dialogOf = (root) => findAll(root, (el) => el.tagName === 'DIALOG')[0];
const statusOf = (root) => findAll(root, (el) => el.className.startsWith('wk-status'))[0];

const LANES = [{ key: 'focus', name: 'Focus' }, { key: 'rest', name: 'Rest' }];
const oneBlockWeek = () => ({
  mon: { title: 'Monday', blocks: [{ label: 'Work', lane: 'focus', start: 540, end: 600 }] },
});

function mounted(week, opts = {}) {
  const root = makeRoot();
  const handed = [];
  mountWeekEditor({
    root,
    getWeek: opts.getWeek || (() => week),
    getLanes: opts.getLanes || (() => LANES),
    onChange: (next) => { handed.push(next); return 'result' in opts ? opts.result : true; },
    ...(opts.getSaveRefusal ? { getSaveRefusal: opts.getSaveRefusal } : {}),
    ...(opts.getStoredWeek ? { getStoredWeek: opts.getStoredWeek } : {}),
    ...(opts.onRestoreLanes ? { onRestoreLanes: opts.onRestoreLanes } : {}),
  });
  return { root, handed, open: () => button(root, 'Edit the week').dispatch('click') };
}

test('editing never touches the week object it was handed, and hands back one that shares nothing with it', () => {
  const week = oneBlockWeek();
  const before = JSON.parse(JSON.stringify(week));
  const { root, handed, open } = mounted(week);
  open();

  control(rows(root)[0], 'Block label').value = 'Deep work';
  control(rows(root)[0], 'Block label').dispatch('blur');
  button(root, 'Add block').dispatch('click');
  control(rows(root)[1], 'Block label').value = 'Review';
  control(rows(root)[1], 'Block label').dispatch('blur');
  button(root, 'Save the week').dispatch('click');

  /* app.js's `week` IS scheduleDoc.value whenever the stored week is valid.
     Not one byte of it may change because an editor was opened over it. */
  assert.deepEqual(week, before);
  assert.equal(handed.length, 1);
  const next = handed[0];
  assert.notEqual(next, week);
  assert.notEqual(next.mon, week.mon);
  assert.notEqual(next.mon.blocks, week.mon.blocks);
  assert.notEqual(next.mon.blocks[0], week.mon.blocks[0]);
  assert.equal(next.mon.blocks[0].label, 'Deep work');
});

test('a save the app refuses is never reported as a save', () => {
  const { root, handed, open } = mounted(oneBlockWeek(), { result: false });
  open();
  button(root, 'Save the week').dispatch('click');

  assert.equal(handed.length, 1, 'the week is still offered to the app');
  assert.equal(dialogOf(root).open, true, 'the dialog must stay open so the edit is not lost');
  const text = statusOf(root).textContent;
  assert.match(text, /Not saved/);
  assert.doesNotMatch(text, /✓|Saved\./);
});

test('an onChange that cannot say whether it saved is treated as not saved', () => {
  /* commitSchedule returns a boolean. A caller wired to an older signature
     returns undefined, and guessing that undefined means success is exactly
     the bug this project keeps reintroducing — so only a literal true
     counts. */
  const { root, open } = mounted(oneBlockWeek(), { result: undefined });
  open();
  button(root, 'Save the week').dispatch('click');
  assert.match(statusOf(root).textContent, /Not saved/);
});

test('an invalid week is never offered to the app, and every error lands on its own block', () => {
  const week = {
    mon: { blocks: [
      { label: 'A', lane: 'focus', start: 540, end: 660 },
      { label: 'B', lane: 'focus', start: 600, end: 700 },
    ] },
    tue: { blocks: [{ label: '', lane: 'gone', start: 540, end: 600 }] },
  };
  const { root, handed, open } = mounted(week);
  open();
  button(root, 'Save the week').dispatch('click');

  assert.equal(handed.length, 0, 'an invalid week must not reach commitSchedule at all');
  const errorLists = byClass(root, 'wk-block-errors');
  assert.match(errorLists[1].textContent, /overlaps the previous block/);
  assert.match(errorLists[2].textContent, /needs a label/);
  assert.match(errorLists[2].textContent, /unknown lane/);
  assert.equal(errorLists[0].textContent, '', 'the block that is fine says nothing');
  assert.equal(byClass(root, 'wk-general-error').length, 0, 'nothing falls through to the general box');
  assert.match(statusOf(root).textContent, /Not saved/);
});

test('deleting the last block of a day leaves its empty state and still saves a valid day', () => {
  const week = oneBlockWeek();
  const { root, handed, open } = mounted(week);
  open();
  button(root, 'Delete').dispatch('click');

  assert.equal(rows(root).length, 0);
  assert.equal(byClass(root, 'wk-day-empty')[0].textContent, 'Nothing planned for Monday yet.');

  button(root, 'Save the week').dispatch('click');
  assert.equal(handed.length, 1);
  /* An empty array, not a deleted key and not null — app.js's renderDay and
     schedule.js's validateWeek both have to keep working on it. */
  assert.deepEqual(handed[0].mon.blocks, []);
  assert.equal(validateWeek(handed[0], ['focus']).ok, true);
});

test('when the stored week cannot be read, the editor offers an explanation instead of a form', () => {
  /* Otherwise it is a trap: the user builds a week, presses Save, and only
     then finds out commitSchedule refuses while weekIsFallback is up. */
  const { root, open } = mounted(oneBlockWeek(), {
    getSaveRefusal: () => 'your stored week could not be read; it was left untouched',
  });
  open();
  assert.equal(rows(root).length, 0);
  assert.equal(button(root, 'Add block'), undefined);
  assert.equal(button(root, 'Save the week').disabled, true);
  assert.match(byClass(root, 'wk-refusal')[0].textContent, /could not be read/);
});

test('changing a start time re-sorts the day rather than offering a reorder control', () => {
  const week = { mon: { blocks: [
    { label: 'A', lane: 'focus', start: 540, end: 600 },
    { label: 'B', lane: 'focus', start: 660, end: 700 },
  ] } };
  const { root, handed, open } = mounted(week);
  open();
  assert.equal(button(root, 'Move up'), undefined, 'order is a fact about the times, not a preference');

  control(rows(root)[1], 'Start time').value = '08:00';
  control(rows(root)[1], 'Start time').dispatch('change');

  /* The rows are rebuilt in the new order, so B is now first — which is why
     the end field has to be found again rather than held from before. Moving
     a start does not drag the end along with it, so B is 8:00–11:40 until
     its end moves too. */
  assert.deepEqual(rows(root).map((r) => control(r, 'Block label').value), ['B', 'A']);
  control(rows(root)[0], 'End time').value = '08:30';
  control(rows(root)[0], 'End time').dispatch('change');

  button(root, 'Save the week').dispatch('click');
  assert.deepEqual(handed[0].mon.blocks.map((b) => [b.start, b.end]), [[480, 510], [540, 600]]);
});

test('the week and the lanes are read fresh on every open, never snapshotted at mount', () => {
  /* app.js's regateWeek() reassigns `week` wholesale — from commitProfile,
     from the sync merge and on cold load — and a profile edit can change the
     lane set while this editor is mounted. */
  let week = { mon: { blocks: [{ label: 'First', lane: 'focus', start: 540, end: 600 }] } };
  let lanes = [{ key: 'focus', name: 'Focus' }];
  const { root, open } = mounted(null, { getWeek: () => week, getLanes: () => lanes });
  open();
  assert.equal(control(rows(root)[0], 'Block label').value, 'First');
  dialogOf(root).close();

  week = { mon: { blocks: [{ label: 'Second', lane: 'deep', start: 540, end: 600 }] } };
  lanes = [{ key: 'deep', name: 'Deep' }];
  open();
  assert.equal(control(rows(root)[0], 'Block label').value, 'Second');
  assert.equal(control(rows(root)[0], 'Lane').value, 'deep');
});

test('a block that ends at midnight keeps its 1440 through an edit to another field', () => {
  /* An <input type="time"> tops out at 23:59 and reads back '' for anything
     it cannot show, so reading every field at save time would silently turn
     "ends at midnight" into "no end time". */
  const week = { mon: { blocks: [{ label: 'Wind down', lane: 'rest', start: 1380, end: 1440 }] } };
  const { root, handed, open } = mounted(week);
  open();
  assert.equal(control(rows(root)[0], 'End time').value, '');
  assert.match(byClass(root, 'wk-block-note')[0].textContent, /midnight/);

  control(rows(root)[0], 'Block label').value = 'Lights out';
  control(rows(root)[0], 'Block label').dispatch('blur');
  button(root, 'Save the week').dispatch('click');
  assert.equal(handed[0].mon.blocks[0].end, 1440);
});

test('editing on after a save does not reach back into the week that was already committed', () => {
  /* The second-order shape of the same trap. After a successful save app.js
     holds the handed-over object as `week`, and gateWeek makes that the same
     object as scheduleDoc.value — so if the still-open dialog kept editing
     it, a later flush would push a half-typed block under the timestamp of
     the save that already happened. */
  const { root, handed, open } = mounted(oneBlockWeek());
  open();
  button(root, 'Save the week').dispatch('click');
  const committed = JSON.parse(JSON.stringify(handed[0]));

  control(rows(root)[0], 'Block label').value = 'Something else entirely';
  control(rows(root)[0], 'Block label').dispatch('blur');
  button(root, 'Delete').dispatch('click');

  assert.deepEqual(handed[0], committed);
});

test('an unparseable time is refused out loud instead of written as a null start', () => {
  /* A cleared or garbled field must not become `null`, which validateWeek
     would then report as "start and end must be whole minutes" — a message
     about a value the user never entered. */
  const { root, open } = mounted(oneBlockWeek());
  open();
  const start = control(rows(root)[0], 'Start time');
  start.value = 'later';
  start.dispatch('change');
  assert.equal(start.value, '09:00', 'the field is put back to what is stored');
  assert.match(byClass(root, 'wk-block-note')[0].textContent, /not a time/);
});

test('a block whose lane no longer exists keeps showing that lane rather than being silently reassigned', () => {
  /* Re-pointing a block at some other lane just by rendering it would change
     the user's data without asking. validateWeek's "unknown lane" error is
     what should tell them, on save. */
  const week = { mon: { blocks: [{ label: 'Work', lane: 'gone', start: 540, end: 600 }] } };
  const { root, handed, open } = mounted(week);
  open();
  assert.equal(control(rows(root)[0], 'Lane').value, 'gone');
  button(root, 'Save the week').dispatch('click');
  assert.equal(handed.length, 0);
  assert.match(byClass(root, 'wk-block-errors')[0].textContent, /unknown lane "gone"/);
});

/* ---------- a day's own name ---------- */
/* week[dayKey].title has been in the data model, on the day panel's heading
   and in the still-used-lane refusal all along, with nothing anywhere able to
   set one — so both of those could only ever take their DAY_NAMES fallback.
   These are the tests for the field that closes that loop. */

test('a day can be given a name, and only the copy handed back carries it', () => {
  const week = oneBlockWeek();
  const before = JSON.parse(JSON.stringify(week));
  const { root, handed, open } = mounted(week);
  open();

  const name = control(daySection(root, 'tue'), 'Name for Tuesday');
  assert.equal(name.value, '', 'a day with no name opens with an empty field');
  name.value = 'Match day';
  name.dispatch('blur');
  button(root, 'Save the week').dispatch('click');

  /* The same copy discipline every other field in here obeys: gateWeek hands
     back scheduleDoc.value BY IDENTITY, so a title written into the object
     app.js is holding would already be inside the cached envelope before the
     user ever pressed Save. */
  assert.deepEqual(week, before, 'the week app.js holds is untouched');
  assert.equal(handed[0].tue.title, 'Match day');
  assert.notEqual(handed[0].tue, week.tue);
  assert.equal(validateWeek(handed[0], ['focus', 'rest']).ok, true);
});

test('the field can only put a string in the week, which is what keeps renderDay safe', () => {
  /* validateWeek does not type-check a day title, so Task 18's invariant —
     anything the validator calls valid must render without throwing — is
     held up here by the field itself. app.js's renderDay filters a non-string
     title for the sake of documents that predate this field; the field must
     never be able to add another one. An <input> stores whatever it is given
     as a string (the stand-in models that, because a browser does it), and
     .trim() of a string is a string. */
  const { root, handed, open } = mounted({});
  open();
  const name = control(daySection(root, 'mon'), 'Name for Monday');
  name.value = 7;
  name.dispatch('blur');
  button(root, 'Save the week').dispatch('click');

  assert.equal(typeof handed[0].mon.title, 'string');
  assert.equal(handed[0].mon.title, '7');
});

test('clearing a day name takes the key out rather than storing an empty string', () => {
  /* '' and absent look identical on screen — renderDay and getLaneUsage both
     fall back with `|| DAY_NAMES[k]` — and differ in what gets pushed to the
     server and in what a diff of the stored document shows. Absent is what
     "this day has no name" means, and it is what every other optional field
     in this editor does with an emptied value. */
  const week = { mon: { title: 'Match day', blocks: [] } };
  const { root, handed, open } = mounted(week);
  open();

  const name = control(daySection(root, 'mon'), 'Name for Monday');
  assert.equal(name.value, 'Match day', 'a stored name opens in the field');
  name.value = '   ';
  name.dispatch('blur');
  button(root, 'Save the week').dispatch('click');

  assert.equal('title' in handed[0].mon, false, 'no empty string left behind');
  assert.equal(validateWeek(handed[0], ['focus']).ok, true);
});

test('a name typed and then cleared in one sitting really is cleared', () => {
  /* The field is not re-rendered on blur, so what the next blur compares
     against has to be the draft read live. Comparing against the value the
     field was BUILT with would make this second blur a no-op — '' against the
     original '' — and the name the user just deleted would be saved. */
  const { root, handed, open } = mounted({ mon: { blocks: [] } });
  open();
  const name = control(daySection(root, 'mon'), 'Name for Monday');
  name.value = 'Match day';
  name.dispatch('blur');
  name.value = '';
  name.dispatch('blur');
  button(root, 'Save the week').dispatch('click');

  assert.equal('title' in handed[0].mon, false, 'the cleared name did not come back');
});

test('a named day still says which day it is', () => {
  /* The heading does not follow the title. This dialog is seven sections
     long, and a Tuesday whose only identifying line reads 'Match day' cannot
     be found in it — the name is the thing being edited, not the label of the
     thing being edited. */
  const { root, open } = mounted({ tue: { title: 'Match day', blocks: [] } });
  open();
  const section = daySection(root, 'tue');

  assert.equal(findAll(section, (el) => el.tagName === 'H3')[0].textContent, 'Tuesday');
  assert.equal(control(section, 'Name for Tuesday').value, 'Match day');
  assert.equal(byClass(section, 'wk-day-empty')[0].textContent, 'Nothing planned for Tuesday yet.');
});

test('an unnamed day offers the name the page would use instead of demanding one', () => {
  /* Most days have no name and that is the finished state, so the empty field
     has to read as answered rather than as blank — the same reason 'Shown as'
     is placeheld with the range it would override. */
  const { root, open } = mounted({});
  open();
  const name = control(daySection(root, 'sat'), 'Name for Saturday');
  assert.equal(name.value, '');
  assert.equal(name.placeholder, 'Saturday');
});

test('naming a day arms the unsaved-changes guard like any other edit', () => {
  const { root, open } = mounted(oneBlockWeek());
  open();
  const name = control(daySection(root, 'tue'), 'Name for Tuesday');
  name.value = 'Match day';
  name.dispatch('blur');
  assert.match(statusOf(root).textContent, /Unsaved changes/);

  button(root, 'Close').dispatch('click');
  assert.equal(dialogOf(root).open, true, 'an unsaved name is not thrown away silently');
  button(root, 'Close').dispatch('click');
  assert.equal(dialogOf(root).open, false);
});

/* ---------- the recovery the refusal offers ---------- */

test('missingLaneKeys names exactly the lanes a stored week points at that the profile lacks', () => {
  /* The refusal used to tell the user to "add that lane back under Edit
     profile", which the profile editor cannot do: newLaneKey only ever emits
     lane1, lane2, … and no lane-key field exists anywhere. So the editor has
     to work out the keys itself. */
  const stored = {
    mon: { blocks: [{ label: 'A', lane: 'study', start: 540, end: 600 }] },
    tue: { blocks: [{ label: 'B', lane: 'work', start: 540, end: 600 },
                    { label: 'C', lane: 'study', start: 600, end: 660 }] },
  };
  assert.deepEqual(missingLaneKeys(stored, ['work']), ['study']);
  assert.deepEqual(missingLaneKeys(stored, ['work', 'study']), []);
  /* First-seen order, and each key once however many blocks use it. */
  assert.deepEqual(missingLaneKeys(stored, []), ['study', 'work']);
});

test('missingLaneKeys ignores a block with no usable lane at all', () => {
  /* '' and a non-string are not lanes that can be restored — there is no key
     to create. validateWeek still reports them; this function only answers
     "which lanes could be put back". */
  const stored = { mon: { blocks: [{ lane: '' }, { lane: null }, { lane: 7 }, { lane: 'study' }] } };
  assert.deepEqual(missingLaneKeys(stored, []), ['study']);
  assert.deepEqual(missingLaneKeys(null, []), []);
  assert.deepEqual(missingLaneKeys({ mon: 'not a day' }, []), []);
});

test('laneDisplayName turns a stored key into something a person would read', () => {
  /* The restored lane needs a name, and the refusal has to say which lanes
     it is offering to put back. A raw key is an internal identifier, not
     user-facing content, so it is title-cased into one. */
  assert.equal(laneDisplayName('study'), 'Study');
  assert.equal(laneDisplayName('deep_work'), 'Deep Work');
  assert.equal(laneDisplayName('deep-work'), 'Deep Work');
  /* Nothing readable left: better the key than an empty lane name, which
     normalizeProfile would drop on the spot. */
  assert.equal(laneDisplayName('__'), '__');
});

/* ---------- the refusal has to offer a recovery the app can actually do ---------- */

const REFUSAL = 'your stored week could not be read; it was left untouched';

test('the refusal names the lanes the stored week is missing and offers to put them back', () => {
  /* The old hint told the user to add the lane back under "Edit profile".
     profileEditor.js's newLaneKey only ever emits lane1, lane2, … and there
     is no lane-key field in either editor, so a week referencing 'study'
     could never be recovered by following that instruction — a permanent
     lockout described as a fix. The editor knows the keys, so it does it. */
  const stored = {
    mon: { blocks: [{ label: 'Revision', lane: 'study', start: 540, end: 600 }] },
    wed: { blocks: [{ label: 'Standup', lane: 'focus', start: 540, end: 600 }] },
  };
  const restored = [];
  const { root, open } = mounted(null, {
    getSaveRefusal: () => REFUSAL,
    getStoredWeek: () => stored,
    onRestoreLanes: (keys) => { restored.push(keys); return false; },
  });
  open();

  const hint = byClass(root, 'wk-refusal-hint')[0].textContent;
  assert.match(hint, /Study/, 'the missing lane is named');
  assert.doesNotMatch(hint, /Edit profile/, 'no instruction the profile editor cannot carry out');

  const restore = button(root, 'Restore the missing lane');
  assert.ok(restore, 'a control that performs the recovery, not just a description of one');
  restore.dispatch('click');
  assert.deepEqual(restored, [['study']], 'the exact stored key, not a freshly invented lane1');
});

test('restoring the missing lanes opens the real form, with the stored week in it', () => {
  /* One action, no dead end: the whole point is that the user is not sent
     somewhere else to finish the job. */
  const stored = { mon: { blocks: [{ label: 'Revision', lane: 'study', start: 540, end: 600 }] } };
  let lanes = [{ key: 'focus', name: 'Focus' }];
  let refusal = REFUSAL;
  const { root, open } = mounted(null, {
    getWeek: () => stored,
    getLanes: () => lanes,
    getSaveRefusal: () => refusal,
    getStoredWeek: () => stored,
    onRestoreLanes: (keys) => {
      lanes = [...lanes, ...keys.map((k) => ({ key: k, name: laneDisplayName(k) }))];
      refusal = null;                                   /* the gate re-ran and the week is readable */
      return true;
    },
  });
  open();
  assert.equal(rows(root).length, 0, 'no form while the week is unreadable');

  button(root, 'Restore the missing lane').dispatch('click');
  assert.equal(rows(root).length, 1, 'the stored week is now editable');
  assert.equal(control(rows(root)[0], 'Block label').value, 'Revision');
  assert.equal(control(rows(root)[0], 'Lane').value, 'study', 'the block still points at its own lane');
  assert.equal(button(root, 'Save the week').disabled, false);
});

test('a refusal with no missing lane offers no button and gives no instruction', () => {
  /* Something else in the stored week is wrong — an overlap, a block with no
     label. There is nothing safe the app can do about that on its own, so it
     says so rather than inventing a step. */
  const stored = { mon: { blocks: [{ label: '', lane: 'focus', start: 540, end: 600 }] } };
  const { root, open } = mounted(null, {
    getSaveRefusal: () => REFUSAL,
    getStoredWeek: () => stored,
    onRestoreLanes: () => true,
  });
  open();
  assert.equal(button(root, 'Restore the missing lane'), undefined);
  assert.equal(button(root, 'Restore the missing lanes'), undefined);
  const hint = byClass(root, 'wk-refusal-hint')[0].textContent;
  assert.doesNotMatch(hint, /Edit profile/);
  assert.match(hint, /untouched/);
});

test('a restore that does not make the week readable says so instead of vanishing', () => {
  /* The lanes went back but the week is still refused — an overlap as well
     as a missing lane. Showing the form would be a lie; showing the same
     "press this" panel again would be a loop. */
  const stored = {
    mon: { blocks: [{ label: 'A', lane: 'study', start: 540, end: 700 },
                    { label: 'B', lane: 'study', start: 600, end: 660 }] },
  };
  let missingGone = false;
  const { root, open } = mounted(null, {
    getSaveRefusal: () => REFUSAL,
    getStoredWeek: () => stored,
    getLanes: () => (missingGone ? [{ key: 'study', name: 'Study' }] : []),
    onRestoreLanes: () => { missingGone = true; return false; },
  });
  open();
  button(root, 'Restore the missing lane').dispatch('click');

  assert.equal(rows(root).length, 0, 'the week is still not editable');
  assert.equal(button(root, 'Restore the missing lane'), undefined, 'nothing left to restore');
  assert.match(byClass(root, 'wk-refusal')[0].textContent, /could not be read/);
});

/* ---------- unsaved changes ---------- */

test('closing with unsaved changes warns once before discarding them', () => {
  const { root, open } = mounted(oneBlockWeek());
  open();
  control(rows(root)[0], 'Block label').value = 'Deep work';
  control(rows(root)[0], 'Block label').dispatch('blur');

  button(root, 'Close').dispatch('click');
  assert.equal(dialogOf(root).open, true, 'the first press must not throw the edit away');
  assert.match(statusOf(root).textContent, /Unsaved changes/);

  button(root, 'Close').dispatch('click');
  assert.equal(dialogOf(root).open, false, 'the second press is the confirmation');
});

test('Escape is held back once too, and lets go the second time', () => {
  /* <dialog> closes on Escape by default, which is exactly as lossy as the
     Close button was. 'cancel' is the cancellable event that fires first. */
  const { root, open } = mounted(oneBlockWeek());
  open();
  button(root, 'Add block').dispatch('click');

  assert.equal(dialogOf(root).dispatch('cancel').defaultPrevented, true);
  assert.match(statusOf(root).textContent, /Unsaved changes/);
  assert.equal(dialogOf(root).dispatch('cancel').defaultPrevented, false);
});

test('a clean dialog closes on the first press', () => {
  const { root, open } = mounted(oneBlockWeek());
  open();
  button(root, 'Close').dispatch('click');
  assert.equal(dialogOf(root).open, false);
});

test('a saved dialog is clean again, and a fresh edit re-arms the warning', () => {
  const { root, open } = mounted(oneBlockWeek());
  open();
  button(root, 'Add block').dispatch('click');
  control(rows(root)[1], 'Block label').value = 'Review';
  control(rows(root)[1], 'Block label').dispatch('blur');
  button(root, 'Save the week').dispatch('click');

  button(root, 'Close').dispatch('click');
  assert.equal(dialogOf(root).open, false, 'nothing is unsaved after a successful save');

  open();
  button(root, 'Add block').dispatch('click');
  button(root, 'Close').dispatch('click');
  assert.equal(dialogOf(root).open, true, 'the guard is armed again by the new edit');
});

test('the failed-write message does not claim the edit is only on this screen', () => {
  /* commitSchedule arms the remote flush even when the local write fails, so
     after a failed save the queue really does hold the edit — "still only on
     this screen" is false. It errs safe, but it is not true. */
  const { root, open } = mounted(oneBlockWeek(), { result: false });
  open();
  button(root, 'Save the week').dispatch('click');
  const text = statusOf(root).textContent;
  assert.match(text, /Not saved/);
  assert.doesNotMatch(text, /only on this screen/);
});

test('a block field typed and then cleared in one sitting really is cleared', () => {
  /* The blur guard compared each edit against the value captured when the
     field was BUILT, and nothing rebuilds the row on blur. So typing into an
     empty Subject and then emptying it again compared '' to the ORIGINAL '',
     returned early, and saved the text the user had just deleted — the field
     looked empty on screen and was not empty in the week. Every optional
     block field could keep a value its user had explicitly removed. */
  const { root, handed, open } = mounted(oneBlockWeek());
  open();
  const subject = () => control(rows(root)[0], 'Block subject');

  subject().value = 'Algebra';
  subject().dispatch('blur');
  subject().value = '';
  subject().dispatch('blur');

  button(root, 'Save the week').dispatch('click');
  assert.equal(handed[0].mon.blocks[0].subject, undefined,
    'the cleared subject came back');
});
