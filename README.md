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

Added in Milestone 2.
