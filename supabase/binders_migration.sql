-- Binders feature migration.
-- Run this in Supabase → SQL Editor → New query, AFTER schema.sql.
-- Idempotent: re-running is safe.

-- ─────────────────────────────────────────────────────────────────
-- binders: a named container with a configurable grid size.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.binders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  grid_cols   int  not null default 3 check (grid_cols between 1 and 6),
  grid_rows   int  not null default 3 check (grid_rows between 1 and 6),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists binders_user_idx on public.binders (user_id);

-- ─────────────────────────────────────────────────────────────────
-- binder_pages: one row per page in a binder. Optional title.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.binder_pages (
  id          uuid primary key default gen_random_uuid(),
  binder_id   uuid not null references public.binders(id) on delete cascade,
  page_index  int  not null check (page_index >= 0),
  title       text,
  created_at  timestamptz not null default now(),
  unique (binder_id, page_index)
);

create index if not exists binder_pages_binder_idx on public.binder_pages (binder_id);

-- ─────────────────────────────────────────────────────────────────
-- collections: now belongs to a binder.
-- Same card can live in multiple binders (different rows).
-- quantity tracks duplicate copies within the same binder.
-- ─────────────────────────────────────────────────────────────────
alter table public.collections
  add column if not exists binder_id uuid references public.binders(id) on delete cascade;

-- Backfill: any existing rows without a binder get a "My Collection" default.
do $$
declare
  u record;
  bid uuid;
begin
  for u in
    select distinct user_id
    from public.collections
    where binder_id is null
  loop
    insert into public.binders (user_id, name)
    values (u.user_id, 'My Collection')
    returning id into bid;

    insert into public.binder_pages (binder_id, page_index)
    values (bid, 0);

    update public.collections
    set binder_id = bid
    where user_id = u.user_id and binder_id is null;
  end loop;
end $$;

-- Now require binder_id on every row.
alter table public.collections
  alter column binder_id set not null;

-- Drop the old (user_id, card_id) unique constraint and replace with
-- (user_id, binder_id, card_id) so the same card can live in multiple binders.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.collections'::regclass
      and contype = 'u'
      and conname like '%user_id%card_id%'
  loop
    execute 'alter table public.collections drop constraint ' || quote_ident(c.conname);
  end loop;
end $$;

alter table public.collections
  drop constraint if exists collections_user_binder_card_unique;
alter table public.collections
  add constraint collections_user_binder_card_unique
  unique (user_id, binder_id, card_id);

create index if not exists collections_binder_idx
  on public.collections (binder_id);

-- ─────────────────────────────────────────────────────────────────
-- RLS for the new tables.
-- ─────────────────────────────────────────────────────────────────
alter table public.binders enable row level security;
alter table public.binder_pages enable row level security;

drop policy if exists "binders own" on public.binders;
create policy "binders own"
  on public.binders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "binder pages own" on public.binder_pages;
create policy "binder pages own"
  on public.binder_pages for all
  using (exists (
    select 1 from public.binders b
    where b.id = binder_pages.binder_id and b.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.binders b
    where b.id = binder_pages.binder_id and b.user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────────────────────
-- updated_at trigger for binders (reuses public.set_updated_at).
-- ─────────────────────────────────────────────────────────────────
drop trigger if exists binders_updated_at on public.binders;
create trigger binders_updated_at
  before update on public.binders
  for each row execute function public.set_updated_at();
