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
