# Weekly Innings — Habit Tracker & Schedule PWA

Implementation spec for Claude Code. Work through the milestones in order; each one leaves the app in a working, deployable state.

---

## 1. Context

I'm a Product Engineer in Pune balancing three things: a 9:30–6:30 job, a BITS Pilani WILP M.Tech in AI & ML (weekend contact classes), and daily fitness (walking / running / home workouts, plus cricket matches Sat & Sun 3:30–7:30 PM).

I already have a working single-file prototype: **`weekly-innings-tracker.html`** (included in this repo). It was built inside Claude.ai as an artifact and contains:

- A cricket-scoreboard-themed schedule page ("The Weekly Innings") — dark pitch-green palette, Bricolage Grotesque + IBM Plex Mono, hanging scoreboard plates in the hero
- Tabbed day views (Mon–Sun) with an hour-by-hour timeline, auto-opening on today's day
- Subject-mapped study mornings: Mon = consolidation, Tue = Maths Foundation for ML, Wed = Machine Learning (+ light evening hour), Thu = Deep Learning, Fri = Statistical Methods, Sun = assignments
- Workout intensity wave: home workout (hard) Mon/Thu, walk (easy) Tue/Fri, run (moderate) Wed, cricket Sat/Sun
- "Today's Scorecard": three daily ticks — study hour, workout, slept by 11
- Streak counter (study + workout only — sleep deliberately excluded from streaks)
- Monthly calendar ("The Season Board") with per-day pips and green fill for 3/3 days; tap a past day to edit it
- Debounced saves with exponential-backoff retry and a visible save-status indicator

**The one thing that must change:** persistence currently uses `window.storage`, an API that only exists inside Claude.ai's artifact viewer. Hosted anywhere else, it silently falls back to memory-only. Replacing the storage layer is Milestone 1.

Keep the existing visual design and HTML/CSS structure. This is a storage + packaging + feature project, not a redesign.

---

## 2. Architecture decision

- **Frontend:** keep it a static site. No framework migration; vanilla HTML/CSS/JS is fine. Refactor the single file into `index.html`, `styles.css`, `app.js` if it helps maintainability, but don't introduce a build step unless a milestone requires it.
- **Storage:** two-tier.
  - `localStorage` is always the immediate write target (instant, offline-safe).
  - **Supabase** (free tier) is the sync layer for cross-device persistence.
- **Hosting:** static deploy on **Vercel or Netlify** (either is fine; pick one and document the deploy command).
- **App shell:** PWA (manifest + service worker) so it installs to the phone home screen and works offline.
- **Auth:** this is a single-user personal app. Use Supabase email magic-link auth for just my account, or a single-row table protected by RLS tied to my user id. Do NOT build a signup flow, roles, or profiles.

### Data model

One record per day:

```sql
create table daily_progress (
  date        date primary key,
  study       boolean not null default false,
  workout     boolean not null default false,
  sleep       boolean not null default false,
  note        text,                -- Milestone 4
  updated_at  timestamptz not null default now(),
  user_id     uuid not null default auth.uid()
);
-- RLS: user can only read/write rows where user_id = auth.uid()
```

Client-side shape (mirrors the current prototype):

```js
// progress = { "2026-08-20": { s:1, w:1, z:1, note:"covered SVMs" }, ... }
```

### Sync strategy (keep it simple)

1. Every tick writes to `localStorage` immediately.
2. A debounced sync (reuse the existing 600 ms debounce + retry/backoff logic) pushes changed dates to Supabase.
3. On app open: load `localStorage` first (instant render), then fetch from Supabase and merge — **last `updated_at` wins per date**.
4. Offline: queue changed dates in `localStorage` (`pendingSync` key); flush on `online` event and on app open.
5. Keep the existing save-status indicator ("saving… / ✓ saved / ⚠ not saved") wired to the sync result.

---

## 3. Milestones

Do these in order. Each ends with a deployable, testable state.

### Milestone 1 — Storage swap + deploy (ship first)
- [ ] Split the prototype into `index.html`, `styles.css`, `app.js` (optional but recommended)
- [ ] Replace all `window.storage` calls with a `storage.js` module: `localStorage` implementation behind `load()` / `save(progress)` functions
- [ ] Keep debounce, retry, and the save-status indicator working
- [ ] Deploy to Vercel/Netlify; document the deploy command in README
- **Done when:** I can open the URL on my phone, tick today, close the tab, reopen, and the tick is still there.

### Milestone 2 — Supabase sync
- [ ] Create Supabase project config (`.env` for URL + anon key; never commit keys)
- [ ] `daily_progress` table + RLS as above; magic-link auth for my single account
- [ ] Implement the sync strategy (localStorage-first, merge by `updated_at`, offline queue)
- [ ] Add a tiny sync indicator distinct from save status (e.g. "synced · 2 min ago")
- **Done when:** a tick made on my phone appears on my laptop after refresh, and ticks made offline sync when back online.

### Milestone 3 — PWA
- [ ] `manifest.json`: name "Weekly Innings", theme color `#16352A`, standalone display, icons (generate a simple scoreboard-style icon — amber digits on pitch green)
- [ ] Service worker: cache-first for the app shell (HTML/CSS/JS/fonts), network-only for Supabase calls
- [ ] Add-to-home-screen works on Android Chrome and iOS Safari
- **Done when:** installed app opens full-screen, renders instantly offline, and syncs when online.

### Milestone 4 — Daily-use features (in this priority order)
1. **"Now" highlight** — in the day view, highlight the timeline row matching the current time (IST). The app should answer "what should I be doing right now" in one glance. Also show it as a compact banner at the top: `NOW · 6:45–7:45 · Study — Deep Learning`.
2. **One-line daily note** — a single text input on the scorecard ("What did you cover?"), saved to the same record. Show notes on calendar-day tap. This becomes my revision log by exam time.
3. **Exam countdown** — a small config (`config.js` or a `settings` table) holding exam dates per subject; show the nearest one as a scoreboard plate: `DL EXAM · 23 DAYS`.
4. **Export** — button that downloads full history as JSON (and CSV). I must always own my data regardless of backend.
5. **Weekly summary** — a Sunday view/section: study days x/5, workouts x/7, sleep x/7, best streak, notes list for the week.

### Explicitly out of scope
- Web push notifications (phone alarms do this job; not worth the iOS pain)
- Multi-user support, profiles, social features
- Framework migration (no React/Next unless a milestone genuinely blocks without it)
- Redesign of the existing visual identity

---

## 4. Schedule reference (source of truth for the "Now" highlight)

**Mon–Fri:** 6:30 wake · 6:45–7:45 study (Mon: consolidation, Tue: Maths Foundation for ML, Wed: Machine Learning, Thu: Deep Learning, Fri: Statistical Methods) · 7:45–8:45 breakfast/ready · 9:30–6:30 work · 7:15–8:15 workout (Mon: home workout hard, Tue: brisk walk easy, Wed: run moderate, Thu: home workout hard, Fri: easy walk + stretch) · 8:15–9:15 shower/dinner · Wed only 9:15–10:15 light study (weakest subject) · 11:00 lights out.

**Sat:** 7:30 wake · morning WILP classes · 1:00 lunch · 2:00–3:00 nap · 3:30–7:30 cricket match · evening fully free · 11:00 sleep.

**Sun:** 7:30 wake · morning class or 2-hr assignment block (nearest deadline) · 1:00 lunch · 2:00–3:00 nap · 3:30–7:30 cricket match · 8:00 dinner + recovery · 9:00–10:30 wind down + prep Monday · 10:30 sleep.

Timezone: Asia/Kolkata. All times IST.

---

## 5. Quality bar

- Mobile-first: primary device is a phone; test at ~380 px width
- Keep `prefers-reduced-motion` support and visible keyboard focus (already present — don't regress)
- Lighthouse PWA installability check passes after Milestone 3
- No console errors on a fresh load with an empty database
- README covers: local dev, env vars, Supabase setup SQL, deploy command
