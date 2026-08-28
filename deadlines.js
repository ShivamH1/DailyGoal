/* A user's own deadlines: each entry is a window covering every subject (or
   milestone), which is why these are date lists rather than single dates. */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthNum = (d) => Number(d.slice(5, 7)) - 1;
const dayNum = (d) => Number(d.slice(8, 10));

export function nextDeadline(deadlines, todayIso) {
  if (!deadlines || !deadlines.length) return null;
  let best = null;
  for (const group of deadlines) {
    for (const date of group.dates) {
      if (date >= todayIso && (!best || date < best.date)) best = { label: group.label, date };
    }
  }
  if (!best) return null;
  const days = Math.round(
    (new Date(best.date + 'T00:00:00') - new Date(todayIso + 'T00:00:00')) / 86400000
  );
  return { ...best, days };
}

export function formatDates(dates) {
  if (!dates.length) return '';
  const year = dates[dates.length - 1].slice(0, 4);
  /* A run of consecutive calendar days reads better as a span; anything else
     has to be listed, because "19–27 Sep" would claim six days that are not
     deadlines. Contiguity is checked calendar-wise (a real day-to-day step),
     not by comparing day-of-month numbers — the old exams.js implementation
     took the month from the first date and applied it to every day number,
     so a window spanning a month boundary (31 Aug, 1 Sep) printed a date
     that does not exist. */
  const contiguous = dates.length > 1 && dates.every((d, i) => {
    if (i === 0) return true;
    const prev = new Date(dates[i - 1] + 'T00:00:00');
    const cur = new Date(d + 'T00:00:00');
    return (cur - prev) === 86400000;
  });
  if (contiguous) {
    const first = dates[0], last = dates[dates.length - 1];
    const fMonth = monthNum(first), lMonth = monthNum(last);
    return fMonth === lMonth
      ? `${dayNum(first)}–${dayNum(last)} ${MONTHS[fMonth]} ${year}`
      : `${dayNum(first)} ${MONTHS[fMonth]} – ${dayNum(last)} ${MONTHS[lMonth]} ${year}`;
  }
  /* Non-contiguous: list every date, grouping consecutive entries that share
     a month so the month is printed once per group rather than once per
     date ("19, 20, 26, 27 Sep", not "19 Sep, 20 Sep, ..."). */
  const groups = [];
  for (const d of dates) {
    const m = monthNum(d);
    const g = groups[groups.length - 1];
    if (g && g.month === m) g.days.push(dayNum(d));
    else groups.push({ month: m, days: [dayNum(d)] });
  }
  const body = groups.map((g) => `${g.days.join(', ')} ${MONTHS[g.month]}`).join(', ');
  return `${body} ${year}`;
}
