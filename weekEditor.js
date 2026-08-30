/* The week editor: a <dialog> the user opens to build the week's shape by
   hand — the blocks each day is made of, and the label, subject, detail,
   lane and times of each one, plus the optional name a day can go by.

   Loaded identically by the browser and by node --test, like profileEditor.js
   beside it. Every dependency arrives through mountWeekEditor's arguments
   rather than being imported from app state, and nothing touches `document`
   at module scope, so a test can hand it a fake root and a fake week and
   drive the whole thing with no browser at all. The pure decisions
   (parseTimeInput, sortBlocks, copyWeek, draftFromWeek, groupErrors) are
   exported for exactly that reason.

   Every string here is user-authored, so every string is set with
   textContent and read from input.value. Nothing is ever interpolated into
   innerHTML — that is a security control, not a style preference, because
   this session holds a token in localStorage. */

import { DAY_KEYS, validateWeek, minutesToLabel } from './schedule.js';

/* Deliberately a local copy of app.js's DAY_NAMES rather than an import:
   this module imports only the pure schedule module, the same way
   profileEditor.js imports only profile.js, and app.js cannot be imported by
   node --test at all (it reads `document` at module scope). Display text for
   a heading, not a fact schedule.js needs to know — see app.js's own comment
   above DAY_NAMES for why it does not live there either. */
const DAY_LABELS = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

/* Both spellings, because both actually reach this function. The page
   displays twelve-hour times with no meridiem (schedule.js's minutesToLabel)
   and an <input type="time"> hands back a twenty-four-hour string regardless
   of what the page shows, so anything reading a time here has to take
   either. Nonsense returns null rather than a guess: a silent 0 would put a
   block at midnight and a silent NaN would fail validateWeek's integer check
   with a message about the wrong thing.

   '24:00' is 1440, not 0. A block that runs to midnight ends at the end of
   its own day, and folding that to 0 would make it end before it starts —
   which validateWeek would then reject, correctly, for a value the user
   never typed. The twelve-hour branch has no such spelling (there is no
   '12:00 pm' that means the following midnight), so the 1440 case is
   reachable only from the 24-hour branch, which is exactly where it comes
   from. */
export function parseTimeInput(text) {
  if (typeof text !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})\s*([ap]m)?$/.exec(text.trim().toLowerCase());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (mins > 59) return null;
  if (m[3]) {
    /* A meridiem pins the hour to 1–12; '0:30 am' and '13:00 pm' are not
       times anyone means, they are two spellings collided. */
    if (hours < 1 || hours > 12) return null;
    return (hours % 12) * 60 + mins + (m[3] === 'pm' ? 720 : 0);
  }
  const total = hours * 60 + mins;
  return total > 1440 ? null : total;
}

/* Order is a fact about the times, so it is derived rather than stored: this
   returns a NEW array (the caller's is never reordered under it) sorted by
   start. A block whose start is not a whole number sorts last instead of
   throwing a NaN comparator at the sort — validateWeek reports that block
   separately, and this function's job is only to put the ones it can read in
   order. The comparator returns 0 for two equal ranks rather than
   Infinity - Infinity, which is NaN and leaves sort() free to do anything.

   Sorting by start also collapses one of validateWeek's two ordering errors:
   after this, `b.start < prevEnd` can only mean a genuine overlap, never
   "5pm listed before 2pm". */
export function sortBlocks(blocks) {
  const rank = (b) => (Number.isInteger(b?.start) ? b.start : Number.POSITIVE_INFINITY);
  return (Array.isArray(blocks) ? blocks.slice() : [])
    .sort((a, b) => {
      const x = rank(a), y = rank(b);
      return x === y ? 0 : x < y ? -1 : 1;
    });
}

/* A deep copy, and the single most load-bearing line in this file.

   schedule.js's gateWeek/weekFromDoc return doc.value BY IDENTITY when the
   stored week is valid, so in app.js `week === scheduleDoc.value`. Editing
   the object getWeek() hands back would therefore be editing the cached
   envelope in place: a half-finished edit would already be inside
   scheduleDoc, and any concurrent flush would push it to the server carrying
   the OLD `u` timestamp, because nothing re-stamped it. That is data
   corruption that reports success.

   So the draft is a copy of what getWeek() returns, and what save() hands to
   onChange is a copy of the draft — no object this editor has ever touched
   is the object app.js is holding, in either direction, at any point. */
export const copyWeek = (week) => JSON.parse(JSON.stringify(week ?? {}));

const isDayObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/* The editable shape: a deep copy of the given week in which all seven days
   exist and every one of them has a blocks array.

   validateWeek permits a day to be absent, and permits a present day to
   carry no blocks key at all, but a form cannot render "absent" — the user
   has to be able to add Tuesday's first block without Tuesday existing
   first. Every other field a day or a block carries is preserved by spread
   rather than rebuilt from a whitelist: block.effort is rendered by app.js
   and is not editable here, and an editor that dropped it on save would
   delete data the user never touched. */
export function draftFromWeek(week) {
  const draft = copyWeek(week);
  const out = isDayObject(draft) ? draft : {};
  for (const key of DAY_KEYS) {
    const day = isDayObject(out[key]) ? out[key] : {};
    const blocks = Array.isArray(day.blocks) ? day.blocks : [];
    out[key] = { ...day, blocks: sortBlocks(blocks.map((b) => ({ ...(isDayObject(b) ? b : {}) }))) };
  }
  return out;
}

/* validateWeek writes its per-block errors as `${dayKey}[${i}]: message`.
   This reads that format back so the message can be shown against the row it
   is about — the plan's requirement is every error, next to its own block,
   and a flat list at the bottom of a seven-day form is not that.

   Anything that does not match (a whole-week or whole-day complaint like
   'week must be an object' or 'mon: blocks is not a list') is not forced
   into a row it does not belong to; groupErrors below keeps it aside. The
   day key is checked against DAY_KEYS rather than any three letters, so a
   user-authored label that happens to look like this format cannot be
   mistaken for a location — errors are our own strings, but the day key is
   the part that decides which row gets the message. */
export function locateError(message) {
  const m = /^([a-z]+)\[(\d+)\]: ([\s\S]+)$/.exec(String(message ?? ''));
  if (!m || !DAY_KEYS.includes(m[1])) return null;
  return { dayKey: m[1], index: Number(m[2]), text: m[3] };
}

export const blockErrorKey = (dayKey, index) => `${dayKey}[${index}]`;

/* { byBlock: Map<'mon[0]', string[]>, general: string[] } — every error
   placed, none dropped. A message this cannot locate goes to `general` and
   is shown at the top of the dialog, because the alternative is showing it
   nowhere. */
export function groupErrors(errors) {
  const byBlock = new Map();
  const general = [];
  for (const message of Array.isArray(errors) ? errors : []) {
    const at = locateError(message);
    if (!at) { general.push(String(message)); continue; }
    const key = blockErrorKey(at.dayKey, at.index);
    if (!byBlock.has(key)) byBlock.set(key, []);
    byBlock.get(key).push(at.text);
  }
  return { byBlock, general };
}

/* Which lane keys the given week's blocks point at that `laneKeys` does not
   contain — the exact set that makes schedule.js's validateWeek reject a
   stored week with "unknown lane", and therefore the exact set that has to
   come back for it to be readable again.

   Derived by diffing the blocks against the lane list rather than by parsing
   validateWeek's own error strings: the message wording is display text and
   is allowed to change, while `block.lane` is the stored fact the gate
   actually tests. Reading it directly means this cannot silently start
   returning nothing the day that sentence is reworded.

   A block whose lane is '' or not a string is skipped, because there is no
   key there to put back. validateWeek still reports it — this function only
   answers "which lanes could be restored", not "what is wrong with this
   week". First-seen order, each key once, so the sentence naming them reads
   in the order the week itself does. */
export function missingLaneKeys(week, laneKeys) {
  const known = new Set(Array.isArray(laneKeys) ? laneKeys : []);
  const missing = [];
  const seen = new Set();
  for (const dayKey of DAY_KEYS) {
    const day = week?.[dayKey];
    if (!isDayObject(day) || !Array.isArray(day.blocks)) continue;
    for (const block of day.blocks) {
      const lane = block?.lane;
      if (typeof lane !== 'string' || !lane) continue;
      if (known.has(lane) || seen.has(lane)) continue;
      seen.add(lane);
      missing.push(lane);
    }
  }
  return missing;
}

/* A readable name for a lane being restored from nothing but its stored key.

   The key is an internal identifier: profileEditor.js generates them
   (lane1, lane2, …) and offers no field to type one, so putting a raw key on
   screen as a lane name would make the app's own plumbing the user's
   content. Title-casing it gives something a person can read and then rename
   — 'study' becomes 'Study' — and it is the same string the refusal uses to
   name the lane it is offering to put back, so the sentence and the lane the
   button creates always agree.

   A key with nothing word-like in it falls back to the key itself rather
   than to '': normalizeProfile drops a lane with no name, so an empty one
   would make the restore button silently do nothing. */
export function laneDisplayName(key) {
  const words = String(key ?? '').split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (!words.length) return String(key ?? '');
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/* '' for anything an <input type="time"> cannot carry, which includes the
   perfectly valid 1440. The field maxes out at 23:59, so a block ending at
   midnight has no representation there; renderBlock says so on the row
   rather than letting a blank field read as "no end time". The draft keeps
   the 1440 either way — see readTime on why an untouched field is never
   read back. */
const toTimeValue = (m) =>
  Number.isInteger(m) && m >= 0 && m <= 1439
    ? `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    : '';

/* Where a newly added block starts: after whatever the day already ends
   with, an hour long, and never past the end of the day. 9am for an empty
   day because a plan that starts at midnight is nobody's morning. */
export function nextBlockTimes(blocks) {
  const ends = (Array.isArray(blocks) ? blocks : [])
    .map((b) => b?.end)
    .filter((e) => Number.isInteger(e) && e >= 0 && e <= 1440);
  const last = ends.length ? Math.max(...ends) : 540;
  const start = Math.min(last, 1380);
  return { start, end: Math.min(start + 60, 1440) };
}

/* 'Study' / 'Study and Work' / 'Study, Work and Rest'. A bare join(', ')
   reads as a list of parts rather than a sentence, and this string sits
   mid-sentence in the refusal. */
const listNames = (names) =>
  names.length < 2 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

export function mountWeekEditor({
  root, getWeek, getLanes, onChange, getSaveRefusal = () => null,
  /* The RAW stored week — scheduleDoc.value, not the gated `week` on screen.
     While the gate is refusing, those are different objects and only the raw
     one still says which lanes the user's real week points at; the rendered
     stand-in says nothing at all. Defaulted so a caller that does not supply
     it simply gets no recovery offer rather than a crash. */
  getStoredWeek = () => null,
  /* Creates lanes with the exact keys it is handed. Whether that made the
     week readable is not this function's answer to give — the editor re-asks
     getSaveRefusal(), which is app.js's own gate and the only thing entitled
     to say so. */
  onRestoreLanes = null,
}) {
  /* A missing mount point must not be able to take the page down:
     mountWeekEditor is called at app.js's module scope, before the sign-in
     gate is ever shown. Same reasoning as mountProfileEditor's own guard. */
  if (!root) return;

  const doc = root.ownerDocument;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const openBtn = el('button', 'week-edit-btn', 'Edit the week');
  openBtn.type = 'button';

  const dialog = el('dialog', 'week-dialog');
  const heading = el('h2', '', 'Edit the week');
  const intro = el('p', 'wk-intro',
    'Blocks are kept in start-time order — set the times and the order follows.');
  const generalBox = el('div', 'wk-general');
  const daysWrap = el('div', 'wk-days');
  const footer = el('div', 'wk-actions');
  const status = el('p', 'wk-status');

  const saveBtn = el('button', 'wk-save-btn', 'Save the week');
  saveBtn.type = 'button';
  const closeBtn = el('button', 'wk-close-btn', 'Close');
  closeBtn.type = 'button';
  /* The status line lives inside the action bar rather than beside it so
     the two can be one sticky footer: this dialog is seven days long and
     scrolls, and a Save button that scrolls away takes the sentence
     explaining why the last save was refused with it. */
  footer.append(status, saveBtn, closeBtn);

  dialog.append(heading, intro, generalBox, daysWrap, footer);
  root.append(openBtn, dialog);

  /* The working copy for the open editing session, and never the object
     getWeek() returned — see copyWeek. Null while the dialog has never been
     opened, and while the editor is refusing to edit at all. */
  let draft = null;
  /* Per-day { section, rows: [{ status }] } from the most recent render, so
     a failed save can write each message onto the row it belongs to without
     querying the DOM back. */
  let dayRefs = new Map();
  /* Unsaved edits exist. Read by requestClose below, which is the only reason
     to track it: <dialog> closes on Escape and the Close button closed
     unconditionally, so an edit could vanish with nothing said. */
  let dirty = false;
  /* The warning has been shown for the close that is currently being asked
     for. Cleared by every new edit and by every open, so the second press is
     only ever a confirmation of the sentence the user just read — never a
     stale permission granted before the edit they are about to lose. */
  let closeArmed = false;

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = kind ? `wk-status ${kind}` : 'wk-status';
  }

  function markDirty() {
    dirty = true;
    closeArmed = false;
    setStatus('Unsaved changes — press “Save the week” to keep them.', 'wk-warn');
  }

  /* Two presses, not a confirm() and not a refusal. One press with unsaved
     work in the form threw it away silently; blocking the close outright
     would trap the dialog, and Escape must keep working. So the first press
     says what is about to be lost and the second one does it.

     Returns whether the dialog actually closed, which is what lets the
     'cancel' handler below decide whether to let Escape through. */
  function requestClose() {
    if (dirty && !closeArmed) {
      closeArmed = true;
      setStatus('Unsaved changes. Press Close again to discard them, or “Save the week” to keep them.', 'wk-warn');
      return false;
    }
    dialog.close();
    return true;
  }

  closeBtn.addEventListener('click', requestClose);
  /* Escape fires 'cancel' before the dialog closes, and it is cancellable —
     the one hook that lets the keyboard route obey the same guard as the
     button instead of being the lossy way out of it. */
  dialog.addEventListener('cancel', (event) => {
    if (!requestClose()) event.preventDefault();
  });

  /* ---------- refusal ---------- */
  /* What the editor offers when the week cannot be saved at all. app.js sets
     this while `weekIsFallback` is up: there IS a stored week, it could not
     be read, and it is being preserved rather than overwritten. Offering a
     full form there would be a trap — the user would build a week and only
     find out it cannot be stored after pressing Save. So the form is not
     offered; the reason is, along with the recovery — PERFORMED, not
     described.

     This used to tell the user to “add that lane back under Edit profile”.
     They could not: profileEditor.js's newLaneKey only ever emits lane1,
     lane2, … and neither editor has a field for typing a lane key, so a week
     referencing ‘study’ was unrecoverable by following the app's own
     instruction. Confidently stating a fix that cannot work is worse than
     stating none. The editor can see the keys — validateWeek's unknown-lane
     rule is a diff between the stored blocks' lanes and the profile's, and
     missingLaneKeys computes exactly that — so it names them and offers a
     button that creates them. The keys themselves never appear: they are
     internal identifiers, so what is shown (and what the restored lane is
     named) is laneDisplayName's readable form.

     When nothing is missing there is no button and no instruction, because
     there is nothing the app can safely do about an overlap or a missing
     label inside a stored document it has already decided not to touch. */
  function renderRefused(reason) {
    draft = null;
    dirty = false;
    closeArmed = false;
    dayRefs = new Map();
    daysWrap.textContent = '';
    generalBox.textContent = '';
    intro.textContent = 'This week cannot be edited right now.';
    saveBtn.disabled = true;
    const p = el('p', 'wk-refusal', reason);

    const missing = onRestoreLanes
      ? missingLaneKeys(getStoredWeek(), (getLanes() || []).map((l) => l?.key))
      : [];
    const names = listNames(missing.map(laneDisplayName));
    const one = missing.length === 1;
    const hint = el('p', 'wk-refusal-hint', missing.length
      ? 'The week on the page is a blank stand-in; your stored one is untouched. '
        + `It points at ${one ? 'a lane' : `${missing.length} lanes`} this profile no longer has `
        + `— ${names} — so it cannot be read. Put ${one ? 'it' : 'them'} back and the stored `
        + 'week is readable again, with nothing lost.'
      : 'The week on the page is a blank stand-in; your stored one is untouched. '
        + 'Every lane it points at still exists, so what it cannot read is something else '
        + 'inside it. Nothing here can repair that without guessing at your week, so it is '
        + 'being kept exactly as it is rather than replaced.');
    daysWrap.append(p, hint);

    if (missing.length) {
      const restore = el('button', 'wk-restore', `Restore the missing lane${one ? '' : 's'}`);
      restore.type = 'button';
      restore.addEventListener('click', () => restoreLanes(missing));
      daysWrap.appendChild(restore);
    }
    setStatus('');
  }

  /* The recovery itself. Whether it worked is not onRestoreLanes' to report:
     app.js re-runs the same gate the refusal came from, so getSaveRefusal()
     is asked again and its answer decides between the real form and a second,
     now-truthful refusal. A restore that put every lane back but left the
     week invalid for some other reason therefore lands on the no-missing-lane
     panel above — which has no button, so this cannot loop. */
  function restoreLanes(keys) {
    onRestoreLanes(keys);
    const refusal = getSaveRefusal();
    if (refusal) { renderRefused(refusal); return; }
    draft = draftFromWeek(getWeek());
    dirty = false;
    closeArmed = false;
    renderAll();
    setStatus(`✓ ${keys.length === 1 ? 'Lane' : 'Lanes'} restored — your stored week is back, unchanged.`, 'wk-ok');
  }

  /* ---------- one block ---------- */
  function renderBlock(dayKey, block, index) {
    const row = el('div', 'wk-block');
    const main = el('div', 'wk-line wk-line-main');
    const more = el('div', 'wk-line wk-line-more');
    const rowStatus = el('ul', 'wk-block-errors');
    const note = el('p', 'wk-block-note');

    const field = (labelText, control) => {
      const wrap = el('label', 'wk-field');
      wrap.append(el('span', '', labelText), control);
      return wrap;
    };

    /* `read` is a function, not the value itself, and that is the whole point:
       what a blur compares against has to be the draft as it stands NOW.
       Nothing rebuilds this row on blur, so a captured value goes stale the
       moment the first edit lands — and then typing into an empty field and
       emptying it again compares '' to the ORIGINAL '', returns early, and
       saves the text the user just deleted. The field reads empty on screen
       and is not empty in the week. dayTitleField reads day.title live for
       exactly this reason; these four fields were written before it. */
    const textInput = (read, placeholder, ariaLabel, apply) => {
      const input = doc.createElement('input');
      const current = () => { const v = read(); return typeof v === 'string' ? v : ''; };
      input.type = 'text';
      input.placeholder = placeholder;
      input.setAttribute('aria-label', ariaLabel);
      input.value = current();
      /* blur, not input: a rebuild mid-keystroke would take the field the
         user is typing in out from under them. profileEditor.js commits on
         blur for the same reason. */
      input.addEventListener('blur', () => {
        const next = input.value.trim();
        if (next === current()) return;
        apply(next);
        markDirty();
      });
      return input;
    };

    const timeInput = (which) => {
      const input = doc.createElement('input');
      input.type = 'time';
      input.setAttribute('aria-label', which === 'start' ? 'Start time' : 'End time');
      input.value = toTimeValue(block[which]);
      /* change, not blur, and the draft is only ever written from a value
         this actually parsed. An <input type="time"> reads back '' for
         anything it cannot represent — including a stored 1440 — so reading
         every field at save time would quietly turn "ends at midnight" into
         "no end time". Nothing is read unless the user changed it, and an
         unparseable change is refused out loud and put back rather than
         written as null. */
      input.addEventListener('change', () => {
        const minutes = parseTimeInput(input.value);
        if (minutes === null) {
          input.value = toTimeValue(block[which]);
          note.textContent = 'Not changed — that is not a time.';
          return;
        }
        note.textContent = '';
        block[which] = minutes;
        markDirty();
        /* Re-sort on every change, and rebuild the day only when the order
           actually moved — a rebuild that changed nothing visible would
           still destroy the element the user's next click is travelling
           towards. */
        const day = draft[dayKey];
        const sorted = sortBlocks(day.blocks);
        if (sorted.some((b, i) => b !== day.blocks[i])) {
          day.blocks = sorted;
          renderDay(dayKey);
        }
      });
      return input;
    };

    const laneSelect = doc.createElement('select');
    laneSelect.setAttribute('aria-label', 'Lane');
    const lanes = getLanes() || [];
    const known = lanes.some((l) => l?.key === block.lane);
    if (!known) {
      /* The block's own lane, shown as it is. A select that silently
         reselected some other lane would change the user's data by
         rendering it; validateWeek's "unknown lane" error is the thing that
         should tell them, on save, and it can only do that if what is on
         screen is still what is stored. */
      const orphan = doc.createElement('option');
      orphan.value = typeof block.lane === 'string' ? block.lane : '';
      orphan.textContent = typeof block.lane === 'string' && block.lane
        ? `${block.lane} — no such lane`
        : 'Choose a lane';
      laneSelect.appendChild(orphan);
    }
    for (const lane of lanes) {
      const option = doc.createElement('option');
      option.value = lane.key;
      option.textContent = lane.name || lane.key;
      laneSelect.appendChild(option);
    }
    laneSelect.value = typeof block.lane === 'string' ? block.lane : '';
    laneSelect.addEventListener('change', () => {
      block.lane = laneSelect.value;
      markDirty();
    });

    const startInput = timeInput('start');
    const endInput = timeInput('end');

    main.append(
      field('Label', textInput(() => block.label, 'What is this block?', 'Block label', (v) => { block.label = v; })),
      field('Lane', laneSelect),
      field('Start', startInput),
      field('End', endInput),
    );

    const del = el('button', 'wk-del', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => {
      draft[dayKey].blocks.splice(index, 1);
      renderDay(dayKey);
      markDirty();
    });
    main.appendChild(del);

    more.append(
      field('Subject', textInput(() => block.subject, 'Optional', 'Block subject', (v) => {
        if (v) block.subject = v; else delete block.subject;
      })),
      field('Detail', textInput(() => block.detail, 'Optional', 'Block detail', (v) => {
        if (v) block.detail = v; else delete block.detail;
      })),
      field('Shown as', textInput(() => block.timeText, timeRangeOf(block), 'Time display override', (v) => {
        if (v) block.timeText = v; else delete block.timeText;
      })),
    );

    if (block.end === 1440) {
      note.textContent = 'Ends at midnight. The end field cannot show 24:00, so it reads blank; '
        + 'leave it alone and midnight is kept.';
    }

    row.append(main, more, note, rowStatus);
    return { row, status: rowStatus };
  }

  /* The derived range, used as the placeholder for the override so the field
     shows what it would be overriding. Only meaningful once both ends are
     real minutes; minutesToLabel of undefined is 'NaN:NaN'. */
  function timeRangeOf(block) {
    return Number.isInteger(block?.start) && Number.isInteger(block?.end)
      ? `${minutesToLabel(block.start)} – ${minutesToLabel(block.end)}`
      : 'Optional';
  }

  /* ---------- a day's own name ---------- */
  /* The only place in the app that can set week[dayKey].title, and optional
     everywhere it is read. app.js has shown a day's title as that day's panel
     heading, and named days by it when refusing to delete a lane they still
     use, all along — with nothing anywhere able to write one, so until now
     both of those could only ever take their DAY_NAMES fallback.

     The heading beside this does NOT follow the title. This dialog is seven
     sections long and the heading is the only thing saying which one you are
     in; a Tuesday that calls itself 'Match day' there is a Tuesday nobody can
     find. The name is what is being edited, not the label of what is being
     edited. The placeholder carries the day's own name instead — the same
     move as 'Shown as', which is placeheld with the range it would override
     — so an empty field shows what the page will say rather than the word
     'Optional', and a day with no name reads as finished rather than blank.

     An emptied field DELETES the key rather than storing ''. Downstream the
     two are indistinguishable — renderDay and getLaneUsage both fall back
     with `|| DAY_NAMES[k]` — so the choice is about what leaves this device:
     absent is what "this day has no name" means, it is what every other
     optional field here does with an emptied value (block.subject, .detail,
     .timeText), and it keeps a cleared name from travelling to every other
     device as a change to a field that now holds nothing.

     blur, not input, for the reason the block fields give. What the blur
     compares against is draft.title read LIVE rather than a value captured
     when the field was built: nothing re-renders this field on blur, so a
     name typed and then cleared in one sitting would otherwise compare '' to
     the ORIGINAL '' and return early, saving the name the user just deleted.

     A stored title that is not a string is left exactly as it is unless the
     user types over it. validateWeek permits one, renderDay filters it, and
     rendering it as '' and then writing that back would be the editor
     changing data by having been opened — the same rule as the unknown-lane
     option in renderBlock. */
  function dayTitleField(day, dayName) {
    const wrap = el('label', 'wk-day-title');
    const input = doc.createElement('input');
    input.type = 'text';
    input.placeholder = dayName;
    input.setAttribute('aria-label', `Name for ${dayName}`);
    input.value = typeof day.title === 'string' ? day.title : '';
    input.addEventListener('blur', () => {
      const next = input.value.trim();
      if (next === (typeof day.title === 'string' ? day.title : '')) return;
      if (next) day.title = next; else delete day.title;
      markDirty();
    });
    wrap.append(el('span', '', 'Call it something?'), input);
    return wrap;
  }

  /* ---------- one day ---------- */
  function renderDay(dayKey) {
    const ref = dayRefs.get(dayKey);
    if (!ref) return;
    const { section } = ref;
    section.textContent = '';
    ref.rows = [];

    const day = draft[dayKey];
    const dayName = DAY_LABELS[dayKey];
    const head = el('div', 'wk-day-head');
    head.append(el('h3', '', dayName), dayTitleField(day, dayName));
    section.appendChild(head);

    if (day.blocks.length) {
      day.blocks.forEach((block, i) => {
        const built = renderBlock(dayKey, block, i);
        section.appendChild(built.row);
        ref.rows.push(built);
      });
    } else {
      /* The same sentence app.js's renderDay shows for a day with nothing in
         it. Deleting the last block leaves this, not a day that has lost its
         blocks array — draftFromWeek guarantees the array is still there and
         still empty, which is what keeps the saved week valid. */
      section.appendChild(el('p', 'wk-day-empty', `Nothing planned for ${dayName} yet.`));
    }

    const add = el('button', 'wk-add', 'Add block');
    add.type = 'button';
    add.addEventListener('click', () => {
      const lanes = getLanes() || [];
      const { start, end } = nextBlockTimes(day.blocks);
      day.blocks = sortBlocks([...day.blocks, { label: '', lane: lanes[0]?.key ?? '', start, end }]);
      renderDay(dayKey);
      markDirty();
    });
    section.appendChild(add);
  }

  function renderAll() {
    intro.textContent = 'Blocks are kept in start-time order — set the times and the order follows.';
    saveBtn.disabled = false;
    generalBox.textContent = '';
    daysWrap.textContent = '';
    dayRefs = new Map();
    for (const dayKey of DAY_KEYS) {
      const section = el('section', 'wk-day');
      daysWrap.appendChild(section);
      dayRefs.set(dayKey, { section, rows: [] });
      renderDay(dayKey);
    }
    setStatus('');
  }

  /* ---------- errors ---------- */
  function showErrors(errors) {
    const { byBlock, general } = groupErrors(errors);

    generalBox.textContent = '';
    for (const message of general) generalBox.appendChild(el('p', 'wk-general-error', message));

    for (const [dayKey, ref] of dayRefs) {
      ref.rows.forEach((row, i) => {
        row.status.textContent = '';
        for (const message of byBlock.get(blockErrorKey(dayKey, i)) || []) {
          row.status.appendChild(el('li', '', message));
        }
      });
    }
  }

  /* ---------- save ---------- */
  saveBtn.addEventListener('click', () => {
    if (!draft) return;

    /* Freshly, every time: app.js's regateWeek() reassigns `week` wholesale
       and a profile commit can change the lane set underneath an open
       dialog. A snapshot taken at mount would validate this week against
       last week's lanes. */
    const laneKeys = (getLanes() || []).map((l) => l.key);
    const next = copyWeek(draft);
    const { ok, errors } = validateWeek(next, laneKeys);
    showErrors(errors);
    if (!ok) {
      setStatus(
        `Not saved — ${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix; `
        + 'each one is shown against the block it belongs to.',
        'wk-warn',
      );
      return;
    }

    /* The return value is the whole point. app.js's commitSchedule refuses
       outright while the stored week could not be read, and returns the
       local write's own result otherwise — so `false` means the week the
       user is looking at is NOT stored. Only a literal true is treated as
       saved: an onChange that returns undefined cannot tell us it worked,
       and guessing that it did is the original bug of this project. The
       failure is loud, the dialog stays open, and the draft stays exactly as
       the user left it, so nothing is lost while it is sorted out. */
    if (onChange(next) !== true) {
      /* Not “still only on this screen”, which is false: commitSchedule arms
         the remote flush even when the local write fails, so the edit is
         usually already queued and on its way to the server. What actually
         failed is this device's own cache, and the editor cannot tell which
         of the two failure modes it was (a single oversized document, or
         storage refusing everything), so it states the part that is true in
         both — a reload here may not bring it back — and claims nothing
         about the queue it cannot see. */
      setStatus(
        getSaveRefusal()
        || 'Not saved — this device could not store the week, so a reload here may not bring '
        + 'it back. It is still on screen exactly as you left it; try again.',
        'wk-warn',
      );
      return;
    }

    dirty = false;
    setStatus('✓ Saved.', 'wk-ok');
  });

  openBtn.addEventListener('click', () => {
    const refusal = getSaveRefusal();
    if (refusal) renderRefused(refusal);
    else {
      /* A fresh draft on every open, never a cached one: `week` is
         reassigned wholesale by regateWeek() and by the sync merge, so a
         draft held across opens would be editing a week that no longer
         exists. */
      draft = draftFromWeek(getWeek());
      dirty = false;
      renderAll();
    }
    dialog.showModal();
  });
}
