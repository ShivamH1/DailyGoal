/* The first-run wizard: the one place a brand-new account is asked who it
   belongs to, before the app has any of the user's own words in it.

   Loaded identically by the browser and by node --test, like the two editors
   beside it. Every dependency arrives through mountOnboarding's arguments —
   it never imports app state and never touches `document` at module scope —
   so a test can hand it a fake root and drive the whole wizard with no
   browser at all.

   Every string a user types is set with textContent and read back from
   input.value. Nothing is ever interpolated into innerHTML: that is a
   security control, not a style preference, because this session holds a
   token in localStorage.

   Nothing is committed until the last screen. A profile written step by step
   would push half-finished setup to every other device the moment the first
   field lost focus, and would leave `onboarded` half-true if the user closed
   the tab in the middle. One commit, at the end, whose result is honoured —
   see finish(). */

import { CORE_TICK_KEYS, defaultProfile, normalizeProfile, tickLabel } from './profile.js';
/* Reused, not re-implemented. nextTickKey excludes keys that still carry
   logged history in rec.x, which profile.js's older newTickKey cannot do —
   see the long comment on nextTickKey itself. A third copy of that rule is
   how one of the copies ends up wrong. Same for parseTimeInput: the week
   editor already accepts both the twelve-hour style the page displays and
   the 24-hour string an <input type="time"> hands back. */
import { assertIsLaneUsageSet, assertLaneUsageIsWired, nextTickKey } from './profileEditor.js';
import { parseTimeInput } from './weekEditor.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

const DAYS = [
  { key: 'mon', name: 'Mon' },
  { key: 'tue', name: 'Tue' },
  { key: 'wed', name: 'Wed' },
  { key: 'thu', name: 'Thu' },
  { key: 'fri', name: 'Fri' },
  { key: 'sat', name: 'Sat' },
  { key: 'sun', name: 'Sun' },
];

/* Placeholders, not values. They are examples shown inside an empty field and
   they vanish the moment anything is typed; none of them is ever stored, and
   none of them is ever rendered anywhere else. Prefilling the three core
   ticks with Study / Workout / Sleep — which is what this app used to do —
   hands every new account one person's idea of what a day is for, and that is
   the thing this project set out to undo. */
const TICK_PLACEHOLDERS = {
  s: 'e.g. Two hours on the hard thing',
  w: 'e.g. Moved properly today',
  z: 'e.g. Lights out before midnight',
};

/* In order. `title` is the heading on the screen; `blurb` is the one line
   under it that says why the question is being asked. */
export const STEPS = [
  {
    id: 'basics',
    title: 'What are you calling this stretch?',
    blurb: 'A season is however long you are treating as one run. Skip it if you would rather not name it yet.',
  },
  {
    id: 'rhythm',
    title: 'When does your day start and end?',
    blurb: 'The only two answers everything else hangs off. Add anything already fixed in your week too — lectures, shifts, a commute.',
  },
  {
    id: 'ticks',
    title: 'The three you tick every day',
    blurb: 'Three habits, in your words. Leave one blank and it keeps a plain name until you decide; you can rename all three later.',
  },
  {
    id: 'lanes',
    title: 'The kinds of hour in your week',
    blurb: 'Lanes colour the schedule. The five below are a starting point, not a rule.',
  },
  {
    id: 'deadlines',
    title: 'Anything with a date on it',
    blurb: 'Exams, submissions, a race. The next one counts down on the front page.',
  },
  {
    id: 'rules',
    title: 'Ground rules, in your own words',
    blurb: 'The lines you hold yourself to. An invented one is worse than none, so leave this empty if nothing comes to mind.',
  },
  {
    id: 'done',
    title: 'That is setup',
    blurb: 'Everything here is editable later from Edit profile.',
  },
];

/* The trigger rule, in one testable place. `onboarded`, never "does this
   profile look empty": a user who deliberately clears everything out must not
   be dragged back through setup on their next launch. */
export const needsOnboarding = (profile) => profile?.onboarded !== true;

/* Only `rhythm` can ever block, and only because wake and sleep are what
   every other decision hangs off. An unknown id is not blocking — a wizard
   that refuses to advance for a reason it cannot name is worse than one that
   advances. */
export function stepValid(stepId, draft) {
  if (stepId !== 'rhythm') return true;
  const intent = draft?.intent;
  return Number.isInteger(intent?.wake) && Number.isInteger(intent?.sleep);
}

/* A pure switch over a cloned draft, normalised on the way out — so every
   step's answer goes through the same shape rules the synced document does,
   and no step can leave the draft in a state the app could not have loaded.
   A step id it does not recognise returns the draft unchanged rather than
   clearing it. */
export function applyStep(draft, stepId, values) {
  const next = clone(normalizeProfile(draft));
  const v = values && typeof values === 'object' ? values : {};

  switch (stepId) {
    case 'basics': {
      if (has(v, 'season')) next.season = v.season;
      /* intent.goals belongs to the generator in the next project, not to
         anything here; it is asked on this screen because "what is this
         season for" is the same question as "what do you call it". */
      if (has(v, 'goals')) next.intent.goals = v.goals;
      break;
    }
    case 'rhythm': {
      if (has(v, 'wake')) next.intent.wake = v.wake;
      if (has(v, 'sleep')) next.intent.sleep = v.sleep;
      if (has(v, 'busy')) next.intent.busy = v.busy;
      break;
    }
    case 'ticks': {
      const labels = v.labels || {};
      const hints = v.hints || {};
      const patch = (t) => ({
        ...t,
        label: has(labels, t.key) ? labels[t.key] : t.label,
        hint: has(hints, t.key) ? hints[t.key] : t.hint,
      });
      /* The core three are always kept, always first, and always exactly
         three — they map to real columns in daily_progress and to the streak
         rule, so a rename is the only edit this step can make to them. */
      const core = next.ticks.filter((t) => CORE_TICK_KEYS.includes(t.key)).map(patch);
      const extrasIn = has(v, 'extras') && Array.isArray(v.extras)
        ? v.extras
        : next.ticks.filter((t) => !CORE_TICK_KEYS.includes(t.key));
      next.ticks = [...core, ...extrasIn.map(patch)];
      break;
    }
    case 'lanes': {
      if (has(v, 'lanes') && Array.isArray(v.lanes)) next.lanes = v.lanes;
      break;
    }
    case 'deadlines': {
      if (has(v, 'deadlines') && Array.isArray(v.deadlines)) next.deadlines = v.deadlines;
      break;
    }
    case 'rules': {
      if (has(v, 'rules') && Array.isArray(v.rules)) next.rules = v.rules;
      break;
    }
    default:
      /* 'done' asks for nothing, and so does an id from a future version of
         this file. Neither is a reason to throw away what has been typed. */
      break;
  }

  return normalizeProfile(next);
}

/* Minutes back to the value an <input type="time"> wants. Not
   schedule.js's minutesToLabel, which is the twelve-hour display style. */
function minutesToTimeValue(m) {
  if (!Number.isInteger(m)) return '';
  const clamped = Math.min(m, 1439);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export function mountOnboarding({
  root,
  /* (profile) => boolean. Only a literal `true` is treated as saved: a
     commit that cannot say whether it worked has not told us it worked, and
     guessing that it did is the original bug of this project. */
  onDone,
  getProfile = defaultProfile,
  /* Every tick key that still carries logged history, so an extra tick added
     here can never inherit a deleted habit's past. Defaulted, because a
     brand-new account usually has none. */
  getReservedTickKeys = () => new Set(),
  /* (laneKey) => Set<dayName> — the SAME usage source the profile editor is
     wired with, because this wizard mounts over every pre-onboarding
     profile, including an existing account whose stored week points at
     these lanes. Removing a used lane here would commit exactly the state
     the profile editor refuses to create. Defaulted to empty because a
     brand-new account has no stored week to point anywhere. */
  getLaneUsage = () => new Set(),
  /* Opens the week editor. PROJECT B REPLACES EXACTLY THIS: the generator
     takes profile.intent — collected on the rhythm and basics steps above and
     read by nothing else in this project — and produces the week the user
     would otherwise build by hand here. Everything else in this wizard
     survives that change unaltered. Null means the offer is not made at all,
     rather than a button that does nothing. */
  onBuildWeek = null,
}) {
  /* A missing mount point must not take the page down: this is called from
     app.js after the init pull, on a page that may have been rearranged.
     Same reasoning as the two editors' own guards. */
  if (!root || typeof onDone !== 'function') return;

  const doc = root.ownerDocument;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /* The working copy. Normalised up front so every step reads the same shape
     the document has, and never the object app.js handed us. */
  let draft = normalizeProfile(getProfile());
  let index = 0;
  let finished = false;

  const wrap = el('section', 'ob');
  /* role=dialog, and deliberately NOT aria-modal. The overlay covers the
     viewport opaquely, but nothing here traps focus the way <dialog>'s
     showModal() does, and claiming modality that is not implemented is the
     same overclaim the day tabs were fixed for — a promise nothing keeps.
     The two editors are real <dialog> elements and can say it; this cannot,
     so it does not. */
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', 'First-time setup');

  const progress = el('p', 'ob-progress');
  const heading = el('h2', 'ob-title');
  const blurb = el('p', 'ob-blurb');
  const body = el('div', 'ob-body');
  const status = el('p', 'ob-status');
  status.setAttribute('role', 'alert');

  const backBtn = el('button', 'ob-back', 'Back');
  backBtn.type = 'button';
  const nextBtn = el('button', 'ob-next', 'Next');
  nextBtn.type = 'button';
  const skipBtn = el('button', 'ob-skip', 'Skip setup');
  skipBtn.type = 'button';

  const actions = el('div', 'ob-actions');
  actions.append(backBtn, nextBtn, skipBtn);

  wrap.append(progress, heading, blurb, body, status, actions);
  root.append(wrap);

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = kind ? `ob-status ${kind}` : 'ob-status';
  }

  /* ---------- field helpers ---------- */
  /* Every one of these reads input.value INSIDE the blur handler and writes
     it straight into the draft. None of them compares against a value
     captured when the field was built: that comparison is what silently
     discarded a cleared field in the week editor, because "unchanged from
     the snapshot" and "empty" look identical to it. */
  function textField(labelText, { placeholder, value, ariaLabel, onValue, multiline }) {
    const label = el('label', 'ob-field');
    const caption = el('span', '', labelText);
    label.append(caption);
    const input = doc.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.placeholder = placeholder || '';
    input.setAttribute('aria-label', ariaLabel || labelText);
    input.value = value || '';
    input.addEventListener('blur', () => onValue(input.value.trim()));
    label.append(input);
    /* `caption` is handed back so a row can retitle itself without redrawing
       the list. Rebuilding rows inside a blur handler destroys the element
       the user is in the act of leaving, which in a browser can swallow the
       click that caused the blur. */
    return { label, input, caption };
  }

  function timeField(labelText, { value, ariaLabel, onValue }) {
    const label = el('label', 'ob-field');
    label.append(el('span', '', labelText));
    const input = doc.createElement('input');
    input.type = 'time';
    input.setAttribute('aria-label', ariaLabel || labelText);
    input.value = minutesToTimeValue(value);
    input.addEventListener('blur', () => onValue(parseTimeInput(input.value)));
    input.addEventListener('change', () => onValue(parseTimeInput(input.value)));
    label.append(input);
    return { label, input };
  }

  /* Toggle buttons rather than checkboxes, for the same reason app.js's day
     tabs are buttons: the state is carried in aria-pressed, which is read
     back the same way by a screen reader and by a test. */
  function dayPicker(selected, onToggle) {
    const boxRow = el('div', 'ob-days');
    boxRow.setAttribute('role', 'group');
    boxRow.setAttribute('aria-label', 'Days');
    for (const day of DAYS) {
      const btn = el('button', 'ob-day', day.name);
      btn.type = 'button';
      const on = selected.includes(day.key);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('on', on);
      btn.addEventListener('click', () => onToggle(day.key));
      boxRow.appendChild(btn);
    }
    return boxRow;
  }

  function addButton(text, onClick) {
    const btn = el('button', 'ob-add', text);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function removeButton(text, onClick) {
    const btn = el('button', 'ob-remove', text);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  }

  /* ---------- the steps ---------- */
  /* Each writes into `draft` through applyStep, so the draft is only ever
     the shape normalizeProfile allows — the same guarantee the app's own
     document has. */
  const apply = (stepId, values) => { draft = applyStep(draft, stepId, values); };

  function renderBasics() {
    body.append(textField('Season', {
      placeholder: 'e.g. Autumn term, or Season 2026',
      value: draft.season,
      ariaLabel: 'Season',
      onValue: (v) => apply('basics', { season: v }),
    }).label);
    body.append(textField('What is this stretch for?', {
      placeholder: 'e.g. Pass the exams in January without falling apart',
      value: draft.intent.goals,
      ariaLabel: 'Goals',
      multiline: true,
      onValue: (v) => apply('basics', { goals: v }),
    }).label);
    /* Said on the screen, not only in a comment: this answer is stored and
       nothing in this app reads it yet. */
    body.append(el('p', 'ob-note',
      'This one is not used anywhere yet — it is what a future version reads to draft a week for you.'));
  }

  function renderRhythm() {
    const times = el('div', 'ob-row');
    times.append(timeField('Wake', {
      value: draft.intent.wake,
      ariaLabel: 'Wake time',
      onValue: (m) => { apply('rhythm', { wake: m }); refreshNext(); },
    }).label);
    times.append(timeField('Sleep', {
      value: draft.intent.sleep,
      ariaLabel: 'Sleep time',
      onValue: (m) => { apply('rhythm', { sleep: m }); refreshNext(); },
    }).label);
    body.append(times);

    /* The commitment rows are held here rather than read back out of the
       draft, because normalizeProfile drops an entry that is not yet
       complete — a row would vanish the instant the user typed its label and
       before they had picked a day. Same reason profileEditor keeps its own
       unnormalised draft. Committed to the draft on every edit; the
       incomplete rows are simply dropped there until they are finished. */
    const rows = draft.intent.busy.map((b) => ({ ...b, days: [...b.days] }));
    const pending = el('p', 'ob-note');

    const commitRows = () => {
      apply('rhythm', { busy: rows });
      const kept = draft.intent.busy.length;
      pending.textContent = kept === rows.length ? ''
        : `${rows.length - kept} of these is not saved yet — each needs a name, at least one day, and an end after its start.`;
    };

    const list = el('div', 'ob-list');
    const drawRows = () => {
      list.textContent = '';
      rows.forEach((row, i) => {
        const rowEl = el('div', 'ob-busy');
        rowEl.append(textField('Commitment', {
          placeholder: 'e.g. Lectures',
          value: row.label,
          ariaLabel: 'Commitment name',
          onValue: (v) => { row.label = v; commitRows(); },
        }).label);
        rowEl.append(dayPicker(row.days, (dayKey) => {
          row.days = row.days.includes(dayKey)
            ? row.days.filter((d) => d !== dayKey)
            : [...row.days, dayKey];
          commitRows();
          drawRows();
        }));
        rowEl.append(timeField('From', {
          value: row.start,
          ariaLabel: 'Commitment start',
          onValue: (m) => { row.start = m; commitRows(); },
        }).label);
        rowEl.append(timeField('To', {
          value: row.end,
          ariaLabel: 'Commitment end',
          onValue: (m) => { row.end = m; commitRows(); },
        }).label);
        rowEl.append(removeButton('Remove', () => {
          rows.splice(i, 1);
          commitRows();
          drawRows();
        }));
        list.appendChild(rowEl);
      });
    };
    drawRows();
    body.append(list, pending, addButton('Add a commitment', () => {
      rows.push({ label: '', days: [], start: 540, end: 600 });
      drawRows();
      commitRows();
    }));
  }

  function renderTicks() {
    const labels = {};
    const hints = {};
    const extras = draft.ticks.filter((t) => !CORE_TICK_KEYS.includes(t.key))
      .map((t) => ({ ...t }));

    const commitTicks = () => apply('ticks', { labels, hints, extras });

    const list = el('div', 'ob-list');
    const drawTicks = () => {
      list.textContent = '';
      draft.ticks.filter((t) => CORE_TICK_KEYS.includes(t.key)).forEach((tick, i) => {
        const rowEl = el('div', 'ob-tick');
        const name = textField(tickLabel(tick, i), {
          placeholder: TICK_PLACEHOLDERS[tick.key] || '',
          value: tick.label,
          ariaLabel: `Habit ${i + 1} name`,
          onValue: (v) => {
            labels[tick.key] = v;
            commitTicks();
            /* The row's own caption, in place — it is the one thing on
               screen that has to change, and it is what the app will call
               this tick if the field is left empty. */
            name.caption.textContent = tickLabel({ label: v }, i);
          },
        });
        rowEl.append(name.label);
        rowEl.append(textField('Hint', {
          placeholder: 'Optional — a few words under the button',
          value: tick.hint,
          ariaLabel: `Habit ${i + 1} hint`,
          onValue: (v) => { hints[tick.key] = v; commitTicks(); },
        }).label);
        list.appendChild(rowEl);
      });

      extras.forEach((tick, i) => {
        const rowEl = el('div', 'ob-tick');
        rowEl.append(textField('Also', {
          placeholder: 'e.g. Read 20 pages',
          value: tick.label,
          ariaLabel: `Extra habit ${i + 1} name`,
          onValue: (v) => { tick.label = v; commitTicks(); },
        }).label);
        rowEl.append(removeButton('Remove', () => {
          extras.splice(i, 1);
          commitTicks();
          drawTicks();
        }));
        list.appendChild(rowEl);
      });
    };
    drawTicks();

    body.append(list, addButton('Add another habit', () => {
      /* nextTickKey, never newTickKey: the key must also avoid every key
         that still carries logged history, or a brand-new habit silently
         inherits a deleted one's past. */
      const reserved = getReservedTickKeys() || new Set();
      extras.push({ key: nextTickKey(draft.ticks.concat(extras), reserved), label: '', hint: '', core: false });
      drawTicks();
    }));
    body.append(el('p', 'ob-note',
      'A habit left blank is not given a name for you — it shows as Habit 1, 2 or 3 until you name it.'));
  }

  function renderLanes() {
    const lanes = draft.lanes.map((l) => ({ ...l }));
    const commitLanes = () => apply('lanes', { lanes });
    const list = el('div', 'ob-list');
    const drawLanes = () => {
      list.textContent = '';
      lanes.forEach((lane, i) => {
        const rowEl = el('div', 'ob-lane');
        rowEl.append(textField('Lane', {
          placeholder: 'e.g. Deep work',
          value: lane.name,
          ariaLabel: `Lane ${i + 1} name`,
          onValue: (v) => { lane.name = v; commitLanes(); },
        }).label);
        rowEl.append(removeButton('Remove', () => {
          /* The profile editor's guard, honoured here too: a lane the
             stored week still points at must not be removable during setup.
             Probe-then-check exactly as profileEditor.js does — a mis-wired
             getLaneUsage that ignores its argument, or answers with an
             Array whose .size reads back undefined, would otherwise fail
             OPEN and delete a lane the week genuinely uses. */
          let usedBy;
          try {
            assertLaneUsageIsWired(getLaneUsage);
            usedBy = getLaneUsage(lane.key);
            assertIsLaneUsageSet(usedBy, 'getLaneUsage(lane.key)');
          } catch (err) {
            setStatus('Not saved — could not safely check whether this lane is still in use, so nothing was changed.', 'ob-warn');
            throw err;
          }
          if (usedBy.size) {
            setStatus(`Still used by ${[...usedBy].join(', ')} — remove it from the schedule first.`, 'ob-warn');
            return;
          }
          setStatus('');
          lanes.splice(i, 1);
          commitLanes();
          drawLanes();
        }));
        list.appendChild(rowEl);
      });
    };
    drawLanes();
    body.append(list, addButton('Add a lane', () => {
      const used = new Set(lanes.map((l) => l.key));
      let n = 1;
      while (used.has(`lane${n}`)) n += 1;
      lanes.push({ key: `lane${n}`, name: '' });
      drawLanes();
    }));
    body.append(el('p', 'ob-note',
      'Empty the list and the five defaults come back — a schedule block has to point at a lane, so no lanes at all is a broken week, not a choice.'));
  }

  function renderDeadlines() {
    /* One date field per row here, where the profile editor lets a group
       hold several — but a row still CARRIES its whole group. The visible
       field edits dates[0] and the remaining dates ride along untouched
       through every commit: rebuilding groups from the visible date alone
       is what this step first did, and any edit on the screen then silently
       truncated every existing multi-date group to one date, with finish()
       syncing the loss everywhere. A row whose group hides more dates says
       so in plain text, so removing the row is an informed removal of the
       group and not just of the date that happens to show. */
    const rows = draft.deadlines.map((d) => ({ label: d.label, date: d.dates[0] || '', rest: d.dates.slice(1) }));
    const pending = el('p', 'ob-note');
    const commitDeadlines = () => {
      apply('deadlines', {
        deadlines: rows.map((r) => ({ label: r.label, dates: [r.date, ...r.rest].filter(Boolean) })),
      });
      const kept = draft.deadlines.length;
      pending.textContent = kept === rows.length ? ''
        : `${rows.length - kept} of these is not saved yet — each needs a name and a date.`;
    };
    const list = el('div', 'ob-list');
    const drawDeadlines = () => {
      list.textContent = '';
      rows.forEach((row, i) => {
        const rowEl = el('div', 'ob-deadline');
        rowEl.append(textField('What', {
          placeholder: 'e.g. Paper 1',
          value: row.label,
          ariaLabel: `Deadline ${i + 1} name`,
          onValue: (v) => { row.label = v; commitDeadlines(); },
        }).label);
        const dateWrap = el('label', 'ob-field');
        dateWrap.append(el('span', '', 'When'));
        const date = doc.createElement('input');
        date.type = 'date';
        date.setAttribute('aria-label', `Deadline ${i + 1} date`);
        date.value = row.date;
        const readDate = () => { row.date = date.value.trim(); commitDeadlines(); };
        date.addEventListener('blur', readDate);
        date.addEventListener('change', readDate);
        dateWrap.append(date);
        rowEl.append(dateWrap);
        if (row.rest.length) {
          rowEl.append(el('p', 'ob-more',
            `+ ${row.rest.length} more date${row.rest.length === 1 ? '' : 's'} — kept`));
        }
        rowEl.append(removeButton('Remove', () => {
          rows.splice(i, 1);
          commitDeadlines();
          drawDeadlines();
        }));
        list.appendChild(rowEl);
      });
    };
    drawDeadlines();
    body.append(list, pending, addButton('Add a date', () => {
      rows.push({ label: '', date: '', rest: [] });
      drawDeadlines();
    }));
  }

  function renderRules() {
    const rows = draft.rules.map((r) => ({ ...r }));
    const pending = el('p', 'ob-note');
    const commitRules = () => {
      apply('rules', { rules: rows });
      const kept = draft.rules.length;
      pending.textContent = kept === rows.length ? ''
        : `${rows.length - kept} of these is not saved yet — a rule needs a title.`;
    };
    const list = el('div', 'ob-list');
    const drawRules = () => {
      list.textContent = '';
      rows.forEach((row, i) => {
        const rowEl = el('div', 'ob-rule');
        rowEl.append(textField('Rule', {
          placeholder: 'e.g. Never miss twice',
          value: row.title,
          ariaLabel: `Rule ${i + 1} title`,
          onValue: (v) => { row.title = v; commitRules(); },
        }).label);
        rowEl.append(textField('Because', {
          placeholder: 'Optional — what it means on a bad day',
          value: row.body,
          ariaLabel: `Rule ${i + 1} body`,
          multiline: true,
          onValue: (v) => { row.body = v; commitRules(); },
        }).label);
        rowEl.append(removeButton('Remove', () => {
          rows.splice(i, 1);
          commitRules();
          drawRules();
        }));
        list.appendChild(rowEl);
      });
    };
    drawRules();
    body.append(list, pending, addButton('Add a rule', () => {
      rows.push({ title: '', body: '' });
      drawRules();
    }));
  }

  function renderDone() {
    body.append(el('p', 'ob-done',
      'Your days are ticked on the front page and the week below it is yours to shape. '
      + 'Nothing here is fixed — Edit profile changes any of it later.'));
    /* THE ONE STEP PROJECT B REPLACES. The schedule generator reads
       profile.intent (wake, sleep, commitments, goals — collected on the two
       screens above and read by nothing in this project) and drafts the week
       instead of handing over a blank editor. Everything else in this wizard
       is unaffected by that change, which is the whole reason intent is
       gathered here rather than in a second setup flow later. */
    if (typeof onBuildWeek === 'function') {
      body.append(addButton('Build my week', () => {
        /* Saves FIRST, and opens nothing if the save was refused: landing in
           the week editor would say setup had been stored when it had not. */
        finish({ buildWeek: true });
      }));
    }
  }

  const RENDERERS = {
    basics: renderBasics,
    rhythm: renderRhythm,
    ticks: renderTicks,
    lanes: renderLanes,
    deadlines: renderDeadlines,
    rules: renderRules,
    done: renderDone,
  };

  /* ---------- the frame ---------- */
  function refreshNext() {
    const step = STEPS[index];
    const last = index === STEPS.length - 1;
    nextBtn.textContent = last ? 'Finish' : 'Next';
    /* Not disabled: a dead button explains nothing. It is pressable, and
       pressing it says what is missing — see the guard in its handler. */
    nextBtn.setAttribute('aria-disabled', stepValid(step.id, draft) ? 'false' : 'true');
  }

  function render() {
    const step = STEPS[index];
    progress.textContent = `Step ${index + 1} of ${STEPS.length}`;
    heading.textContent = step.title;
    blurb.textContent = step.blurb;
    body.textContent = '';
    setStatus('');
    backBtn.disabled = index === 0;
    RENDERERS[step.id]();
    refreshNext();
  }

  function unmount() {
    finished = true;
    wrap.remove();
  }

  /* The single commit. `next` is the live draft — whatever the user actually
     typed and nothing else — plus onboarded: true.

     Nothing is invented on the way out. Skip setup arrives here too: an
     untouched draft is exactly defaultProfile() with onboarded flipped, so
     skipping stores three blank core ticks and no rules rather than a set of
     words nobody chose. Someone who skips after typing a season keeps their
     season — their own word is not an invention, and discarding it would be
     a data-loss bug wearing a "defaults" label.

     The result is honoured. A commit that did not return true did not save,
     so the wizard stays exactly where it is with everything still on screen:
     unmounting here would drop the user onto an app that looks set up and
     is not. */
  function finish({ buildWeek = false } = {}) {
    if (finished) return false;
    const next = normalizeProfile({ ...draft, onboarded: true });
    if (onDone(next) !== true) {
      setStatus(
        'Not saved — this device could not store your setup, so a reload here may not bring it back. '
        + 'Everything you typed is still on this screen; try again.',
        'ob-warn',
      );
      return false;
    }
    unmount();
    if (buildWeek && typeof onBuildWeek === 'function') onBuildWeek();
    return true;
  }

  backBtn.addEventListener('click', () => {
    if (index === 0) return;
    index -= 1;
    render();
  });

  nextBtn.addEventListener('click', () => {
    const step = STEPS[index];
    if (!stepValid(step.id, draft)) {
      setStatus('Add a wake time and a sleep time — every other decision in this app hangs off those two.', 'ob-warn');
      return;
    }
    if (index === STEPS.length - 1) { finish(); return; }
    index += 1;
    render();
  });

  skipBtn.addEventListener('click', () => { finish(); });

  render();
}
