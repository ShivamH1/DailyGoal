/* The per-user document. Pure, no imports — loaded identically by the browser
   and by node --test, like progress.js.

   Shape rules exist because this document is edited by hand, synced between
   devices, and in a later project written by a language model. Anything that
   reaches normalizeProfile is treated as untrusted. */

export const DEFAULT_LANES = [
  { key: 'focus',  name: 'Focus' },
  { key: 'work',   name: 'Work' },
  { key: 'move',   name: 'Movement' },
  { key: 'commit', name: 'Commitment' },
  { key: 'rest',   name: 'Rest' },
];

/* These three map to real columns in daily_progress and to the streak rule.
   They can be renamed; they cannot be removed. */
export const CORE_TICK_KEYS = ['s', 'w', 'z'];

/* schedule.js's DAY_KEYS, inlined rather than imported. This module has no
   imports on purpose — it is loaded identically by the browser and by
   node --test — and one shared array of seven strings is not worth making
   that untrue. Same order, and the same keys a week's days are stored under,
   because a commitment on 'mon' has to mean the same day the schedule does. */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const clone = (v) => JSON.parse(JSON.stringify(v));
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/* Minutes past midnight, 1440 included so a block (or a sleep time) can end
   at midnight without ending before it started. */
const minuteOfDay = (v) => (Number.isInteger(v) && v >= 0 && v <= 1440 ? v : null);

/* What a tick is called on screen, and the ONLY way a tick's name should
   reach a rendered string. A new account's three core ticks ship blank — see
   defaultProfile — and they can never be deleted, so "unnamed" is a state
   every render site has to survive: a nameless button, a blank scorecard
   caption and an empty CSV column heading are all silent data problems. The
   fallback is positional, computed at render time, and never written back
   into the document: nothing here invents a word the user then finds stored
   as though they had chosen it. */
export const tickLabel = (tick, index) => str(tick?.label) || `Habit ${(Number(index) || 0) + 1}`;

/* Wake, sleep, fixed commitments and goals. NOTHING IN THIS PROJECT READS
   THIS. That is deliberate rather than an oversight: it is the input the
   schedule generator in the next project reads, and collecting it in the
   onboarding wizard now means that project adds a generation step to an
   existing form rather than standing a second onboarding beside it. It is
   stored, normalised and exported from day one. */
function normalizeIntent(raw) {
  const i = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const busy = [];
  for (const b of Array.isArray(i.busy) ? i.busy : []) {
    const label = str(b?.label);
    /* Unknown day keys are dropped rather than failing the whole entry: a
       commitment naming six real days and one typo is still six real days.
       Filtering DAY_KEYS against the input (not the input against DAY_KEYS)
       also collapses duplicates and puts the days in the week's own order —
       the one canonical form, so ['mon','mon','sun'] and ['sun','mon'] both
       store as the same commitment. */
    const raw = Array.isArray(b?.days) ? b.days : [];
    const days = DAY_KEYS.filter((d) => raw.includes(d));
    const start = minuteOfDay(b?.start);
    const end = minuteOfDay(b?.end);
    if (!label || !days.length || start === null || end === null || end <= start) continue;
    busy.push({ label, days, start, end });
  }
  return { wake: minuteOfDay(i.wake), sleep: minuteOfDay(i.sleep), busy, goals: str(i.goals) };
}

/* The three core ticks start with NO label. They used to ship as Study /
   Workout / Sleep, which handed every new account one person's framing of
   what a day is for — the thing this project exists to undo. They are named
   in onboarding, or later in the profile editor, and until then every render
   site calls them by position through tickLabel above. Defaults where a
   default is honest; blank where it would be an invention. */
export const defaultProfile = () => ({
  season: '',
  lanes: clone(DEFAULT_LANES),
  ticks: CORE_TICK_KEYS.map((key) => ({ key, label: '', hint: '', core: true })),
  rules: [],
  deadlines: [],
  intent: { wake: null, sleep: null, busy: [], goals: '' },
  onboarded: false,
});

export function normalizeProfile(raw) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const base = defaultProfile();

  const lanes = [];
  const laneSeen = new Set();
  for (const l of Array.isArray(p.lanes) ? p.lanes : []) {
    const key = str(l?.key);
    const name = str(l?.name);
    if (!key || !name || laneSeen.has(key)) continue;
    laneSeen.add(key);
    lanes.push({ key, name });
  }

  const given = new Map();
  for (const t of Array.isArray(p.ticks) ? p.ticks : []) {
    const key = str(t?.key);
    if (!key || given.has(key)) continue;      /* first wins */
    given.set(key, { key, label: str(t?.label), hint: str(t?.hint) });
  }

  const ticks = CORE_TICK_KEYS.map((key) => ({
    key,
    /* No fallback label here, deliberately: a blank core label is a real
       state (nobody has named it yet), and filling one in would write the
       invented word into the document, into the next push, and onto every
       other device as though the user had chosen it. tickLabel does the
       naming, at render time only. */
    label: given.get(key)?.label || '',
    hint: given.get(key)?.hint || '',
    core: true,
  }));
  for (const [key, t] of given) {
    /* A label-less extra tick would render as a nameless button. */
    if (CORE_TICK_KEYS.includes(key) || !t.label) continue;
    ticks.push({ ...t, core: false });
  }

  const rules = (Array.isArray(p.rules) ? p.rules : [])
    .filter((r) => r && typeof r === 'object' && str(r.title))
    .map((r) => ({ title: str(r.title), body: str(r.body) }));

  const deadlines = (Array.isArray(p.deadlines) ? p.deadlines : [])
    .filter((d) => d && typeof d === 'object' && str(d.label) && Array.isArray(d.dates) && d.dates.length)
    .map((d) => ({
      label: str(d.label),
      /* Sorted here so nothing downstream has to re-sort to decide whether a
         run of dates is contiguous, and deduped here because both editors can
         produce a collision the user cannot see — the wizard hides a group's
         remainder behind "+ N more dates", so editing its visible date onto
         one of the hidden ones would otherwise store the day twice. */
      dates: [...new Set(d.dates.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort(),
    }))
    .filter((d) => d.dates.length);

  return {
    season: str(p.season),
    lanes: lanes.length ? lanes : base.lanes,
    ticks,
    rules,
    deadlines,
    intent: normalizeIntent(p.intent),
    onboarded: p.onboarded === true,
  };
}

export function newTickKey(ticks) {
  const used = new Set((ticks || []).map((t) => t.key));
  for (let i = 1; ; i++) {
    const k = `k${i}`;
    if (!used.has(k)) return k;
  }
}

/* Whole-document last-write-wins, the same comparison mergeProgress uses.
   Weaker than the per-date merge, and deliberately so: profile edits are rare
   and deliberate, ticks are frequent and incidental, and the frequent case is
   the one that needed the stronger guarantee. A tie keeps local — remote must
   be strictly newer to win, or the same write coming back re-renders. */
export function mergeDoc(local, remote) {
  if (!local) return remote || null;
  if (!remote) return local;
  return (remote.u || '') > (local.u || '') ? remote : local;
}
