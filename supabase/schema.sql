-- Pokémon Tracker — Supabase schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- It's idempotent (uses `if not exists` where possible).

-- ─────────────────────────────────────────────────────────────────
-- collections: one row per (user, card) pair the user is tracking
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.collections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- Identity from PokemonTCG.io. We never store our own card catalogue;
  -- card data is fetched fresh and cached client-side. The denormalized
  -- fields below are just enough to render lists offline.
  card_id       text not null,         -- e.g. "base1-4" (Charizard)
  card_name     text not null,
  set_id        text not null,
  set_name      text not null,
  card_number   text not null,         -- "4/102"
  rarity        text,                  -- "Rare Holo"
  card_type     text,                  -- "Fire" (first type only)
  image_small   text,
  image_large   text,

  -- Tracker state
  status        text not null check (status in ('have','want','really')),
  quantity      int  not null default 1 check (quantity >= 0),
  condition     text not null default 'NM',   -- NM/EX/GD/LP/MP/HP
  notes         text,

  -- Last seen market price (EU, €) — keep here so we can sort/sum without
  -- re-fetching every card. Update on lookup and on detail view.
  last_price_eur numeric(10,2),
  price_checked_at timestamptz,

  added_at      timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (user_id, card_id)
);

create index if not exists collections_user_idx
  on public.collections (user_id);
create index if not exists collections_user_status_idx
  on public.collections (user_id, status);
create index if not exists collections_user_set_idx
  on public.collections (user_id, set_id);

-- ─────────────────────────────────────────────────────────────────
-- price_snapshots: optional history table.
-- A daily Edge Function can append rows here so the detail screen can
-- render a real chart instead of "last seen" only. Empty for v1.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.price_snapshots (
  card_id   text not null,
  taken_at  date not null,
  price_eur numeric(10,2) not null,
  source    text not null default 'cardmarket',
  primary key (card_id, taken_at, source)
);

-- ─────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists collections_updated_at on public.collections;
create trigger collections_updated_at
  before update on public.collections
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- Row Level Security — users only see/edit their own rows
-- ─────────────────────────────────────────────────────────────────
alter table public.collections enable row level security;

drop policy if exists "select own collection"  on public.collections;
drop policy if exists "insert own collection"  on public.collections;
drop policy if exists "update own collection"  on public.collections;
drop policy if exists "delete own collection"  on public.collections;

create policy "select own collection"
  on public.collections for select
  using (auth.uid() = user_id);

create policy "insert own collection"
  on public.collections for insert
  with check (auth.uid() = user_id);

create policy "update own collection"
  on public.collections for update
  using (auth.uid() = user_id);

create policy "delete own collection"
  on public.collections for delete
  using (auth.uid() = user_id);

-- price_snapshots is read-only-public; only edge functions can write.
alter table public.price_snapshots enable row level security;

drop policy if exists "snapshots readable" on public.price_snapshots;
create policy "snapshots readable"
  on public.price_snapshots for select
  using (true);
