-- Atomic position reorder.
-- The unique constraint on (binder_id, position) is DEFERRABLE INITIALLY
-- DEFERRED, so position writes inside ONE transaction can collide
-- intermediately — the constraint is checked at commit. This function
-- batches the writes into one transaction so a "swap A and B" succeeds.
--
-- SECURITY INVOKER means the function runs as the caller, so the existing
-- RLS policies on `collections` enforce ownership automatically.
--
-- Run in: Supabase Dashboard → SQL Editor → New query.

-- DROP first because we changed the return type from void → int.
drop function if exists public.reorder_cards_swap(uuid, uuid[], int[]);

create or replace function public.reorder_cards_swap(
  binder uuid,
  ids uuid[],
  positions int[]
) returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  i int;
  n int;
  affected int := 0;
  delta int;
begin
  if ids is null or positions is null then
    return 0;
  end if;
  n := coalesce(array_length(ids, 1), 0);
  if array_length(positions, 1) <> n then
    raise exception 'ids and positions must be the same length';
  end if;

  for i in 1..n loop
    update public.collections
    set position = positions[i]
    where id = ids[i]
      and binder_id = binder;
    get diagnostics delta = row_count;
    affected := affected + delta;
  end loop;

  return affected;
end;
$$;

grant execute on function public.reorder_cards_swap(uuid, uuid[], int[]) to authenticated;
