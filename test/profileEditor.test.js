import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountProfileEditor } from '../profileEditor.js';
import { defaultProfile, normalizeProfile, DEFAULT_LANES } from '../profile.js';

/* profileEditor.js takes `root` as a parameter rather than importing
   `document`, precisely so it can be driven here with no browser at all — a
   hand-rolled DOM stand-in, just enough of createElement/appendChild/
   textContent/addEventListener for the editor to build and be inspected.
   Nothing beyond that vocabulary is implemented, because profileEditor.js
   uses nothing beyond it (no querySelector, no dataset — it keeps its own
   references in closures instead of querying itself back). */
function makeDoc() {
  function createTextNode(text) {
    const node = {
      tagName: '#text',
      children: [],
      parentNode: null,
      textContent: String(text),
      remove() {
        if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
      },
    };
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
      value: '',
      disabled: false,
      _text: '',
      listeners: {},
      attrs: {},
      setAttribute(name, v) { el.attrs[name] = String(v); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null; },
      removeAttribute(name) { delete el.attrs[name]; },
      get textContent() {
        return el.children.length ? el.children.map((c) => c.textContent).join('') : el._text;
      },
      set textContent(v) {
        el._text = String(v);
        el.children = [];
      },
      appendChild(child) {
        el.children.push(child);
        child.parentNode = el;
        return child;
      },
      append(...items) {
        for (const item of items) el.appendChild(typeof item === 'string' ? createTextNode(item) : item);
      },
      remove() {
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
      },
      addEventListener(type, fn) {
        (el.listeners[type] ||= []).push(fn);
      },
      dispatch(type) {
        (el.listeners[type] || []).forEach((fn) => fn({ target: el }));
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
const buttonsNamed = (root, text) => findAll(root, (el) => el.tagName === 'BUTTON' && el.textContent === text);

test('the three core ticks have no delete control at all — not even a disabled one', () => {
  const root = makeRoot();
  const profile = defaultProfile();
  mountProfileEditor({ root, getProfile: () => profile, getLaneUsage: () => new Set(), onChange: () => {} });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const tickRows = findAll(root, (el) => el.className === 'pf-tick-row');
  assert.equal(tickRows.length, 3);
  for (const row of tickRows) {
    assert.equal(findAll(row, (el) => el.tagName === 'BUTTON' && el.textContent === 'Delete').length, 0);
  }
});

test('an extra tick gets a delete control, and deleting it removes it from the profile', () => {
  let changed = null;
  const profile = normalizeProfile({ ticks: [{ key: 'k1', label: 'Read' }] });
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, getLaneUsage: () => new Set(), onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const tickRows = findAll(root, (el) => el.className === 'pf-tick-row');
  assert.equal(tickRows.length, 4); // 3 core + the extra
  const extraDelete = findAll(tickRows[3], (el) => el.tagName === 'BUTTON' && el.textContent === 'Delete')[0];
  assert.ok(extraDelete, 'the extra tick row must carry its own delete button');
  extraDelete.dispatch('click');

  assert.equal(changed.ticks.some((t) => t.key === 'k1'), false);
});

test('adding an extra tick uses newTickKey and shows up as a fourth row', () => {
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, getLaneUsage: () => new Set(), onChange: () => {} });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  buttonsNamed(root, 'Add tick')[0].dispatch('click');
  const tickRows = findAll(root, (el) => el.className === 'pf-tick-row');
  assert.equal(tickRows.length, 4);
});

test('deleting a lane still used by the schedule is refused and says which day', () => {
  let changed = null;
  const profile = defaultProfile(); // DEFAULT_LANES: focus, work, move, commit, rest
  const root = makeRoot();
  mountProfileEditor({
    root,
    getProfile: () => profile,
    getLaneUsage: (key) => (key === 'work' ? new Set(['Monday']) : new Set()),
    onChange: (p) => { changed = p; },
  });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const laneRows = findAll(root, (el) => el.className === 'pf-lane-row');
  const workRow = laneRows[1];
  buttonsNamed(workRow, 'Delete')[0].dispatch('click');

  assert.equal(changed, null, 'a used lane must never reach onChange as deleted');
  const status = findAll(workRow, (el) => el.className === 'pf-lane-status')[0];
  assert.match(status.textContent, /Monday/);
});

test('deleting a lane no schedule block uses succeeds', () => {
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({
    root,
    getProfile: () => profile,
    getLaneUsage: () => new Set(),
    onChange: (p) => { changed = p; },
  });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const laneRows = findAll(root, (el) => el.className === 'pf-lane-row');
  buttonsNamed(laneRows[1], 'Delete')[0].dispatch('click');

  assert.ok(changed);
  assert.equal(changed.lanes.some((l) => l.key === 'work'), false);
});

test('editing the season commits on blur', () => {
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, getLaneUsage: () => new Set(), onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const seasonInput = findAll(root, (el) => el.tagName === 'INPUT' && el.type === 'text')[0];
  seasonInput.value = 'Fall 2026';
  seasonInput.dispatch('blur');

  assert.equal(changed.season, 'Fall 2026');
});

test('a newly added rule with no title yet does not reach onChange, matching normalizeProfile', () => {
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, getLaneUsage: () => new Set(), onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  buttonsNamed(root, 'Add rule')[0].dispatch('click');
  assert.equal(changed, null, 'adding a blank row is not itself a commit');

  const ruleRows = findAll(root, (el) => el.className === 'pf-rule-row');
  assert.equal(ruleRows.length, 1, 'the blank row must still be visible to type into');

  const titleInput = findAll(ruleRows[0], (el) => el.placeholder === 'Title')[0];
  titleInput.value = 'Never miss twice';
  titleInput.dispatch('blur');

  assert.equal(changed.rules.length, 1);
  assert.equal(changed.rules[0].title, 'Never miss twice');
});

/* ---------- fix round 1 ---------- */

test('mounting with no root does nothing rather than throwing', () => {
  assert.doesNotThrow(() => {
    mountProfileEditor({ root: null, getProfile: () => defaultProfile(), onChange: () => {} });
  });
});

test('a missing getLaneUsage does not throw when a lane is deleted', () => {
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  // getLaneUsage deliberately omitted — the default in the destructure must cover it.
  mountProfileEditor({ root, getProfile: () => profile, onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const laneRows = findAll(root, (el) => el.className === 'pf-lane-row');
  assert.doesNotThrow(() => buttonsNamed(laneRows[1], 'Delete')[0].dispatch('click'));
  assert.ok(changed);
  assert.equal(changed.lanes.some((l) => l.key === 'work'), false);
});

test('a rule with a body but no title is not saved, and says so', () => {
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  buttonsNamed(root, 'Add rule')[0].dispatch('click');
  const row = findAll(root, (el) => el.className === 'pf-rule-row')[0];
  const bodyInput = findAll(row, (el) => el.placeholder === 'Body')[0];
  bodyInput.value = 'One day is a rain delay.';
  bodyInput.dispatch('blur');

  assert.equal(changed.rules.length, 0, 'a title-less rule must not be persisted');
  const status = findAll(row, (el) => el.className === 'pf-row-status')[0];
  assert.match(status.textContent, /title/i);
});

test('a deadline with a label but no dates is not saved, and says so', () => {
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  buttonsNamed(root, 'Add deadline')[0].dispatch('click');
  const row = findAll(root, (el) => el.className === 'pf-deadline-row')[0];
  const labelInput = findAll(row, (el) => el.placeholder === 'Label')[0];
  labelInput.value = 'Midterms';
  labelInput.dispatch('blur');

  assert.equal(changed.deadlines.length, 0, 'a dateless deadline must not be persisted');
  const status = findAll(row, (el) => el.className === 'pf-row-status')[0];
  assert.match(status.textContent, /date/i);
});

test('a lane added with no name is not saved, and says so', () => {
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  buttonsNamed(root, 'Add lane')[0].dispatch('click');
  const rows = findAll(root, (el) => el.className === 'pf-lane-row');
  const newRow = rows[rows.length - 1];
  findAll(newRow, (el) => el.tagName === 'INPUT')[0].dispatch('blur');

  assert.equal(changed.lanes.length, DEFAULT_LANES.length, 'the nameless lane must not be persisted');
  const status = findAll(newRow, (el) => el.className === 'pf-lane-status')[0];
  assert.match(status.textContent, /name/i);
});

test('an extra tick added with no label is not saved, and says so', () => {
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  buttonsNamed(root, 'Add tick')[0].dispatch('click');
  const rows = findAll(root, (el) => el.className === 'pf-tick-row');
  const newRow = rows[rows.length - 1];
  findAll(newRow, (el) => el.placeholder === 'Hint')[0].dispatch('blur');

  assert.equal(changed.ticks.filter((t) => !t.core).length, 0, 'a label-less extra must not be persisted');
  const status = findAll(newRow, (el) => el.className === 'pf-row-status')[0];
  assert.match(status.textContent, /label/i);
});

test('deleting the last lane is refused rather than letting normalizeProfile silently resurrect the defaults', () => {
  let changed = null;
  const profile = normalizeProfile({ lanes: [{ key: 'solo', name: 'Solo' }] });
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, getLaneUsage: () => new Set(), onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const rows = findAll(root, (el) => el.className === 'pf-lane-row');
  assert.equal(rows.length, 1);
  buttonsNamed(rows[0], 'Delete')[0].dispatch('click');

  assert.equal(changed, null, 'the only lane must never reach onChange as deleted');
  const status = findAll(rows[0], (el) => el.className === 'pf-lane-status')[0];
  assert.match(status.textContent, /at least one lane/i);
});

test('a tick key still present in stored progress is never reused, even after the tick is deleted', () => {
  /* profile.js's newTickKey only ever avoids collision with the CURRENT
     profile.ticks. Deleting an extra tick does not touch any day it was
     already logged against, so the freed key still carries history —
     handing it to a brand-new invented tick would silently attach that
     history to an unrelated habit. getReservedTickKeys stands in for the
     set of keys app.js finds still present in stored progress. */
  let changed = null;
  const start = normalizeProfile({ ticks: [{ key: 'k1', label: 'Read' }] });
  const root = makeRoot();
  mountProfileEditor({
    root,
    getProfile: () => changed || start,
    getLaneUsage: () => new Set(),
    getReservedTickKeys: () => new Set(['k1']),
    onChange: (p) => { changed = p; },
  });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  // Delete the tick whose key ('k1') is still logged against real days.
  let tickRows = findAll(root, (el) => el.className === 'pf-tick-row');
  assert.equal(tickRows.length, 4);
  buttonsNamed(tickRows[3], 'Delete')[0].dispatch('click');
  assert.equal(changed.ticks.some((t) => t.key === 'k1'), false);

  // Reopen so the draft reflects the profile with k1 gone, then invent a new one.
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');
  buttonsNamed(root, 'Add tick')[0].dispatch('click');
  tickRows = findAll(root, (el) => el.className === 'pf-tick-row');
  assert.equal(tickRows.length, 4); // 3 core + the freshly invented one
  const labelInput = findAll(tickRows[3], (el) => el.placeholder === 'Label')[0];
  labelInput.value = 'Meditate';
  labelInput.dispatch('blur');

  const newExtra = changed.ticks.find((t) => !t.core);
  assert.ok(newExtra, 'the new tick must have been persisted once labelled');
  assert.notEqual(newExtra.key, 'k1', 'k1 still has history in stored progress and must not be reused');
});

/* ---------- fix round 2 ---------- */

test('a getLaneUsage that ignores its argument fails loudly instead of refusing every delete silently', () => {
  /* This is the plan's own literal Task 19 closure, argument-ignoring and
     returning lane keys instead of day names — the exact wiring the last
     round's reviewer proved still slips past a rename alone. */
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({
    root,
    getProfile: () => profile,
    getLaneUsage: () => new Set(['focus']),
    onChange: (p) => { changed = p; },
  });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const laneRows = findAll(root, (el) => el.className === 'pf-lane-row');
  assert.throws(() => buttonsNamed(laneRows[1], 'Delete')[0].dispatch('click'));
  assert.equal(changed, null, 'a mis-wired getLaneUsage must never be trusted enough to reach onChange either way');
});

test('a correct getLaneUsage that legitimately returns a day name matching a lane key is not flagged', () => {
  /* The probe must never accuse a correct caller. A day can legitimately be
     titled the same as a lane's key (e.g. a lane key "rest" and a day
     literally titled "rest") — the probe object can never equal a real
     lane's key by construction, so this must still succeed undisturbed. */
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({
    root,
    getProfile: () => profile,
    getLaneUsage: (key) => (key === 'work' ? new Set(['rest']) : new Set()),
    onChange: (p) => { changed = p; },
  });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const laneRows = findAll(root, (el) => el.className === 'pf-lane-row');
  const workRow = laneRows[1];
  assert.doesNotThrow(() => buttonsNamed(workRow, 'Delete')[0].dispatch('click'));
  assert.equal(changed, null, 'work is genuinely in use and must still be refused');
  const status = findAll(workRow, (el) => el.className === 'pf-lane-status')[0];
  assert.match(status.textContent, /rest/);
});

test('a pruned deadline group is reported correctly even when a later group shares its label', () => {
  /* Reproduces the reviewer's finding: matching raw-to-kept by label alone
     let a pruned group steal a same-labelled surviving sibling's "kept"
     match, so the discarded row said nothing and the saved row was falsely
     told it was missing a date it already had. */
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  // First group: labelled "Exam", never given a date — will be pruned.
  buttonsNamed(root, 'Add deadline')[0].dispatch('click');
  let rows = findAll(root, (el) => el.className === 'pf-deadline-row');
  const firstLabel = findAll(rows[0], (el) => el.placeholder === 'Label')[0];
  firstLabel.value = 'Exam';
  firstLabel.dispatch('blur');

  // Second group: same label, given a real date — will survive.
  buttonsNamed(root, 'Add deadline')[0].dispatch('click');
  rows = findAll(root, (el) => el.className === 'pf-deadline-row');
  assert.equal(rows.length, 2);
  const secondLabel = findAll(rows[1], (el) => el.placeholder === 'Label')[0];
  secondLabel.value = 'Exam';
  secondLabel.dispatch('blur');
  buttonsNamed(rows[1], 'Add date')[0].dispatch('click');
  rows = findAll(root, (el) => el.className === 'pf-deadline-row'); // rebuilt by "Add date"
  const dateInput = findAll(rows[1], (el) => el.type === 'date')[0];
  dateInput.value = '2026-12-01';
  dateInput.dispatch('blur');

  assert.equal(changed.deadlines.length, 1, 'only the dated group should have been persisted');
  assert.deepEqual(changed.deadlines[0].dates, ['2026-12-01']);

  const finalRows = findAll(root, (el) => el.className === 'pf-deadline-row');
  const status0 = findAll(finalRows[0], (el) => el.className === 'pf-row-status')[0];
  const status1 = findAll(finalRows[1], (el) => el.className === 'pf-row-status')[0];
  assert.match(status0.textContent, /date/i, 'the pruned first group must say it was not saved');
  assert.equal(status1.textContent, '', 'the surviving second group must not be told it is missing something it already has');
});

/* ---------- fix round 3 ---------- */

test('a getLaneUsage that returns an Array instead of a Set fails loudly rather than silently deleting an in-use lane', () => {
  /* A "correct-logic, wrong-container" implementation: it genuinely computes
     the right days for the right lane, it just forgets to wrap the answer
     in a Set. `.size` on an Array is `undefined`, which is falsy — so the
     old code's `if (usedBy.size)` guard would silently take the "not in
     use" branch and delete a lane the schedule actively depends on. This
     must fail loudly and change nothing instead. */
  let changed = null;
  const profile = defaultProfile(); // DEFAULT_LANES: focus, work, move, commit, rest
  const root = makeRoot();
  mountProfileEditor({
    root,
    getProfile: () => profile,
    getLaneUsage: (key) => (key === 'work' ? ['Monday'] : []),
    onChange: (p) => { changed = p; },
  });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const laneRows = findAll(root, (el) => el.className === 'pf-lane-row');
  const workRow = laneRows[1];
  assert.throws(() => buttonsNamed(workRow, 'Delete')[0].dispatch('click'));
  assert.equal(changed, null, 'a lane the schedule uses must never be deleted just because the wrong container silenced the check');

  const status = findAll(workRow, (el) => el.className === 'pf-lane-status')[0];
  assert.match(status.textContent, /not saved/i, 'the row must say something rather than leave a dead button');
});

/* ---------- fix round 4 ---------- */

test('a PRESENT getLaneUsage that returns null is refused loudly and does not delete the lane', () => {
  /* Distinct from the omitted-function case above: this getLaneUsage IS
     supplied, so the destructure default never runs. No correct
     implementation of (laneKey) => Set<dayName> ever returns null — a
     present function returning it (e.g. from a bug like an undefined
     schedule variable at cold open) is exactly as capable of meaning "the
     schedule this lane is used by never loaded" as "not used", so it must
     be refused the same way a wrong container is, not treated as a
     friendlier spelling of "no usage". */
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, getLaneUsage: () => null, onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const laneRows = findAll(root, (el) => el.className === 'pf-lane-row');
  assert.throws(() => buttonsNamed(laneRows[1], 'Delete')[0].dispatch('click'));
  assert.equal(changed, null, 'onChange must never fire when the usage answer cannot be trusted');
});

test('a PRESENT getLaneUsage that returns undefined is refused loudly and does not delete the lane', () => {
  let changed = null;
  const profile = defaultProfile();
  const root = makeRoot();
  mountProfileEditor({ root, getProfile: () => profile, getLaneUsage: () => undefined, onChange: (p) => { changed = p; } });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const laneRows = findAll(root, (el) => el.className === 'pf-lane-row');
  assert.throws(() => buttonsNamed(laneRows[1], 'Delete')[0].dispatch('click'));
  assert.equal(changed, null, 'onChange must never fire when the usage answer cannot be trusted');
});

test('a commit the app says it could not store is reported on the dialog itself', () => {
  /* onChange now hands back commitProfile's own result. The dialog covers
     the page's global save line, so a failed local write during profile
     editing was invisible: the editor said nothing while localStorage kept
     none of it. Only an exact false means "the app said no" — see the next
     test for the legacy shape. */
  const root = makeRoot();
  const profile = defaultProfile();
  let result = false;
  mountProfileEditor({ root, getProfile: () => profile, onChange: () => result });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');

  const label = findAll(root, (el) => el.getAttribute('aria-label') === 'Tick label')[0];
  label.value = 'Study hour';
  label.dispatch('blur');
  const status = findAll(root, (el) => el.className === 'pf-save-status')[0];
  assert.ok(status, 'the dialog carries its own save status');
  assert.match(status.textContent, /Not saved/);

  result = true;
  label.value = 'Deep work';
  label.dispatch('blur');
  assert.equal(status.textContent, '', 'a commit that saved clears the failure');
});

test('an onChange that returns nothing keeps the old contract and invents no failure', () => {
  const root = makeRoot();
  const profile = defaultProfile();
  mountProfileEditor({ root, getProfile: () => profile, onChange: () => {} });
  buttonsNamed(root, 'Edit profile')[0].dispatch('click');
  const label = findAll(root, (el) => el.getAttribute('aria-label') === 'Tick label')[0];
  label.value = 'Study hour';
  label.dispatch('blur');
  const status = findAll(root, (el) => el.className === 'pf-save-status')[0];
  assert.equal(status ? status.textContent : '', '', 'undefined is the legacy signature, not a refusal');
});
