# Weekly Innings PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Claude.ai artifact prototype into a deployed, installable PWA that persists ticks in `localStorage`, syncs across phone and laptop through Supabase, and shows what you should be doing right now.

**Architecture:** Zero-build static site of ES modules. Pure logic (`progress.js`, `schedule.js`) is imported by both the browser and `node --test`. One module owns each side effect: `storage.js` for `localStorage`, `sync.js` for HTTP. `app.js` is the only module that touches the DOM.

**Tech Stack:** Vanilla ES modules, Node 26 (`node --test` only — zero runtime dependencies), Supabase PostgREST over `fetch`, Vercel static hosting.

**Spec:** `docs/superpowers/specs/2026-08-15-weekly-innings-design.md`

## Global Constraints

- **Zero npm runtime dependencies.** No `supabase-js`, no bundler, no framework. `package.json` exists only for `"type": "module"` and the test script.
- **No build step.** What is committed is what is deployed.
- **ES modules everywhere.** `<script type="module">` in the browser; `import`/`export` in Node. The service worker (`sw.js`) is the one exception — classic script, loaded via `importScripts`-free plain syntax.
- **Node 26** is installed. `node --test` is built in; do not add a test framework.
- **Timezone is `Asia/Kolkata`.** Every "what time is it" decision goes through `Intl.DateTimeFormat` with an explicit `timeZone: 'Asia/Kolkata'`. Never use raw `getHours()` for schedule logic.
- **Visual identity is REDEFINED in Task 17b** (superseding the original spec's "no redesign" line, at the user's request). Until Task 17b, `styles.css` stays verbatim from the prototype and tasks only append to it — never edit an existing rule — so that every task before the design pass is judged on behaviour alone. Task 17b then replaces the stylesheet and reorders `index.html` wholesale. Reviewers of Tasks 1-17 should NOT flag the prototype's styling as a defect; reviewers of Task 17b judge against the design brief in that task.
- **Do not regress accessibility.** `@media (prefers-reduced-motion: reduce)` and all `:focus-visible` rules stay. New interactive elements get keyboard focus styles.
- **Mobile-first.** Test at 380 px width.
- **No console errors** on a fresh load with empty storage and no Supabase config.
- **Client keys stay short.** `s`, `w`, `z`, `note`, `u` — the prototype already wrote these to `localStorage` and renaming would orphan existing ticks.
- **Commits are backdated.** Every commit command in this plan carries explicit `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`. Use them exactly as written — Tasks 1–5 land on 15 Aug, Tasks 6–10 on 17 Aug, Tasks 11–18 on 18 Aug.
- **Git identity:** commits use `-c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com"`.
- **Every commit message ends with:** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | `type: module`, test + dev scripts. No dependencies. |
| `index.html` | Markup shell: hero, scorecard, tabs, calendar mount, rules, footer. |
| `styles.css` | Verbatim from prototype, appended to for new components only. |
| `config.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `USER_ID`, `EXAM_DATES`. |
| `schedule.js` | The week as data + NOW resolution. Pure, no imports. |
| `progress.js` | Streak, merge, weekly summary, CSV/JSON export. Pure, no imports. |
| `storage.js` | `localStorage` read/write + `pendingSync` queue. |
| `sync.js` | PostgREST pull/push, column mapping, backoff, status callbacks. |
| `app.js` | DOM wiring. The only module that touches `document`. |
| `sw.js` | Cache-first app shell. |
| `manifest.json`, `icons/` | PWA install metadata. |
| `supabase/schema.sql` | Table + RLS, copy-pasted into the Supabase SQL editor. |
| `test/*.test.js` | `node --test` suites over the pure modules. |
| `README.md` | Local dev, Supabase setup, deploy command. |

**Local dev requires a server** — ES modules do not load over `file://`. Use `npm run dev` (`python3 -m http.server 8080`) and open `http://localhost:8080`.

---

### Task 1: Split the prototype into static files

**Files:**
- Create: `package.json`, `index.html`, `styles.css`, `app.js`
- Read: `weekly-innings-tracker (1).html`

**Interfaces:**
- Consumes: nothing.
- Produces: `index.html` linking `styles.css` and `<script type="module" src="app.js">`. `app.js` still contains the prototype's script body verbatim, including its `window.storage` calls (removed in Task 4).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "weekly-innings",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/",
    "dev": "python3 -m http.server 8080"
  }
}
```

- [ ] **Step 2: Extract the stylesheet**

Copy everything between `<style>` and `</style>` in `weekly-innings-tracker (1).html` (lines 11–153) into `styles.css`. Do not reformat, reorder, or "clean up" a single rule.

- [ ] **Step 3: Extract the script**

Copy everything between `<script>` and `</script>` (lines 343–487) into `app.js`. Leave the `window.storage` calls alone for now.

- [ ] **Step 4: Create `index.html`**

Copy the prototype, then make exactly these three edits:
- Replace the whole `<style>…</style>` block with `<link rel="stylesheet" href="styles.css">`
- Replace the whole `<script>…</script>` block with `<script type="module" src="app.js"></script>`
- Leave everything else — every `<div>`, class, and attribute — untouched.

- [ ] **Step 5: Verify the JS still parses**

Run: `node --check app.js`
Expected: no output, exit 0. (`"type": "module"` in `package.json` makes `--check` parse it as ESM.)

- [ ] **Step 6: Verify the page renders identically**

Run: `npm run dev`, open `http://localhost:8080`.
Expected: pixel-identical to opening the original prototype. Today's day tab is auto-selected, tabs switch panels, the calendar renders the current month, and the red "Progress can't be saved in this view" note appears (there is no `window.storage` outside Claude.ai — this is the bug Task 4 fixes).
Expected: zero console errors.

- [ ] **Step 7: Commit**

```bash
git add package.json index.html styles.css app.js
GIT_AUTHOR_DATE="2026-08-15T21:40:00+05:30" GIT_COMMITTER_DATE="2026-08-15T21:40:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Split prototype into index.html, styles.css and app.js

No behaviour change; the script body is verbatim from the artifact.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `progress.js` — streak, merge, summary, export

**Files:**
- Create: `progress.js`, `test/progress.test.js`

**Interfaces:**
- Consumes: nothing. This module imports nothing and touches no globals.
- Produces:
  - `iso(date) -> string` — `"YYYY-MM-DD"` for a `Date`, using local date parts.
  - `addDays(isoStr, n) -> string`
  - `computeStreak(progress, todayIso) -> number` — consecutive days ending today where both `s` and `w` are truthy. Today is skipped (not broken) if incomplete.
  - `mergeProgress(local, remote) -> object` — per date, later `u` wins the whole record; local wins ties; a record with no `u` loses to one that has it.
  - `weeklySummary(progress, weekStartIso) -> {study, workout, sleep, bestStreak, notes}` where `notes` is `[{date, note}]` in date order.
  - `toCSV(progress) -> string`
  - `weekStart(isoStr) -> string` — the Monday of that ISO date's week.

- [ ] **Step 1: Write the failing tests**

Create `test/progress.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  iso, addDays, weekStart, computeStreak, mergeProgress, weeklySummary, toCSV
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../progress.js'`

- [ ] **Step 3: Implement `progress.js`**

```js
/* Pure functions over the progress object. No imports, no globals — this
   module is loaded identically by the browser and by node --test. */

export function iso(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function addDays(isoStr, n) {
  const [y, m, d] = isoStr.split('-').map(Number);
  return iso(new Date(y, m - 1, d + n));
}

export function weekStart(isoStr) {
  const [y, m, d] = isoStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();   // 0 Sun … 6 Sat
  return addDays(isoStr, day === 0 ? -6 : 1 - day);
}

const complete = (rec) => !!(rec && rec.s && rec.w);

export function computeStreak(progress, todayIso) {
  /* Today counts only if already complete; an unfinished today is not yet a
     miss, so we start counting from yesterday instead of returning 0. */
  let cursor = complete(progress[todayIso]) ? todayIso : addDays(todayIso, -1);
  let n = 0;
  while (complete(progress[cursor])) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function mergeProgress(local, remote) {
  const out = {};
  for (const date of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const a = local[date];
    const b = remote[date];
    if (!a) { out[date] = b; continue; }
    if (!b) { out[date] = a; continue; }
    /* Later updated_at wins the whole record. Field-level merge would let a
       stale device resurrect a tick the user had deliberately removed. */
    out[date] = (b.u || '') > (a.u || '') ? b : a;
  }
  return out;
}

export function weeklySummary(progress, weekStartIso) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStartIso, i));
  let study = 0, workout = 0, sleep = 0, run = 0, bestStreak = 0;
  const notes = [];
  for (const date of days) {
    const rec = progress[date] || {};
    if (rec.s) study++;
    if (rec.w) workout++;
    if (rec.z) sleep++;
    if (complete(rec)) { run++; bestStreak = Math.max(bestStreak, run); }
    else run = 0;
    if (rec.note) notes.push({ date, note: rec.note });
  }
  return { study, workout, sleep, bestStreak, notes };
}

const csvField = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(progress) {
  const head = 'date,study,workout,sleep,note,updated_at';
  const rows = Object.keys(progress).sort().map((date) => {
    const r = progress[date] || {};
    return [date, r.s ? 1 : 0, r.w ? 1 : 0, r.z ? 1 : 0, csvField(r.note), csvField(r.u)].join(',');
  });
  return [head, ...rows].join('\n') + '\n';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 13 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add progress.js test/progress.test.js
GIT_AUTHOR_DATE="2026-08-15T22:05:00+05:30" GIT_COMMITTER_DATE="2026-08-15T22:05:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add progress.js: streak, merge, weekly summary and CSV export

Pure module with node --test coverage. Merge resolves per date by
updated_at so a stale device cannot resurrect a removed tick.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `storage.js` — localStorage layer and pending queue

**Files:**
- Create: `storage.js`, `test/storage.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `loadProgress(store) -> object` — parses the saved payload; returns `{}` for missing or malformed data.
  - `saveProgress(progress, store) -> void`
  - `loadPending(store) -> string[]` — queued ISO dates awaiting sync.
  - `markPending(dates, store) -> void` — union, deduplicated.
  - `clearPending(dates, store) -> void`
  - Every function takes an optional `store` defaulting to `globalThis.localStorage`, which is what makes them testable in Node with a fake.
  - Keys: `weekly-innings-progress`, `weekly-innings-pending`.

- [ ] **Step 1: Write the failing tests**

Create `test/storage.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProgress, saveProgress, loadPending, markPending, clearPending
} from '../storage.js';

/* Minimal stand-in for the Web Storage API — only the four members
   storage.js actually uses. */
const fakeStore = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
};

test('loadProgress returns an empty object when nothing is stored', () => {
  assert.deepEqual(loadProgress(fakeStore()), {});
});

test('loadProgress discards malformed JSON instead of throwing', () => {
  const s = fakeStore({ 'weekly-innings-progress': '{not json' });
  assert.deepEqual(loadProgress(s), {});
});

test('loadProgress discards a payload that is not an object', () => {
  const s = fakeStore({ 'weekly-innings-progress': '"a string"' });
  assert.deepEqual(loadProgress(s), {});
});

test('saveProgress round-trips through loadProgress', () => {
  const s = fakeStore();
  saveProgress({ '2026-08-20': { s: 1, w: 1 } }, s);
  assert.deepEqual(loadProgress(s), { '2026-08-20': { s: 1, w: 1 } });
});

test('markPending unions without duplicating', () => {
  const s = fakeStore();
  markPending(['2026-08-20'], s);
  markPending(['2026-08-20', '2026-08-21'], s);
  assert.deepEqual(loadPending(s).sort(), ['2026-08-20', '2026-08-21']);
});

test('clearPending removes only the named dates', () => {
  const s = fakeStore();
  markPending(['2026-08-20', '2026-08-21'], s);
  clearPending(['2026-08-20'], s);
  assert.deepEqual(loadPending(s), ['2026-08-21']);
});

test('a write failure is swallowed rather than crashing a tick', () => {
  const s = fakeStore();
  s.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.doesNotThrow(() => saveProgress({ '2026-08-20': { s: 1 } }, s));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../storage.js'`

- [ ] **Step 3: Implement `storage.js`**

```js
/* The localStorage tier. Always written synchronously on every tick, so the
   app is correct and instant with no network at all. */

const PROGRESS_KEY = 'weekly-innings-progress';
const PENDING_KEY = 'weekly-innings-pending';

const defaultStore = () => globalThis.localStorage;

function read(key, fallback, store) {
  try {
    const raw = (store || defaultStore()).getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed;
  } catch {
    /* Corrupt payload, private-mode restrictions, disabled storage — none of
       these are worth breaking the page over. Start clean instead. */
    return fallback;
  }
}

function write(key, value, store) {
  try {
    (store || defaultStore()).setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadProgress = (store) => read(PROGRESS_KEY, {}, store);
export const saveProgress = (progress, store) => write(PROGRESS_KEY, progress, store);

export function loadPending(store) {
  const v = read(PENDING_KEY, [], store);
  return Array.isArray(v) ? v : [];
}

export function markPending(dates, store) {
  write(PENDING_KEY, [...new Set([...loadPending(store), ...dates])], store);
}

export function clearPending(dates, store) {
  const gone = new Set(dates);
  write(PENDING_KEY, loadPending(store).filter((d) => !gone.has(d)), store);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 20 tests total, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add storage.js test/storage.test.js
GIT_AUTHOR_DATE="2026-08-15T22:30:00+05:30" GIT_COMMITTER_DATE="2026-08-15T22:30:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add storage.js: localStorage tier plus pending-sync queue

Reads are defensive — malformed or unavailable storage starts clean
rather than throwing on load.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Replace `window.storage` in `app.js`

**Files:**
- Modify: `app.js` (the progress-store block, and the tick and streak handlers)

**Interfaces:**
- Consumes: `loadProgress`, `saveProgress` from `storage.js`; `computeStreak`, `iso` from `progress.js`.
- Produces: a module-level `progress` object, a `commit(dates)` function that later tasks extend to enqueue sync, and a `setSaveStatus(text, color)` helper.

- [ ] **Step 1: Add the imports at the top of `app.js`**

```js
import { loadProgress, saveProgress } from './storage.js';
import { computeStreak, iso } from './progress.js';
```

- [ ] **Step 2: Delete the `window.storage` block**

Remove the entire `/* ---------- progress store ---------- */` section: the `KEY`, `memoryOnly` and `hasStore` constants, `loadProgress`, `doSave`, the `visibilitychange` listener, and the async IIFE's `await loadProgress()`. Also delete the `#storageNote` element from `index.html` — memory-only mode no longer exists.

- [ ] **Step 3: Replace it with the local-first store**

```js
/* ---------- progress store ---------- */
let progress = loadProgress();

const saveStatus = document.getElementById('saveStatus');
function setSaveStatus(text, color) {
  saveStatus.textContent = text;
  saveStatus.style.color = color || 'var(--muted)';
}

/* Called after every mutation. The localStorage write is synchronous and
   effectively cannot fail, so status goes straight to saved; Task 8 hangs the
   remote queue off the same call. */
function commit(dates) {
  for (const date of dates) {
    progress[date] = { ...progress[date], u: new Date().toISOString() };
  }
  saveProgress(progress);
  setSaveStatus('✓ saved', '#7BC49A');
  setTimeout(() => {
    if (saveStatus.textContent === '✓ saved') setSaveStatus('');
  }, 2500);
}
```

- [ ] **Step 4: Point the tick handler and streak at the new code**

In the tick click handler, replace `saveProgress();` with `commit([selDate]);` and drop the now-pointless `async`. In `renderStreak`, replace the hand-rolled loop with:

```js
function renderStreak() {
  document.getElementById('streak').textContent = computeStreak(progress, iso(new Date()));
}
```

Replace the file's own `const iso = …` and `const todayISO = …` definitions with `const todayISO = () => iso(new Date());`, since `iso` now comes from `progress.js`.

- [ ] **Step 5: Replace the async init IIFE**

```js
/* ---------- init ---------- */
renderScorecard();
renderCalendar();
```

- [ ] **Step 6: Verify persistence by hand**

Run: `npm run dev`, open `http://localhost:8080`.
- Tick all three boxes. Expected: `✓ saved` appears then fades; today's calendar cell turns green.
- Reload the page. Expected: all three ticks are still set, streak shows `1`.
- Open DevTools → Application → Local Storage. Expected: `weekly-innings-progress` holds `{"2026-08-20":{"s":1,"w":1,"z":1,"u":"…"}}`.
- Expected: zero console errors, and no red storage note.

- [ ] **Step 7: Commit**

```bash
git add app.js index.html
GIT_AUTHOR_DATE="2026-08-15T22:55:00+05:30" GIT_COMMITTER_DATE="2026-08-15T22:55:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Persist ticks to localStorage instead of window.storage

window.storage only exists inside the Claude.ai artifact viewer, so the
hosted page silently lost every tick on reload. Ticks now survive.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Deploy Milestone 1

**Files:**
- Create: `README.md`, `vercel.json`

**Interfaces:**
- Consumes: the working Milestone 1 app.
- Produces: a live URL.

- [ ] **Step 1: Create `vercel.json`**

Vercel must not try to build a site that has no build step:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": null,
  "outputDirectory": ".",
  "cleanUrls": true
}
```

- [ ] **Step 2: Write `README.md`**

Cover, in this order: what the app is (two sentences); local dev (`npm run dev`, then `http://localhost:8080`, and the note that `file://` will not work because of ES modules); tests (`npm test`); deploy (`npx vercel --prod`). Leave a `## Supabase setup` heading with the single line `Added in Milestone 2.` — Task 6 fills it in.

- [ ] **Step 3: Deploy**

Run: `npx vercel --prod`
Accept the defaults; when asked for the project directory, choose the repo root.
Expected: a `https://<project>.vercel.app` URL.

- [ ] **Step 4: Verify on the phone**

Open the URL on your phone. Tick today, close the tab entirely, reopen the URL.
Expected: the tick is still there. This is the Milestone 1 done-when condition.

- [ ] **Step 5: Commit**

```bash
git add README.md vercel.json
GIT_AUTHOR_DATE="2026-08-15T23:20:00+05:30" GIT_COMMITTER_DATE="2026-08-15T23:20:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add README and Vercel static config

Milestone 1 complete: ticks survive a reload on a hosted URL.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: Supabase config generation and schema file

**Files:**
- Create: `tools/make-config.mjs`, `config.example.js`, `exams.js`, `supabase/schema.sql`
- Modify: `.gitignore`, `package.json`, `vercel.json`, `README.md`

**Interfaces:**
- Consumes: a gitignored `.env` at the repo root holding `PROJECT_URL`, `PUBLIC_KEY`, `USER_ID`.
- Produces:
  - `config.js` — GENERATED and gitignored. Exports `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `USER_ID`.
  - `exams.js` — COMMITTED. Exports `EXAM_DATES` as `[{subject, short, date}]`. Exam dates are not secret and must not live in `.env`.

**The credentials are already in place and you must not read them.** `.env` also contains a `SECRET_KEY` (Supabase `service_role`, which bypasses RLS entirely) and a `DATABASE_URL` containing the database password. Your generator reads only `PROJECT_URL`, `PUBLIC_KEY` and `USER_ID`. Never print `config.js` or `.env` to your terminal, never paste their contents into your report, and never add either file to git.

**The schema is already applied.** The controller ran the DDL below against the live database and verified it end-to-end with the anon key: upsert `201`, re-upsert `200`, select OK, delete `204`, and a write carrying a foreign `user_id` correctly rejected with `401 / 42501`. Your job is to write `supabase/schema.sql` so it matches what is deployed — do not run it, and do not connect to the database.

- [ ] **Step 1: Write `supabase/schema.sql`**

```sql
-- Already applied to the live project. Kept here as the source of truth and
-- for rebuilding the table from scratch.
-- Replace <USER_ID> with the UUID in .env (it is not secret, but it lives
-- with the secrets, so it is not committed).

create table if not exists daily_progress (
  date       date primary key,
  study      boolean     not null default false,
  workout    boolean     not null default false,
  sleep      boolean     not null default false,
  note       text,
  updated_at timestamptz not null default now(),
  user_id    uuid        not null
);

alter table daily_progress enable row level security;

drop policy if exists single_user on daily_progress;
create policy single_user on daily_progress
  for all
  using      (user_id = '<USER_ID>'::uuid)
  with check (user_id = '<USER_ID>'::uuid);

-- Without this grant PostgREST rejects the anon key before RLS is even
-- consulted. RLS restricts which rows; the grant permits the table at all.
grant select, insert, update, delete on daily_progress to anon;
```

- [ ] **Step 2: Write `tools/make-config.mjs`**

```js
/* Generates the gitignored config.js from .env (local) or from process.env
   (Vercel build). Reads only the three values the browser needs — never
   SECRET_KEY, never DATABASE_URL. Run: node tools/make-config.mjs */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const fileEnv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const pick = (k) => process.env[k] || fileEnv[k] || '';

/* Supabase's dashboard hands you the project URL with /rest/v1/ already on
   the end. sync.js appends that path itself, so leaving it produces
   /rest/v1//rest/v1/... and every request fails with PGRST125. */
const base = pick('PROJECT_URL').replace(/\/+$/, '').replace(/(\/rest(\/v1)?)+$/, '');

const out = `/* GENERATED by tools/make-config.mjs — do not edit, do not commit.
   Regenerate with: npm run config */
export const SUPABASE_URL = ${JSON.stringify(base)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(pick('PUBLIC_KEY'))};
export const USER_ID = ${JSON.stringify(pick('USER_ID'))};
`;

writeFileSync('config.js', out);
const missing = ['PROJECT_URL', 'PUBLIC_KEY', 'USER_ID'].filter((k) => !pick(k));
console.log(missing.length
  ? `config.js written; MISSING ${missing.join(', ')} — the app will run local-only`
  : 'config.js written with all three values');
```

Print only that summary line. Never echo the values.

- [ ] **Step 3: Write `config.example.js`**

```js
/* Committed reference only. The real config.js is generated from .env by
   tools/make-config.mjs and is gitignored. */
export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
export const SUPABASE_ANON_KEY = '<the anon / publishable key — never the service_role key>';
export const USER_ID = '<uuid, matching the RLS policy in supabase/schema.sql>';
```

- [ ] **Step 4: Write `exams.js`**

> **Superseded by Task 15.** The user supplied the real BITS WILP schedule after this task shipped: EC1/EC2/EC3 are exam *windows* covering every subject, not one date per subject. Task 15 rewrites this file. Implement it as written here so the history stays honest; Task 15 carries the correction.

```js
/* Drives the exam-countdown line. Nearest future date wins.
   Provisional dates — replace with the real BITS WILP exam schedule. */
export const EXAM_DATES = [
  { subject: 'Maths Foundation for ML', short: 'MFM', date: '2026-09-12' },
  { subject: 'Machine Learning',        short: 'ML',  date: '2026-09-19' },
  { subject: 'Deep Learning',           short: 'DL',  date: '2026-09-26' },
  { subject: 'Statistical Methods',     short: 'STA', date: '2026-10-03' },
];
```

- [ ] **Step 5: Add `config.js` to `.gitignore`**

Append a `config.js` line. Then prove it is ignored:

Run: `git check-ignore -v config.js`
Expected: a line naming `.gitignore` and the `config.js` rule. If it prints nothing, the file would be committed with the anon key in it — stop and fix before continuing.

- [ ] **Step 6: Wire the generator into `package.json`**

```json
"scripts": {
  "config": "node tools/make-config.mjs",
  "pretest": "node tools/make-config.mjs",
  "build": "node tools/make-config.mjs",
  "test": "node --test \"test/**/*.test.js\"",
  "dev": "python3 -m http.server 8080"
}
```

`pretest` matters: `test/sync.test.js` imports `config.js`, so a fresh clone must generate it before the suite runs.

- [ ] **Step 7: Point Vercel at the generator**

In `vercel.json`, change `"buildCommand": null` to `"buildCommand": "node tools/make-config.mjs"`. Vercel supplies `PROJECT_URL`, `PUBLIC_KEY` and `USER_ID` from its own environment-variable settings.

- [ ] **Step 8: Generate and verify without printing secrets**

Run: `npm run config`
Expected: `config.js written with all three values`.

Run: `node -e "import('./config.js').then(c=>console.log('url ok:', c.SUPABASE_URL.startsWith('https://'), '| no rest suffix:', !c.SUPABASE_URL.includes('/rest'), '| key len:', c.SUPABASE_ANON_KEY.length, '| uuid shape:', /^[0-9a-f-]{36}$/.test(c.USER_ID)))"`
Expected: `url ok: true | no rest suffix: true | key len: 208 | uuid shape: true`

Run: `git status --short`
Expected: `config.js` does NOT appear.

- [ ] **Step 9: Document it in the README's Supabase section**

Cover: the three values that belong in `.env`; that `SECRET_KEY` and `DATABASE_URL` are used by nobody in this app and must never be deployed; that `config.js` is generated and gitignored; `npm run config`; the Vercel environment-variable names; and that `supabase/schema.sql` is already applied. State plainly that the anon key reaches the browser by design because the app has no auth, and that RLS confines it to this one table.

- [ ] **Step 10: Commit**

```bash
git add tools/make-config.mjs config.example.js exams.js supabase/schema.sql .gitignore package.json vercel.json README.md
GIT_AUTHOR_DATE="2026-08-17T10:20:00+05:30" GIT_COMMITTER_DATE="2026-08-17T10:20:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Generate client config from .env instead of committing keys

The schema and RLS policy are already applied; schema.sql records them.
config.js is generated and gitignored so the service_role key sharing
that .env can never be committed by accident.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Then confirm the commit did not capture a secret:

Run: `git show --stat HEAD`
Expected: no `config.js`, no `.env`.

---

### Task 7: `sync.js` — PostgREST pull and push

**Files:**
- Create: `sync.js`, `test/sync.test.js`

**Interfaces:**
- Consumes: `config.js`.
- Produces:
  - `isConfigured() -> boolean`
  - `normalizeBase(url) -> string` — strips a trailing slash and a trailing `/rest` or `/rest/v1` from a project URL. Exported so it can be tested.
  - `toRow(date, rec) -> object` — client record to column names.
  - `fromRows(rows) -> object` — columns to a client progress object.
  - `pull({fetchImpl}) -> Promise<object>` — every row for `USER_ID`, as a progress object.
  - `push(progress, dates, {fetchImpl}) -> Promise<void>` — one batched upsert; throws on a non-2xx response so the caller can queue and retry.
  - Both accept an injected `fetchImpl` defaulting to `globalThis.fetch`, which is how the tests avoid the network.

- [ ] **Step 1: Write the failing tests**

Create `test/sync.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRow, fromRows, pull, push, normalizeBase } from '../sync.js';
import { USER_ID } from '../config.js';

test('normalizeBase strips the /rest/v1 suffix the dashboard includes', () => {
  assert.equal(normalizeBase('https://abc.supabase.co/rest/v1/'), 'https://abc.supabase.co');
  assert.equal(normalizeBase('https://abc.supabase.co/rest/v1'), 'https://abc.supabase.co');
});

test('normalizeBase strips a bare trailing slash', () => {
  assert.equal(normalizeBase('https://abc.supabase.co/'), 'https://abc.supabase.co');
});

test('normalizeBase leaves an already-clean URL alone', () => {
  assert.equal(normalizeBase('https://abc.supabase.co'), 'https://abc.supabase.co');
});

test('toRow maps short client keys onto column names', () => {
  const row = toRow('2026-08-20', { s: 1, w: 0, z: 1, note: 'SVMs', u: '2026-08-20T12:00:00.000Z' });
  assert.deepEqual(row, {
    date: '2026-08-20',
    study: true,
    workout: false,
    sleep: true,
    note: 'SVMs',
    updated_at: '2026-08-20T12:00:00.000Z',
    user_id: USER_ID,
  });
});

test('toRow sends an explicit updated_at even when the record lacks one', () => {
  const row = toRow('2026-08-20', { s: 1 });
  assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('fromRows maps columns back to short keys', () => {
  const p = fromRows([{
    date: '2026-08-20', study: true, workout: false, sleep: true,
    note: null, updated_at: '2026-08-20T12:00:00.000Z',
  }]);
  assert.deepEqual(p, {
    '2026-08-20': { s: 1, w: 0, z: 1, note: '', u: '2026-08-20T12:00:00.000Z' },
  });
});

test('pull requests only this user and returns a progress object', async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return {
      ok: true,
      json: async () => ([{ date: '2026-08-20', study: true, workout: true, sleep: false, note: null, updated_at: 'x' }]),
    };
  };
  const p = await pull({ fetchImpl });
  assert.match(seen.url, /\/rest\/v1\/daily_progress\?select=\*&user_id=eq\./);
  assert.equal(seen.opts.headers.apikey.length > 0, true);
  assert.deepEqual(p['2026-08-20'].w, 1);
});

test('push sends one batched upsert for all dates', async () => {
  let body;
  const fetchImpl = async (_url, opts) => { body = JSON.parse(opts.body); return { ok: true, text: async () => '' }; };
  await push(
    { '2026-08-20': { s: 1, u: 'a' }, '2026-08-21': { w: 1, u: 'b' } },
    ['2026-08-20', '2026-08-21'],
    { fetchImpl }
  );
  assert.equal(body.length, 2);
  assert.deepEqual(body.map((r) => r.date).sort(), ['2026-08-20', '2026-08-21']);
});

test('push asks PostgREST to merge duplicates rather than insert', async () => {
  let headers;
  const fetchImpl = async (_url, opts) => { headers = opts.headers; return { ok: true, text: async () => '' }; };
  await push({ '2026-08-20': { s: 1 } }, ['2026-08-20'], { fetchImpl });
  assert.match(headers.Prefer, /resolution=merge-duplicates/);
});

test('push throws on a non-2xx so the caller can requeue', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'no' });
  await assert.rejects(
    () => push({ '2026-08-20': { s: 1 } }, ['2026-08-20'], { fetchImpl }),
    /401/
  );
});

test('push with no dates makes no request at all', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, text: async () => '' }; };
  await push({}, [], { fetchImpl });
  assert.equal(called, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../sync.js'`

- [ ] **Step 3: Implement `sync.js`**

```js
/* The Supabase tier, spoken to directly over PostgREST. No SDK: one table,
   two verbs, and a bundle we would otherwise have to cache offline. */

import { SUPABASE_URL, SUPABASE_ANON_KEY, USER_ID } from './config.js';

const TABLE = 'daily_progress';

/* The Supabase dashboard shows the project URL with /rest/v1/ already
   appended. We add that path ourselves, so leaving it produces
   /rest/v1//rest/v1/... and every request fails with PGRST125. Defended
   here as well as in tools/make-config.mjs, because the value can also
   arrive from a Vercel environment variable that never passes through the
   generator's normalisation. */
export const normalizeBase = (url) =>
  String(url || '').replace(/\/+$/, '').replace(/(\/rest(\/v1)?)+$/, '');

const BASE = normalizeBase(SUPABASE_URL);

export const isConfigured = () =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && USER_ID && !SUPABASE_URL.includes('<'));

const headers = (extra = {}) => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

export function toRow(date, rec = {}) {
  return {
    date,
    study: !!rec.s,
    workout: !!rec.w,
    sleep: !!rec.z,
    note: rec.note || '',
    /* Always explicit. Left to the column default, now() would stamp server
       receipt time, so a tick made offline on Monday and flushed on Wednesday
       would outrank a genuinely newer Tuesday edit from the other device. */
    updated_at: rec.u || new Date().toISOString(),
    user_id: USER_ID,
  };
}

export function fromRows(rows) {
  const out = {};
  for (const r of rows) {
    out[r.date] = {
      s: r.study ? 1 : 0,
      w: r.workout ? 1 : 0,
      z: r.sleep ? 1 : 0,
      note: r.note || '',
      u: r.updated_at,
    };
  }
  return out;
}

export async function pull({ fetchImpl = globalThis.fetch } = {}) {
  const url = `${BASE}/rest/v1/${TABLE}?select=*&user_id=eq.${USER_ID}`;
  const res = await fetchImpl(url, { headers: headers() });
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  return fromRows(await res.json());
}

export async function push(progress, dates, { fetchImpl = globalThis.fetch } = {}) {
  if (!dates.length) return;
  const body = JSON.stringify(dates.map((d) => toRow(d, progress[d])));
  const res = await fetchImpl(`${BASE}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body,
  });
  if (!res.ok) throw new Error(`push failed: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 31 tests total, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add sync.js test/sync.test.js
GIT_AUTHOR_DATE="2026-08-17T11:05:00+05:30" GIT_COMMITTER_DATE="2026-08-17T11:05:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add sync.js: PostgREST pull and batched upsert

updated_at is always sent explicitly; leaving it to the column default
would let a late offline flush outrank a newer edit from another device.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire sync into the app — queue, flush, indicator

**Files:**
- Modify: `app.js` (imports, `commit`, init), `index.html` (one new line under `.streak`), `styles.css` (append one rule)

**Interfaces:**
- Consumes: `pull`, `push`, `isConfigured` from `sync.js`; `loadPending`, `markPending`, `clearPending` from `storage.js`; `mergeProgress` from `progress.js`.
- Produces: `flushSync()` and `setSyncStatus(text, color)` inside `app.js`.

- [ ] **Step 1: Add the sync line to `index.html`**

Directly after the existing `<div class="streak">…</div>`:

```html
<div class="sync" id="syncStatus"></div>
```

- [ ] **Step 2: Append its style to `styles.css`**

```css
/* ===== SYNC STATUS ===== */
.sync{margin-top:6px;font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
```

- [ ] **Step 3: Extend the imports in `app.js`**

```js
import { loadProgress, saveProgress, loadPending, markPending, clearPending } from './storage.js';
import { computeStreak, iso, mergeProgress } from './progress.js';
import { pull, push, isConfigured } from './sync.js';
```

- [ ] **Step 4: Add the sync machinery below `commit`**

```js
/* ---------- remote sync ---------- */
const syncEl = document.getElementById('syncStatus');
let lastSyncAt = null;
let syncTimer = null;
let attempt = 0;

function setSyncStatus(text, color) {
  syncEl.textContent = text;
  syncEl.style.color = color || 'var(--muted)';
}

function describeIdle() {
  const pending = loadPending();
  if (!isConfigured()) return setSyncStatus('local only · sync not configured');
  if (pending.length) return setSyncStatus(`offline · ${pending.length} unsynced`, 'var(--amber)');
  if (lastSyncAt) {
    const mins = Math.round((Date.now() - lastSyncAt) / 60000);
    return setSyncStatus(mins < 1 ? 'synced · just now' : `synced · ${mins} min ago`);
  }
  setSyncStatus('');
}

async function flushSync() {
  if (!isConfigured()) return describeIdle();
  const dates = loadPending();
  if (!dates.length) return describeIdle();
  setSyncStatus('syncing…');
  try {
    await push(progress, dates);
    clearPending(dates);
    lastSyncAt = Date.now();
    attempt = 0;
    describeIdle();
  } catch {
    /* Back off 1s, 2s, 4s, 8s, then stop and wait for the next tick or an
       'online' event. An unbounded retry loop would burn battery all day. */
    if (attempt < 4) {
      attempt++;
      setSyncStatus(`retrying sync (${attempt}/4)…`, 'var(--amber)');
      clearTimeout(syncTimer);
      syncTimer = setTimeout(flushSync, 1000 * 2 ** (attempt - 1));
    } else {
      attempt = 0;
      describeIdle();
    }
  }
}

function queueSync(dates) {
  markPending(dates);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 600);   /* coalesce rapid ticks */
}
```

- [ ] **Step 5: Hang the queue off `commit`**

Add `queueSync(dates);` as the last line of `commit`.

- [ ] **Step 6: Replace init with the local-first, then-remote sequence**

```js
/* ---------- init ---------- */
renderScorecard();
renderCalendar();

(async () => {
  if (!isConfigured()) return describeIdle();
  try {
    setSyncStatus('syncing…');
    progress = mergeProgress(progress, await pull());
    saveProgress(progress);
    renderScorecard();
    renderCalendar();
    lastSyncAt = Date.now();
  } catch {
    /* Offline or unreachable — localStorage already rendered, so there is
       nothing for the user to lose here. */
  }
  flushSync();
})();

window.addEventListener('online', flushSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && loadPending().length) flushSync();
});
setInterval(describeIdle, 60000);
```

- [ ] **Step 7: Verify cross-device sync by hand**

- Laptop: tick study. Expected: `✓ saved`, then `syncing…`, then `synced · just now`. Supabase Table Editor shows the row.
- Phone: open the URL, hard-refresh. Expected: the same tick appears.
- Phone: enable airplane mode, tick workout. Expected: `offline · 1 unsynced` and the tick still renders.
- Phone: disable airplane mode. Expected: within a second it flips to `synced · just now`; the laptop shows the workout tick after a refresh.
- This is the Milestone 2 done-when condition.

- [ ] **Step 8: Commit**

```bash
git add app.js index.html styles.css
GIT_AUTHOR_DATE="2026-08-17T12:10:00+05:30" GIT_COMMITTER_DATE="2026-08-17T12:10:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Sync ticks to Supabase with an offline queue

localStorage renders first, the remote pull merges by updated_at, and
unsynced dates flush on the online event.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: PWA manifest and icons

**Files:**
- Create: `manifest.json`, `tools/make-icons.mjs`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`
- Modify: `index.html` (`<head>`)

**Interfaces:**
- Consumes: nothing.
- Produces: three PNGs and a manifest referencing them.

- [ ] **Step 1: Write the icon generator**

Icons are generated rather than hand-drawn so they stay reproducible with zero dependencies. `node:zlib` provides both `deflateSync` and `crc32`, which is everything a PNG needs.

Create `tools/make-icons.mjs`:

```js
/* Generates the scoreboard icons: amber digits on pitch green.
   Run: node tools/make-icons.mjs   (no dependencies) */
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const PITCH = [0x16, 0x35, 0x2a];
const AMBER = [0xf5, 0xb8, 0x41];

/* 5x7 glyphs, one string row per line, '#' = lit pixel. */
const GLYPHS = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // truecolour RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;   // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixels(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size, text) {
  const cols = text.length * 6 - 1;          // 5 wide + 1 gap, no trailing gap
  const scale = Math.floor((size * 0.55) / cols);
  const w = cols * scale;
  const h = 7 * scale;
  const x0 = Math.floor((size - w) / 2);
  const y0 = Math.floor((size - h) / 2);
  return png(size, (x, y) => {
    const gx = Math.floor((x - x0) / scale);
    const gy = Math.floor((y - y0) / scale);
    if (gx >= 0 && gy >= 0 && gy < 7 && gx < cols) {
      const ch = text[Math.floor(gx / 6)];
      const col = gx % 6;
      if (col < 5 && GLYPHS[ch] && GLYPHS[ch][gy][col] === '#') return AMBER;
    }
    return PITCH;
  });
}

mkdirSync('icons', { recursive: true });
for (const [file, size] of [['icons/icon-192.png', 192], ['icons/icon-512.png', 512], ['icons/apple-touch-icon.png', 180]]) {
  writeFileSync(file, render(size, '07'));
  console.log('wrote', file, size);
}
```

- [ ] **Step 2: Generate and eyeball the icons**

Run: `node tools/make-icons.mjs`
Expected: three `wrote …` lines. Open `icons/icon-512.png`.
Expected: a pitch-green square with a centred amber `07` — full-bleed background, so the maskable safe zone is satisfied.

- [ ] **Step 3: Write `manifest.json`**

```json
{
  "name": "Weekly Innings",
  "short_name": "Innings",
  "description": "Schedule and habit tracker — study, workout, sleep.",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#16352A",
  "theme_color": "#16352A",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 4: Link it from `index.html`**

Add inside `<head>`, after the existing font links:

```html
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#16352A">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Innings">
```

- [ ] **Step 5: Verify the manifest parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('ok')"`
Expected: `ok`
Then reload the dev server and check DevTools → Application → Manifest.
Expected: name, theme colour, and both icons listed with no warnings. Chrome will still say a service worker is required — Task 10.

- [ ] **Step 6: Commit**

```bash
git add manifest.json tools/make-icons.mjs icons index.html
GIT_AUTHOR_DATE="2026-08-17T16:40:00+05:30" GIT_COMMITTER_DATE="2026-08-17T16:40:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add PWA manifest and generated scoreboard icons

Icons are produced by a dependency-free node:zlib PNG writer so they
stay reproducible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Service worker

**Files:**
- Create: `sw.js`
- Modify: `app.js` (registration at the end of the file)

**Interfaces:**
- Consumes: nothing.
- Produces: a cache-first app shell under the cache name `weekly-innings-v1`.

- [ ] **Step 1: Write `sw.js`**

```js
/* Classic worker script — not a module, so no imports here.
   Bump CACHE when any shell file changes; activate purges older caches. */
const CACHE = 'weekly-innings-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './exams.js',
  './storage.js',
  './sync.js',
  './progress.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  /* Supabase is never cached: a stale tick is worse than no tick. */
  if (url.hostname.endsWith('.supabase.co')) return;

  /* Fonts are cross-origin and immutable — cache them on first use so the
     installed app renders correctly with no network at all. */
  if (url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).catch(() => caches.match('./index.html'))
    )
  );
});
```

`SHELL` deliberately omits `./schedule.js`: Task 11 has not created it yet, and `addAll` rejects atomically, so listing a file that does not exist would fail the very first install and leave the app with no worker at all. Task 18 adds it alongside the cache-version bump.

- [ ] **Step 2: Register it from `app.js`**

Append to the end of `app.js`:

```js
/* ---------- service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* Registration fails over file:// and on some private modes. The app
         works fine without it — only offline start-up is lost. */
    });
  });
}
```

- [ ] **Step 3: Verify offline start-up**

Run: `npm run dev`, load the page, then DevTools → Application → Service Workers.
Expected: `weekly-innings-v1` activated and running.
Then DevTools → Network → Offline, and reload.
Expected: the page renders fully, fonts included; the sync line reads `offline · N unsynced` or `synced · N min ago`. Zero console errors other than the expected failed Supabase request.

- [ ] **Step 4: Verify install on the phone**

Deploy (`npx vercel --prod`), open on Android Chrome → menu → Install app; on iOS Safari → Share → Add to Home Screen.
Expected: launches full-screen with no browser chrome, renders instantly, and syncs when online. This is the Milestone 3 done-when condition.

- [ ] **Step 5: Commit**

```bash
git add sw.js app.js
GIT_AUTHOR_DATE="2026-08-17T17:20:00+05:30" GIT_COMMITTER_DATE="2026-08-17T17:20:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add service worker: cache-first shell, network-only Supabase

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 11: `schedule.js` — the week as data

**Files:**
- Create: `schedule.js`, `test/schedule.test.js`

**Interfaces:**
- Consumes: nothing. Pure, no imports.
- Produces:
  - `DAY_KEYS = ['mon','tue','wed','thu','fri','sat','sun']`
  - `WEEK` — `{ [dayKey]: { title, tag, note, blocks: Block[] } }` where `Block` is `{ time, start, end, label, detail, lane, subject?, effort? }`. `start`/`end` are minutes from midnight, `lane` is one of `rest|study|work|fit|cricket`, `effort` is `{text, cls}` with `cls` one of `''|'hard'|'easy'`.
  - `istNow(date) -> {dayKey, minutes}` — current IST weekday key and minute-of-day.
  - `resolveNow(dayKey, minutes) -> {state, dayKey, block}` where `state` is `'now'` or `'next'`. Never returns null; after the last block of the day it rolls to the next day's first block.

- [ ] **Step 1: Write the failing tests**

Create `test/schedule.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEEK, DAY_KEYS, istNow, resolveNow } from '../schedule.js';

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../schedule.js'`

- [ ] **Step 3: Implement `schedule.js`**

Every `time`, `label`, `detail`, `subject` and `effort` string below is copied from the prototype so the rendered page is unchanged. `start`/`end` are new, and give the previously open-ended entries (`Morning`, `8:15 onwards`) explicit ranges taken from section 4 of the source spec.

```js
/* The week as data. Drives both the rendered timeline and the NOW banner.
   start/end are minutes from midnight, IST. */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const hard = { text: 'Hard', cls: 'hard' };
const easy = { text: 'Easy', cls: 'easy' };

/* Shared weekday scaffolding — every Mon-Fri day has the same shape around
   its study subject and its workout. */
const wake  = { time: '6:30', start: 390, end: 405, label: 'Wake up', detail: '', lane: 'rest' };
const bfast = { time: '7:45 – 8:45', start: 465, end: 525, label: 'Breakfast &amp; get ready', detail: '', lane: 'rest' };
const work  = { time: '9:30 – 6:30', start: 570, end: 1110, label: 'Work', detail: '', lane: 'work' };
const dinner = { time: '8:15 – 9:15', start: 1215, end: 1275, label: 'Shower &amp; dinner', detail: '', lane: 'rest' };
const free  = { time: '9:15 – 10:15', start: 1275, end: 1335, label: 'Free time', detail: '', lane: 'rest' };
const lights = { time: '11:00', start: 1380, end: 1410, label: 'Lights out', detail: '', lane: 'rest' };

const study = (subject, detail) =>
  ({ time: '6:45 – 7:45', start: 405, end: 465, label: 'Study', subject, detail, lane: 'study' });

const evening = (label, detail, effort) =>
  ({ time: '7:15 – 8:15', start: 1155, end: 1215, label, detail, effort, lane: 'fit' });

export const WEEK = {
  mon: {
    title: 'Monday', tag: 'Consolidation day',
    note: "Replay the weekend's lectures across all four subjects while they're fresh. Decide which topics Tue–Fri mornings will cover.",
    blocks: [
      { ...wake, detail: 'No phone for the first 15 minutes' },
      { ...study('All subjects', 'Consolidate Sat/Sun classes · plan the week&rsquo;s topics'), label: 'Study — weekend review' },
      bfast,
      { ...work, detail: 'Truworth Wellness' },
      evening('Home workout — full body', 'Push-ups, squats, lunges, plank circuit · 3–4 rounds', hard),
      dinner,
      { ...free, detail: 'Genuinely free — no guilt' },
      lights,
    ],
  },
  tue: {
    title: 'Tuesday', tag: 'Maths morning',
    note: 'Maths Foundation gets the freshest brain of the week — everything in ML and DL stands on it. The evening walk keeps the body moving while it recovers from Monday.',
    blocks: [
      wake,
      study('Maths Foundation for ML', 'Linear algebra, calculus, optimisation · work problems by hand'),
      bfast, work,
      evening('Brisk walk — 60 min', 'Recovery pace · podcast or lecture audio if you like', easy),
      dinner, free, lights,
    ],
  },
  wed: {
    title: 'Wednesday', tag: 'Mid-week double',
    note: 'Machine Learning in the morning, a run in the evening, then one light study hour — the only weekday with two study blocks, so the run stays moderate.',
    blocks: [
      wake,
      study('Machine Learning', 'Algorithms &amp; theory · connect back to Tuesday&rsquo;s maths'),
      bfast, work,
      evening('Run — 40–50 min', 'Steady pace, or easy intervals · finish able to talk', { text: 'Moderate', cls: '' }),
      dinner,
      { time: '9:15 – 10:15', start: 1275, end: 1335, label: 'Study — light hour', subject: 'Weakest subject',
        detail: 'Lecture videos &amp; notes only — no heavy problem-solving at night', lane: 'study' },
      lights,
    ],
  },
  thu: {
    title: 'Thursday', tag: 'Power play',
    note: "Deep Learning builds directly on Tuesday's maths and Wednesday's ML — that's why it sits here. Last hard workout of the week; the load tapers from tomorrow.",
    blocks: [
      wake,
      study('Deep Learning', 'Theory + code · implement small pieces in Python'),
      bfast, work,
      evening('Home workout — strength &amp; core', 'Push-up variations, split squats, core circuit', hard),
      dinner, free, lights,
    ],
  },
  fri: {
    title: 'Friday', tag: 'Taper &amp; recover',
    note: "Statistical Methods closes the study week. Easy walk plus stretching in the evening — you want loose hamstrings, not sore ones, for tomorrow's match.",
    blocks: [
      wake,
      study('Statistical Methods', 'Distributions, inference, hypothesis testing · flag doubts for weekend classes'),
      bfast, work,
      evening('Easy walk + full stretch', '30 min walk · 20 min hips, hamstrings, shoulders', { text: 'Very easy', cls: 'easy' }),
      { time: '8:15 onwards', start: 1215, end: 1380, label: 'Free evening',
        detail: 'Fully unclaimed — this is the slack in the system', lane: 'rest' },
      { ...lights, detail: 'Match tomorrow — protect the sleep' },
    ],
  },
  sat: {
    title: 'Saturday', tag: 'Match day · Class day',
    note: 'Classes in the morning, cricket in the evening. The nap in between is not optional — it&rsquo;s what makes both halves work.',
    blocks: [
      { time: '7:30', start: 450, end: 465, label: 'Wake up — slightly later', detail: 'Optional 20 min mobility to loosen up', lane: 'rest' },
      { time: 'Morning', start: 540, end: 780, label: 'BITS WILP contact classes', subject: 'Per timetable',
        detail: 'Attend live · ask the doubts flagged on Friday', lane: 'study' },
      { time: '1:00 – 2:00', start: 780, end: 840, label: 'Lunch', detail: "Proper meal + hydrate — you'll sweat it out at 3:30", lane: 'rest' },
      { time: '2:00 – 3:00', start: 840, end: 900, label: 'Nap', detail: '', lane: 'rest' },
      { time: '3:30 – 7:30', start: 930, end: 1170, label: 'Cricket match', effort: { text: 'Match', cls: 'hard' },
        detail: 'This is the workout — tick it on the scorecard', lane: 'cricket' },
      { time: '8:00 – 9:00', start: 1200, end: 1260, label: 'Dinner &amp; wind down', detail: '', lane: 'rest' },
      { time: 'Evening', start: 1260, end: 1380, label: 'Completely free', detail: 'No study, no assignments, no guilt', lane: 'rest' },
      lights,
    ],
  },
  sun: {
    title: 'Sunday', tag: 'Match day · Assignments',
    note: "Class or assignments in the morning — rotate the assignment subject by whatever's due next. The day ends when the match ends.",
    blocks: [
      { time: '7:30', start: 450, end: 465, label: 'Wake up', detail: '', lane: 'rest' },
      { time: 'Morning', start: 540, end: 780, label: 'Class — or assignment block (2 hrs)', subject: 'Rotating',
        detail: 'Whichever subject has the nearest deadline', lane: 'study' },
      { time: '1:00 – 2:00', start: 780, end: 840, label: 'Lunch', detail: '', lane: 'rest' },
      { time: '2:00 – 3:00', start: 840, end: 900, label: 'Nap', detail: '', lane: 'rest' },
      { time: '3:30 – 7:30', start: 930, end: 1170, label: 'Cricket match', effort: { text: 'Match', cls: 'hard' }, detail: '', lane: 'cricket' },
      { time: '8:00 – 9:00', start: 1200, end: 1260, label: 'Dinner &amp; recovery', detail: 'Stretch 10 min · big glass of water', lane: 'rest' },
      { time: '9:00 – 10:30', start: 1260, end: 1350, label: 'Wind down', detail: 'Lay out Monday: notes, workout clothes, breakfast plan', lane: 'rest' },
      { time: '10:30', start: 1350, end: 1380, label: 'Lights out — earlier tonight', detail: 'The week starts at 6:30 sharp', lane: 'rest' },
    ],
  },
};

export function istNow(date = new Date()) {
  /* hourCycle h23 avoids the '24:00' some ICU builds emit at midnight. */
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    dayKey: parts.weekday.toLowerCase().slice(0, 3),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function resolveNow(dayKey, minutes) {
  const blocks = WEEK[dayKey].blocks;
  const current = blocks.find((b) => minutes >= b.start && minutes < b.end);
  if (current) return { state: 'now', dayKey, block: current };

  const upcoming = blocks.find((b) => b.start > minutes);
  if (upcoming) return { state: 'next', dayKey, block: upcoming };

  /* Past the last block — the useful answer is tomorrow's first, not nothing. */
  const nextKey = DAY_KEYS[(DAY_KEYS.indexOf(dayKey) + 1) % 7];
  return { state: 'next', dayKey: nextKey, block: WEEK[nextKey].blocks[0] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 46 tests total, 0 failures. If the overlap test fails, the fix is in the data, not the assertion.

- [ ] **Step 5: Commit**

```bash
git add schedule.js test/schedule.test.js
GIT_AUTHOR_DATE="2026-08-18T09:30:00+05:30" GIT_COMMITTER_DATE="2026-08-18T09:30:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add schedule.js: the week as data plus IST NOW resolution

Times are pinned to Asia/Kolkata through Intl rather than device local
time, so a laptop on another timezone still highlights the right row.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Render the day panels from data

**Files:**
- Modify: `index.html` (replace the seven `<div class="panel">` bodies), `app.js` (add `renderDay`)

**Interfaces:**
- Consumes: `WEEK`, `DAY_KEYS` from `schedule.js`.
- Produces: `renderDay(dayKey)`, which fills `#p-<dayKey>` with markup identical to the prototype's, plus `data-day` and `data-i` attributes on each `.row` for Task 13 to target.

- [ ] **Step 1: Empty the panels in `index.html`**

Replace all seven panel blocks (`<div class="panel" id="p-mon">…</div>` through `p-sun`) with:

```html
<div class="panel" id="p-mon" role="tabpanel"></div>
<div class="panel" id="p-tue" role="tabpanel"></div>
<div class="panel" id="p-wed" role="tabpanel"></div>
<div class="panel" id="p-thu" role="tabpanel"></div>
<div class="panel" id="p-fri" role="tabpanel"></div>
<div class="panel" id="p-sat" role="tabpanel"></div>
<div class="panel" id="p-sun" role="tabpanel"></div>
```

This removes roughly 90 lines of hand-maintained HTML.

- [ ] **Step 2: Add the renderer to `app.js`**

Import at the top:

```js
import { WEEK, DAY_KEYS, istNow, resolveNow } from './schedule.js';
```

Then, above the day-tabs section:

```js
/* ---------- day panels ---------- */
function rowHTML(dayKey, block, i) {
  const subj = block.subject ? `<span class="subj">${block.subject}</span>` : '';
  const eff = block.effort ? `<span class="effort ${block.effort.cls}">${block.effort.text}</span>` : '';
  const detail = block.detail ? `<em>${block.detail}</em>` : '';
  return `<div class="row" data-day="${dayKey}" data-i="${i}">` +
         `<div class="time">${block.time}</div>` +
         `<div class="bar b-${block.lane}"></div>` +
         `<div class="what"><strong>${block.label}${subj}${eff}</strong>${detail}</div></div>`;
}

function renderDay(dayKey) {
  const day = WEEK[dayKey];
  document.getElementById('p-' + dayKey).innerHTML =
    `<div class="day-head"><h2>${day.title}</h2><span class="tag">${day.tag}</span></div>` +
    `<p class="day-note">${day.note}</p>` +
    day.blocks.map((b, i) => rowHTML(dayKey, b, i)).join('');
}

DAY_KEYS.forEach(renderDay);
```

Place `DAY_KEYS.forEach(renderDay);` before the existing `showDay(...)` call so the panels exist when a tab is selected.

- [ ] **Step 3: Verify the rendering is unchanged**

Run: `npm run dev`, and compare each of the seven tabs against the original prototype opened in a second window.
Expected: identical text, identical colour bars, identical subject and effort pills. Check Saturday and Sunday specifically — they have the most irregular rows.
Expected: zero console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html app.js
GIT_AUTHOR_DATE="2026-08-18T10:05:00+05:30" GIT_COMMITTER_DATE="2026-08-18T10:05:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Render day panels from schedule.js instead of hardcoded HTML

Same markup out, but the timeline now has start/end times as data, which
is what the NOW highlight needs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: NOW banner and row highlight

**Files:**
- Modify: `index.html` (banner element), `styles.css` (append), `app.js` (add `renderNow`)

**Interfaces:**
- Consumes: `istNow`, `resolveNow`, `WEEK` from `schedule.js`.
- Produces: `renderNow()`, called on load, every 60 s, and on tab focus.

- [ ] **Step 1: Add the banner to `index.html`**

Immediately before `<div class="tabs" role="tablist" …>`:

```html
<div class="now" id="nowBanner" aria-live="polite"></div>
```

- [ ] **Step 2: Append the styles to `styles.css`**

```css
/* ===== NOW BANNER ===== */
.now{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--ink);border:1px solid var(--line);border-left:4px solid var(--amber);border-radius:8px;padding:12px 16px;margin-bottom:20px;font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.now b{color:var(--amber);font-weight:700}
.now .what-now{font-family:var(--disp);font-size:.95rem;letter-spacing:0;text-transform:none;color:var(--chalk);font-weight:600}
.now.next{border-left-color:var(--muted)}
.row.is-now{background:rgba(245,184,65,.07);border-radius:6px}
.row.is-now .time{color:var(--amber)}
```

- [ ] **Step 3: Add the renderer to `app.js`**

```js
/* ---------- NOW ---------- */
function renderNow() {
  const { dayKey, minutes } = istNow();
  const { state, dayKey: blockDay, block } = resolveNow(dayKey, minutes);

  const label = block.subject ? `${block.label} — ${block.subject}` : block.label;
  const when = state === 'now' ? block.time : block.time.split(' – ')[0];
  const dayPrefix = blockDay === dayKey ? '' : `${WEEK[blockDay].title.slice(0, 3)} · `;
  const banner = document.getElementById('nowBanner');
  banner.classList.toggle('next', state !== 'now');
  banner.innerHTML = `<b>${state === 'now' ? 'NOW' : 'NEXT'}</b> · ${dayPrefix}${when} · ` +
                     `<span class="what-now">${label}</span>`;

  document.querySelectorAll('.row.is-now').forEach((el) => el.classList.remove('is-now'));
  if (state === 'now') {
    const i = WEEK[dayKey].blocks.indexOf(block);
    document.querySelector(`.row[data-day="${dayKey}"][data-i="${i}"]`)?.classList.add('is-now');
  }
}

renderNow();
setInterval(renderNow, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderNow();
});
```

Call `renderNow()` after `DAY_KEYS.forEach(renderDay)` so the rows it highlights already exist.

- [ ] **Step 4: Verify against several times of day**

Run: `npm run dev` and check the banner matches the clock.

Then drive the edge cases directly rather than waiting for the clock — paste into the DevTools console:

```js
const { resolveNow } = await import('./schedule.js');
console.log(resolveNow('thu', 420));   // inside study  -> state 'now'
console.log(resolveNow('thu', 1130));  // gap after work -> state 'next', start 1155
console.log(resolveNow('thu', 1430));  // after bedtime  -> dayKey 'fri'
```

Expected: those three states in order.
Expected: inside a block, `NOW · 6:45 – 7:45 · Study — Deep Learning` and the matching row tinted amber. In a gap (say 18:50) `NEXT · 7:15 · Home workout — strength & core` with no row tinted. Late at night, the banner names tomorrow with a day prefix.
Expected: the highlight survives switching day tabs, and reappears correctly on the current day.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js
GIT_AUTHOR_DATE="2026-08-18T10:45:00+05:30" GIT_COMMITTER_DATE="2026-08-18T10:45:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add NOW banner and current-row highlight

Falls back to the next block during gaps rather than showing nothing,
and rolls over to tomorrow after the last block of the day.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: One-line daily note

**Files:**
- Modify: `index.html` (input on the scorecard), `styles.css` (append), `app.js` (wiring, `renderScorecard`, calendar tap)

**Interfaces:**
- Consumes: `commit` from Task 4.
- Produces: notes stored at `progress[date].note`, rendered into the scorecard input and shown under the calendar on tap.

- [ ] **Step 1: Add the input to `index.html`**

Directly after the `<div class="ticks">…</div>` block:

```html
<label class="note-row">
  <span class="note-lbl">What did you cover?</span>
  <input id="noteInput" class="note-input" type="text" maxlength="140"
         placeholder="one line — this becomes your revision log" autocomplete="off">
</label>
```

- [ ] **Step 2: Append the styles to `styles.css`**

```css
/* ===== DAILY NOTE ===== */
.note-row{display:block;margin-top:14px}
.note-lbl{display:block;font-family:var(--mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.note-input{width:100%;background:var(--pitch);border:1px solid var(--line);border-radius:8px;padding:12px 14px;color:var(--chalk);font-family:var(--disp);font-size:.95rem}
.note-input::placeholder{color:var(--muted);opacity:.7}
.note-input:focus-visible{outline:2px solid var(--amber);outline-offset:2px;border-color:var(--amber)}
```

- [ ] **Step 3: Wire it up in `app.js`**

```js
/* ---------- daily note ---------- */
const noteInput = document.getElementById('noteInput');
let noteTimer = null;

noteInput.addEventListener('input', () => {
  clearTimeout(noteTimer);
  /* Same 600 ms coalescing as ticks — one write per pause, not per keystroke. */
  noteTimer = setTimeout(() => {
    const rec = progress[selDate] || (progress[selDate] = {});
    rec.note = noteInput.value.trim();
    commit([selDate]);
  }, 600);
});

noteInput.addEventListener('blur', () => {
  clearTimeout(noteTimer);
  const rec = progress[selDate] || (progress[selDate] = {});
  if ((rec.note || '') !== noteInput.value.trim()) {
    rec.note = noteInput.value.trim();
    commit([selDate]);
  }
});
```

Inside `renderScorecard`, add as the last line before `renderStreak()`:

```js
  noteInput.value = rec.note || '';
```

- [ ] **Step 4: Verify**

- Type a note, wait a second. Expected: `✓ saved`, then `synced · just now`.
- Reload. Expected: the note is still in the input.
- Tap a different calendar day, then tap back. Expected: the input swaps to that day's note and back.
- Check the Supabase Table Editor. Expected: the `note` column holds the text.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js
GIT_AUTHOR_DATE="2026-08-18T11:25:00+05:30" GIT_COMMITTER_DATE="2026-08-18T11:25:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add the one-line daily note to the scorecard

Debounced onto the same save path as ticks, and flushed on blur so a
note is never lost by navigating away mid-pause.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Exam countdown

**Files:**
- Rewrite: `exams.js`
- Create: `test/exams.test.js`
- Modify: `index.html` (fourth hero plate gets ids), `app.js` (`renderExam`)

**Interfaces:**
- Consumes: `iso` from `progress.js`.
- Produces:
  - `exams.js` exports `EXAMS` — `[{label, dates}]` where `dates` is an array of `"YYYY-MM-DD"` strings, ascending.
  - `exams.js` exports `nextExam(todayIso) -> {label, date, days} | null` — the nearest date on or after `todayIso` across all groups.
  - `exams.js` exports `formatExamDates(dates) -> string` — a human span.
  - `app.js` gains `renderExam()`, called once on load.

**Why this replaces the provisional data:** BITS WILP evaluation components are scheduled as windows covering every subject at once, not per-subject exams. Task 6 shipped four invented per-subject dates as a placeholder; this task replaces them with the real schedule the user supplied.

- [ ] **Step 1: Write the failing tests**

Create `test/exams.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `nextExam` and `formatExamDates` are not exported by `exams.js`.

- [ ] **Step 3: Rewrite `exams.js`**

```js
/* BITS WILP evaluation components, 2026. Each EC is a window covering every
   subject, which is why these are date lists rather than per-subject dates. */

export const EXAMS = [
  { label: 'EC-1', dates: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'] },
  { label: 'EC-2', dates: ['2026-09-19', '2026-09-20', '2026-09-26', '2026-09-27'] },
  { label: 'EC-3', dates: ['2026-12-05', '2026-12-06', '2026-12-12', '2026-12-13'] },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dayNum = (d) => Number(d.slice(8, 10));

export function nextExam(todayIso) {
  let best = null;
  for (const ec of EXAMS) {
    for (const date of ec.dates) {
      if (date >= todayIso && (!best || date < best.date)) best = { label: ec.label, date };
    }
  }
  if (!best) return null;
  const days = Math.round(
    (new Date(best.date + 'T00:00:00') - new Date(todayIso + 'T00:00:00')) / 86400000
  );
  return { ...best, days };
}

export function formatExamDates(dates) {
  if (!dates.length) return '';
  const month = MONTHS[Number(dates[0].slice(5, 7)) - 1];
  const year = dates[0].slice(0, 4);
  const nums = dates.map(dayNum);
  /* A run of consecutive days reads better as a span; anything else has to be
     listed, because "19–27 Sep" would claim six days that are not exams. */
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  const body = contiguous && nums.length > 1
    ? `${nums[0]}–${nums[nums.length - 1]} ${month}`
    : `${nums.join(', ')} ${month}`;
  return `${body} ${year}`;
}
```

Note `formatExamDates` assumes a single month per group, which holds for all three real windows. If a future EC straddles a month boundary, it needs a second branch — leave that until it happens.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 53 tests total, 0 failures.

- [ ] **Step 5: Give the fourth plate ids in `index.html`**

Replace the fourth `.plate` (`7.5 / Sleep hrs / night`) with:

```html
<div class="plate"><div class="num" id="examNum">7.5</div><div class="cap" id="examCap">Sleep hrs / night</div></div>
```

Keeping the sleep numbers as the fallback means the plate still reads correctly once every exam is past. (Task 17b later moves this into the Today card as a single line and repoints `renderExam` at it.)

- [ ] **Step 6: Add the renderer to `app.js`**

```js
import { nextExam, formatExamDates, EXAMS } from './exams.js';
```

```js
/* ---------- exam countdown ---------- */
function renderExam() {
  const next = nextExam(todayISO());
  if (!next) return;   /* every exam past — the plate keeps its sleep default */

  const num = document.getElementById('examNum');
  const cap = document.getElementById('examCap');
  num.textContent = next.days;
  cap.textContent = next.days === 0 ? `${next.label} · today`
                  : next.days === 1 ? `${next.label} · day away`
                  : `${next.label} · days away`;
  const group = EXAMS.find((e) => e.label === next.label);
  num.title = `${next.label} · ${formatExamDates(group.dates)}`;
}

renderExam();
```

- [ ] **Step 7: Verify**

Expected: with today at 2026-08-20 the plate reads `4` over `EC-1 · days away`, and hovering the number shows `EC-1 · 24–28 Aug 2026`.

Run: `node -e "import('./exams.js').then(m=>{console.log(m.nextExam('2026-08-20')); console.log(m.formatExamDates(m.EXAMS[0].dates)); console.log(m.formatExamDates(m.EXAMS[1].dates))})"`
Expected:
```
{ label: 'EC-1', date: '2026-08-24', days: 4 }
24–28 Aug 2026
19, 20, 26, 27 Sep 2026
```

- [ ] **Step 8: Commit**

```bash
git add exams.js test/exams.test.js index.html app.js
GIT_AUTHOR_DATE="2026-08-18T11:55:00+05:30" GIT_COMMITTER_DATE="2026-08-18T11:55:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Show the next BITS WILP evaluation component as a countdown

Replaces the provisional per-subject dates: EC1/EC2/EC3 are windows
covering every subject, so the data is date lists, not one date each.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Export as JSON and CSV

**Files:**
- Modify: `index.html` (two buttons in the footer), `styles.css` (append), `app.js` (download helper)

**Interfaces:**
- Consumes: `toCSV` from `progress.js`.
- Produces: `download(filename, text, mime)` and two click handlers.

- [ ] **Step 1: Add the buttons to `index.html`**

Inside `<footer>`, as a third child:

```html
<span class="export">
  <button id="exportJson" type="button">Export JSON</button>
  <button id="exportCsv" type="button">Export CSV</button>
</span>
```

- [ ] **Step 2: Append the styles to `styles.css`**

```css
/* ===== EXPORT ===== */
.export{display:flex;gap:10px}
.export button{background:var(--ink);border:1px solid var(--line);color:var(--chalk);border-radius:6px;padding:7px 12px;cursor:pointer;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase}
.export button:hover{border-color:var(--muted)}
.export button:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
```

- [ ] **Step 3: Add the handlers to `app.js`**

Extend the progress import to include `toCSV`, then:

```js
/* ---------- export ---------- */
function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  /* Revoke on the next tick — revoking synchronously can cancel the download
     on some mobile browsers. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('exportJson').addEventListener('click', () => {
  download(`weekly-innings-${todayISO()}.json`, JSON.stringify(progress, null, 2), 'application/json');
});

document.getElementById('exportCsv').addEventListener('click', () => {
  download(`weekly-innings-${todayISO()}.csv`, toCSV(progress), 'text/csv');
});
```

- [ ] **Step 4: Verify**

Click both buttons.
Expected: two files download, named with today's date. The JSON parses; the CSV opens in a spreadsheet with six columns and one row per recorded day, with any note containing a comma correctly quoted.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js
GIT_AUTHOR_DATE="2026-08-18T12:25:00+05:30" GIT_COMMITTER_DATE="2026-08-18T12:25:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add JSON and CSV export of the full history

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Weekly summary section

**Files:**
- Modify: `index.html` (new section before `.rules`), `styles.css` (append), `app.js` (`renderWeek`)

**Interfaces:**
- Consumes: `weeklySummary`, `weekStart` from `progress.js`.
- Produces: `renderWeek()`, called on load and after every `commit`.

- [ ] **Step 1: Add the section to `index.html`**

Immediately before `<section class="rules">`:

```html
<section class="week">
  <h3>This week's card <span>— Mon to Sun</span></h3>
  <div class="week-stats" id="weekStats"></div>
  <ul class="week-notes" id="weekNotes"></ul>
</section>
```

- [ ] **Step 2: Append the styles to `styles.css`**

```css
/* ===== WEEKLY SUMMARY ===== */
.week{margin:48px 0 0;border-top:2px solid var(--line);padding:40px 0 8px}
.week h3{font-size:clamp(1.3rem,3.5vw,1.8rem);font-weight:800;text-transform:uppercase;margin-bottom:22px}
.week h3 span{color:var(--ball)}
.week-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.week-stat{background:var(--ink);border:1px solid var(--line);border-radius:8px;padding:14px;text-align:center}
.week-stat b{display:block;font-family:var(--mono);font-weight:700;font-size:1.6rem;color:var(--amber);line-height:1}
.week-stat span{display:block;margin-top:6px;font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.week-notes{list-style:none;margin-top:20px}
.week-notes li{padding:10px 0;border-bottom:1px dashed var(--line);font-size:.95rem}
.week-notes li:last-child{border-bottom:none}
.week-notes .d{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);margin-right:12px}
.week-notes .empty{color:var(--muted);font-size:.9rem}
@media (max-width:720px){.week-stats{grid-template-columns:repeat(2,1fr)}}
```

- [ ] **Step 3: Add the renderer to `app.js`**

Extend the progress import to include `weeklySummary` and `weekStart`, then:

```js
/* ---------- weekly summary ---------- */
function renderWeek() {
  const start = weekStart(todayISO());
  const sum = weeklySummary(progress, start);
  document.getElementById('weekStats').innerHTML = [
    [`${sum.study}/5`, 'Study days'],
    [`${sum.workout}/7`, 'Workouts'],
    [`${sum.sleep}/7`, 'Slept by 11'],
    [sum.bestStreak, 'Best streak'],
  ].map(([n, cap]) => `<div class="week-stat"><b>${n}</b><span>${cap}</span></div>`).join('');

  const notes = document.getElementById('weekNotes');
  notes.innerHTML = sum.notes.length
    ? sum.notes.map((n) => {
        const label = new Date(n.date + 'T00:00:00')
          .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
        return `<li><span class="d">${label}</span>${n.note}</li>`;
      }).join('')
    : `<li class="empty">No notes yet this week — the week started ${start}.</li>`;
}
```

Call `renderWeek()` at init, at the end of `commit`, and after the remote merge in the init IIFE.

- [ ] **Step 4: Verify**

Expected: four stat tiles reading the current week's counts, and the notes list showing every note from Monday onward in date order. Tick something and confirm the tiles update immediately without a reload. With no notes yet, the empty line appears rather than a bare list.
Expected at 380 px: the tiles reflow to two columns.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js
GIT_AUTHOR_DATE="2026-08-18T13:00:00+05:30" GIT_COMMITTER_DATE="2026-08-18T13:00:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Add the weekly summary card with counts, best streak and notes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17b: Design system pass

**Files:**
- Rewrite: `styles.css` (complete replacement), `index.html` (section order + font links)
- Modify: `app.js` (tick markup, season-strip renderer, remove the deleted hero plates' code)

**Interfaces:**
- Consumes: every component built in Tasks 1-17.
- Produces: a token-based stylesheet and a reordered page. No JS behaviour changes — every existing function keeps its name and contract. The only JS edits are markup strings and the removal of code for elements that no longer exist.

This task exists because the prototype's information architecture, not its palette, is what reads as machine-generated: a hero of four stats that never change, a schedule outranking the daily action, and cricket applied as decoration via `::before` stump dots. The page's real job is "what am I doing right now, and let me tick three things in five seconds."

**Do not invent your own direction.** The palette, typefaces, page order, and signature element below are decided. Execute them.

- [ ] **Step 1: Replace the font links in `index.html`**

Drop Bricolage Grotesque and IBM Plex Mono entirely. Two families, one of them carrying the utility role through its width axis:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Source+Serif+4:opsz,wght@8..60,400..600&display=swap" rel="stylesheet">
```

Archivo is used at two width extremes from one family — Expanded for numerals and scores, Condensed for times and labels. Scoreboards genuinely do this, so the width axis carries meaning. It also replaces the mono face via tabular figures.

- [ ] **Step 2: Write the token block at the top of the new `styles.css`**

```css
:root{
  /* Colour — two related warm accents against a green-cast neutral,
     deliberately not "near-black plus one neon". */
  --field:#10261F;      /* deep pitch, the page ground */
  --crease:#17352B;     /* raised card surface */
  --chalk:#ECE7D9;      /* warm off-white, primary text */
  --linseed:#E2A32B;    /* accent: oiled-willow amber, duller than neon on purpose */
  --leather:#A33F2B;    /* ball red: misses and the streak count only */
  --twilight:#6E8B7C;   /* secondary text, green-cast so the page reads tonal */
  --rule:rgba(110,139,124,.22);

  /* Type */
  --ui:'Archivo',system-ui,sans-serif;
  --prose:'Source Serif 4',Georgia,serif;

  /* Spacing scale — every margin and padding on the page comes from here */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --s8:64px;

  /* The ledger gutter: the fixed left column that carries WHEN */
  --gutter:56px;
  --radius:10px;
}
@media (max-width:420px){ :root{ --gutter:44px } }
```

Every colour, size, and space in the rest of the stylesheet must reference these tokens. A raw hex or a magic pixel value outside this block is a defect.

- [ ] **Step 3: Set the type scale**

Six roles, no more. Use `font-variation-settings` for the width axis and `font-variant-numeric: tabular-nums` on anything numeric that updates.

```css
.t-score{font-family:var(--ui);font-variation-settings:'wdth' 125,'wght' 800;font-size:clamp(2.4rem,9vw,3.6rem);line-height:.92;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.t-title{font-family:var(--ui);font-variation-settings:'wdth' 110,'wght' 800;font-size:clamp(1.4rem,5vw,2rem);line-height:1.05;text-transform:uppercase}
.t-label{font-family:var(--ui);font-variation-settings:'wdth' 75,'wght' 700;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--twilight)}
.t-time{font-family:var(--ui);font-variation-settings:'wdth' 70,'wght' 500;font-size:13px;font-variant-numeric:tabular-nums;color:var(--twilight)}
.t-body{font-family:var(--prose);font-size:15.5px;line-height:1.55}
.t-note{font-family:var(--prose);font-size:14px;line-height:1.5;color:var(--twilight)}
```

- [ ] **Step 4: Reorder `index.html` into the new information architecture**

Sections, in this exact order. Move existing markup — do not rebuild working components from scratch.

1. **NOW strip** (`#nowBanner`, built in Task 13) — the very first element on the page, above everything, sitting in the ledger gutter.
2. **Today card** — date, the three ticks, the daily note input, the streak, the save and sync lines.
3. **Season strip** — the month grid.
4. **This week** — the four summary tiles.
5. **Schedule** — day tabs and panels, demoted below the fold. Give the section a `.t-label` heading reading `SCHEDULE` so its new position reads as deliberate.
6. **Match rules**, then the footer with the export buttons.

**Delete outright:** the entire `.board` block of four hero plates and its CSS. Those numbers never change and never prompt an action. The exam countdown from Task 15 moves into the Today card as a single `.t-label` line reading `DL exam · 23 days` — remove the `#examNum` / `#examCap` plate wiring in `app.js` and repoint `renderExam()` at the new element. Keep the function's name and behaviour.

- [ ] **Step 5: Build the ledger gutter**

One structural device, used by the NOW strip, every timeline row, and the week card: a fixed left column of `var(--gutter)` carrying *when* — the time, the day letter, the date. It replaces the prototype's `118px / 14px / 1fr` row grid.

```css
.ledger{display:grid;grid-template-columns:var(--gutter) 1fr;gap:0 var(--s4);align-items:start}
.ledger > .when{text-align:right;padding-top:2px}
```

The coloured lane bar becomes a 2px left border on the content cell rather than its own grid column — same information, one less column to align at 380 px.

- [ ] **Step 6: Make the three ticks the hero**

They are the thing touched twice a day; everything else on the page is reference. Three across at every width, each at least 96 px tall, each a real `<button>`.

The tick's mark is an inline SVG check whose path draws on when the tick is set — this is the page's one motion moment, and it must be reduced-motion safe:

```css
.tick .mark path{stroke:var(--field);stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:24;stroke-dashoffset:24;transition:stroke-dashoffset .26s cubic-bezier(.2,.8,.3,1)}
.tick.done .mark path{stroke-dashoffset:0}
@media (prefers-reduced-motion:reduce){ .tick .mark path{transition:none} }
```

Everything else on the page stays still. Do not add scroll reveals, hover lifts, or entrance animations.

- [ ] **Step 7: Build the season strip — the signature element**

The month rendered as a scorebook page. In a real scorebook a dot ball means *failed to score*, which maps onto a missed habit exactly, so the metaphor does work rather than sitting on top.

- Seven columns, hairline `1px solid var(--rule)` separating rows. **Hairline rules appear nowhere else on the page** — a scorebook genuinely has them here, which is what makes them earned rather than a broadsheet affectation.
- Complete day (all three): a filled `var(--linseed)` block with the day number knocked out in `var(--field)`.
- Partial day: up to three small bars in the cell — study, workout, sleep — in `--linseed`, `--leather`, `--chalk`.
- Past day with nothing recorded: a centred `·` in `var(--twilight)`. That is the dot ball.
- Future day: empty.
- Today: a 1px `var(--linseed)` ring.
- **Consecutive complete days sit flush with no gap between them**, so a streak reads as one continuous bar across the strip. This is the reward surface — it should be the most satisfying thing on the page to look at.

- [ ] **Step 8: Redraw the icons for the new palette and for maskable safe area**

The Task 9 icons use the old amber `#F5B841` on `#16352A` and centre their glyphs at ~55% of the canvas with no maskable inset, so a circular launcher crop on Android can clip the digits. Update `tools/make-icons.mjs`:

- Swap the two colour constants to the new tokens: `PITCH` becomes `#10261F`, `AMBER` becomes `#E2A32B`.
- Reduce the glyph block to **40% of the canvas width** and keep it centred, which places it inside the 80%-diameter safe circle every maskable spec assumes.
- Regenerate: `node tools/make-icons.mjs`, and confirm all three files still report their declared dimensions (192, 512, 180).

- [ ] **Step 9: Normalise typographic apostrophes**

`schedule.js` currently mixes straight `'` with `&rsquo;` — three detail strings use the entity and the rest do not, an inconsistency introduced when the schedule data was authored. Source Serif 4 sets a proper right single quote well, so make them all `&rsquo;` across every `note` and `detail` string in `schedule.js`. Check the day notes too, not just the details: `weekend's`, `That's why`, `whatever's`, `it's`.

Run `grep -n "'" schedule.js` afterwards and confirm the only remaining straight quotes are JavaScript string delimiters.

- [ ] **Step 10: Quality floor**

- Single column, mobile-first; verify at 380 px with no horizontal scrolling anywhere.
- Visible keyboard focus on every interactive element: `outline:2px solid var(--linseed);outline-offset:2px`. Ticks, tabs, calendar cells, note input, export buttons.
- `@media (prefers-reduced-motion:reduce)` disables the tick draw and any transition.
- Contrast: `--chalk` on `--field` and `--twilight` on `--field` must both clear WCAG AA for their sizes. Check `--twilight` at 11 px specifically — if it fails, lighten the token rather than enlarging the text.
- No `!important`. No selector fighting: the prototype's `.section` versus `.cta` style of specificity collision is what this rewrite exists to remove.

- [ ] **Step 11: Verify nothing behavioural regressed**

Run: `npm test`
Expected: PASS, 53 tests, 0 failures — this task changes no logic, so any failure means you edited behaviour by accident.

Run: `node --check app.js`
Expected: exit 0.

Then confirm by reading `app.js` that every function kept its name and contract: `commit`, `renderScorecard`, `renderCalendar`, `renderStreak`, `renderNow`, `renderWeek`, `renderExam`, `flushSync`, `queueSync`, `describeIdle`, `download`.

- [ ] **Step 12: Commit in four parts**

```bash
git add index.html styles.css
GIT_AUTHOR_DATE="2026-08-18T14:10:00+05:30" GIT_COMMITTER_DATE="2026-08-18T14:10:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Replace the stylesheet with a token-based design system

Archivo at two width extremes replaces Bricolage Grotesque and IBM Plex
Mono; the palette moves off dark-plus-neon to two warm accents over a
green-cast neutral.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

```bash
git add index.html app.js
GIT_AUTHOR_DATE="2026-08-18T14:40:00+05:30" GIT_COMMITTER_DATE="2026-08-18T14:40:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Reorder the page around the daily action

The scorecard leads and the schedule moves below the fold. Drops the
four hero stat plates: none of those numbers change or prompt an action.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

```bash
git add tools/make-icons.mjs icons
GIT_AUTHOR_DATE="2026-08-18T15:25:00+05:30" GIT_COMMITTER_DATE="2026-08-18T15:25:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Redraw the icons in the new palette with a maskable safe area

The glyph block was centred at 55% of the canvas, which a circular
launcher crop can clip.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

```bash
git add styles.css app.js
GIT_AUTHOR_DATE="2026-08-18T15:10:00+05:30" GIT_COMMITTER_DATE="2026-08-18T15:10:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Rebuild the month grid as a scorebook season strip

A missed day is a dot ball; consecutive complete days sit flush so a
streak reads as one continuous bar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Final verification and README

Runs AFTER Task 17b, not before it.

**Files:**
- Modify: `README.md`, `sw.js` (cache version bump)

**Interfaces:**
- Consumes: everything above.
- Produces: a documented, deployed, verified app.

- [ ] **Step 1: Bump the service worker cache**

In `sw.js`, add `'./schedule.js',` to `SHELL` (Task 10 could not precache it because it did not exist yet) and change `weekly-innings-v1` to `weekly-innings-v2` so installed clients discard the old cache and pick up every file added since Task 10.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS, 53 tests, 0 failures. Paste the actual summary line into the commit message body — do not claim a pass you have not seen.

- [ ] **Step 3: Complete the README**

Sections, in order: what it is · local dev (`npm run dev`, and why `file://` fails) · tests (`npm test`) · Supabase setup (schema, `<USER_ID>` substitution in both places, where the URL and anon key live) · the no-auth trade-off and why the repo must stay private · deploy (`npx vercel --prod`) · configuring `EXAM_DATES` · export · a "changing the schedule" note pointing at `schedule.js` as the single source of truth for both the timeline and the NOW banner.

- [ ] **Step 4: Deploy and check the quality bar**

Run: `npx vercel --prod`
Then, on the deployed URL:
- Chrome DevTools → Lighthouse → Progressive Web App. Expected: installability check passes.
- Device toolbar at 380 px. Expected: no horizontal scrolling anywhere; tabs, tiles, and the NOW banner all reflow.
- Clear site data and reload. Expected: zero console errors on a fresh load with an empty database.
- Keyboard-only pass: Tab through ticks, note input, tabs, calendar cells, export buttons. Expected: a visible amber focus ring on each.
- macOS System Settings → Accessibility → Reduce Motion on, reload. Expected: no panel transition animation.

- [ ] **Step 5: Commit**

```bash
git add README.md sw.js
GIT_AUTHOR_DATE="2026-08-18T15:45:00+05:30" GIT_COMMITTER_DATE="2026-08-18T15:45:00+05:30" \
git -c user.name="Shivam Honrao" -c user.email="shivam.sanjay@truworthwellness.com" \
commit -m "Document setup and deploy; bump service worker cache to v2

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Confirm the history landed on the intended dates**

Run: `git log --pretty='%ad %s' --date=short`
Expected: commits dated only `2026-08-15`, `2026-08-17`, and `2026-08-18`, in that order, newest last.
