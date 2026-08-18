/* The week as data. Drives both the rendered timeline and the NOW banner.
   start/end are minutes from midnight, IST. */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const hard = { text: 'Hard', cls: 'hard' };
const easy = { text: 'Easy', cls: 'easy' };

/* Shared weekday scaffolding — every Mon-Fri day has the same shape around
   its study subject and its workout. */
const wake  = { time: '6:30', start: 390, end: 405, label: 'Wake up', detail: '', lane: 'rest' };
const bfast = { time: '7:45 – 8:45', start: 465, end: 525, label: 'Breakfast &amp; get ready', detail: '', lane: 'rest' };
const work  = { time: '9:30 – 6:30', start: 570, end: 1110, label: 'Work', detail: '', lane: 'work' };
const dinner = { time: '8:15 – 9:15', start: 1215, end: 1275, label: 'Shower &amp; dinner', detail: '', lane: 'rest' };
const free  = { time: '9:15 – 10:15', start: 1275, end: 1335, label: 'Free time', detail: '', lane: 'rest' };
const lights = { time: '11:00', start: 1380, end: 1410, label: 'Lights out', detail: '', lane: 'rest' };

const study = (subject, detail) =>
  ({ time: '6:45 – 7:45', start: 405, end: 465, label: 'Study', subject, detail, lane: 'study' });

const evening = (label, detail, effort) =>
  ({ time: '7:15 – 8:15', start: 1155, end: 1215, label, detail, effort, lane: 'fit' });

export const WEEK = {
  mon: {
    title: 'Monday', tag: 'Consolidation day',
    note: 'Replay the weekend&rsquo;s lectures across all four subjects while they&rsquo;re fresh. Decide which topics Tue–Fri mornings will cover.',
    blocks: [
      { ...wake, detail: 'No phone for the first 15 minutes' },
      { ...study('All subjects', 'Consolidate Sat/Sun classes · plan the week&rsquo;s topics'), label: 'Study — weekend review' },
      bfast,
      { ...work, detail: 'Truworth Wellness' },
      evening('Home workout — full body', 'Push-ups, squats, lunges, plank circuit · 3–4 rounds', hard),
      dinner,
      { ...free, detail: 'Genuinely free — no guilt' },
      lights,
    ],
  },
  tue: {
    title: 'Tuesday', tag: 'Maths morning',
    note: 'Maths Foundation gets the freshest brain of the week — everything in ML and DL stands on it. The evening walk keeps the body moving while it recovers from Monday.',
    blocks: [
      wake,
      study('Maths Foundation for ML', 'Linear algebra, calculus, optimisation · work problems by hand'),
      bfast, work,
      evening('Brisk walk — 60 min', 'Recovery pace · podcast or lecture audio if you like', easy),
      dinner, free, lights,
    ],
  },
  wed: {
    title: 'Wednesday', tag: 'Mid-week double',
    note: 'Machine Learning in the morning, a run in the evening, then one light study hour — the only weekday with two study blocks, so the run stays moderate.',
    blocks: [
      wake,
      study('Machine Learning', 'Algorithms &amp; theory · connect back to Tuesday&rsquo;s maths'),
      bfast, work,
      evening('Run — 40–50 min', 'Steady pace, or easy intervals · finish able to talk', { text: 'Moderate', cls: '' }),
      dinner,
      { time: '9:15 – 10:15', start: 1275, end: 1335, label: 'Study — light hour', subject: 'Weakest subject',
        detail: 'Lecture videos &amp; notes only — no heavy problem-solving at night', lane: 'study' },
      lights,
    ],
  },
  thu: {
    title: 'Thursday', tag: 'Power play',
    note: 'Deep Learning builds directly on Tuesday&rsquo;s maths and Wednesday&rsquo;s ML — that&rsquo;s why it sits here. Last hard workout of the week; the load tapers from tomorrow.',
    blocks: [
      wake,
      study('Deep Learning', 'Theory + code · implement small pieces in Python'),
      bfast, work,
      evening('Home workout — strength &amp; core', 'Push-up variations, split squats, core circuit', hard),
      dinner, free, lights,
    ],
  },
  fri: {
    title: 'Friday', tag: 'Taper &amp; recover',
    note: 'Statistical Methods closes the study week. Easy walk plus stretching in the evening — you want loose hamstrings, not sore ones, for tomorrow&rsquo;s match.',
    blocks: [
      wake,
      study('Statistical Methods', 'Distributions, inference, hypothesis testing · flag doubts for weekend classes'),
      bfast, work,
      evening('Easy walk + full stretch', '30 min walk · 20 min hips, hamstrings, shoulders', { text: 'Very easy', cls: 'easy' }),
      { time: '8:15 onwards', start: 1215, end: 1380, label: 'Free evening',
        detail: 'Fully unclaimed — this is the slack in the system', lane: 'rest' },
      { ...lights, detail: 'Match tomorrow — protect the sleep' },
    ],
  },
  sat: {
    title: 'Saturday', tag: 'Match day · Class day',
    note: 'Classes in the morning, cricket in the evening. The nap in between is not optional — it&rsquo;s what makes both halves work.',
    blocks: [
      { time: '7:30', start: 450, end: 465, label: 'Wake up — slightly later', detail: 'Optional 20 min mobility to loosen up', lane: 'rest' },
      { time: 'Morning', start: 540, end: 780, label: 'BITS WILP contact classes', subject: 'Per timetable',
        detail: 'Attend live · ask the doubts flagged on Friday', lane: 'study' },
      { time: '1:00 – 2:00', start: 780, end: 840, label: 'Lunch', detail: 'Proper meal + hydrate — you&rsquo;ll sweat it out at 3:30', lane: 'rest' },
      { time: '2:00 – 3:00', start: 840, end: 900, label: 'Nap', detail: '', lane: 'rest' },
      { time: '3:30 – 7:30', start: 930, end: 1170, label: 'Cricket match', effort: { text: 'Match', cls: 'hard' },
        detail: 'This is the workout — tick it on the scorecard', lane: 'cricket' },
      { time: '8:00 – 9:00', start: 1200, end: 1260, label: 'Dinner &amp; wind down', detail: '', lane: 'rest' },
      { time: 'Evening', start: 1260, end: 1380, label: 'Completely free', detail: 'No study, no assignments, no guilt', lane: 'rest' },
      lights,
    ],
  },
  sun: {
    title: 'Sunday', tag: 'Match day · Assignments',
    note: 'Class or assignments in the morning — rotate the assignment subject by whatever&rsquo;s due next. The day ends when the match ends.',
    blocks: [
      { time: '7:30', start: 450, end: 465, label: 'Wake up', detail: '', lane: 'rest' },
      { time: 'Morning', start: 540, end: 780, label: 'Class — or assignment block (2 hrs)', subject: 'Rotating',
        detail: 'Whichever subject has the nearest deadline', lane: 'study' },
      { time: '1:00 – 2:00', start: 780, end: 840, label: 'Lunch', detail: '', lane: 'rest' },
      { time: '2:00 – 3:00', start: 840, end: 900, label: 'Nap', detail: '', lane: 'rest' },
      { time: '3:30 – 7:30', start: 930, end: 1170, label: 'Cricket match', effort: { text: 'Match', cls: 'hard' }, detail: '', lane: 'cricket' },
      { time: '8:00 – 9:00', start: 1200, end: 1260, label: 'Dinner &amp; recovery', detail: 'Stretch 10 min · big glass of water', lane: 'rest' },
      { time: '9:00 – 10:30', start: 1260, end: 1350, label: 'Wind down', detail: 'Lay out Monday: notes, workout clothes, breakfast plan', lane: 'rest' },
      { time: '10:30', start: 1350, end: 1380, label: 'Lights out — earlier tonight', detail: 'The week starts at 6:30 sharp', lane: 'rest' },
    ],
  },
};

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

export function resolveNow(dayKey, minutes) {
  const blocks = WEEK[dayKey].blocks;
  const current = blocks.find((b) => minutes >= b.start && minutes < b.end);
  if (current) return { state: 'now', dayKey, block: current };

  const upcoming = blocks.find((b) => b.start > minutes);
  if (upcoming) return { state: 'next', dayKey, block: upcoming };

  /* Past the last block — the useful answer is tomorrow's first, not nothing. */
  const nextKey = DAY_KEYS[(DAY_KEYS.indexOf(dayKey) + 1) % 7];
  return { state: 'next', dayKey: nextKey, block: WEEK[nextKey].blocks[0] };
}
