/* The profile editor: a <dialog> the user opens to put their own content
   into the app — season, ground rules, deadlines, lanes and ticks.

   Loaded identically by the browser and by node --test, like profile.js and
   progress.js. It takes every dependency through mountProfileEditor's
   arguments rather than importing app state or touching `document` at
   module scope, so a test can hand it a fake root and a fake profile and
   drive it with no browser at all.

   Every string here is user-authored, so every string is set with
   textContent and read from input.value. Nothing is ever interpolated into
   innerHTML — that is a security control, not a style preference, because
   this session holds a token in localStorage. */

import { normalizeProfile, newTickKey } from './profile.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

function newLaneKey(lanes) {
  const used = new Set((lanes || []).map((l) => l.key));
  for (let i = 1; ; i++) {
    const k = `lane${i}`;
    if (!used.has(k)) return k;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function mountProfileEditor({ root, getProfile, getUsedLaneKeys, onChange }) {
  const doc = root.ownerDocument;

  const openBtn = doc.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'profile-edit-btn';
  openBtn.textContent = 'Edit profile';

  const dialog = doc.createElement('dialog');
  dialog.className = 'profile-dialog';

  const heading = doc.createElement('h2');
  heading.textContent = 'Edit profile';

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'profile-close-btn';
  closeBtn.textContent = 'Done';
  closeBtn.addEventListener('click', () => dialog.close());

  const seasonSection = doc.createElement('section');
  const rulesSection = doc.createElement('section');
  const deadlinesSection = doc.createElement('section');
  const lanesSection = doc.createElement('section');
  const ticksSection = doc.createElement('section');

  dialog.append(heading, seasonSection, rulesSection, deadlinesSection, lanesSection, ticksSection, closeBtn);
  root.append(openBtn, dialog);

  /* The working copy for the open editing session. It is deliberately NOT
     the same object commit() hands to onChange: normalizeProfile drops a
     rule with no title and a deadline group with no dates, and doing that to
     `draft` the instant a field goes blank would erase the row the user is
     still mid-way through typing into. `draft` stays exactly what the user
     sees; only the normalized copy handed to onChange is ever pruned. */
  let draft = null;

  function commit() {
    onChange(normalizeProfile(draft));
  }

  /* ---------- season ---------- */
  function renderSeason() {
    seasonSection.textContent = '';
    const label = doc.createElement('label');
    label.className = 'pf-field';
    const span = doc.createElement('span');
    span.textContent = 'Season';
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = draft.season;
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      if (v === draft.season) return;
      draft.season = v;
      commit();
    });
    label.append(span, input);
    seasonSection.appendChild(label);
  }

  /* ---------- ground rules ---------- */
  function renderRules() {
    rulesSection.textContent = '';
    const h3 = doc.createElement('h3');
    h3.textContent = 'Ground rules';
    rulesSection.appendChild(h3);

    draft.rules.forEach((rule, i) => {
      const row = doc.createElement('div');
      row.className = 'pf-rule-row';

      const title = doc.createElement('input');
      title.type = 'text';
      title.placeholder = 'Title';
      title.value = rule.title;
      title.addEventListener('blur', () => { rule.title = title.value.trim(); commit(); });

      const body = doc.createElement('input');
      body.type = 'text';
      body.placeholder = 'Body';
      body.value = rule.body;
      body.addEventListener('blur', () => { rule.body = body.value.trim(); commit(); });

      const up = doc.createElement('button');
      up.type = 'button';
      up.textContent = 'Move up';
      up.disabled = i === 0;
      up.addEventListener('click', () => {
        [draft.rules[i - 1], draft.rules[i]] = [draft.rules[i], draft.rules[i - 1]];
        renderRules();
        commit();
      });

      const down = doc.createElement('button');
      down.type = 'button';
      down.textContent = 'Move down';
      down.disabled = i === draft.rules.length - 1;
      down.addEventListener('click', () => {
        [draft.rules[i], draft.rules[i + 1]] = [draft.rules[i + 1], draft.rules[i]];
        renderRules();
        commit();
      });

      const del = doc.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', () => {
        draft.rules.splice(i, 1);
        renderRules();
        commit();
      });

      row.append(title, body, up, down, del);
      rulesSection.appendChild(row);
    });

    const add = doc.createElement('button');
    add.type = 'button';
    add.textContent = 'Add rule';
    add.addEventListener('click', () => {
      draft.rules.push({ title: '', body: '' });
      renderRules();
    });
    rulesSection.appendChild(add);
  }

  /* ---------- deadlines ---------- */
  function renderDeadlines() {
    deadlinesSection.textContent = '';
    const h3 = doc.createElement('h3');
    h3.textContent = 'Deadlines';
    deadlinesSection.appendChild(h3);

    draft.deadlines.forEach((group, gi) => {
      const row = doc.createElement('div');
      row.className = 'pf-deadline-row';

      const label = doc.createElement('input');
      label.type = 'text';
      label.placeholder = 'Label';
      label.value = group.label;
      label.addEventListener('blur', () => { group.label = label.value.trim(); commit(); });
      row.appendChild(label);

      const datesWrap = doc.createElement('div');
      datesWrap.className = 'pf-dates';
      group.dates.forEach((d, di) => {
        const dateInput = doc.createElement('input');
        dateInput.type = 'date';
        dateInput.value = d;
        dateInput.addEventListener('blur', () => {
          const v = dateInput.value.trim();
          /* type="date" already keeps the browser from producing anything
             but YYYY-MM-DD or '', but the value still gets the same regex
             normalizeProfile itself uses — belt and braces against a
             hand-typed value in a browser that ignores the input type. */
          group.dates[di] = DATE_RE.test(v) ? v : '';
          commit();
        });
        const removeDate = doc.createElement('button');
        removeDate.type = 'button';
        removeDate.textContent = 'Remove date';
        removeDate.addEventListener('click', () => {
          group.dates.splice(di, 1);
          renderDeadlines();
          commit();
        });
        const pair = doc.createElement('span');
        pair.append(dateInput, removeDate);
        datesWrap.appendChild(pair);
      });
      row.appendChild(datesWrap);

      const addDate = doc.createElement('button');
      addDate.type = 'button';
      addDate.textContent = 'Add date';
      addDate.addEventListener('click', () => {
        group.dates.push('');
        renderDeadlines();
      });
      row.appendChild(addDate);

      const delGroup = doc.createElement('button');
      delGroup.type = 'button';
      delGroup.textContent = 'Delete deadline';
      delGroup.addEventListener('click', () => {
        draft.deadlines.splice(gi, 1);
        renderDeadlines();
        commit();
      });
      row.appendChild(delGroup);

      deadlinesSection.appendChild(row);
    });

    const addGroup = doc.createElement('button');
    addGroup.type = 'button';
    addGroup.textContent = 'Add deadline';
    addGroup.addEventListener('click', () => {
      draft.deadlines.push({ label: '', dates: [] });
      renderDeadlines();
    });
    deadlinesSection.appendChild(addGroup);
  }

  /* ---------- lanes ---------- */
  function renderLanes() {
    lanesSection.textContent = '';
    const h3 = doc.createElement('h3');
    h3.textContent = 'Lanes';
    lanesSection.appendChild(h3);

    draft.lanes.forEach((lane, i) => {
      const row = doc.createElement('div');
      row.className = 'pf-lane-row';

      const name = doc.createElement('input');
      name.type = 'text';
      name.value = lane.name;
      name.addEventListener('blur', () => { lane.name = name.value.trim(); commit(); });
      row.appendChild(name);

      const status = doc.createElement('span');
      status.className = 'pf-lane-status';
      row.appendChild(status);

      const del = doc.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', () => {
        /* getUsedLaneKeys is called with this lane's key and hands back the
           set of days (as plain names) whose schedule still points at it.
           Today's caller always passes an empty set — there is no
           user-editable schedule yet — but the guard is written and tested
           against a non-empty one now so Task 18 only has to swap the
           function that supplies it, not this behaviour. */
        const usedBy = getUsedLaneKeys(lane.key) || new Set();
        if (usedBy.size) {
          status.textContent = `Still used by ${[...usedBy].join(', ')} — remove it from the schedule first.`;
          return;
        }
        draft.lanes.splice(i, 1);
        renderLanes();
        commit();
      });
      row.appendChild(del);

      lanesSection.appendChild(row);
    });

    const add = doc.createElement('button');
    add.type = 'button';
    add.textContent = 'Add lane';
    add.addEventListener('click', () => {
      draft.lanes.push({ key: newLaneKey(draft.lanes), name: '' });
      renderLanes();
    });
    lanesSection.appendChild(add);
  }

  /* ---------- ticks ---------- */
  function renderTicks() {
    ticksSection.textContent = '';
    const h3 = doc.createElement('h3');
    h3.textContent = 'Ticks';
    ticksSection.appendChild(h3);

    draft.ticks.forEach((tick) => {
      const row = doc.createElement('div');
      row.className = 'pf-tick-row';

      const label = doc.createElement('input');
      label.type = 'text';
      label.placeholder = 'Label';
      label.value = tick.label;
      label.addEventListener('blur', () => { tick.label = label.value.trim(); commit(); });

      const hint = doc.createElement('input');
      hint.type = 'text';
      hint.placeholder = 'Hint';
      hint.value = tick.hint;
      hint.addEventListener('blur', () => { tick.hint = hint.value.trim(); commit(); });

      row.append(label, hint);

      /* The three core ticks map to real database columns and to the streak
         rule, so there is no way to honour a delete here — not a disabled
         button, which still LOOKS like an offer, but no control at all. */
      if (!tick.core) {
        const del = doc.createElement('button');
        del.type = 'button';
        del.textContent = 'Delete';
        del.addEventListener('click', () => {
          draft.ticks = draft.ticks.filter((t) => t.key !== tick.key);
          renderTicks();
          commit();
        });
        row.appendChild(del);
      }

      ticksSection.appendChild(row);
    });

    const add = doc.createElement('button');
    add.type = 'button';
    add.textContent = 'Add tick';
    add.addEventListener('click', () => {
      draft.ticks.push({ key: newTickKey(draft.ticks), label: '', hint: '', core: false });
      renderTicks();
    });
    ticksSection.appendChild(add);
  }

  function renderAll() {
    renderSeason();
    renderRules();
    renderDeadlines();
    renderLanes();
    renderTicks();
  }

  openBtn.addEventListener('click', () => {
    draft = clone(getProfile());
    renderAll();
    dialog.showModal();
  });
}
