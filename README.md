# Weekly Innings

A cricket-scoreboard-themed habit tracker and weekly schedule for balancing a job, a part-time M.Tech, and daily fitness. It is a zero-dependency, installable PWA: today's scorecard (study, workout, sleep, and a one-line note) ticks instantly to `localStorage`, then syncs to Supabase in the background — with an offline queue so ticks made without a connection are not lost.

## Local dev

```
npm run dev
```

Then open `http://localhost:8080`. Opening `index.html` directly via `file://` will not work — the app is loaded as ES modules, and browsers refuse to load modules from the filesystem.

## Tests

```
npm test
```

64 tests, 0 failures, across `schedule.js`, `storage.js`, `progress.js`, `sync.js`, and `exams.js`.

## Supabase setup

The app talks to one Postgres table (`daily_progress`) directly over PostgREST — no SDK.

### `.env` (local, gitignored)

Create a `.env` at the repo root with these three values, read by `tools/make-config.mjs`:

```
PROJECT_URL=...   # the Supabase project URL
PUBLIC_KEY=...    # the anon / publishable key
USER_ID=...       # uuid, matching the RLS policy in supabase/schema.sql
```

`.env` also holds `SECRET_KEY` (the `service_role` key, which bypasses RLS
entirely) and `DATABASE_URL` (contains the database password). **Nothing in
this app reads either one** — they exist only because the Supabase dashboard
hands out all five together — and neither must ever be deployed or
committed.

### Generating `config.js`

`config.js` is generated, gitignored, and exports `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `USER_ID` for the browser to import. Regenerate it
with:

```
npm run config
```

See `config.example.js` for the shape of the generated file.

### Vercel

In the Vercel project's environment variables, set `PROJECT_URL`,
`PUBLIC_KEY`, and `USER_ID` (same three names as `.env`). The build command
(`node tools/make-config.mjs`, see `vercel.json`) generates `config.js` from
those at deploy time. Never set `SECRET_KEY` or `DATABASE_URL` there.

### Schema

`supabase/schema.sql` records the `daily_progress` table and its RLS policy
and is **already applied** to the live project — it's kept in the repo as
the source of truth and for rebuilding the table from scratch, not as a
migration to run again.

## The no-auth trade-off

There is no login. The app has no auth, so the Supabase anon key ships to
the browser by design. Row-level security is the entire security model:
every row is pinned to a single hardcoded `USER_ID`, so the anon key can
only ever see and write that one user's rows — but within that table,
**anyone who has the deployed URL can read and write it**, because the key
in the shipped bundle grants exactly that. This is acceptable only because
it is a single-user personal tracker with nothing sensitive in it; it is not
a pattern to reuse for anything with real stakes.

## Deploy

```
npx vercel --prod
```

Accept the defaults; when asked for the project directory, choose the repo
root.

`outputDirectory` is `.`, so everything uploaded is also served.
`.vercelignore` keeps the tests, the docs, the SQL, and the original
prototype out of the deployment — but deliberately keeps `tools/`, because
the build command (`node tools/make-config.mjs`) runs against the uploaded
files and would fail without it.

## Changing the schedule

`schedule.js` is the single source of truth for the week. It exports the
`WEEK` timeline data that both the "Schedule" tabs and the NOW/NEXT banner
render from — edit a block there and both surfaces update together.

## Changing exam dates

Exam windows live in `exams.js` as the `EXAMS` array (label + list of
dates). The dates currently checked in are the real BITS WILP EC-1, EC-2,
and EC-3 evaluation windows for 2026, not placeholders.

## Verify after first deploy

These checks need a browser against the live deployment and have not been
run as part of this task — work through them once `npx vercel --prod` has
been run interactively:

- [ ] Chrome DevTools → Lighthouse → Progressive Web App. Expected:
      installability check passes.
- [ ] Device toolbar at 380px width. Expected: no horizontal scrolling
      anywhere; tabs, tiles, and the NOW banner all reflow.
- [ ] Clear site data and reload. Expected: zero console errors on a fresh
      load against an empty database.
- [ ] Keyboard-only pass: Tab through ticks, note input, tabs, calendar
      cells, export buttons. Expected: a visible amber focus ring on each.
- [ ] macOS System Settings → Accessibility → Reduce Motion on, then
      reload. Expected: tapping a habit fills its box with no check-draw
      animation, and tapping a calendar cell jumps the page to the scorecard
      instead of scrolling smoothly to it. Those two are the only motion in
      the app — panels swap with `display`, and never animated.
