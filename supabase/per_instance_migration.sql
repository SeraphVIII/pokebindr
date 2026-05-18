-- Per-instance card rows.
--
-- The original schema treated (user, binder, card_id) as unique with a
-- `quantity` column to track multiple copies. That's incompatible with:
--   - Putting two copies of the same card in two distinct slots.
--   - Tracking different conditions per copy (e.g. one NM + one EX).
--
-- This migration:
--   1. Drops the (user_id, binder_id, card_id) unique constraint.
--   2. Splits any quantity>1 rows into separate rows of quantity=1,
--      appending each new row at the next free position in its binder.
--
-- After this, every row represents one physical card. The `quantity`
-- column stays (default 1) but is effectively unused going forward.
--
-- Run in: Supabase Dashboard → SQL Editor → New query. Idempotent.

alter table public.collections
  drop constraint if exists collections_user_binder_card_unique;

do $$
declare
  r record;
  i int;
  next_pos int;
begin
  for r in
    select * from public.collections where quantity > 1
  loop
    -- Normalise the original row to qty=1.
    update public.collections set quantity = 1 where id = r.id;

    for i in 2..r.quantity loop
      select coalesce(max(position), -1) + 1 into next_pos
      from public.collections
      where binder_id = r.binder_id;

      insert into public.collections (
        user_id, binder_id, card_id, card_name, set_id, set_name,
        card_number, rarity, card_type, image_small, image_large,
        status, quantity, condition, notes, last_price_eur,
        price_checked_at, position
      ) values (
        r.user_id, r.binder_id, r.card_id, r.card_name, r.set_id, r.set_name,
        r.card_number, r.rarity, r.card_type, r.image_small, r.image_large,
        r.status, 1, r.condition, r.notes, r.last_price_eur,
        r.price_checked_at, next_pos
      );
    end loop;
  end loop;
end $$;
