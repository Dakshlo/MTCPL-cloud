-- 231: typing the paper register in, a page at a time (Daksh, Oct 2026).
--
-- The team rejected per-person entry at the cupboard: "it will not be
-- possible that every person will do entry of what they took. What they
-- want is, they already enter all stock which they take in a register,
-- so we can make a thing where a person will just enter the whole
-- physical register into the software."
--
-- They are right. A tool crib dies the moment it adds a step at the
-- wardrobe. The register already works and people already sign it, so
-- the cheapest change is to leave the cupboard alone and let one person
-- — whose job is already this kind of entry — type the page in.
--
-- Each vendor keeps a SEPARATE register, so a page belongs to exactly
-- one vendor. That is why the batch carries the vendor and the lines do
-- not: the typist chooses whose register once, at the top.
--
-- Two things this needs that the table did not have:
--
--   occurred_on — the date written on the register LINE, not the date
--     somebody typed it. Without this every page collapses onto the day
--     it was entered and "when was it taken" is lost, which is one of
--     the three things the team asked for.
--
--   register_batch_id — so a page typed wrongly can be taken back as a
--     page. Undoing 30 lines one by one is not a real option.
--
-- Stock is unaffected: it is still SUM(delta) over live movements, and
-- neither new column takes part in that sum.
--
-- Safety: one new table and two new nullable columns. Existing rows get
-- occurred_on back-filled from their own created_at, so every row that
-- predates this migration keeps a sensible date instead of a null.

begin;

-- ── One page of one vendor's register ──────────────────────────────
create table if not exists public.cnc_tool_register_batches (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id),
  -- the date written at the top of the page; individual lines may
  -- differ and carry their own date in cnc_tool_movements.occurred_on
  register_date date not null,
  entered_by    uuid references public.profiles(id),
  entered_at    timestamptz not null default now(),
  line_count    integer not null default 0,
  note          text,
  undone_at     timestamptz,
  undone_by     uuid references public.profiles(id),
  constraint cnc_tool_register_batches_undo_pair
    check ((undone_at is null) = (undone_by is null)),
  constraint cnc_tool_register_batches_note_len
    check (note is null or length(note) <= 300)
);

create index if not exists idx_cnc_tool_batches_vendor
  on public.cnc_tool_register_batches (vendor_id, register_date desc);

-- ── Movement columns ───────────────────────────────────────────────
alter table public.cnc_tool_movements
  add column if not exists occurred_on date,
  add column if not exists register_batch_id uuid references public.cnc_tool_register_batches(id);

-- Every existing row keeps a date: the day it was recorded, which for
-- rows entered live IS the day it happened.
update public.cnc_tool_movements
   set occurred_on = (created_at at time zone 'Asia/Kolkata')::date
 where occurred_on is null;

create index if not exists idx_cnc_tool_moves_occurred
  on public.cnc_tool_movements (occurred_on desc);
create index if not exists idx_cnc_tool_moves_batch
  on public.cnc_tool_movements (register_batch_id)
  where register_batch_id is not null;

-- A line typed in from a register is a take, like a line on the paper
-- is. Nothing else may be back-dated in through this door.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cnc_tool_movements_batch_issue_only'
  ) then
    alter table public.cnc_tool_movements
      add constraint cnc_tool_movements_batch_issue_only
      check (register_batch_id is null or kind = 'issue');
  end if;
end $$;

-- Service-role only, same posture as the rest of this module.
alter table public.cnc_tool_register_batches enable row level security;

notify pgrst, 'reload schema';

commit;

-- ROLLBACK
-- begin;
-- alter table public.cnc_tool_movements
--   drop constraint if exists cnc_tool_movements_batch_issue_only;
-- drop index if exists public.idx_cnc_tool_moves_batch;
-- drop index if exists public.idx_cnc_tool_moves_occurred;
-- alter table public.cnc_tool_movements
--   drop column if exists register_batch_id,
--   drop column if exists occurred_on;
-- drop table if exists public.cnc_tool_register_batches;
-- notify pgrst, 'reload schema';
-- commit;
