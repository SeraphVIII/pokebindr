-- Master-set tracking migration.
-- Run in Supabase → SQL Editor → New query, AFTER likes_migration.sql.
-- Idempotent: re-running is safe.

-- ─────────────────────────────────────────────────────────────────
-- user_mastering_sets: each row marks a set the user is trying to
-- master (collect every card from). Progress is computed client-side
-- from the user's collection vs. the set's card count, so no count
-- column is stored here.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.user_mastering_sets (
  user_id    uuid not null references auth.users(id) on delete cascade,
  set_id     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, set_id)
);

create index if not exists user_mastering_sets_user_idx
  on public.user_mastering_sets (user_id);

-- RLS: a user can only see / modify their own mastering list.
alter table public.user_mastering_sets enable row level security;

drop policy if exists "mastering own" on public.user_mastering_sets;
create policy "mastering own"
  on public.user_mastering_sets for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
