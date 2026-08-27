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
const CORE_TICK_LABELS = { s: 'Study', w: 'Workout', z: 'Sleep' };

const clone = (v) => JSON.parse(JSON.stringify(v));
const str = (v) => (typeof v === 'string' ? v.trim() : '');

export const defaultProfile = () => ({
  season: '',
  lanes: clone(DEFAULT_LANES),
  ticks: CORE_TICK_KEYS.map((key) => ({ key, label: CORE_TICK_LABELS[key], hint: '', core: true })),
  rules: [],
  deadlines: [],
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
    label: given.get(key)?.label || CORE_TICK_LABELS[key],
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
         run of dates is contiguous. */
      dates: d.dates.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort(),
    }))
    .filter((d) => d.dates.length);

  return {
    season: str(p.season),
    lanes: lanes.length ? lanes : base.lanes,
    ticks,
    rules,
    deadlines,
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
