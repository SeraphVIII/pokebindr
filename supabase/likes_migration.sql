-- Likes migration.
-- Run in Supabase → SQL Editor → New query, AFTER visibility_migration.sql.
-- Idempotent: re-running is safe.

-- ─────────────────────────────────────────────────────────────────
-- binder_likes: one row per (binder, user) like.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.binder_likes (
  binder_id  uuid not null references public.binders(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (binder_id, user_id)
);

create index if not exists binder_likes_binder_idx on public.binder_likes (binder_id);
create index if not exists binder_likes_user_idx   on public.binder_likes (user_id);

-- ─────────────────────────────────────────────────────────────────
-- Cached count on binders so list views render without a join.
-- ─────────────────────────────────────────────────────────────────
alter table public.binders
  add column if not exists likes_count int not null default 0;

-- SECURITY DEFINER so the trigger can update binders.likes_count regardless
-- of who's liking the binder. Without this, RLS ("binders update" — owner
-- only) silently blocks the count bump when a non-owner likes the binder
-- and the row counter never moves.
create or replace function public.bump_binder_likes_count()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    update public.binders
      set likes_count = likes_count + 1
      where id = new.binder_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.binders
      set likes_count = greatest(likes_count - 1, 0)
      where id = old.binder_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists binder_likes_count on public.binder_likes;
create trigger binder_likes_count
  after insert or delete on public.binder_likes
  for each row execute function public.bump_binder_likes_count();

-- Backfill counts so the cached column is consistent if the table existed
-- with rows already.
update public.binders b
set likes_count = coalesce((
  select count(*) from public.binder_likes l where l.binder_id = b.id
), 0);

-- ─────────────────────────────────────────────────────────────────
-- RLS: anyone can read likes; only authed users can like/unlike own.
-- ─────────────────────────────────────────────────────────────────
alter table public.binder_likes enable row level security;

drop policy if exists "likes read"   on public.binder_likes;
drop policy if exists "likes insert" on public.binder_likes;
drop policy if exists "likes delete" on public.binder_likes;

create policy "likes read"
  on public.binder_likes for select
  using (true);

-- A user can only like binders they're allowed to see (non-private or own).
create policy "likes insert"
  on public.binder_likes for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.binders b
      where b.id = binder_likes.binder_id
        and (b.user_id = auth.uid() or b.visibility != 'private')
    )
  );

create policy "likes delete"
  on public.binder_likes for delete
  using (user_id = auth.uid());
