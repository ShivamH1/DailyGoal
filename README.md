# Weekly Innings

A cricket-scoreboard-themed habit tracker and weekly schedule for balancing a job, a part-time M.Tech, and daily fitness. It's a static PWA: today's scorecard (study, workout, sleep) ticks instantly to `localStorage` and later syncs to Supabase for cross-device persistence.

## Local dev

```
npm run dev
```

Then open `http://localhost:8080`. Opening `index.html` directly via `file://` will not work — the app uses ES modules, which browsers refuse to load from the filesystem.

## Tests

```
npm test
```

## Deploy

```
npx vercel --prod
```

Accept the defaults; when asked for the project directory, choose the repo root.

## Supabase setup

The app has no auth, so the Supabase anon key ships to the browser by design.
Row-level security is the entire security model: every row is pinned to a
single hardcoded `USER_ID`, so the anon key can only ever see and write that
one user's rows.

### `.env` (local, gitignored)

Create a `.env` at the repo root with:

```
PROJECT_URL=https://<project-ref>.supabase.co
PUBLIC_KEY=<anon / publishable key>
USER_ID=<uuid, matching the RLS policy in supabase/schema.sql>
```

`.env` also holds `SECRET_KEY` (the `service_role` key, which bypasses RLS
entirely) and `DATABASE_URL` (contains the database password). Neither is
used by this app — nothing in this repo reads them — and neither must ever
be deployed or committed.

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
`PUBLIC_KEY`, and `USER_ID` (same names as `.env`). The build command
(`node tools/make-config.mjs`, see `vercel.json`) generates `config.js` from
those at deploy time.

### Schema

`supabase/schema.sql` is already applied to the live project. It's kept in
the repo as the source of truth and for rebuilding the table from scratch.
