-- Tira cloud schema (Supabase / Postgres)
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement is idempotent.

-- ────────────────────────────────────────────────────────────
-- Customers: one row per signed-in Google user
-- ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  full_name     text,
  given_name    text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- Each customer's Tira data. One row per engine table:
--   appointments | shopping | todo | users (name, list style, ride contacts)
-- `data` is the table's JSON as stored on the phone.
-- ────────────────────────────────────────────────────────────
create table if not exists public.user_data (
  user_id     uuid not null references auth.users (id) on delete cascade,
  table_name  text not null check (table_name in ('appointments', 'shopping', 'todo', 'users')),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, table_name)
);

-- ────────────────────────────────────────────────────────────
-- Row-level security: a customer can only see and change their own rows
-- ────────────────────────────────────────────────────────────
alter table public.profiles  enable row level security;
alter table public.user_data enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: read own"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: insert own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles: update own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "user_data: read own"   on public.user_data;
drop policy if exists "user_data: insert own" on public.user_data;
drop policy if exists "user_data: update own" on public.user_data;
drop policy if exists "user_data: delete own" on public.user_data;
create policy "user_data: read own"   on public.user_data for select using (auth.uid() = user_id);
create policy "user_data: insert own" on public.user_data for insert with check (auth.uid() = user_id);
create policy "user_data: update own" on public.user_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_data: delete own" on public.user_data for delete using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- In-app "Delete my account" (required by Google Play for apps with sign-in).
-- Deletes the auth user; profiles and user_data cascade.
-- ────────────────────────────────────────────────────────────
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
