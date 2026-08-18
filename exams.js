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
