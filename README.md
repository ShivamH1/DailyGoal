# Weekly Innings

A cricket-scoreboard-themed habit tracker and weekly schedule. It is a zero-dependency, installable PWA with real accounts: today's scorecard (three core habits you name yourself, extra habits, and a one-line note) ticks instantly to `localStorage`, then syncs to Supabase in the background — with an offline queue so ticks made without a connection are not lost. Habits, the week's schedule, deadlines and rules are all per-account data, set up by a first-run wizard and editable in the app.

## Local dev

```
npm run dev
```

Then open `http://localhost:8080`. Opening `index.html` directly via `file://` will not work — the app is loaded as ES modules, and browsers refuse to load modules from the filesystem.

## Tests

```
npm test
```

The suite runs on `node --test` alone — zero dependencies is a constraint the
tests enforce (`package.json` declares none, and the acceptance run checks
that stays true).

## Supabase setup

The app talks to Postgres over PostgREST — no SDK. Sign-in is an email and a
password through Supabase Auth: two requests, no redirect out of the app, no
client secret, and nothing to configure with a third party.

### 1. Authentication settings

In Supabase → Authentication:

- **Sign In / Providers → Email** must be enabled. It is on by default, and
  it is the only provider this app uses.
- **Confirm email** decides what registering does. With it OFF, a new
  account is signed in immediately. With it ON, Supabase emails a
  confirmation link and the account can do nothing until it is clicked —
  which needs a real SMTP provider configured, because the built-in mailer
  sends a couple of messages an hour and is documented as test-only. The app
  handles both: a registration that comes back without a session says to
  check that inbox instead of pretending to be signed in.
- **Minimum password length** should be at least 8, matching `MIN_PASSWORD`
  in `auth.js`. The client checks the same number before sending, but the
  server setting is the rule — the client's copy only saves a round trip.
- **Leaked password protection**, if the plan offers it, is worth having on.
  It costs nothing here and refuses passwords already known to be breached.

No redirect allow-list, no provider keys, no callback URL: none of that
exists in this flow any more.

### 2. `.env` (local, gitignored)

Create a `.env` at the repo root with two values, read by
`tools/make-config.mjs`. Either spelling of each name works — the dashboard
uses one pair, the wider ecosystem the other:

```
PROJECT_URL=...   # or SUPABASE_URL — the project URL
PUBLIC_KEY=...    # or SUPABASE_ANON_KEY — the anon / publishable key
```

`USER_ID` is gone: rows are keyed to `auth.uid()` and RLS checks the token,
so a `.env` that still declares it is simply ignored. `.env` may also hold
`SECRET_KEY` (the `service_role` key, which bypasses RLS entirely) and
`DATABASE_URL` (contains the database password). **Nothing in this app reads
either one** — and neither must ever be deployed or committed.

### Generating `config.js`

`config.js` is generated, gitignored, and exports `SUPABASE_URL` and
`SUPABASE_ANON_KEY` for the browser to import. Regenerate it with:

```
npm run config
```

See `config.example.js` for the shape of the generated file.

### Vercel

In the Vercel project's environment variables, set `PROJECT_URL` and
`PUBLIC_KEY` (same names as `.env`). The build command
(`node tools/make-config.mjs`, see `vercel.json`) generates `config.js` from
those at deploy time. Never set `SECRET_KEY` or `DATABASE_URL` there.

### Schema, in order

`supabase/schema.sql` is layered, and the order matters:

1. **v1** — the original single-user `daily_progress` table. Already applied
   to the live project.
2. **v2** — additive multi-user: the `(user_id, date)` primary key,
   `user_profile` and `user_schedule`, and per-account RLS for the
   `authenticated` role. Must be applied before a second account can exist —
   under the old key, two users cannot both tick today.
3. **Phase-3 cutover** — drops the v1 policy and revokes `anon`'s table
   access. Applied **last**, and only after any pre-account rows have been
   migrated onto a real account (the Task 7 record at the end of the file):
   after the revocation, orphaned rows are reachable only with the service
   key.

The file is kept as the source of truth and for rebuilding from scratch; the
guards make the v2 section safe to re-run.

## The security model

The app has real accounts. Row-level security grants each `authenticated`
user exactly the rows where `user_id = auth.uid()` — a second account
cannot read or write the first's data, and the server, not the client,
enforces that. The anon key still ships to the browser (it has to: it is
what the sign-in and registration requests are addressed with), but the
anon key **alone grants nothing** once the phase-3 cutover has revoked the
`anon` role's table access. A token, not a key, is what reads and writes.

A password is only ever an argument: it goes into a request body and is
dropped, never stored, never logged, never in a URL, and not sent at all
when it is too short to succeed. The session's JWT does live in
`localStorage` — an offline-first app has to survive a reload — which is an
XSS exposure, and the mitigation is that no user-authored string is ever
interpolated into `innerHTML` anywhere in this codebase. Every refused
sign-in says the same thing, so the gate cannot be used to find out whether
an address has an account here.

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

## Changing the schedule or deadlines

There is nothing to edit in the code: the week, the habits and the deadline
windows are all account data, created by the first-run wizard and changed in
the app (Edit profile, and the week editor). The repo ships no one's
schedule and no one's exam dates.

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
