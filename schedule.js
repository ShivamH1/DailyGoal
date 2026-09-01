/* Pure functions over a week. Loaded identically by the browser and by
   node --test, like progress.js and profile.js — no imports, no document.

   The week itself is no longer data this module owns: it is supplied by the
   caller (a per-user document) and validated against that user's own lanes. */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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

/* The record key for "today" in IST. Every other "what time is it" decision
   goes through Intl with this timeZone; the date a tick is filed under has to
   as well, or the banner, the day tab and the scorecard can disagree without
   showing it. */
export function istDateISO(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const emptyWeek = () =>
  Object.fromEntries(DAY_KEYS.map((k) => [k, { title: '', tag: '', note: '', blocks: [] }]));

/* Twelve-hour, no meridiem — the style already on the page ('9:30 – 6:30').
   A 24-hour clock here would silently restyle every row in the app. */
export function minutesToLabel(m) {
  const h = Math.floor(m / 60) % 12;
  return `${h === 0 ? 12 : h}:${String(m % 60).padStart(2, '0')}`;
}

/* Derived, never stored. A stored display string is a second source of truth
   for the same fact, and in the next project that fact comes from a language
   model — which will eventually emit a time contradicting its own start.

   The typeof guard is not belt-and-braces over validateWeek's matching check
   below: this function is also reached with weeks that predate that check —
   whatever is already in someone's localStorage — and its result is handed
   straight to .split(' – ') by app.js's row and banner renderers. A number
   there throws a TypeError mid-render. An unusable override falls back to
   the derived range rather than to '', because a range is what the block
   actually says; the override was only ever a nicer way to say it. */
export const formatTime = (b) =>
  typeof b?.timeText === 'string' && b.timeText
    ? b.timeText
    : `${minutesToLabel(b?.start)} – ${minutesToLabel(b?.end)}`;

export function resolveNow(week, dayKey, minutes) {
  const blocks = week?.[dayKey]?.blocks || [];
  const current = blocks.find((b) => minutes >= b.start && minutes < b.end);
  if (current) return { state: 'now', dayKey, block: current };

  const upcoming = blocks.find((b) => b.start > minutes);
  if (upcoming) return { state: 'next', dayKey, block: upcoming };

  /* Walk forward for a day that actually has something in it. A user may
     plan four days and leave three blank, so looking exactly one day ahead —
     which is all the old single-week version needed — is not enough. */
  for (let i = 1; i <= 7; i++) {
    const key = DAY_KEYS[(DAY_KEYS.indexOf(dayKey) + i) % 7];
    const first = week?.[key]?.blocks?.[0];
    if (first) return { state: 'next', dayKey: key, block: first };
  }
  return null;                     /* nothing planned anywhere */
}

/* True for {} and Object.create(null), false for arrays, Dates, RegExps,
   Maps, functions and the rest of the built-in zoo. A week (and each day
   inside it) has to be plain data, not merely "typeof === 'object'" — a
   Date has that too, and is not a sensible week. Everything this module is
   ever handed comes from JSON, which can produce arrays, primitives and
   plain objects and nothing else, so this is the exact boundary a legitimate
   value can never fail. */
const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';

export function validateWeek(week, laneKeys) {
  /* laneKeys must be an array of lane KEY STRINGS, e.g. ['focus', 'rest'] —
     not profile.lanes itself. profile.js defines lanes as {key, name}
     objects, and a Set built from those objects will never match a block's
     lane string, so every block in an otherwise-valid week would report as
     an unknown lane. The caller is responsible for mapping:
     profile.lanes.map((l) => l.key). This function deliberately does not
     also accept the {key, name} shape — silently tolerating it would hide
     that caller mistake instead of surfacing it. */
  const lanes = new Set(Array.isArray(laneKeys) ? laneKeys : []);
  const errors = [];

  if (!isPlainObject(week)) {
    errors.push('week must be an object');
    return { ok: false, errors };
  }

  for (const key of DAY_KEYS) {
    const daySlot = week[key];
    if (daySlot === undefined) continue;                    /* day not supplied */
    if (!isPlainObject(daySlot)) { errors.push(`${key}: day must be an object`); continue; }
    const blocks = daySlot.blocks;
    if (blocks === undefined) continue;                     /* day supplied, no blocks yet */
    if (!Array.isArray(blocks)) { errors.push(`${key}: blocks is not a list`); continue; }
    let prevStart = null, prevEnd = -1;
    blocks.forEach((b, i) => {
      const at = `${key}[${i}]`;
      if (!Number.isInteger(b?.start) || !Number.isInteger(b?.end)) errors.push(`${at}: start and end must be whole minutes`);
      else {
        if (b.start < 0 || b.end > 1440) errors.push(`${at}: outside the day`);
        if (b.end <= b.start) errors.push(`${at}: ends before it starts`);
        if (prevStart !== null && b.start < prevEnd) {
          /* b.start < prevEnd alone conflates two different problems: a
             block that truly overlaps the previous one in time, and a block
             that is merely out of order in the list (5pm then 2pm) but never
             overlaps it. Only call it an overlap when the intervals actually
             intersect — this message should not say something that isn't so. */
          const overlaps = b.end > prevStart;
          errors.push(`${at}: ${overlaps ? 'overlaps the previous block' : 'is out of order relative to the previous block'}`);
        }
        prevStart = b.start;
        prevEnd = b.end;
      }
      if (!String(b?.label || '').trim()) errors.push(`${at}: needs a label`);
      if (!lanes.has(b?.lane)) errors.push(`${at}: unknown lane "${b?.lane}"`);
      /* Optional, so undefined passes — but if it is there it is display
         text, and the renderer splits it on ' – '. A number here used to be
         declared valid and then throw a TypeError inside the day render,
         which is the one failure mode this validator exists to prevent. */
      if (b?.timeText !== undefined && typeof b.timeText !== 'string') {
        errors.push(`${at}: timeText must be text`);
      }
    });
  }
  /* Every problem, not the first. Fixing a generated week one error at a
     time is a guessing game. */
  return { ok: errors.length === 0, errors };
}

/* The one gate between a stored document and what actually renders. app.js
   applied this decision in two places, character for character — once on
   load and once after the remote merge — which is two chances for them to
   drift apart and no way to test either.

   The valid case returns doc.value ITSELF, not a copy. app.js's callers
   compare the result against doc.value by identity to know whether they are
   looking at the real week or at a fallback, and refuse to overwrite storage
   when it is a fallback. A defensive copy here would make every load look
   like a fallback and silently disable saving. */
export function weekFromDoc(doc, laneKeys) {
  return doc?.value && validateWeek(doc.value, laneKeys).ok ? doc.value : emptyWeek();
}

/* The whole gate decision, not just the week: what to render, AND whether
   what we ended up rendering is the stored value itself. app.js needs both
   halves at every gate site — the cold load, the remote merge, and again
   whenever the lane set changes underneath a week that was already gated —
   and re-deriving the second half by hand at each site is exactly how the
   two original copies of this decision drifted apart.

   Identity, not deep equality, is the entire test; see weekFromDoc above on
   why the valid case must hand back doc.value rather than a copy.

   isFallback is deliberately false for a document that does not exist at
   all. "Empty because this account is new" and "empty because your stored
   week could not be read" are different states, and only the second may
   block a save — a brand-new account must be able to write its first week. */
export function gateWeek(doc, laneKeys) {
  const week = weekFromDoc(doc, laneKeys);
  return { week, isFallback: !!doc?.value && week !== doc.value };
}

/* Which of the stylesheet's five rotation colours a lane gets, by its
   position in the user's own profile.lanes — the key spelling never decides.
   Returns a var() reference for an inline --lane-i, so styles.css needs no
   per-key selector.

   The modulo is load-bearing. profileEditor.js sets no upper bound on lane
   count and styles.css defines --lane-pos-1..5 only, so a sixth lane emitted
   --lane-pos-6: not an undefined property but an INVALID substitution, which
   means background: var(--lane-i, var(--lane-pos-5)) does NOT fall back and
   the dot renders with no colour. The legend already wraps modulo 5
   (.legend span:nth-child(5n+k)), so anything else here also puts the row
   and the legend on different colours for the same lane — and
   position-is-the-colour is the entire contract of the scheme.

   A lane the profile does not define keeps the last rotation slot rather
   than throwing: the same tolerance validateWeek's "unknown lane" error
   exists to flag well before rendering ever sees it. */
export function laneVarFor(lanes, laneKey) {
  const idx = Array.isArray(lanes) ? lanes.findIndex((l) => l?.key === laneKey) : -1;
  return idx === -1 ? 'var(--lane-pos-5)' : `var(--lane-pos-${(idx % 5) + 1})`;
}
