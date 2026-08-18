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

/* Which queued dates a completed push may safely clear. A date whose record
   changed while the push was in flight must stay queued: the body was
   serialised before that change, so clearing it by date would strand the
   newer value locally forever. */
export function clearableDates(dates, sentStamps, progressNow) {
  return dates.filter((d, i) => (progressNow[d] || {}).u === sentStamps[i]);
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
