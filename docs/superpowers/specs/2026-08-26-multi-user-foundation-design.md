# Multi-user foundation — design

**Date:** 2026-08-26
**Branch:** `multi-user`
**Status:** approved, ready for planning

## Why

The app was built for one person. That was a deliberate choice: no auth, the
anon key shipped in the page, and a single RLS policy pinning every row to one
hardcoded UUID. It is now meant to be usable by anyone, and that choice does
not survive contact with a second user — with no auth there is nothing in the
system that distinguishes one person from another, so every user would read and
write every other user's data.

This is also a live hole today, not a future one. Anyone who finds the deployed
URL can read and overwrite the existing data, because the anon key is in the
page and RLS trusts it.

## Scope

This spec covers **A: the multi-user foundation** only. Two follow-on projects
were scoped in the same conversation and are deliberately deferred, each to get
its own spec:

- **B — AI schedule generation.** A multi-step form after sign-in feeds Mistral
  (plain `fetch`, no LangChain, no dependencies) via a Vercel serverless
  function; it returns a validated week. A builds the form and the storage; B
  swaps the wizard's final step from "here is your empty week" to "here is the
  week Mistral built you".
- **C — Extras.** Exam mode (the schedule shifts during a user's own exam
  windows), a weekly review that reads the last seven days of ticks and notes
  and returns one concrete adjustment, and a "never miss twice" nudge.

B must not ship before A. The Mistral endpoint spends the project owner's
credits, so it has to be gated behind a logged-in user and rate-limited from
its first deploy.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Sign-in | Google only | User's call. Accepted cost: no Google account, no app. |
| Guest mode | None | One code path. Signed out shows a sign-in screen and nothing else. |
| Data model | Widen what exists — 3 tables | Preserves the per-date merge, which is the hardest-won logic in the app. |
| Core ticks | Stay three, labels become data | Every logged day stays valid; streak rule unchanged. |
| Extra ticks | User-defined, in `extras jsonb` | Asked for. They do **not** feed the streak. |
| Lanes | Neutral defaults, user-extensible | A default lane set is honest; a default *rule* is not. |
| Rules / deadlines / season | Start empty | Inventing someone's principles is worse than showing none. |
| The week in A | User data + hand editor | Needed regardless — AI output will sometimes be wrong. |
| AI library | None | Plain `fetch`. Keeps the project at zero runtime dependencies. |

### Extras do not feed the streak

`complete = study && workout` is unchanged. If extras counted, adding a tick in
September would retroactively change whether August was complete — every stored
day would silently change meaning. Extras are tracked and shown; they do not
carry the chain.

## Auth

New module `auth.js`. Plain `fetch`, no `supabase-js`, consistent with how
`sync.js` already talks to PostgREST.

### Verified endpoints

Probed against the live project on 2026-08-26. These are confirmed, not assumed:

| Call | Observed | Conclusion |
| --- | --- | --- |
| `GET /auth/v1/authorize?provider=google` | `400 "provider is not enabled"` | Route correct; only configuration is missing. A bogus provider returns `"could not be found"` instead, so the two cases are distinguishable. |
| `POST /auth/v1/token?grant_type=pkce` | `404 flow_state_not_found` | Correct grant. A fabricated `auth_code` was rejected *after* grant validation, so the `{auth_code, code_verifier}` body shape is accepted. |
| `POST /auth/v1/token?grant_type=authorization_code` | `unsupported_grant_type` | Not the OAuth-server flow. The published docs describe Supabase acting as an OAuth *provider*, which is a different feature. |
| `POST /auth/v1/token?grant_type=refresh_token` | `"Refresh token is not valid"` | Correct grant for refresh. |
| `GET /auth/v1/settings` | `external: { email }` | Google is not yet enabled. |

### Flow

1. **Sign in.** Generate a random `code_verifier`, derive an S256
   `code_challenge` via WebCrypto, persist the verifier, and redirect to
   `/auth/v1/authorize` with `provider=google`, `redirect_to`, the challenge and
   `code_challenge_method=s256`.
2. **Return.** Supabase redirects back with `?code=`. Exchange it at
   `/auth/v1/token?grant_type=pkce` with `{ auth_code, code_verifier }`, store
   the session, strip the query string from the URL so a reload cannot replay a
   spent code, then render.
3. **Refresh.** A single `accessToken()` accessor returns a valid token,
   refreshing via `grant_type=refresh_token` when within 60 seconds of expiry.
   Every other caller — `sync.js` included — stays ignorant of expiry.
4. **Sign out.** `POST /auth/v1/logout`, clear the session, return to the
   signed-out view.

### Token storage

`localStorage`, not `sessionStorage`, so an installed PWA stays signed in
between launches. Accepted risk: an XSS could exfiltrate a session. The
mitigation is the rule already in force — every user-authored string is written
with `textContent`, never `innerHTML`. That rule now guards a session token as
well as the page, and must hold for all new UI in this project.

### Testability

The pure parts take injected dependencies, matching `sync.js` and `storage.js`:
verifier/challenge derivation, expiry arithmetic, session parsing and URL
cleanup are all testable under `node --test` with a stub `fetch` and a stub
store. The redirect itself is the only untestable step.

## Schema

```sql
-- daily_progress: keeps its rows and its history.
alter table daily_progress add column extras jsonb;
alter table daily_progress alter column user_id set default auth.uid();

-- Phase 2 ADDS this policy. The existing single_user/anon policy stays in
-- place beside it, because phase 2 lands before the client can present a
-- token — dropping anon here would break the app for a whole phase.
create policy own_rows on daily_progress
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on daily_progress to authenticated;

-- Phase 3 only, once the client authenticates:
--   drop policy if exists single_user on daily_progress;
--   revoke all on daily_progress from anon;

create table user_profile (
  user_id    uuid primary key references auth.users on delete cascade
             default auth.uid(),
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null
);

create table user_schedule (
  user_id    uuid primary key references auth.users on delete cascade
             default auth.uid(),
  week       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null
);
-- both: RLS on, same own-rows policy, grants to authenticated only.
```

`user_id` gains a default of `auth.uid()`, so the client stops sending it
entirely. Fewer things the client can get wrong, and one fewer field to trust.

`updated_at` stays `not null` with **no default**. The client always sends it
explicitly — the same rule the existing sync already follows, because a column
default of `now()` would be the server's clock rather than the clock the merge
compares against.

### Migration

Existing rows carry the hardcoded UUID. On the owner's first Google sign-in,
one `UPDATE` rewrites `user_id` to the new auth UID. It runs once, from the
Supabase SQL editor, and every logged day survives. It must run *before* the
`anon` grants are revoked, or the old rows become unreachable to the only
credential that can currently see them.

## Storage is per-account

`localStorage` keys are global today (`wi:progress`, `wi:pending`). Two Google
accounts in one browser would silently share and corrupt one another's data.
Keys become `wi:<uid>:<name>`.

Existing unnamespaced data is migrated into the signing-in user's namespace on
first sign-in, once, and the old keys removed. Sign-out leaves a namespace in
place — signing back in on a shared laptop should not have cost you your queue.

## Documents

### Profile

```json
{
  "season":  "",
  "lanes":   [{ "key": "focus", "name": "Focus" }, ...],
  "ticks":   [{ "key": "s", "label": "Study hour", "hint": "6:45 am", "core": true }, ...],
  "rules":     [],
  "deadlines": []
}
```

Per-day extra ticks are stored in `daily_progress.extras` as a flat map of
tick key to boolean — `{"x7f2": true}` — with absent meaning false. The
definitions live in the profile; only the values live per day, so renaming a
tick does not have to touch a single logged row.

`lanes` ships with a neutral default set (Focus, Work, Movement, Commitment,
Rest) that the user can rename and extend. `ticks` ships with the three core
entries, which cannot be deleted because they map to real columns; user-added
ticks get generated keys and live in `extras`. `rules`, `deadlines` and
`season` start empty.

### Week

```json
{ "mon": { "title": "", "tag": "", "note": "", "blocks": [
    { "start": 405, "end": 465,
      "label": "", "subject": "", "detail": "", "lane": "focus" } ] }, ... }
```

`start`/`end` stay minutes from midnight, matching what `resolveNow` already
expects. **`time` is derived at render, never stored** — a stored display
string is a second source of truth for the same fact, and in B that fact comes
from a language model, which will eventually emit a `time` that contradicts its
own `start`. Blocks whose label is not a range ("Morning", "8:15 onwards") set
an optional `timeText` that overrides the derived string; the schedule in the
current app has three such blocks, so this is a real case, not a hypothetical. A validator enforces `0 <= start < end <= 1440`, a known lane, and
blocks sorted by start; it is written in A and reused unchanged in B to check
Mistral's output.

### Merge

Both documents are whole-document last-write-wins by `updated_at`, the same
comparison `mergeProgress` uses. This is weaker than the per-date merge and it
is a real trade-off: editing your rules on a phone and your lanes on a laptop
while both are offline loses one of the two edits. Accepted because profile and
schedule edits are rare and deliberate, whereas ticks are frequent and
incidental — the case that actually needed protecting is the one that keeps it.

## Modules

| Module | Change |
| --- | --- |
| `auth.js` | New. PKCE, session, refresh, sign-out. |
| `profile.js` | New. Profile + schedule documents, local-first with the same pending-queue pattern as progress. |
| `schedule.js` | Stops containing a week. `resolveNow(week, day, minutes)`, `WEEK` gone, validator added. |
| `sync.js` | Bearer token from `accessToken()`; stops sending `user_id`; gains profile and schedule push/pull. |
| `storage.js` | Keys namespaced by uid; one-time migration of the unnamespaced keys. |
| `app.js` | Signed-out view, onboarding wizard, settings and week editors, render from documents. |
| `index.html` | Personal content removed; sections render from the profile. |
| `sw.js` | New modules in `SHELL`; cache bumped to v6. |

`app.js` is 531 lines and this adds substantially to it. The wizard and the
editors move into their own modules rather than growing it further.

## Build order

Six phases, each ending green:

1. **Auth** — `auth.js`, sign-in/out UI, session persistence. No data changes.
2. **Schema** — migration SQL, applied and verified live; owner's rows moved.
3. **Plumbing** — tokenised sync, namespaced storage, `anon` revoked.
4. **Profile** — content out of HTML into the document; settings editors.
5. **Week** — schedule as data; block editor; empty state.
6. **Onboarding** — the multi-step wizard, writing the profile.

Phase 3 is the cutover: until it lands the app still reads the old rows, and
after it lands the old anon path is gone. It is the one phase that must be
verified against the live database before being called done.

## Testing

`node --test` only, no new dependencies. New coverage:

- PKCE derivation, expiry arithmetic, session parse, spent-code URL cleanup
- Storage namespacing, and the one-time unnamespaced migration
- Profile and schedule document merge, including equal `updated_at`
- Schedule validation: reversed ranges, out-of-range minutes, unknown lanes,
  overlapping blocks, empty days
- `resolveNow` against an injected week, including a week with an empty day
- Sync: token attached, `user_id` absent, 401 surfaced rather than swallowed

An expired token mid-session is the failure mode most likely to reach a user,
so it gets an explicit test: a 401 from PostgREST must trigger one refresh and
one retry, and only then surface.

## Manual setup

Two steps that cannot be automated. Both are needed before phase 1 can be
verified end to end:

1. **Google Cloud** — create a project, configure the OAuth consent screen, create
   an OAuth 2.0 Web Application client, and register
   `https://<project-ref>.supabase.co/auth/v1/callback` as an authorised
   redirect URI. Note the client ID and secret.
2. **Supabase** — Authentication → Providers → Google: enable, paste the client
   ID and secret. Authentication → URL Configuration: add `http://localhost:8080`
   and the production Vercel URL to the redirect allow list. Anything not on that
   list is rejected, which is the most common way this flow fails.

## Security notes

- `SECRET_KEY` (service role) and `DATABASE_URL` in `.env` are never read by
  the client, never committed, and never printed. Unchanged.
- The anon key remains public by design, but after phase 3 it grants nothing:
  no table grants, and no policy matches it.
- `config.js` stays generated and gitignored. `USER_ID` becomes dead once the
  migration has run and is removed from the generator.
- Every user-authored string is rendered with `textContent`. With a session
  token in `localStorage`, this stops being a hygiene preference and becomes
  the control that protects the session.

## Success criteria

1. A second Google account signing in sees an empty app and cannot observe or
   modify the first account's data — verified by direct PostgREST calls with
   that account's token, not by looking at the UI.
2. The owner's existing logged days are all present after migration, with the
   streak and the calendar unchanged from before.
3. A request with the anon key alone returns no rows.
4. Signed in, aeroplane mode, force-quit, relaunch: the app opens, renders, and
   accepts ticks, which sync when the connection returns.
5. An access token expiring mid-session causes no visible failure and no lost
   tick.
6. `npm test` green; no runtime dependencies added.
