-- Visibility + sharing migration.
-- Run in Supabase → SQL Editor → New query, AFTER binders_migration.sql.
-- Idempotent: re-running is safe.

-- ─────────────────────────────────────────────────────────────────
-- profiles: public-facing info per auth user (username, etc.)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format
    check (
      username is null
      or (username ~ '^[a-z0-9_-]{3,24}$')
    )
);

create index if not exists profiles_username_idx
  on public.profiles (username) where username is not null;

-- Auto-create an empty profile when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users who signed up before this migration.
insert into public.profiles (user_id)
select id from auth.users
on conflict do nothing;

-- Profiles RLS: usernames are public-readable; only owner edits own.
alter table public.profiles enable row level security;

drop policy if exists "profiles read"       on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;

create policy "profiles read"       on public.profiles for select using (true);
create policy "profiles insert own" on public.profiles for insert with check (user_id = auth.uid());
create policy "profiles update own" on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- binders: visibility + share_token
-- ─────────────────────────────────────────────────────────────────
alter table public.binders
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'unlisted', 'public'));

alter table public.binders
  add column if not exists share_token text;

create unique index if not exists binders_share_token_uniq
  on public.binders (share_token) where share_token is not null;

-- Auto-generate share_token the first time visibility flips off 'private'.
create or replace function public.ensure_binder_share_token()
returns trigger language plpgsql as $$
begin
  if new.visibility != 'private' and new.share_token is null then
    new.share_token := encode(gen_random_bytes(12), 'hex');
  end if;
  return new;
end $$;

drop trigger if exists binders_share_token on public.binders;
create trigger binders_share_token
  before insert or update on public.binders
  for each row execute function public.ensure_binder_share_token();

-- ─────────────────────────────────────────────────────────────────
-- RLS: open read access for non-private binders (and their pages/cards)
-- so other users can view them. Writes still owner-only.
-- ─────────────────────────────────────────────────────────────────
drop policy if exists "binders own"    on public.binders;
drop policy if exists "binders read"   on public.binders;
drop policy if exists "binders write"  on public.binders;
drop policy if exists "binders insert" on public.binders;
drop policy if exists "binders update" on public.binders;
drop policy if exists "binders delete" on public.binders;

create policy "binders read"
  on public.binders for select
  using (auth.uid() = user_id or visibility != 'private');

create policy "binders insert"
  on public.binders for insert
  with check (auth.uid() = user_id);

create policy "binders update"
  on public.binders for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "binders delete"
  on public.binders for delete
  using (auth.uid() = user_id);

-- binder_pages: read if owner OR parent binder is non-private.
drop policy if exists "binder pages own"    on public.binder_pages;
drop policy if exists "binder pages read"   on public.binder_pages;
drop policy if exists "binder pages write"  on public.binder_pages;
drop policy if exists "binder pages insert" on public.binder_pages;
drop policy if exists "binder pages update" on public.binder_pages;
drop policy if exists "binder pages delete" on public.binder_pages;

create policy "binder pages read"
  on public.binder_pages for select
  using (exists (
    select 1 from public.binders b
    where b.id = binder_pages.binder_id
      and (b.user_id = auth.uid() or b.visibility != 'private')
  ));

create policy "binder pages write"
  on public.binder_pages for all
  using (exists (
    select 1 from public.binders b
    where b.id = binder_pages.binder_id and b.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.binders b
    where b.id = binder_pages.binder_id and b.user_id = auth.uid()
  ));

-- collections: cards inside a non-private binder become publicly readable.
-- Writes still owner-only.
drop policy if exists "select own collection" on public.collections;
drop policy if exists "insert own collection" on public.collections;
drop policy if exists "update own collection" on public.collections;
drop policy if exists "delete own collection" on public.collections;
drop policy if exists "collections read"      on public.collections;

create policy "collections read"
  on public.collections for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.binders b
      where b.id = collections.binder_id and b.visibility != 'private'
    )
  );

create policy "collections insert"
  on public.collections for insert
  with check (auth.uid() = user_id);

create policy "collections update"
  on public.collections for update
  using (auth.uid() = user_id);

create policy "collections delete"
  on public.collections for delete
  using (auth.uid() = user_id);
