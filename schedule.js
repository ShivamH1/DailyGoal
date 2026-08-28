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
   model — which will eventually emit a time contradicting its own start. */
export const formatTime = (b) =>
  b.timeText ? b.timeText : `${minutesToLabel(b.start)} – ${minutesToLabel(b.end)}`;

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

export function validateWeek(week, laneKeys) {
  const lanes = new Set(laneKeys || []);
  const errors = [];
  for (const key of DAY_KEYS) {
    const blocks = week?.[key]?.blocks;
    if (blocks === undefined) continue;
    if (!Array.isArray(blocks)) { errors.push(`${key}: blocks is not a list`); continue; }
    let prevEnd = -1;
    blocks.forEach((b, i) => {
      const at = `${key}[${i}]`;
      if (!Number.isInteger(b?.start) || !Number.isInteger(b?.end)) errors.push(`${at}: start and end must be whole minutes`);
      else {
        if (b.start < 0 || b.end > 1440) errors.push(`${at}: outside the day`);
        if (b.end <= b.start) errors.push(`${at}: ends before it starts`);
        if (b.start < prevEnd) errors.push(`${at}: overlaps the previous block`);
        prevEnd = b.end;
      }
      if (!String(b?.label || '').trim()) errors.push(`${at}: needs a label`);
      if (!lanes.has(b?.lane)) errors.push(`${at}: unknown lane "${b?.lane}"`);
    });
  }
  /* Every problem, not the first. Fixing a generated week one error at a
     time is a guessing game. */
  return { ok: errors.length === 0, errors };
}
