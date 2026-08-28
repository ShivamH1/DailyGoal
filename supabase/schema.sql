-- v1
-- Already applied to the live project. Kept here as the source of truth and
-- for rebuilding the table from scratch.
-- Replace <USER_ID> with the UUID in .env (it is not secret, but it lives
-- with the secrets, so it is not committed).

create table if not exists daily_progress (
  date       date primary key,
  study      boolean     not null default false,
  workout    boolean     not null default false,
  sleep      boolean     not null default false,
  note       text,
  updated_at timestamptz not null default now(),
  user_id    uuid        not null
);

alter table daily_progress enable row level security;

drop policy if exists single_user on daily_progress;
create policy single_user on daily_progress
  for all
  using      (user_id = '<USER_ID>'::uuid)
  with check (user_id = '<USER_ID>'::uuid);

-- Without this grant PostgREST rejects the anon key before RLS is even
-- consulted. RLS restricts which rows; the grant permits the table at all.
grant select, insert, update, delete on daily_progress to anon;

-- ============================================================
-- v2 — multi-user. Additive; the v1 anon path is dropped in the
-- phase 3 section at the bottom, not here.
-- ============================================================

alter table daily_progress add column if not exists extras jsonb;
alter table daily_progress alter column user_id set default auth.uid();

-- v1 left the primary key as `date` alone, which was correct for one user.
-- Under v2 it means two users cannot both hold a row for the same date —
-- the modal case, since everybody ticks today. Widen it to (user_id, date).
-- user_id is already `not null` above, so it needs no redundant not-null
-- here. The widen is safe by construction, not merely by the data happening
-- to cooperate: the existing PK already makes `date` alone unique, so
-- `(user_id, date)` is unique for any user_id distribution whatsoever — it
-- cannot find a duplicate pair to violate. That holds before Task 7's
-- migration and after it, since the migration rewrites user_id values on
-- existing rows without adding new ones, so it cannot create a duplicate
-- pair either.
--
-- MUST still be applied before Task 7 migrates the owner's rows onto their
-- new account — not because the widen itself is unsafe, but because the
-- collision this whole change fixes is a *second signed-up user ticking
-- today* under the old narrow key, and that can happen the moment a second
-- account exists. PostgREST's schema cache MUST also be reloaded afterwards
-- (see the `notify pgrst` statement below) — the PostgREST docs call out a
-- primary-key change by name as required for upsert to keep working.
--
-- Guarded for re-runnability like the rest of this section, but a plain
-- `if exists`/name check does not work here: Postgres names the primary key
-- constraint `daily_progress_pkey` regardless of which columns are in it, so
-- the name is identical before and after this statement has run. The guard
-- instead asks whether user_id is already a member of the primary key — true
-- only once this has already been applied. The join also pins kcu.table_name
-- to the same table: constraint names are unique per table, not per schema,
-- and key_column_usage also carries foreign-key columns, which reserve no
-- name of their own — without pinning the table, an unrelated FK elsewhere
-- in `public` that happened to reuse the name `daily_progress_pkey` on a
-- user_id column could satisfy this check and silently skip the widen.
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.table_schema = tc.table_schema
     and kcu.table_name = tc.table_name
    where tc.table_schema = 'public'
      and tc.table_name = 'daily_progress'
      and tc.constraint_type = 'PRIMARY KEY'
      and kcu.column_name = 'user_id'
  ) then
    alter table daily_progress drop constraint if exists daily_progress_pkey;
    alter table daily_progress add primary key (user_id, date);
  end if;
end $$;

-- Required after the primary-key change above, or upsert misbehaves
-- regardless of anything in the client — PostgREST docs: "After creating a
-- table or changing its primary key, you must refresh PostgREST schema
-- cache for upsert to work properly." Issued unconditionally: it is cheap
-- and idempotent whether or not the guard above actually ran anything.
notify pgrst, 'reload schema';

drop policy if exists own_rows on daily_progress;
create policy own_rows on daily_progress
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on daily_progress to authenticated;

create table if not exists user_profile (
  user_id    uuid primary key references auth.users on delete cascade default auth.uid(),
  data       jsonb       not null default '{}'::jsonb,
  -- No default. The client always sends this explicitly: now() would stamp
  -- server receipt time, so an edit made offline on Monday and flushed on
  -- Wednesday would outrank a genuinely newer Tuesday edit from another
  -- device. Same rule daily_progress already follows.
  updated_at timestamptz not null
);

create table if not exists user_schedule (
  user_id    uuid primary key references auth.users on delete cascade default auth.uid(),
  week       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null
);

alter table user_profile  enable row level security;
alter table user_schedule enable row level security;

drop policy if exists own_profile on user_profile;
create policy own_profile on user_profile
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_schedule on user_schedule;
create policy own_schedule on user_schedule
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- RLS decides which rows; the grant decides whether the table is reachable
-- at all. Without this PostgREST rejects before RLS is ever consulted —
-- the mistake this project already made once with anon.
grant select, insert, update, delete on user_profile  to authenticated;
grant select, insert, update, delete on user_schedule to authenticated;

-- ============================================================
-- Phase 3 cutover — NOT YET RUN.
--
-- Do not apply this until the project owner's pre-account rows have been
-- migrated (Task 7, blocked on completing Google sign-in setup) and the
-- client authenticates on every request (Tasks 8-9, code-complete as of this
-- commit but not yet exercised against the live project). Applying it first
-- would orphan the owner's existing rows behind a policy that no longer
-- matches anything, with no anon fallback left to read them back out.
-- ============================================================
drop policy if exists single_user on daily_progress;
revoke all on daily_progress from anon;
