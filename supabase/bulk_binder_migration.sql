-- Bulk binder migration.
-- Run in Supabase → SQL Editor → New query, AFTER mastering_migration.sql.
-- Idempotent: re-running is safe.
--
-- Adds a per-user "Bulk" pseudo-binder for cards the user owns but
-- doesn't want sorted into a curated binder (e.g. commons collected
-- toward mastering a set). Master-set progress already aggregates by
-- (user_id, set_id), so the bulk binder counts toward completion just
-- like any other binder — its only special property is the is_bulk
-- flag, which lets the UI mark it visually and pick it as the default
-- destination for one-tap "I own this" actions.

alter table public.binders
  add column if not exists is_bulk boolean not null default false;

-- Enforce at most one bulk binder per user.
create unique index if not exists binders_one_bulk_per_user
  on public.binders (user_id) where is_bulk = true;
