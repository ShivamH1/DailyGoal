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

import { normalizeProfile } from './profile.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

function newLaneKey(lanes) {
  const used = new Set((lanes || []).map((l) => l.key));
  for (let i = 1; ; i++) {
    const k = `lane${i}`;
    if (!used.has(k)) return k;
  }
}

/* Supersedes profile.js's newTickKey rather than calling it. newTickKey only
   ever avoids collision with the CURRENT profile.ticks, which is right for a
   brand-new profile but wrong the moment a tick has been deleted: deleting
   an extra does not touch any already-logged rec.x[key] (progress.js never
   purges it, deliberately — see progress.js and this file's lane guard for
   the same "logged data is sacred" posture), so the freed key still carries
   history on every day it was ever ticked. Handing that key to the NEXT
   invented tick would silently attach someone else's history to a brand-new
   habit — the same class of meaning-changes-after-the-fact bug this
   project's streak rule exists to avoid on the study/workout axis.
   profile.js is not in this task's file list, so newTickKey itself is left
   untouched; this walks the identical "first free k1, k2, …" sequence but
   also excludes any key `getReservedTickKeys()` reports as still present in
   stored progress. */
function nextTickKey(ticks, reserved) {
  const used = new Set((ticks || []).map((t) => t.key));
  for (let i = 1; ; i++) {
    const k = `k${i}`;
    if (!used.has(k) && !reserved.has(k)) return k;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* getLaneUsage's contract is (laneKey) => Set<dayName>, keyed to the ACTUAL
   argument. A caller that ignores its argument and always returns the same
   Set — exactly the shape of bug this guards against — would make every
   lane look permanently in use, and a name that merely DESCRIBES the
   contract does not stop a careless wiring from violating it; only checking
   actually stops it. PROBE_LANE_KEY is an object, not a string, specifically
   so that a real implementation's `block.lane === laneKey` (comparing
   against a schedule's actual STRING lane keys) can never be true for it —
   not because of what it looks like (no lane name or day name is ever
   inspected, so a real day legitimately titled "Focus" is never at risk of
   tripping this), but because no string is ever `===` to an object
   reference, in any schedule, by construction. A getLaneUsage that respects
   its argument is therefore GUARANTEED to return an empty set for this
   probe; one that returns anything else is provably ignoring what it was
   passed. */
const PROBE_LANE_KEY = { toString: () => '(profileEditor internal probe — must never match a real lane key)' };

function assertLaneUsageIsWired(getLaneUsage) {
  const probe = getLaneUsage(PROBE_LANE_KEY);
  if (probe && probe.size) {
    throw new Error(
      'getLaneUsage(laneKey) returned a non-empty result for a lane key that cannot exist. ' +
      'This means it is ignoring the key it is given and always returning the same answer, ' +
      'which would make every lane look permanently in use — refusing to trust it rather ' +
      'than silently refusing every deletion forever.',
    );
  }
}

/* normalizeProfile only ever FILTERS each of these lists — it never
   reorders and it never invents an entry — so a surviving item always
   appears in the same relative order it had going in. That's what lets this
   walk both lists once, in lockstep, and say which raw item corresponds to
   which kept item (or to none) without re-deriving normalizeProfile's own
   accept/reject rule. */
function survivedMaskByContent(rawList, keptList, sameItem) {
  let ki = 0;
  return rawList.map((raw) => {
    if (ki < keptList.length && sameItem(raw, keptList[ki])) {
      ki += 1;
      return true;
    }
    return false;
  });
}

export function mountProfileEditor({
  root, getProfile, getLaneUsage = () => new Set(), getReservedTickKeys = () => new Set(), onChange,
}) {
  /* A missing #profileEditorRoot must not be able to take the whole page
     down. mountProfileEditor is called at app.js's module scope, not inside
     startApp() — a throw here would happen before the user ever sees the
     sign-in gate. */
  if (!root) return;

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
     sees; only the normalized copy handed to onChange is ever pruned. Every
     row that CAN be pruned also gets a status line — see the update*Statuses
     functions below — so a drop is reported, never silent. */
  let draft = null;

  /* Row references from the most recent render*() call, so a blur-only edit
     (which never rebuilds the row list) can still find the right status
     span to update after a commit. */
  let ruleRowRefs = [];
  let deadlineRowRefs = [];
  let laneRowRefs = [];
  let tickRowRefs = [];

  function updateRuleStatuses(normalized) {
    const mask = survivedMaskByContent(
      draft.rules, normalized.rules, (r, k) => k.title === r.title && k.body === r.body,
    );
    ruleRowRefs.forEach(({ status }, i) => {
      status.textContent = mask[i] ? '' : 'Not saved — add a title.';
    });
  }

  /* Matching a raw deadline group to a kept one by label alone breaks the
     moment two groups share a label — a pruned group ordered before a
     surviving same-labelled one steals its "kept" match, so the actually-
     discarded row reports nothing and the actually-saved row is falsely
     told it's missing a date it already has. Deadlines have no stable key
     (unlike lanes/ticks) and, unlike rules, DO have a second field (dates)
     that a label-only comparison throws away — so instead of matching
     against the full committed list at all, each group is asked whether IT,
     in isolation, would survive. normalizeProfile never dedupes or
     cross-checks deadline groups against each other (that's only lanes and
     ticks, by key), so normalizing a group alone gives exactly the answer
     it would get as part of the full list — with no sibling to be confused
     with. */
  function deadlineGroupSurvives(group) {
    return normalizeProfile({ deadlines: [group] }).deadlines.length > 0;
  }

  function updateDeadlineStatuses() {
    deadlineRowRefs.forEach(({ group, status }) => {
      if (deadlineGroupSurvives(group)) { status.textContent = ''; return; }
      const hasLabel = !!group.label;
      const hasDate = group.dates.some((d) => DATE_RE.test(d));
      status.textContent = !hasLabel && !hasDate ? 'Not saved — add a label and at least one date.'
        : !hasLabel ? 'Not saved — add a label.'
        : 'Not saved — add at least one date.';
    });
  }

  function updateLaneStatuses(normalized) {
    laneRowRefs.forEach(({ lane, status }) => {
      const kept = normalized.lanes.some((l) => l.key === lane.key && l.name === lane.name);
      if (kept) status.textContent = '';
      else if (!lane.name) status.textContent = 'Not saved — give this lane a name.';
      /* else: leave whatever the delete guard already wrote (still-used /
         last-lane) — this shouldn't otherwise be reachable since lane keys
         are always unique and generated by newLaneKey. */
    });
  }

  function updateTickStatuses(normalized) {
    tickRowRefs.forEach(({ tick, status }) => {
      if (tick.core) return;                    /* core ticks are never pruned */
      const kept = normalized.ticks.some((t) => !t.core && t.key === tick.key);
      status.textContent = kept || tick.label ? '' : 'Not saved — add a label.';
    });
  }

  function commit() {
    const normalized = normalizeProfile(draft);
    onChange(normalized);
    updateRuleStatuses(normalized);
    updateDeadlineStatuses();
    updateLaneStatuses(normalized);
    updateTickStatuses(normalized);
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
    ruleRowRefs = [];
    const h3 = doc.createElement('h3');
    h3.textContent = 'Ground rules';
    rulesSection.appendChild(h3);

    draft.rules.forEach((rule, i) => {
      const row = doc.createElement('div');
      row.className = 'pf-rule-row';

      const title = doc.createElement('input');
      title.type = 'text';
      title.placeholder = 'Title';
      title.setAttribute('aria-label', 'Rule title');
      title.value = rule.title;
      title.addEventListener('blur', () => { rule.title = title.value.trim(); commit(); });

      const body = doc.createElement('input');
      body.type = 'text';
      body.placeholder = 'Body';
      body.setAttribute('aria-label', 'Rule body');
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

      const status = doc.createElement('span');
      status.className = 'pf-row-status';

      row.append(title, body, up, down, del, status);
      rulesSection.appendChild(row);
      ruleRowRefs.push({ rule, status });
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
    deadlineRowRefs = [];
    const h3 = doc.createElement('h3');
    h3.textContent = 'Deadlines';
    deadlinesSection.appendChild(h3);

    draft.deadlines.forEach((group, gi) => {
      const row = doc.createElement('div');
      row.className = 'pf-deadline-row';

      const label = doc.createElement('input');
      label.type = 'text';
      label.placeholder = 'Label';
      label.setAttribute('aria-label', 'Deadline label');
      label.value = group.label;
      label.addEventListener('blur', () => { group.label = label.value.trim(); commit(); });
      row.appendChild(label);

      const datesWrap = doc.createElement('div');
      datesWrap.className = 'pf-dates';
      group.dates.forEach((d, di) => {
        const dateInput = doc.createElement('input');
        dateInput.type = 'date';
        dateInput.setAttribute('aria-label', 'Deadline date');
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

      const status = doc.createElement('span');
      status.className = 'pf-row-status';
      row.appendChild(status);

      deadlinesSection.appendChild(row);
      deadlineRowRefs.push({ group, status });
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
    laneRowRefs = [];
    const h3 = doc.createElement('h3');
    h3.textContent = 'Lanes';
    lanesSection.appendChild(h3);

    draft.lanes.forEach((lane, i) => {
      const row = doc.createElement('div');
      row.className = 'pf-lane-row';

      const name = doc.createElement('input');
      name.type = 'text';
      name.placeholder = 'Lane name';
      name.setAttribute('aria-label', 'Lane name');
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
        /* Every schedule needs somewhere for a block to point at.
           normalizeProfile enforces this too, but only by resurrecting ALL
           FIVE defaults the moment the list is emptied (lanes.length ?
           lanes : base.lanes) — silently, with no way for the user to tell
           "I deleted my last lane and got five new ones" from "nothing
           happened". Refusing here means that surprise never has to fire. */
        if (draft.lanes.length <= 1) {
          status.textContent = 'Not saved — every schedule needs at least one lane.';
          return;
        }
        /* getLaneUsage is called with this lane's key and hands back the
           set of days (as plain names) whose schedule still points at it.
           Today's caller always passes an empty set — there is no
           user-editable schedule yet — but the guard is written and tested
           against a non-empty one now so a later task only has to swap the
           function that supplies it, not this behaviour. Defaulted in the
           destructure AND guarded here: a caller that omits the option
           entirely must not throw on the first delete click either.
           assertLaneUsageIsWired runs BEFORE the real call is trusted: a
           mis-wired function that ignores laneKey and always returns the
           same Set would otherwise make every lane look permanently in use,
           forever, with nothing ever failing loudly enough to notice. */
        assertLaneUsageIsWired(getLaneUsage);
        const usedBy = getLaneUsage(lane.key) || new Set();
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
      laneRowRefs.push({ lane, status });
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
    tickRowRefs = [];
    const h3 = doc.createElement('h3');
    h3.textContent = 'Ticks';
    ticksSection.appendChild(h3);

    draft.ticks.forEach((tick) => {
      const row = doc.createElement('div');
      row.className = 'pf-tick-row';

      const label = doc.createElement('input');
      label.type = 'text';
      label.placeholder = 'Label';
      label.setAttribute('aria-label', 'Tick label');
      label.value = tick.label;
      label.addEventListener('blur', () => { tick.label = label.value.trim(); commit(); });

      const hint = doc.createElement('input');
      hint.type = 'text';
      hint.placeholder = 'Hint';
      hint.setAttribute('aria-label', 'Tick hint');
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

      const status = doc.createElement('span');
      status.className = 'pf-row-status';
      row.appendChild(status);

      ticksSection.appendChild(row);
      tickRowRefs.push({ tick, status });
    });

    const add = doc.createElement('button');
    add.type = 'button';
    add.textContent = 'Add tick';
    add.addEventListener('click', () => {
      const reserved = getReservedTickKeys() || new Set();
      draft.ticks.push({ key: nextTickKey(draft.ticks, reserved), label: '', hint: '', core: false });
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
