/* A user's own deadlines: each entry is a window covering every subject (or
   milestone), which is why these are date lists rather than single dates. */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const yearOf = (d) => d.slice(0, 4);
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
  /* Every date carries its own year and month rather than one being read off
     a single date (first or last) and reused for the whole string — that
     single-field-from-one-date-applied-everywhere shape is exactly the bug
     this module exists to avoid. It bit the month first (a window spanning
     a month boundary, e.g. 31 Aug/1 Sep, printed a date that doesn't exist
     if the month came only from the first date) and, in an earlier version
     of this fix, bit the year the same way (a window spanning a year
     boundary, e.g. 31 Dec 2026/1 Jan 2027, printed '2027' for both ends if
     the year came only from the last date). The year is only ever collapsed
     to one shared trailing value when every date actually is in that year. */
  const sameYear = dates.every((d) => yearOf(d) === yearOf(dates[0]));
  /* A run of consecutive calendar days reads better as a span; anything else
     has to be listed, because "19–27 Sep" would claim six days that are not
     deadlines. Contiguity is checked calendar-wise (a real day-to-day step),
     not by comparing day-of-month numbers — comparing bare day numbers is
     the same class of bug: it took the month from the first date and applied
     it to every day number, so a window spanning a month boundary printed a
     date that does not exist. */
  const contiguous = dates.length > 1 && dates.every((d, i) => {
    if (i === 0) return true;
    const prev = new Date(dates[i - 1] + 'T00:00:00');
    const cur = new Date(d + 'T00:00:00');
    return (cur - prev) === 86400000;
  });
  if (contiguous) {
    const first = dates[0], last = dates[dates.length - 1];
    const fMonth = monthNum(first), lMonth = monthNum(last);
    if (!sameYear) {
      return `${dayNum(first)} ${MONTHS[fMonth]} ${yearOf(first)} – ${dayNum(last)} ${MONTHS[lMonth]} ${yearOf(last)}`;
    }
    return fMonth === lMonth
      ? `${dayNum(first)}–${dayNum(last)} ${MONTHS[fMonth]} ${yearOf(first)}`
      : `${dayNum(first)} ${MONTHS[fMonth]} – ${dayNum(last)} ${MONTHS[lMonth]} ${yearOf(first)}`;
  }
  /* Non-contiguous: list every date, grouping consecutive entries that share
     both a month AND a year so the label is printed once per group rather
     than once per date ("19, 20, 26, 27 Sep", not "19 Sep, 20 Sep, ..."),
     without collapsing two different Decembers (or a Dec/Jan pair a year
     apart) into one group just because their month numbers match. */
  const groups = [];
  for (const d of dates) {
    const m = monthNum(d), y = yearOf(d);
    const g = groups[groups.length - 1];
    if (g && g.month === m && g.year === y) g.days.push(dayNum(d));
    else groups.push({ month: m, year: y, days: [dayNum(d)] });
  }
  if (sameYear) {
    const body = groups.map((g) => `${g.days.join(', ')} ${MONTHS[g.month]}`).join(', ');
    return `${body} ${yearOf(dates[0])}`;
  }
  /* Years differ across the list, so a single trailing year would misreport
     every group but the last — each group states its own year instead. */
  return groups.map((g) => `${g.days.join(', ')} ${MONTHS[g.month]} ${g.year}`).join(', ');
}
