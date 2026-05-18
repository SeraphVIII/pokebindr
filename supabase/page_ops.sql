-- Page operations: delete a page (shifting later pages + card positions up)
-- and swap two adjacent pages.
--
-- Run in: Supabase Dashboard → SQL Editor → New query. Idempotent.

-- ─────────────────────────────────────────────────────────────────
-- delete_binder_page(page_id)
--   Removes a page. Errors if the page has cards on it. Subsequent
--   pages' page_index and their cards' positions are shifted up by 1
--   page (slotsPerPage slots) so things stay contiguous.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.delete_binder_page(
  page_id uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  bid uuid;
  idx int;
  slots int;
begin
  select p.binder_id, p.page_index, b.grid_cols * b.grid_rows
  into bid, idx, slots
  from public.binder_pages p
  join public.binders b on b.id = p.binder_id
  where p.id = page_id;

  if bid is null then
    raise exception 'page not found';
  end if;

  -- Refuse if the page being deleted has cards on it.
  if exists (
    select 1 from public.collections
    where binder_id = bid
      and position >= idx * slots
      and position <  (idx + 1) * slots
  ) then
    raise exception 'page has cards on it';
  end if;

  -- Delete the page row.
  delete from public.binder_pages where id = page_id;

  -- Shift later page rows down by 1 (process highest first to avoid the
  -- unique(binder_id, page_index) collision).
  update public.binder_pages
  set page_index = page_index - 1
  where binder_id = bid and page_index > idx;

  -- Shift cards on later pages up by `slots` so positions stay aligned
  -- with the new page indexes. (positions unique constraint is deferrable.)
  update public.collections
  set position = position - slots
  where binder_id = bid and position >= (idx + 1) * slots;
end;
$$;

grant execute on function public.delete_binder_page(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- swap_binder_pages(binder, idx_a, idx_b)
--   Swaps two pages' titles AND their card positions. Parks the moved
--   page metadata at page_index = 1_000_000 (above any real page count
--   but ≥ 0, so the check constraint is happy) while the swap runs.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.swap_binder_pages(
  binder uuid,
  idx_a int,
  idx_b int
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  slots int;
begin
  if idx_a = idx_b then
    return;
  end if;

  select b.grid_cols * b.grid_rows
  into slots
  from public.binders b
  where b.id = binder;

  if slots is null then
    raise exception 'binder not found';
  end if;

  -- Swap page metadata: A → 1000000 placeholder, B → A, 1000000 → B.
  update public.binder_pages set page_index = 1000000
    where binder_id = binder and page_index = idx_a;
  update public.binder_pages set page_index = idx_a
    where binder_id = binder and page_index = idx_b;
  update public.binder_pages set page_index = idx_b
    where binder_id = binder and page_index = 1000000;

  -- Swap card positions. We use a negative-offset placeholder so the
  -- deferred unique constraint on (binder_id, position) has nothing to
  -- complain about mid-sequence.
  -- 1. Cards on page A → temporary negative range.
  update public.collections
  set position = position - (idx_a * slots) - (slots * 1000)
  where binder_id = binder
    and position >= idx_a * slots
    and position <  (idx_a + 1) * slots;

  -- 2. Cards on page B → page A's range.
  update public.collections
  set position = position - (idx_b - idx_a) * slots
  where binder_id = binder
    and position >= idx_b * slots
    and position <  (idx_b + 1) * slots;

  -- 3. Cards from temp → page B's range.
  update public.collections
  set position = position + (idx_b * slots) + (slots * 1000)
  where binder_id = binder
    and position < 0;
end;
$$;

grant execute on function public.swap_binder_pages(uuid, int, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- reorder_binder_page(binder, page_id, new_index)
--   Moves one page to a new index, shifting every page in between
--   by one slot in the appropriate direction (insert/splice semantics,
--   NOT swap). Cards on every affected page have their `position`
--   updated to follow the page they live on. Atomic via the parking
--   trick the swap function uses.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.reorder_binder_page(
  binder uuid,
  page_id uuid,
  new_index int
) returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  src_index int;
  slots int;
  total int;
  i int;
begin
  select page_index into src_index
  from public.binder_pages
  where id = page_id and binder_id = binder;
  if src_index is null then
    return 0;
  end if;

  select count(*) into total
  from public.binder_pages
  where binder_id = binder;

  if new_index < 0 then new_index := 0; end if;
  if new_index >= total then new_index := total - 1; end if;
  if src_index = new_index then return 0; end if;

  select b.grid_cols * b.grid_rows into slots
  from public.binders b
  where b.id = binder;
  if slots is null then
    raise exception 'binder not found';
  end if;

  -- Park moved page metadata at 1_000_000 (above any real page count but
  -- still ≥ 0 to satisfy the check constraint on page_index) and its
  -- cards at safe negative positions so the shift step below has
  -- nothing to collide with.
  update public.binder_pages
  set page_index = 1000000
  where id = page_id;

  update public.collections
  set position = position - (src_index * slots) - (slots * 1000)
  where binder_id = binder
    and position >= src_index * slots
    and position <  (src_index + 1) * slots;

  if src_index < new_index then
    -- Moving down: pages (src, new] shift down one slot.
    -- The (binder_id, page_index) unique constraint is checked per row
    -- (not deferrable), so a single bulk UPDATE can collide mid-statement.
    -- Walk the range lowest-first so each row moves into the slot the
    -- previous iteration just vacated.
    for i in (src_index + 1) .. new_index loop
      update public.binder_pages
      set page_index = i - 1
      where binder_id = binder and page_index = i;
    end loop;
    update public.collections
    set position = position - slots
    where binder_id = binder
      and position >= (src_index + 1) * slots
      and position <  (new_index + 1) * slots;
  else
    -- Moving up: pages [new, src) shift up one slot. Highest-first.
    for i in reverse (src_index - 1) .. new_index loop
      update public.binder_pages
      set page_index = i + 1
      where binder_id = binder and page_index = i;
    end loop;
    update public.collections
    set position = position + slots
    where binder_id = binder
      and position >= new_index * slots
      and position <  src_index * slots;
  end if;

  -- Unpark the moved page + cards into the destination slot.
  update public.binder_pages
  set page_index = new_index
  where id = page_id;

  update public.collections
  set position = position + (new_index * slots) + (slots * 1000)
  where binder_id = binder
    and position < 0;

  return 1;
end;
$$;

grant execute on function public.reorder_binder_page(uuid, uuid, int) to authenticated;
