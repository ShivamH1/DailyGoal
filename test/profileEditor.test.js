import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountProfileEditor } from '../profileEditor.js';
import { defaultProfile, normalizeProfile } from '../profile.js';

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
  mountProfileEditor({ root, getProfile: () => profile, getUsedLaneKeys: () => new Set(), onChange: () => {} });
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
  mountProfileEditor({ root, getProfile: () => profile, getUsedLaneKeys: () => new Set(), onChange: (p) => { changed = p; } });
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
  mountProfileEditor({ root, getProfile: () => profile, getUsedLaneKeys: () => new Set(), onChange: () => {} });
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
    getUsedLaneKeys: (key) => (key === 'work' ? new Set(['Monday']) : new Set()),
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
    getUsedLaneKeys: () => new Set(),
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
  mountProfileEditor({ root, getProfile: () => profile, getUsedLaneKeys: () => new Set(), onChange: (p) => { changed = p; } });
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
  mountProfileEditor({ root, getProfile: () => profile, getUsedLaneKeys: () => new Set(), onChange: (p) => { changed = p; } });
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
