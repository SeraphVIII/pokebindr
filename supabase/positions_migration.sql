-- Position migration — gives each card a stable slot index within its binder,
-- so drag-and-drop has something to write back.
-- Run after binders_migration.sql. Idempotent.

-- 1. Add the column (nullable so we can backfill).
alter table public.collections
  add column if not exists position int;

-- 2. Backfill: every card gets a position within its binder, ordered by
--    added_at asc (oldest first → page 1 slot 0).
do $$
begin
  if exists (select 1 from public.collections where position is null) then
    update public.collections c
    set position = ranked.rn - 1
    from (
      select id, row_number() over (
        partition by binder_id order by added_at asc, id asc
      ) as rn
      from public.collections
    ) ranked
    where c.id = ranked.id and c.position is null;
  end if;
end $$;

-- 3. Make it non-null. New rows MUST set their own position (the client
--    computes "next available" in useUpsertCard).
alter table public.collections
  alter column position set not null;

-- 4. Unique within a binder so two cards can't share a slot.
alter table public.collections
  drop constraint if exists collections_binder_position_unique;
alter table public.collections
  add constraint collections_binder_position_unique
  unique (binder_id, position) deferrable initially deferred;

-- The deferrable bit matters: a drag-and-drop reorder writes multiple rows
-- in one transaction, and intermediate states will temporarily collide.

create index if not exists collections_binder_position_idx
  on public.collections (binder_id, position);
