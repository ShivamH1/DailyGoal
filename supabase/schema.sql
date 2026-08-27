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
