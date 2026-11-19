-- ──────────────────────────────────────────────────────────────────
-- Migration 238 — a tool in a man's hands, and the machine it died on
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh, Nov 2026: "user will come, they took some tool eg tool no 1,
-- and took 5 pcs and took 5 pcs of other tool. These tools will show in
-- that user account — eg Mohit took 5 pcs of some tool, then this 5 pcs
-- will show in his account. Now we have to connect this with our CNC.
-- He will then do 1 pcs used in CNC no 14. This way we will have CNC
-- wise consumption too."
--
-- ── This reverses a decision mig 228 wrote down ────────────────────
--
-- 228 said, in his words at the time: "there is no return thing, they
-- take the tool and it gets used." So it recorded a take as the END of
-- the story — "a vendor's screen is a LOG of what they took, not a
-- balance of what they hold, and nothing in the schema pretends to
-- track custody."
--
-- That is the sentence this migration deletes. A take is now the MIDDLE
-- of the story. A tool leaves the shelf, sits in somebody's hands for a
-- day or a week, and then one of two things happens to it: it is spent
-- on a machine, or it comes back. Until then it is nowhere — which is
-- exactly the hole he is pointing at, because a 450mm bit in Mohit's
-- pocket is neither in stock nor consumed, and the old model had to
-- call it consumed the moment he signed for it.
--
-- Nothing about the SHELF changes. Stock is still SUM(delta) over
-- cnc_tool_movements, and this migration adds no movement kinds and
-- alters no existing row. What it adds is a SECOND question the same
-- ledger can now answer: not "what is on the shelf" but "where did the
-- things that left it go".
--
-- ── Three places a tool can be ─────────────────────────────────────
--
--   on the shelf   stock(tool)            = SUM(movements.delta)
--   in his hands   holding(person, tool)  = taken − returned − used
--   spent          used(machine, tool)    = SUM(usage.qty)
--
-- The second line is why usage is NOT a movement. An 'issue' already
-- took the tool off the shelf; spending it must not take it off twice.
-- Put as a movement with a delta it would corrupt stock, and put as a
-- movement with delta = 0 it would break the one CHECK that makes the
-- ledger meaningful (delta <> 0). It is a different ledger about a
-- different thing, so it gets its own table.
--
-- ── Why usage must name a person, not just a machine ───────────────
--
-- The tempting shape is (machine, tool, qty) — the report he asked for,
-- stored directly. It is wrong, and the reason is the only invariant
-- this module has: a thing spent on a machine must come out of somebody's
-- hands. Without the person, usage and custody are two unrelated piles
-- of numbers that drift apart within a week, and nothing can be checked.
-- With the person, every pc is accounted for from the shelf to the
-- spindle, and the database can refuse a man who reports using more than
-- he ever took.
--
-- So used_by is mandatory and is exactly one of profile / operator —
-- the same two kinds of signer mig 234 established, for the same reason:
-- there is one login per vendor company and the man who walks off with
-- the bit is usually not it.
--
-- ── The job gets recorded for free ─────────────────────────────────
--
-- cnc_machines.current_carving_item_id already says what each machine is
-- carving right now. The man reporting "1 pc on 14" is not going to pick
-- a job from a list, and should not have to — so the function below
-- snapshots whatever 14 was carving at that moment. Nobody is asked a
-- question, and the day somebody wants tool cost per component the data
-- is already there instead of starting from zero.
--
-- ── Safety ─────────────────────────────────────────────────────────
--
-- Additive. One new table, one new view, one new function. No existing
-- table, column, constraint, policy or row is touched, so every number
-- on every existing screen is bit-for-bit what it was. The 11 live takes
-- already in the ledger simply become 11 things men are holding, which
-- is what they are.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.cnc_tool_settle_held(uuid,text,numeric,uuid,uuid,uuid,text,uuid,text,uuid,uuid);
--   DROP VIEW  IF EXISTS public.cnc_tool_holdings;
--   DROP TABLE IF EXISTS public.cnc_tool_usage;
-- ──────────────────────────────────────────────────────────────────

begin;

-- ── 1. What was spent, and where ──────────────────────────────────

create table if not exists public.cnc_tool_usage (
  id          uuid primary key default gen_random_uuid(),
  tool_id     uuid not null references public.cnc_tools(id) on delete restrict,
  -- The CNC it went into. RESTRICT rather than CASCADE: a machine that
  -- is sold still has a year of consumption filed against it, and
  -- deleting the row would silently rewrite last year's costing.
  machine_id  uuid not null references public.cnc_machines(id) on delete restrict,
  qty         numeric(12,2) not null check (qty > 0),

  -- Whose hands it came out of. Exactly one, never neither — see the
  -- header: this is the invariant the whole module rests on.
  used_by_profile_id  uuid references public.profiles(id) on delete restrict,
  used_by_operator_id uuid references public.cnc_tool_operators(id) on delete restrict,
  -- The readable name, kept on the row the way cnc_tool_movements.taken_by
  -- is: every screen shows it, and it must survive a man being removed.
  used_by     text not null
                check (length(btrim(used_by)) > 0 and length(used_by) <= 60),
  -- The company it was for, same meaning as on a movement. Null for the
  -- office three, who have no firm of their own.
  vendor_id   uuid references public.vendors(id) on delete restrict,

  -- Snapshot, not a live pointer. What this machine happened to be
  -- carving when the tool was spent on it. Mig 236's lesson about
  -- cnc_machine_id being cleared on unload applies: a pointer that moves
  -- is no use to a report about the past, so this one is written once
  -- and never updated.
  carving_item_id uuid references public.carving_items(id) on delete set null,

  note        text check (note is null or length(note) <= 300),
  entered_by  uuid references public.profiles(id) on delete set null,
  guest_link_id uuid references public.cnc_tool_store_links(id) on delete set null,
  created_at  timestamptz not null default now(),

  -- Same ten-minute soft void as the register (mig 227). A wrong machine
  -- number is the easy mistake here and it lands straight in a costing
  -- report, so it has to be takeable back — and, like a movement, the
  -- line stays visible with a stroke through it rather than vanishing.
  --
  -- TWO undoer columns, unlike cnc_tool_movements, which has one. There
  -- the undo only ever happens in the office, where everybody has a
  -- profile. Here it happens on the man's own phone, and an operator has
  -- no profile at all (mig 234) — so a single profiles column would mean
  -- an operator's undo wrote undone_at with no undoer beside it and the
  -- pair CHECK below would refuse the one undo this screen exists for.
  undone_at   timestamptz,
  undone_by   uuid references public.profiles(id) on delete set null,
  undone_by_operator_id uuid references public.cnc_tool_operators(id) on delete set null,

  constraint cnc_tool_usage_one_user check (
    (used_by_profile_id is not null) <> (used_by_operator_id is not null)
  ),
  -- Undone rows carry a mark and an undoer, or neither of each.
  constraint cnc_tool_usage_undo_pair check (
    (undone_at is null) = (undone_by is null and undone_by_operator_id is null)
  ),
  constraint cnc_tool_usage_one_undoer check (
    undone_by is null or undone_by_operator_id is null
  )
);

comment on table public.cnc_tool_usage is
  'Mig 238 — a tool SPENT on a CNC. Not a movement: the issue already took '
  'it off the shelf, so this never changes stock. It moves a pc from a '
  'man''s hands to a machine, which is what makes machine-wise consumption '
  'possible. Written only by cnc_tool_settle_held().';
comment on column public.cnc_tool_usage.carving_item_id is
  'Mig 238 — snapshot of what the machine was carving at that moment, taken '
  'from cnc_machines.current_carving_item_id. Never updated afterwards.';

-- The consumption report: one machine, a date window.
create index if not exists cnc_tool_usage_machine_idx
  on public.cnc_tool_usage (machine_id, created_at desc)
  where undone_at is null;

-- The custody view, and "where did this tool go".
create index if not exists cnc_tool_usage_tool_idx
  on public.cnc_tool_usage (tool_id, created_at desc)
  where undone_at is null;

-- One man's account.
create index if not exists cnc_tool_usage_person_idx
  on public.cnc_tool_usage (used_by_profile_id, used_by_operator_id, tool_id)
  where undone_at is null;

-- The whole log, newest first (undone rows included — they stay on
-- screen, struck through).
create index if not exists cnc_tool_usage_recent_idx
  on public.cnc_tool_usage (created_at desc);

-- House posture: RLS on, one read policy for authenticated, no write
-- policies at all. Every write goes through the function below on the
-- service-role client, which is where the rules live.
alter table public.cnc_tool_usage enable row level security;
drop policy if exists cnc_tool_usage_read_all on public.cnc_tool_usage;
create policy cnc_tool_usage_read_all
  on public.cnc_tool_usage for select to authenticated using (true);

-- ── 2. What each man is holding ───────────────────────────────────
--
-- ONE definition of custody, in SQL, used by both the guard below and
-- every screen. Written twice — once here and once in TypeScript — it
-- would drift, and the two halves disagreeing is the one failure that
-- would let a man report using a tool he does not have.
--
-- A take and a return share a branch on purpose: an issue carries a
-- NEGATIVE delta and a return a positive one, so -delta is "+what he
-- took, −what he gave back" in a single expression.
--
-- 'scrap' and 'adjust' are deliberately absent. Both are things the
-- KEEPER does to the shelf; neither passes through anybody's hands.

create or replace view public.cnc_tool_holdings
with (security_invoker = true)
as
select
  tool_id,
  profile_id,
  operator_id,
  sum(qty)::numeric(14,2) as qty
from (
  -- taken (+) and given back (−)
  select
    m.tool_id,
    m.taken_by_profile_id  as profile_id,
    m.taken_by_operator_id as operator_id,
    -m.delta               as qty
  from public.cnc_tool_movements m
  where m.undone_at is null
    and m.kind in ('issue', 'return')
    and (m.taken_by_profile_id is not null or m.taken_by_operator_id is not null)

  union all

  -- spent on a machine (−)
  select
    u.tool_id,
    u.used_by_profile_id,
    u.used_by_operator_id,
    -u.qty
  from public.cnc_tool_usage u
  where u.undone_at is null
) parts
group by tool_id, profile_id, operator_id
having sum(qty) <> 0;

comment on view public.cnc_tool_holdings is
  'Mig 238 — the ONE definition of custody: holding = taken − returned − '
  'used, per (tool, person). Rows with a zero balance drop out. Read by '
  'cnc_tool_settle_held() and by every screen that shows "in his hands".';

-- ── 3. The only way a held tool leaves a man's hands ──────────────
--
-- Two outcomes, one function, because they are one operation: a pc
-- leaves his account. Both need the same lock and the same ceiling, and
-- splitting them would mean writing that ceiling twice.
--
--   'used'     → a cnc_tool_usage row. The shelf does not move.
--   'returned' → a 'return' movement. The shelf goes UP.
--
-- The lock is on cnc_tools, exactly as in mig 235, and for the same
-- reason: custody is DERIVED, so there is no row to collide on. Without
-- it a man tapping twice on a bad signal reports 1 pc used on two
-- machines out of a single pc. Holding the tool's row means the second
-- call reads a balance that already includes the first.
--
-- Serialising on the tool rather than on the man is the right grain: the
-- same tool is what two callers can fight over, and a man settling two
-- different tools at once never waits.

create or replace function public.cnc_tool_settle_held(
  p_tool_id     uuid,
  p_outcome     text,                      -- 'used' | 'returned'
  p_qty         numeric,
  p_machine_id  uuid default null,         -- required for 'used'
  p_profile_id  uuid default null,
  p_operator_id uuid default null,
  p_used_by     text default null,
  p_vendor_id   uuid default null,
  p_note        text default null,
  p_entered_by  uuid default null,
  p_guest_link  uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tool    record;
  v_machine record;
  v_held    numeric;
  v_id      uuid;
begin
  if p_outcome not in ('used', 'returned') then
    return jsonb_build_object('ok', false, 'code', 'bad_outcome');
  end if;
  if p_qty is null or p_qty <= 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_qty');
  end if;
  -- Exactly one signer, checked here as well as by the table: a call
  -- with neither would otherwise settle against an empty balance and
  -- look like it worked.
  if (p_profile_id is not null) = (p_operator_id is not null) then
    return jsonb_build_object('ok', false, 'code', 'no_person');
  end if;

  -- ── The lock ────────────────────────────────────────────────────
  select id, name, unit, is_active
    into v_tool
    from public.cnc_tools
   where id = p_tool_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'missing');
  end if;

  -- ── What he actually has, read inside the lock ──────────────────
  select coalesce(sum(h.qty), 0)
    into v_held
    from public.cnc_tool_holdings h
   where h.tool_id = p_tool_id
     and h.profile_id is not distinct from p_profile_id
     and h.operator_id is not distinct from p_operator_id;

  if v_held <= 0 then
    return jsonb_build_object(
      'ok', false, 'code', 'not_holding',
      'holding', 0, 'tool', v_tool.name, 'unit', v_tool.unit
    );
  end if;
  if p_qty > v_held then
    return jsonb_build_object(
      'ok', false, 'code', 'over_holding',
      'holding', v_held, 'tool', v_tool.name, 'unit', v_tool.unit
    );
  end if;

  -- ── Spent on a machine ──────────────────────────────────────────
  if p_outcome = 'used' then
    if p_machine_id is null then
      return jsonb_build_object('ok', false, 'code', 'no_machine');
    end if;

    select id, machine_code, vendor_id, is_active, current_carving_item_id
      into v_machine
      from public.cnc_machines
     where id = p_machine_id;

    if not found or not v_machine.is_active then
      return jsonb_build_object('ok', false, 'code', 'bad_machine');
    end if;

    -- A man working for one company cannot spend a tool on another
    -- company's machine. The store is shared (mig 228); the machines are
    -- not. p_vendor_id null is the office, which may file against any of
    -- them.
    if p_vendor_id is not null and v_machine.vendor_id is distinct from p_vendor_id then
      return jsonb_build_object(
        'ok', false, 'code', 'other_vendor', 'machine', v_machine.machine_code
      );
    end if;

    insert into public.cnc_tool_usage (
      tool_id, machine_id, qty,
      used_by_profile_id, used_by_operator_id, used_by, vendor_id,
      carving_item_id, note, entered_by, guest_link_id
    ) values (
      p_tool_id, p_machine_id, p_qty,
      p_profile_id, p_operator_id, btrim(coalesce(p_used_by, 'Unnamed')), p_vendor_id,
      v_machine.current_carving_item_id, p_note, p_entered_by, p_guest_link
    )
    returning id into v_id;

    return jsonb_build_object(
      'ok', true, 'outcome', 'used', 'usage_id', v_id,
      'qty', p_qty, 'holding_after', v_held - p_qty,
      'tool', v_tool.name, 'unit', v_tool.unit, 'machine', v_machine.machine_code
    );
  end if;

  -- ── Back on the shelf ───────────────────────────────────────────
  -- A return is an ordinary movement and needs no stock check: it only
  -- ever goes up. The ceiling above is the real guard — it stops a man
  -- "returning" ten of something he took one of, which is the only way
  -- this path could invent stock.
  insert into public.cnc_tool_movements (
    tool_id, kind, delta, taken_by,
    taken_by_profile_id, taken_by_operator_id,
    vendor_id, note, entered_by, guest_link_id
  ) values (
    p_tool_id, 'return', p_qty, btrim(coalesce(p_used_by, 'Unnamed')),
    p_profile_id, p_operator_id,
    p_vendor_id, p_note, p_entered_by, p_guest_link
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'outcome', 'returned', 'movement_id', v_id,
    'qty', p_qty, 'holding_after', v_held - p_qty,
    'tool', v_tool.name, 'unit', v_tool.unit
  );
end;
$$;

comment on function public.cnc_tool_settle_held is
  'Mig 238 — the ONLY way to write a cnc_tool_usage row or a custody-backed '
  'return. Locks the tool, re-reads cnc_tool_holdings inside the lock, '
  'refuses more than the man is holding, then writes. service_role only.';

revoke all on function public.cnc_tool_settle_held(
  uuid, text, numeric, uuid, uuid, uuid, text, uuid, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.cnc_tool_settle_held(
  uuid, text, numeric, uuid, uuid, uuid, text, uuid, text, uuid, uuid
) to service_role;

notify pgrst, 'reload schema';

commit;

-- ── Verification (paste separately after running) ─────────────────
-- -- every take already in the ledger should now read as held
-- select h.tool_id, t.name, coalesce(p.full_name, o.name) as person, h.qty
--   from cnc_tool_holdings h
--   join cnc_tools t on t.id = h.tool_id
--   left join profiles p on p.id = h.profile_id
--   left join cnc_tool_operators o on o.id = h.operator_id
--  order by person, t.name;
--
-- -- and these must all be refused:
-- --   qty bigger than the holding            → over_holding
-- --   a person holding nothing               → not_holding
-- --   'used' with no machine                 → no_machine
-- --   a vendor's man on another's machine     → other_vendor
