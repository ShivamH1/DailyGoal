# Weekly Innings — Design

Status: approved
Source spec: `weekly-innings-spec.md`
Prototype: `weekly-innings-tracker (1).html`

## 1. Goal

Turn the Claude.ai artifact prototype into a deployed, installable PWA that
persists habit ticks locally, syncs them across phone and laptop through
Supabase, and answers "what should I be doing right now" at a glance.

The visual identity is fixed. This is a storage, packaging, and feature
project, not a redesign.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Build step | None | The anon key is public by design, so there is no secret to inject and nothing for a bundler to earn. |
| Dependencies | Zero npm packages | Supabase is reached through its PostgREST HTTP API with `fetch`. `supabase-js` would add ~100 KB to cache for one table and one verb. |
| Auth | None; public anon key plus a hardcoded `user_id` | User's explicit choice. See Risk below. |
| Hosting | Vercel, `vercel --prod` | Static deploy of the repo root. |
| Tests | `node --test` (built into Node 26) | Pure logic only. Keeps the zero-dependency rule. |

### Accepted risk: no auth

The anon key ships in client source. Anyone who discovers the deployed URL can
read and write the habit rows. RLS still pins every policy to the single
hardcoded `user_id`, so the blast radius is exactly one table of booleans and
short notes — nothing else in the Supabase project is reachable.

Storage and sync sit behind `load()` / `save()` / `pull()` / `push()`, so
adding email+password auth later touches `sync.js` and a login form, not
application logic.

## 3. Architecture

```
index.html     shell, hero, scorecard, calendar mount points
styles.css     lifted verbatim from the prototype
config.js      SUPABASE_URL, SUPABASE_ANON_KEY, USER_ID, EXAM_DATES
schedule.js    the week as data; drives both rendering and NOW resolution
progress.js    pure logic: streak, merge, weekly summary, CSV  [tested]
storage.js     localStorage read/write plus the pendingSync queue
sync.js        PostgREST pull/push, backoff, status events
app.js         DOM wiring: tabs, scorecard, calendar, NOW banner, export
sw.js          cache-first app shell
manifest.json  plus icons/
test/          node --test suites
```

Each module answers one question. `progress.js` and `schedule.js` are pure and
import nothing — they are the tested core. `storage.js` and `sync.js` own one
side effect each. `app.js` is the only module that touches the DOM.

### Deviation from the source spec

The seven day panels move out of hardcoded HTML into `schedule.js` and are
rendered at runtime. The NOW highlight needs block start and end times as
structured data; the alternative is parsing `"6:45 – 7:45"` back out of
rendered text, which breaks the moment a label changes. Emitted markup and CSS
class names are unchanged, so the rendered page is visually identical.

## 4. Data model

```sql
create table daily_progress (
  date       date primary key,
  study      boolean not null default false,
  workout    boolean not null default false,
  sleep      boolean not null default false,
  note       text,
  updated_at timestamptz not null default now(),
  user_id    uuid not null
);
alter table daily_progress enable row level security;
create policy single_user on daily_progress
  for all using (user_id = '<USER_ID>') with check (user_id = '<USER_ID>');
```

`<USER_ID>` is a literal substitution made once during Supabase setup: generate
a UUID, paste it into both the policy above and `USER_ID` in `config.js`. The
README carries the exact steps.

Client shape, unchanged from the prototype plus two fields:

```js
progress = { "2026-08-20": { s:1, w:1, z:1, note:"covered SVMs", u:"2026-08-20T18:04:11.000Z" } }
```

`u` mirrors `updated_at` and is what the merge compares. It is stamped
client-side on every local mutation so an offline device still orders
correctly against a device that synced meanwhile.

Column mapping, applied in `sync.js` and nowhere else:

| Client | Column |
|---|---|
| `s` (0/1) | `study` (boolean) |
| `w` (0/1) | `workout` (boolean) |
| `z` (0/1) | `sleep` (boolean) |
| `note` | `note` |
| `u` (ISO string) | `updated_at` |

The short client keys are kept because the prototype's existing
`localStorage` payloads already use them, and renaming would orphan any ticks
already recorded.

## 5. Sync

**Write path.** Tick → in-memory mutation → re-render → `localStorage` write
(synchronous, instant) → date pushed onto `pendingSync` → 600 ms debounce →
upsert the changed rows. On success the dates clear from `pendingSync`.

Upsert uses `POST /rest/v1/daily_progress` with
`Prefer: resolution=merge-duplicates,return=minimal`, keyed on the `date`
primary key. Rows are sent in one batch, not one request per date.

Every upsert sends `updated_at` explicitly from the client-side `u` value. It
must never be left to the column default: `now()` would stamp server receipt
time, so a tick made offline on Monday and flushed on Wednesday would outrank a
genuinely newer Tuesday edit from the other device, and the merge rule would
silently pick the wrong row.

**Read path.** On open: read `localStorage`, render immediately, then pull all
remote rows, merge, re-render, and flush anything pending.

**Conflict rule.** Per date, the row with the later `updated_at` wins in full.
Field-level merge is rejected deliberately: it would let a stale device
resurrect a tick the user had removed.

**Offline.** A failed pull or push leaves `pendingSync` intact and sets the
indicator to `offline · N unsynced`. The `online` event and the next app open
both flush.

**Indicators.** Two, kept distinct: the prototype's `saving… / ✓ saved / ⚠ not
saved` reports the local write; a second line reports Supabase as
`syncing… / synced · 2 min ago / offline · N unsynced`.

## 6. NOW highlight

Each schedule block carries `start` and `end` as minutes from midnight. The
current time is read through `Intl.DateTimeFormat` pinned to `Asia/Kolkata`,
so the app is correct regardless of device timezone. The banner re-resolves
every 60 seconds and on tab focus.

- Inside a block: `NOW · 6:45–7:45 · Study — Deep Learning`, and the matching
  timeline row gets a highlight class.
- In a gap: `NEXT · 7:15 · Home workout`.
- After the last block: the banner shows the next day's first block.

Open-ended blocks in the prototype (`"Morning"`, `"8:15 onwards"`) are given
explicit ranges in `schedule.js`, derived from the schedule reference in
section 4 of the source spec.

## 7. Features (source spec Milestone 4)

1. **NOW highlight** — banner plus row highlight, as above.
2. **Daily note** — one text input on the scorecard, saved to the same record,
   debounced with the same 600 ms path as ticks. Shown when a calendar day is
   tapped.
3. **Exam countdown** — `EXAM_DATES` in `config.js`; the nearest future exam
   replaces the fourth hero plate: `DL EXAM · 23 DAYS`.
4. **Export** — downloads full history as JSON and as CSV. CSV quotes and
   escapes note text.
5. **Weekly summary** — study x/5, workouts x/7, sleep x/7, best streak, and
   the week's notes, for the current Mon–Sun week.

## 8. Failure behaviour

- Empty database, absent config, and offline all render a working app with no
  console errors.
- `config.js` without keys runs local-only and says so in the sync line, so
  Milestone 1 is usable before Supabase exists.
- Push and pull failures back off 1s, 2s, 4s, 8s, then park until the next
  tick or `online` event. No unbounded retry loop.
- A malformed `localStorage` payload is discarded rather than thrown on.

## 9. Testing

`node --test` over the two pure modules:

- `progress.js` — streak with today incomplete, streak across a gap, merge
  ordering by `updated_at`, merge with a missing side, weekly summary counts,
  CSV escaping of quotes and commas in notes.
- `schedule.js` — resolution at exact block boundaries, inside a gap, before
  the first block, after the last block, and the differing Sat/Sun shapes.

No DOM tests. `app.js` is verified by running the app.

## 10. Out of scope

Push notifications, multi-user, profiles, framework migration, visual redesign.
