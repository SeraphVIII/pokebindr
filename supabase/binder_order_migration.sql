-- Binder ordering migration.
-- Run in Supabase → SQL Editor → New query, AFTER bulk_binder_migration.sql.
-- Idempotent: re-running is safe.
--
-- Adds a `position` column on binders so users can drag-reorder their
-- binder list. Existing rows are backfilled by created_at order so the
-- visible order doesn't change on first run.

alter table public.binders
  add column if not exists position int;

-- Backfill positions per user, in current created_at order.
do $$
declare
  u uuid;
  r record;
  pos int;
begin
  for u in select distinct user_id from public.binders where position is null loop
    pos := 0;
    for r in
      select id from public.binders
      where user_id = u and position is null
      order by created_at, id
    loop
      update public.binders set position = pos where id = r.id;
      pos := pos + 1;
    end loop;
  end loop;
end $$;

-- Set NOT NULL + default for future inserts. New binders go to the end;
-- the app keeps positions contiguous via the reorder RPC, but we tolerate
-- gaps and ties — the ORDER BY in useBinders is (position, created_at).
alter table public.binders
  alter column position set default 0;
alter table public.binders
  alter column position set not null;

create index if not exists binders_user_position_idx
  on public.binders (user_id, position);
