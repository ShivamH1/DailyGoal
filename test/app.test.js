import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setNamespace } from '../storage.js';
import { DAY_KEYS, emptyWeek } from '../schedule.js';
import { setConfigForTests } from '../auth.js';

/* app.js booted for real, with no browser.

   Everything else in this repo is a pure module or an editor that takes its
   root as a parameter, so it could be tested by importing it. app.js cannot:
   it reads `document` at module scope. That is exactly why it had no test at
   all — and why nine separate mutations to it, including the two shapes of
   this project's original "said saved, saved nothing" bug, all stayed green
   on a 259-test suite.

   It is a missing test, not an impossibility. app.js touches a small and
   countable slice of the DOM (createElement, getElementById, textContent,
   appendChild, classList, dataset, style, a couple of querySelectors), so a
   hand-rolled stand-in built from plain object literals is enough to boot it
   — the same approach test/profileEditor.test.js and test/weekEditor.test.js
   already take for the two editors, and the same zero dependencies.

   What that buys is the only place these behaviours exist: the real
   commitSchedule, the real onChange closures wired to the real editors, and
   the real getLaneUsage, driven end to end through the two dialogs the user
   actually presses.

   Module scope stops short of startApp(): the sign-in gate only calls it
   for a stored session, and most boots here store none, so no timer starts
   and nothing reaches the network — state is built the way a user builds
   it, through the editors. The first-run tests are the exception: they seed
   a session and stub fetch, because the mount decision they test lives
   inside initSync and nowhere else.

   Configuration is injected, never inherited: config.js is generated and
   gitignored, so what it holds on any machine — including a fresh checkout,
   where it is config.example.js's placeholders — must not decide what these
   tests exercise. Every boot states configured or not through
   setConfigForTests; see boot(). */

/* ---------- the DOM stand-in ---------- */
function makeDom() {
  const byId = new Map();

  function createTextNode(text) {
    const node = { tagName: '#text', children: [], parentNode: null, textContent: String(text) };
    return node;
  }

  function createElement(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      className: '',
      type: '',
      placeholder: '',
      title: '',
      hidden: false,
      disabled: false,
      open: false,
      _text: '',
      _value: '',
      listeners: {},
      attrs: {},
      dataset: {},
      style: { setProperty() {} },
      classList: {
        _set: new Set(),
        add(...c) { c.forEach((x) => el.classList._set.add(x)); },
        remove(...c) { c.forEach((x) => el.classList._set.delete(x)); },
        toggle(c, on) { if (on) el.classList._set.add(c); else el.classList._set.delete(c); },
        contains(c) { return el.classList._set.has(c); },
      },
      setAttribute(name, v) { el.attrs[name] = String(v); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null; },
      removeAttribute(name) { delete el.attrs[name]; },
      get value() { return el._value; },
      set value(v) {
        /* A real <select> cannot hold a value none of its options carry; the
           week editor relies on that (it adds an option for an unknown lane
           precisely so the stored value stays visible). Same rule as
           test/weekEditor.test.js's stand-in, for the same reason. */
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
      /* app.js's four innerHTML writes are its own fixed markup (a checkmark
         <svg>, the growth dots, the calendar cell) — never user data, which
         is the rule this stand-in does not need to model. It only has to not
         throw. */
      set innerHTML(v) { el._text = ''; el.children = []; el._html = String(v); },
      get innerHTML() { return el._html || ''; },
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      append(...items) {
        for (const item of items) el.appendChild(typeof item === 'string' ? createTextNode(item) : item);
      },
      remove() {
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
      },
      /* renderProfile/renderExtraTicks reach into a tick button for its .lbl
         and .hint spans. Memoised so two reads of the same selector are the
         same node, as they would be in a browser. */
      querySelector(sel) {
        el._q = el._q || new Map();
        if (!el._q.has(sel)) el._q.set(sel, createElement('span'));
        return el._q.get(sel);
      },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      dispatch(type) {
        const event = { target: el, defaultPrevented: false, preventDefault() { event.defaultPrevented = true; } };
        (el.listeners[type] || []).forEach((fn) => fn(event));
        return event;
      },
      showModal() { el.open = true; },
      close() { el.open = false; },
      scrollIntoView() {},
      click() { el.dispatch('click'); },
    };
    el.ownerDocument = document;
    return el;
  }

  const document = {
    createElement,
    createTextNode,
    visibilityState: 'visible',
    /* Permissive on purpose: index.html is not parsed here, and app.js reads
       forty ids at module scope. Every one of them gets a real element, so a
       missing id can never be what a failure is about. */
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, createElement('div'));
      return byId.get(id);
    },
    /* app.js's own two: '.row.is-now' (rows this stand-in never registers)
       and the .scorecard scroll target, both behind ?. or .forEach. */
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  return document;
}

/* ---------- localStorage stand-in ---------- */
/* `fails` decides which keys refuse a write, which is the only way to reach
   commitSchedule's failed-local-write branch: quota, Lockdown Mode and
   storage switched off are all a throwing setItem. */
function makeStorage(fails = () => false) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (fails(k)) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    read: (k) => JSON.parse(map.get(k) ?? 'null'),
  };
}

const define = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

let bootCount = 0;

/* Boots a fresh copy of app.js against fresh stand-ins. The cache-busting
   query re-evaluates app.js — so each test gets its own `week`, `profile`,
   `scheduleDoc` and `weekIsFallback` — while its imports (storage.js,
   schedule.js, the editors) resolve to the same URLs and stay the single
   instances they are in the browser. */
async function boot({ storageFails, session, fetchImpl, configured = true, seed } = {}) {
  const document = makeDom();
  const storage = makeStorage(storageFails);
  define('document', document);
  define('localStorage', storage);
  define('window', { addEventListener() {} });
  define('history', { replaceState() {} });
  define('location', { href: 'https://weekly-innings.test/', origin: 'https://weekly-innings.test', pathname: '/', reload() {}, assign() {} });
  if (typeof navigator === 'undefined') define('navigator', {});
  setNamespace('u1');
  /* auth.js and sync.js are singletons across boots (only app.js is
     cache-busted), so the configuration the previous test set would leak
     into this one. Every boot therefore states its own — a real-shaped
     pair, or the placeholder shape a fresh checkout's config.example.js
     has — which is also what makes this suite's answers identical on a
     machine with a generated config.js and on one without. */
  setConfigForTests(configured
    ? { url: 'https://project-ref.test.supabase.co', key: 'test-anon-key' }
    : { url: 'https://<project-ref>.supabase.co', key: '<placeholder>' });
  /* A stored session makes the sign-in gate call startApp() for real, which
     is the only route to initSync and the first-run mount decision. The far
     future expires_at keeps accessToken from trying to refresh over the
     network; fetchImpl is what pull/pullDoc then actually hit. */
  if (session) {
    storage.setItem('wi:session', JSON.stringify({
      access_token: 'AT', refresh_token: 'RT',
      expires_at: Date.now() + 3_600_000, user_id: 'u1', email: 'me@test',
      ...session,
    }));
  }
  /* Written before app.js evaluates — the only way a test can hand the boot
     a pre-existing queue or document, because module scope and startApp read
     storage exactly once. Runs after the session write so a seed may
     overwrite even that. */
  if (seed) seed(storage);
  if (fetchImpl) define('fetch', fetchImpl);

  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  /* startApp() arms the minute tick; a real interval would outlive the test. */
  globalThis.setInterval = () => 0;
  try {
    await import(`../app.js?boot=${++bootCount}`);
    /* The module-scope sign-in check is async — and with a session, so is the
       whole of initSync behind it. Let both settle before driving anything,
       so no render lands mid-test. */
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  } finally {
    globalThis.setInterval = realSetInterval;
  }

  return { document, storage, realSetTimeout };
}

/* The network-tier tests arm real timers — armFlush's 600 ms debounce and
   flushSync's retry backoff — which would outlive the test and re-run the
   flush against dead stubs. Captured instead: a zero-delay timer passes
   through (boot's own settle is one), everything else is recorded with its
   delay and runs only if the test replays it. Installed BEFORE boot() so the
   boot-time flush is covered too; always restored in finally. */
function captureTimers() {
  const real = globalThis.setTimeout;
  const armed = [];
  globalThis.setTimeout = (fn, ms) => {
    if (!ms) return real(fn, 0);
    armed.push({ fn, ms });
    return 0;
  };
  return {
    armed,
    /* Replays what the app armed, awaiting each: flushSync is async, and
       asserting before it settles would race it. */
    async run() { for (const { fn } of armed.splice(0)) await fn(); },
    restore() { globalThis.setTimeout = real; },
  };
}

/* The minimal Response pull() and pullDoc() read: ok, status, json(). */
const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

/* armFlush() schedules flushSync, which is the network tier. Every drive
   below is synchronous, so the timer is simply never handed a real clock —
   restored immediately afterwards so node:test keeps its own. */
function drive(ctx, fn) {
  const real = ctx.realSetTimeout;
  globalThis.setTimeout = () => 0;
  try { return fn(); } finally { globalThis.setTimeout = real; }
}

/* ---------- reading the stand-in back ---------- */
function collect(el, out = []) {
  out.push(el);
  for (const c of el.children) collect(c, out);
  return out;
}
const findAll = (root, pred) => collect(root).filter(pred);
const byClass = (root, cls) => findAll(root, (el) => el.className === cls);
const button = (root, text) => findAll(root, (el) => el.tagName === 'BUTTON' && el.textContent === text)[0];
const control = (row, aria) => findAll(row, (el) => el.getAttribute('aria-label') === aria)[0];

const weekRoot = (ctx) => ctx.document.getElementById('weekEditorRoot');
const profileRoot = (ctx) => ctx.document.getElementById('profileEditorRoot');
const weekStatus = (ctx) => findAll(weekRoot(ctx), (el) => el.className.startsWith('wk-status'))[0];
const blockRows = (ctx) => byClass(weekRoot(ctx), 'wk-block');
const daySection = (ctx, dayKey) => byClass(weekRoot(ctx), 'wk-day')[DAY_KEYS.indexOf(dayKey)];
const laneRows = (ctx) => byClass(profileRoot(ctx), 'pf-lane-row');
const laneRow = (ctx, name) => laneRows(ctx).find((r) => control(r, 'Lane name').value === name);

const openWeekEditor = (ctx) => button(weekRoot(ctx), 'Edit the week').dispatch('click');
const openProfileEditor = (ctx) => button(profileRoot(ctx), 'Edit profile').dispatch('click');

/* Adds one block to `dayKey` through the real form: the button, the label
   field, the lane <select>. */
function addBlock(ctx, dayKey, label, laneKey) {
  const section = daySection(ctx, dayKey);
  button(section, 'Add block').dispatch('click');
  const row = byClass(section, 'wk-block').at(-1);
  control(row, 'Block label').value = label;
  control(row, 'Block label').dispatch('blur');
  if (laneKey) {
    control(row, 'Lane').value = laneKey;
    control(row, 'Lane').dispatch('change');
  }
  return row;
}

const storedWeek = (ctx) => ctx.storage.read('wi:u1:schedule')?.value ?? null;
const storedLaneKeys = (ctx) => (ctx.storage.read('wi:u1:profile')?.value.lanes ?? []).map((l) => l.key);

/* Blanking a lane's name is the one route a user has to a stored week the
   gate then refuses: normalizeProfile drops a lane with no name, commitProfile
   re-gates against what is left, and a block still pointing at the dropped
   key makes the stored week unreadable. Not a contrivance — it is the exact
   lockout the week editor's refusal panel exists for. */
function blankLaneName(ctx, name) {
  const input = control(laneRow(ctx, name), 'Lane name');
  input.value = '';
  input.dispatch('blur');
}

/* ---------- the tests ---------- */

test('a week the browser could not cache is reported as not saved, not as saved', async () => {
  /* Both halves of this project's original bug live on this line:
     commitSchedule must return the LOCAL WRITE'S OWN result rather than
     true-if-we-got-this-far, and app.js's onChange must hand that result
     back to the editor unaltered. Either one hardcoded to `true` closes the
     dialog on an edit that is gone by the next reload, saying "✓ Saved". */
  const ctx = await boot({ storageFails: (k) => k === 'wi:u1:schedule' });
  drive(ctx, () => {
    openWeekEditor(ctx);
    addBlock(ctx, 'mon', 'Revision');
    button(weekRoot(ctx), 'Save the week').dispatch('click');
  });

  const text = weekStatus(ctx).textContent;
  assert.match(text, /Not saved/);
  assert.doesNotMatch(text, /✓|Saved\./);
  assert.equal(ctx.storage.map.has('wi:u1:schedule'), false, 'nothing was cached');
  /* And the message may not say the edit is only on this screen: the queue
     write is a different, much smaller key and it landed. */
  assert.deepEqual(ctx.storage.read('wi:u1:doc-pending'), ['schedule']);
  assert.doesNotMatch(text, /only on this screen/);
});

test('a week that saved is reported as saved, and is what got stored', async () => {
  /* The other direction of the same contract — a guard that always returns
     false would pass the test above and break the app. */
  const ctx = await boot();
  drive(ctx, () => {
    openWeekEditor(ctx);
    addBlock(ctx, 'mon', 'Revision');
    button(weekRoot(ctx), 'Save the week').dispatch('click');
  });

  assert.match(weekStatus(ctx).textContent, /Saved/);
  assert.equal(storedWeek(ctx).mon.blocks[0].label, 'Revision');
  assert.equal(storedWeek(ctx).mon.blocks[0].lane, 'focus');
});

test('while the stored week cannot be read, saving does not overwrite it', async () => {
  /* commitSchedule's early return is the only thing standing between a
     failed load and permanent data loss: `week` is emptyWeek() standing in
     for a document that failed validation, and writing it back replaces the
     real week locally and then, on the next flush, everywhere. */
  const ctx = await boot();
  drive(ctx, () => {
    openWeekEditor(ctx);
    addBlock(ctx, 'mon', 'Revision');
    button(weekRoot(ctx), 'Save the week').dispatch('click');
  });
  const before = storedWeek(ctx);
  assert.equal(before.mon.blocks.length, 1);

  drive(ctx, () => {
    /* Empty the day in the still-open dialog first, so what Save offers is
       valid against the lanes that survive — otherwise validateWeek refuses
       it before commitSchedule is ever reached, and the guard under test
       never runs. */
    button(byClass(weekRoot(ctx), 'wk-block')[0], 'Delete').dispatch('click');
    openProfileEditor(ctx);
    blankLaneName(ctx, 'Focus');
    button(weekRoot(ctx), 'Save the week').dispatch('click');
  });

  assert.deepEqual(storedWeek(ctx), before, 'the stored week is untouched');
  assert.match(weekStatus(ctx).textContent, /could not be read/);
});

test('a lane the stored week still uses cannot be deleted — even while that week cannot be read', async () => {
  /* The state this guard exists for is exactly the state it used to fail
     open in. getLaneUsage read the RENDERED week, which is emptyWeek()
     whenever the stored one was refused, so every lane reported zero usage
     and all of them could be deleted — letting a user already locked out
     delete the very lanes that would have got them back in. */
  const ctx = await boot();
  drive(ctx, () => {
    openWeekEditor(ctx);
    addBlock(ctx, 'mon', 'Revision', 'focus');
    addBlock(ctx, 'tue', 'Standup', 'work');
    button(weekRoot(ctx), 'Save the week').dispatch('click');
    openProfileEditor(ctx);
    blankLaneName(ctx, 'Focus');                 /* the stored week is now unreadable */
    button(laneRow(ctx, 'Work'), 'Delete').dispatch('click');
  });

  const status = byClass(laneRow(ctx, 'Work'), 'pf-lane-status')[0];
  /* 'Tuesday', not 'tue': nothing named this day, so dayNameIn falls through
     to DAY_NAMES. The test below is the other branch of that same fallback,
     now that the week editor can write a day title. */
  assert.equal(status.textContent, 'Still used by Tuesday — remove it from the schedule first.');
  assert.ok(storedLaneKeys(ctx).includes('work'), 'the lane is still in the profile');
});

test('a lane nothing points at still deletes, and one the visible week uses does not', async () => {
  /* The shape contract, executed rather than described. profileEditor.js
     probes getLaneUsage with an object no block lane can equal and demands
     an empty Set back, then demands a real Set (not an Array, whose .size is
     undefined and would fail OPEN) for the real answer. A getLaneUsage that
     ignored its argument, or returned an Array, or returned day objects
     instead of names, breaks one of these two halves. */
  const ctx = await boot();
  drive(ctx, () => {
    openWeekEditor(ctx);
    addBlock(ctx, 'mon', 'Revision', 'focus');
    button(weekRoot(ctx), 'Save the week').dispatch('click');
    openProfileEditor(ctx);
    button(laneRow(ctx, 'Rest'), 'Delete').dispatch('click');
  });
  assert.equal(storedLaneKeys(ctx).includes('rest'), false, 'an unused lane deletes');

  drive(ctx, () => button(laneRow(ctx, 'Focus'), 'Delete').dispatch('click'));
  assert.equal(
    byClass(laneRow(ctx, 'Focus'), 'pf-lane-status')[0].textContent,
    'Still used by Monday — remove it from the schedule first.',
  );
  assert.ok(storedLaneKeys(ctx).includes('focus'));
});

test('a day the user has named is refused by that name, not by the weekday', async () => {
  /* The loop this closes: dayNameIn has always preferred week[dayKey].title
     over DAY_NAMES, and app.js's renderDay has always shown it as the panel
     heading, but nothing in the app could set one — so the title branch of
     both was unreachable in practice. Driven end to end through the real week
     editor, the real commitSchedule and the real getLaneUsage.

     Saving also runs app.js's own renderDay for real (commitSchedule ends in
     renderWeekPanels), so the panel heading below is executed proof that a
     title this field can produce renders without throwing — the invariant
     validateWeek cannot enforce, because it does not type-check a day title
     at all. */
  const ctx = await boot();
  drive(ctx, () => {
    openWeekEditor(ctx);
    addBlock(ctx, 'tue', 'Nets', 'work');
    const name = control(daySection(ctx, 'tue'), 'Name for Tuesday');
    name.value = 'Match day';
    name.dispatch('blur');
    button(weekRoot(ctx), 'Save the week').dispatch('click');
  });

  assert.equal(storedWeek(ctx).tue.title, 'Match day', 'the name reached the stored week');
  assert.equal(
    findAll(ctx.document.getElementById('p-tue'), (el) => el.tagName === 'H3')[0].textContent,
    'Match day',
    'and the day panel renders under it',
  );

  drive(ctx, () => {
    openProfileEditor(ctx);
    button(laneRow(ctx, 'Work'), 'Delete').dispatch('click');
  });

  assert.equal(
    byClass(laneRow(ctx, 'Work'), 'pf-lane-status')[0].textContent,
    'Still used by Match day — remove it from the schedule first.',
  );
  /* The lane row itself, not the stored profile: a refused delete commits
     nothing at all, so there is no profile document written here to read
     back. Still on screen is what "not deleted" looks like from here. */
  assert.ok(laneRow(ctx, 'Work'), 'the lane was not deleted');
});

test('the refusal restores the lane it names, and the stored week comes back untouched', async () => {
  /* End to end through the real app: the editor works out which lane keys
     the stored document points at that the profile lacks, creates them with
     those exact keys, and the gate re-runs — the recovery the old hint
     described and the app could not perform, because newLaneKey only ever
     emits lane1, lane2, … */
  const ctx = await boot();
  drive(ctx, () => {
    openWeekEditor(ctx);
    addBlock(ctx, 'mon', 'Revision', 'focus');
    button(weekRoot(ctx), 'Save the week').dispatch('click');
    button(weekRoot(ctx), 'Close').dispatch('click');
    openProfileEditor(ctx);
    blankLaneName(ctx, 'Focus');
  });
  const before = storedWeek(ctx);

  drive(ctx, () => openWeekEditor(ctx));
  assert.equal(blockRows(ctx).length, 0, 'no form while the stored week is unreadable');
  assert.match(byClass(weekRoot(ctx), 'wk-refusal-hint')[0].textContent, /Focus/);

  drive(ctx, () => button(weekRoot(ctx), 'Restore the missing lane').dispatch('click'));

  assert.equal(blockRows(ctx).length, 1, 'the stored week is editable again');
  assert.equal(control(blockRows(ctx)[0], 'Block label').value, 'Revision');
  assert.ok(storedLaneKeys(ctx).includes('focus'), 'the lane was created with its stored key');
  assert.deepEqual(storedWeek(ctx), before, 'and the week itself was never rewritten');
});

test('a core tick nobody has named renders a plain name rather than a blank button', async () => {
  /* The three core ticks ship blank now — a new account is not handed one
     person's Study / Workout / Sleep — and they map to real columns, so they
     can be renamed but never removed. "Named, then cleared" and "never
     named" therefore both have to render: a nameless button is a control
     with nothing on it, and no amount of correct data behind it makes that
     usable. The fallback is positional and only ever on screen — the
     document keeps the empty string, so nothing invented is stored or
     synced. */
  const ctx = await boot();
  const tickBtn = ctx.document.getElementById('t-s');
  const tickLbl = tickBtn.querySelector('.lbl');
  const tickRow = (i) => byClass(profileRoot(ctx), 'pf-tick-row')[i];

  drive(ctx, () => {
    openProfileEditor(ctx);
    control(tickRow(0), 'Tick label').value = 'Study hour';
    control(tickRow(0), 'Tick label').dispatch('blur');
  });
  assert.equal(tickLbl.textContent, 'Study hour');
  assert.equal(tickBtn.classList.contains('unnamed'), false);

  drive(ctx, () => {
    control(tickRow(0), 'Tick label').value = '';
    control(tickRow(0), 'Tick label').dispatch('blur');
  });
  assert.equal(tickLbl.textContent, 'Habit 1', 'the button still says what it is');
  assert.equal(tickBtn.classList.contains('unnamed'), true, 'and shows it is waiting for a name');
  assert.match(tickBtn.title, /Edit profile/, 'which says where to fix it');
  assert.equal(ctx.storage.read('wi:u1:profile').value.ticks[0].label, '', 'nothing invented is stored');
});

test('the calendar stat captions follow the renamed core ticks, and fall back by position', async () => {
  /* Decision A: no render site may carry one person's framing. index.html
     used to hardcode Study and Workout beside the two month counts, so a
     renamed or still-unnamed core tick kept someone else's words on the
     calendar. The captions are empty in the static HTML and rendered
     through tickLabel by renderProfile, like the week strip already is. */
  const ctx = await boot();
  const stS = ctx.document.getElementById('stSLabel');
  const stW = ctx.document.getElementById('stWLabel');
  const tickRow = (i) => byClass(profileRoot(ctx), 'pf-tick-row')[i];

  drive(ctx, () => {
    openProfileEditor(ctx);
    control(tickRow(0), 'Tick label').value = 'Deep work';
    control(tickRow(0), 'Tick label').dispatch('blur');
    control(tickRow(1), 'Tick label').value = 'Moved today';
    control(tickRow(1), 'Tick label').dispatch('blur');
  });
  assert.equal(stS.textContent, 'Deep work', 'the first count is captioned by the first core tick');
  assert.equal(stW.textContent, 'Moved today', 'the second by the second');

  drive(ctx, () => {
    control(tickRow(0), 'Tick label').value = '';
    control(tickRow(0), 'Tick label').dispatch('blur');
  });
  assert.equal(stS.textContent, 'Habit 1', 'a cleared name falls back to the positional label, not to Study');
});

test('an unconfigured build stops at the gate — no app, and no setup wizard over it', async () => {
  /* Driven with injected placeholder config, exactly what a fresh checkout
     holds. isAuthConfigured is the FIRST gate: with no working sign-in
     there is never a session, startApp never runs, and initSync's
     unconfigured branch sits behind it as defence — so what an unconfigured
     build shows is the gate's message, not the app and not the wizard. */
  const ctx = await boot({ configured: false, session: {} });
  assert.equal(ctx.document.getElementById('appMain').hidden, true, 'the app is not shown');
  assert.equal(ctx.document.getElementById('onboardingRoot').children.length, 0, 'no wizard either');
  assert.match(ctx.document.getElementById('authError').textContent, /no Supabase configuration/);
});

test('a failed init pull mounts no wizard — provenance unknown is not "new account"', async () => {
  /* The destructive path this closes: a returning user's second device (or
     first device with a cold cache) boots with a stale near-default local
     profile, the pull fails, and the wizard mounts over it anyway. One
     press of Skip setup then commits that stale draft with a FRESH
     timestamp, the queue pushes it, and newer-wins mergeDoc kills the real
     profile on every device. Setup is only offered when the profile's
     provenance is known; a failed pull just skips the offer this launch. */
  const ctx = await boot({
    session: {},
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  });
  assert.equal(ctx.document.getElementById('onboardingRoot').children.length, 0,
    'no setup over a profile the pull could not vouch for');
  /* The app itself still runs — delayed setup, not a dead screen. */
  assert.equal(ctx.document.getElementById('appMain').hidden, false);
});

test('a pull that settles with no profile row is known provenance — setup mounts', async () => {
  /* pullDoc returns null for "no row", and null is load-bearing: this
     account has never been set up anywhere, so the wizard is safe to offer
     and Skip commits nothing that could clobber another device. */
  const ctx = await boot({
    session: {},
    fetchImpl: async () => jsonResponse([]),
  });
  const obRoot = ctx.document.getElementById('onboardingRoot');
  assert.equal(obRoot.children.length, 1, 'the wizard mounted after the pull settled');
  assert.equal(obRoot.children[0].getAttribute('aria-label'), 'First-time setup');
});

test('a pulled profile that finished onboarding elsewhere mounts no wizard', async () => {
  /* The second-device path: the row arrives, says onboarded, and the
     account is walked through nothing. */
  const profileRow = { data: { onboarded: true, season: 'S' }, updated_at: '2026-08-20T00:00:00.000Z' };
  const ctx = await boot({
    session: {},
    fetchImpl: async (url) => (String(url).includes('user_profile')
      ? jsonResponse([profileRow])
      : jsonResponse([])),
  });
  assert.equal(ctx.document.getElementById('onboardingRoot').children.length, 0);
});

test('the mounted wizard refuses to remove a lane the pulled schedule still uses', async () => {
  /* The wiring half of the lanes-step guard: app.js hands mountOnboarding
     the same laneUsage source the profile editor gets, reading the raw
     stored scheduleDoc. Driven end to end — a real pull delivers a week
     whose Monday points at focus, the wizard mounts, and its lanes step
     answers with the profile editor's own sentence. */
  const week = emptyWeek();
  week.mon.blocks = [{ label: 'Revision', lane: 'focus', start: 540, end: 600 }];
  const ctx = await boot({
    session: {},
    fetchImpl: async (url) => (String(url).includes('user_schedule')
      ? jsonResponse([{ week, updated_at: '2026-08-20T00:00:00.000Z' }])
      : jsonResponse([])),
  });
  const obRoot = ctx.document.getElementById('onboardingRoot');
  assert.equal(obRoot.children.length, 1, 'the wizard mounted');

  drive(ctx, () => {
    button(obRoot, 'Next').dispatch('click');                       /* basics -> rhythm */
    control(obRoot, 'Wake time').value = '06:30';
    control(obRoot, 'Wake time').dispatch('change');
    control(obRoot, 'Sleep time').value = '23:00';
    control(obRoot, 'Sleep time').dispatch('change');
    button(obRoot, 'Next').dispatch('click');                       /* rhythm -> ticks */
    button(obRoot, 'Next').dispatch('click');                       /* ticks -> lanes */
    const focusRow = byClass(obRoot, 'ob-lane')[0];                 /* DEFAULT_LANES[0] is Focus */
    button(focusRow, 'Remove').dispatch('click');
  });

  const status = findAll(obRoot, (el) => el.className.startsWith('ob-status'))[0];
  assert.equal(status.textContent, 'Still used by Monday — remove it from the schedule first.');
  assert.equal(byClass(obRoot, 'ob-lane').length, 5, 'the lane row is still there');
});

test('a profile edit the browser could not cache is reported as not saved on the dialog', async () => {
  /* The same contract commitSchedule already honours for the week editor,
     now returned through the profile editor's onChange: a failed local
     write during profile editing used to reach only the page's save line,
     which the open dialog covers. */
  const ctx = await boot({ storageFails: (k) => k === 'wi:u1:profile' });
  drive(ctx, () => {
    openProfileEditor(ctx);
    const row = byClass(profileRoot(ctx), 'pf-tick-row')[0];
    control(row, 'Tick label').value = 'Study hour';
    control(row, 'Tick label').dispatch('blur');
  });
  const status = byClass(profileRoot(ctx), 'pf-save-status')[0];
  assert.ok(status, 'the dialog carries a save status');
  assert.match(status.textContent, /Not saved/);
  assert.equal(ctx.storage.map.has('wi:u1:profile'), false, 'nothing was cached');
  /* The queue write is a different key and it landed — the edit is still on
     its way to the server, so the message must not claim otherwise. */
  assert.deepEqual(ctx.storage.read('wi:u1:doc-pending'), ['profile']);
  assert.doesNotMatch(status.textContent, /only on this screen/);
});

test('an unreachable refresh keeps the app up — offline, not signed out', async () => {
  /* The modal offline case: the app opens past the ~1h access-token TTL
     with no network. The refresh fetch REJECTS — it never reached the
     server, so nothing was revoked — but auth.js coerces that to the same
     null as a genuine rejection, authedFetch's stable "not signed in" made
     it an auth error, and enterSignedOut gated an offline-first app at the
     exact moment it was offline, with wi:session still in storage as proof
     the session was never dead. A surviving session after a failed refresh
     means UNREACHABLE: the app stays up, the queue stays queued, and the
     status line talks about the network, not about signing in again. */
  const timers = captureTimers();
  try {
    const ctx = await boot({
      session: { expires_at: Date.now() - 1000 },  /* past TTL: every request must refresh first */
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
      seed: (storage) => {
        storage.setItem('wi:u1:progress', JSON.stringify({ '2026-08-29': { s: 1, u: '2026-08-29T10:00:00.000Z' } }));
        storage.setItem('wi:u1:pending', JSON.stringify(['2026-08-29']));
      },
    });
    assert.equal(ctx.document.getElementById('appMain').hidden, false, 'the app stays up');
    assert.equal(ctx.document.getElementById('authGate').hidden, true, 'no sign-in gate');
    assert.ok(ctx.storage.map.has('wi:session'), 'the session is still in storage');
    assert.deepEqual(ctx.storage.read('wi:u1:pending'), ['2026-08-29'], 'the queue is untouched');
    const status = ctx.document.getElementById('syncStatus').textContent;
    assert.doesNotMatch(status, /signed out/);
    assert.match(status, /offline|retrying/);
    assert.doesNotMatch(ctx.document.getElementById('authError').textContent, /expired/);
  } finally {
    timers.restore();
  }
});

test('a refresh the server rejects still signs the user out at the gate', async () => {
  /* The other side of the seam, pinned so the unreachable fix cannot eat
     it: a refresh token the server REJECTED will be rejected again every
     minute, so signing out is the only exit that does not loop.
     auth.test.js pins the accessToken half (null + session cleared); this
     pins what the app does with it — the gate, and no surviving session. */
  const ctx = await boot({
    session: { expires_at: Date.now() - 1000 },
    fetchImpl: async (url) => (String(url).includes('grant_type=refresh_token')
      ? { ok: false, status: 400, text: async () => 'invalid_grant' }
      : jsonResponse([])),
  });
  assert.equal(ctx.document.getElementById('appMain').hidden, true, 'the app is gated');
  assert.equal(ctx.document.getElementById('authGate').hidden, false, 'the sign-in gate is shown');
  assert.equal(ctx.storage.map.has('wi:session'), false, 'the dead session is cleared');
  assert.match(ctx.document.getElementById('authError').textContent, /expired/);
});
