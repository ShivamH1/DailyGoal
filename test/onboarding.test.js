import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, stepValid, applyStep, mountOnboarding, needsOnboarding } from '../onboarding.js';
import { defaultProfile } from '../profile.js';

test('the steps are ordered and each has an id and a title', () => {
  assert.ok(STEPS.length >= 4);
  for (const s of STEPS) {
    assert.equal(typeof s.id, 'string');
    assert.equal(typeof s.title, 'string');
  }
  assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length);
});

test('only the rhythm step can block progress', () => {
  /* Everything else is genuinely optional. A wizard that refuses to advance
     until you have invented a ground rule is how people abandon setup. */
  const draft = defaultProfile();
  for (const s of STEPS) {
    if (s.id === 'rhythm') continue;
    assert.equal(stepValid(s.id, draft), true, `${s.id} blocked an empty draft`);
  }
});

test('the rhythm step needs a wake time and a sleep time', () => {
  const draft = defaultProfile();
  assert.equal(stepValid('rhythm', draft), false);
  draft.intent.wake = 390;
  assert.equal(stepValid('rhythm', draft), false);
  draft.intent.sleep = 1380;
  assert.equal(stepValid('rhythm', draft), true);
});

test('applyStep returns a new normalised profile and does not mutate the draft', () => {
  const draft = defaultProfile();
  const next = applyStep(draft, 'basics', { season: '  Season 2026  ' });
  assert.equal(next.season, 'Season 2026');
  assert.equal(draft.season, '');
});

test('applyStep on the ticks step renames a core tick without removing it', () => {
  const next = applyStep(defaultProfile(), 'ticks', { labels: { s: 'Study hour' } });
  assert.equal(next.ticks.find((t) => t.key === 's').label, 'Study hour');
  assert.equal(next.ticks.filter((t) => t.core).length, 3);
});

test('applyStep ignores a step id it does not know rather than clearing the draft', () => {
  const draft = applyStep(defaultProfile(), 'basics', { season: 'S' });
  assert.deepEqual(applyStep(draft, 'nonsense', { anything: 1 }), draft);
});

/* ---------- the mounted wizard ---------- */
/* The same hand-rolled DOM stand-in test/profileEditor.test.js and
   test/weekEditor.test.js already use for the two editors: a few dozen lines
   of plain object literals, not a dependency — this repo has no runtime or
   dev dependencies and this adds none. mountOnboarding takes `root` as a
   parameter and never touches `document` at module scope precisely so it can
   be driven here.

   What it buys is the pair of properties nothing else can check: that a
   commit the app refused is never reported as a finished setup, and that a
   field typed and then cleared is stored as cleared rather than silently
   kept. */
function makeDoc() {
  function createTextNode(text) {
    return { tagName: '#text', children: [], parentNode: null, textContent: String(text) };
  }
  function createElement(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      className: '',
      type: '',
      placeholder: '',
      disabled: false,
      _text: '',
      _value: '',
      listeners: {},
      attrs: {},
      classList: {
        _set: new Set(),
        add(...c) { c.forEach((x) => el.classList._set.add(x)); },
        remove(...c) { c.forEach((x) => el.classList._set.delete(x)); },
        toggle(c, on) { if (on) el.classList._set.add(c); else el.classList._set.delete(c); },
        contains(c) { return el.classList._set.has(c); },
      },
      setAttribute(name, v) { el.attrs[name] = String(v); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null; },
      get value() { return el._value; },
      set value(v) { el._value = String(v); },
      get textContent() {
        return el.children.length ? el.children.map((c) => c.textContent).join('') : el._text;
      },
      set textContent(v) { el._text = String(v); el.children = []; },
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      append(...items) {
        for (const item of items) el.appendChild(typeof item === 'string' ? createTextNode(item) : item);
      },
      remove() {
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
      },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      dispatch(type) {
        const event = { target: el, defaultPrevented: false, preventDefault() { event.defaultPrevented = true; } };
        (el.listeners[type] || []).forEach((fn) => fn(event));
        return event;
      },
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
const control = (root, aria) => findAll(root, (el) => el.getAttribute('aria-label') === aria)[0];
const nextBtn = (root) => byClass(root, 'ob-next')[0];
const statusOf = (root) => findAll(root, (el) => el.className.startsWith('ob-status'))[0];
const progressOf = (root) => byClass(root, 'ob-progress')[0];
const titleOf = (root) => byClass(root, 'ob-title')[0];
const mounted = (root) => root.children.length > 0;

function wizard(opts = {}) {
  const root = makeRoot();
  const handed = [];
  const built = [];
  mountOnboarding({
    root,
    onDone: (p) => { handed.push(p); return 'result' in opts ? opts.result : true; },
    ...(opts.getProfile ? { getProfile: opts.getProfile } : {}),
    ...(opts.getReservedTickKeys ? { getReservedTickKeys: opts.getReservedTickKeys } : {}),
    ...(opts.noBuildWeek ? {} : { onBuildWeek: () => built.push(true) }),
  });
  return { root, handed, built };
}

/* Types into a field and leaves it, the way a user does. */
function type(root, aria, value) {
  const input = control(root, aria);
  input.value = value;
  input.dispatch('blur');
  return input;
}

const advance = (root) => nextBtn(root).dispatch('click');

/* Walks to a step by id, filling the rhythm step's two required times on the
   way through, since that is the only screen that can refuse to advance. */
function goTo(root, stepId) {
  for (let guard = 0; guard < STEPS.length + 1; guard++) {
    const here = STEPS[Number(progressOf(root).textContent.split(' ')[1]) - 1];
    if (here.id === stepId) return;
    if (here.id === 'rhythm') {
      type(root, 'Wake time', '06:30');
      type(root, 'Sleep time', '23:00');
    }
    advance(root);
  }
  throw new Error(`never reached ${stepId}`);
}

test('the wizard opens on the first step and says where you are', () => {
  const { root } = wizard();
  assert.equal(progressOf(root).textContent, `Step 1 of ${STEPS.length}`);
  assert.equal(titleOf(root).textContent, STEPS[0].title);
  assert.equal(byClass(root, 'ob-back')[0].disabled, true, 'there is nothing behind the first step');
});

test('the rhythm step refuses to advance and names what is missing', () => {
  const { root } = wizard();
  advance(root);
  assert.equal(titleOf(root).textContent, STEPS[1].title, 'the optional first step never blocks');
  advance(root);
  assert.equal(titleOf(root).textContent, STEPS[1].title, 'still on rhythm');
  assert.match(statusOf(root).textContent, /wake time and a sleep time/i);
});

test('a wake time and a sleep time let the wizard move on', () => {
  const { root } = wizard();
  advance(root);
  type(root, 'Wake time', '06:30');
  type(root, 'Sleep time', '23:00');
  advance(root);
  assert.equal(titleOf(root).textContent, STEPS[2].title);
});

test('Skip setup stores an onboarded profile and invents no content', () => {
  /* The whole point of the control: someone who wants to look around first
     must not be trapped in a form — and must not be handed three habits,
     a season and a ground rule they never chose. */
  const { root, handed } = wizard();
  button(root, 'Skip setup').dispatch('click');
  assert.equal(handed.length, 1);
  const p = handed[0];
  assert.equal(p.onboarded, true);
  assert.deepEqual(p.ticks.map((t) => t.label), ['', '', '']);
  assert.equal(p.season, '');
  assert.deepEqual(p.rules, []);
  assert.deepEqual(p.deadlines, []);
  assert.deepEqual(p.intent, { wake: null, sleep: null, busy: [], goals: '' });
  assert.equal(mounted(root), false, 'a saved wizard gets out of the way');
});

test('skipping after typing keeps what was typed', () => {
  /* Their own word is not an invention. Discarding it in the name of
     "defaults" would be a data-loss bug wearing a tidy label. */
  const { root, handed } = wizard();
  type(root, 'Season', 'Autumn term');
  button(root, 'Skip setup').dispatch('click');
  assert.equal(handed[0].season, 'Autumn term');
});

test('the example placeholders are never stored as if they were answers', () => {
  /* They are hints inside an empty input. A placeholder that reached the
     document would hand every new account one person's framing of a day —
     the exact thing this wizard exists to stop doing. */
  const { root, handed } = wizard();
  goTo(root, 'ticks');
  const field = control(root, 'Habit 1 name');
  assert.match(field.placeholder, /^e\.g\./, 'the example is offered');
  assert.equal(field.value, '', 'and nothing is filled in');
  button(root, 'Skip setup').dispatch('click');
  assert.deepEqual(handed[0].ticks.map((t) => t.label), ['', '', '']);
});

test('a habit named and then cleared in one sitting really is cleared', () => {
  /* The trap the week editor fell into: a blur handler that compares against
     the value captured when the field was built cannot tell "unchanged" from
     "emptied", so the clearing is silently dropped. */
  const { root, handed } = wizard();
  goTo(root, 'ticks');
  type(root, 'Habit 1 name', 'Study hour');
  type(root, 'Habit 1 name', '');
  button(root, 'Skip setup').dispatch('click');
  assert.equal(handed[0].ticks.find((t) => t.key === 's').label, '');
});

test('a setup the app could not save is never reported as finished', () => {
  const { root, handed } = wizard({ result: false });
  type(root, 'Season', 'Autumn term');
  button(root, 'Skip setup').dispatch('click');
  assert.equal(handed.length, 1, 'the profile is still offered to the app');
  assert.equal(mounted(root), true, 'the wizard stays put rather than dropping the user on a set-up-looking app');
  const text = statusOf(root).textContent;
  assert.match(text, /Not saved/);
  assert.doesNotMatch(text, /✓|Saved\./);
  assert.equal(control(root, 'Season').value, 'Autumn term', 'and nothing typed is lost');
});

test('an onDone that cannot say whether it saved is treated as not saved', () => {
  /* commitProfile returns a boolean. A caller wired to an older signature
     returns undefined, and guessing that undefined means success is exactly
     the bug this project keeps reintroducing. */
  const { root } = wizard({ result: undefined });
  button(root, 'Skip setup').dispatch('click');
  assert.equal(mounted(root), true);
  assert.match(statusOf(root).textContent, /Not saved/);
});

test('Build my week saves first, and opens nothing when the save was refused', () => {
  const refused = wizard({ result: false });
  goTo(refused.root, 'done');
  button(refused.root, 'Build my week').dispatch('click');
  assert.equal(refused.built.length, 0, 'the week editor must not open over an unsaved setup');
  assert.equal(mounted(refused.root), true);

  const ok = wizard();
  goTo(ok.root, 'done');
  button(ok.root, 'Build my week').dispatch('click');
  assert.equal(ok.handed.length, 1);
  assert.equal(ok.built.length, 1);
  assert.equal(mounted(ok.root), false);
});

test('an extra habit never takes a key that still carries logged history', () => {
  /* Deleting an extra tick does not purge rec.x[key], so handing a freed key
     to a new habit attaches someone else's history to it. */
  const { root, handed } = wizard({ getReservedTickKeys: () => new Set(['k1', 'k2']) });
  goTo(root, 'ticks');
  button(root, 'Add another habit').dispatch('click');
  type(root, 'Extra habit 1 name', 'Read 20 pages');
  button(root, 'Skip setup').dispatch('click');
  const extra = handed[0].ticks.filter((t) => !t.core);
  assert.deepEqual(extra.map((t) => t.label), ['Read 20 pages']);
  assert.equal(['k1', 'k2'].includes(extra[0].key), false, `reused ${extra[0].key}`);
});

test('the commitments a user fills in are kept, and the half-filled ones say so', () => {
  const { root, handed } = wizard();
  goTo(root, 'rhythm');
  type(root, 'Wake time', '06:30');
  type(root, 'Sleep time', '23:00');
  button(root, 'Add a commitment').dispatch('click');
  type(root, 'Commitment name', 'Lectures');
  assert.match(byClass(root, 'ob-note')[0].textContent, /not saved yet/i, 'a commitment with no day is not silently dropped');
  button(root, 'Mon').dispatch('click');
  type(root, 'Commitment start', '09:30');
  type(root, 'Commitment end', '13:00');
  button(root, 'Skip setup').dispatch('click');
  assert.deepEqual(handed[0].intent.busy, [{ label: 'Lectures', days: ['mon'], start: 570, end: 780 }]);
});

test('needsOnboarding asks whether setup was done, not whether the profile looks empty', () => {
  /* A user who deliberately clears everything out must not be dragged back
     through setup on their next launch. */
  const cleared = { ...defaultProfile(), onboarded: true };
  assert.equal(needsOnboarding(cleared), false);
  assert.equal(needsOnboarding(defaultProfile()), true);
  assert.equal(needsOnboarding(null), true);
  assert.equal(needsOnboarding({ onboarded: 'yes' }), true, 'only a real true counts');
});
