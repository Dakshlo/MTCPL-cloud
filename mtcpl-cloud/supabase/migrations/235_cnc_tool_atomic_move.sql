-- ──────────────────────────────────────────────────────────────────
-- Migration 235 — two men at one cupboard
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh, Nov 2026: "if someone take something and at some moment
-- someone else try to add or take it will be fucked."
--
-- He is right, and it was a real hole. Every write did this:
--
--     stock := SUM(delta)        -- read
--     ...check stock is enough...
--     INSERT a movement          -- write
--
-- Two phones at the same cupboard both read "1 left", both pass the
-- check, both insert −1, and the shelf is at −1 with two men holding
-- the same last bit. Nothing in the database stopped it: stock is
-- DERIVED, so there is no row to collide on and no unique index to
-- lean on. The gap is small — a few milliseconds — but a cupboard at
-- shift change is exactly when several people reach for it at once.
--
-- ── The fix: one caller at a time, per tool ───────────────────────
--
-- SELECT ... FOR UPDATE on the tool's own row. PostgREST runs each
-- call in its own transaction, so the lock is held from the read to
-- the insert and released when the function returns. A second caller
-- for the SAME tool waits those few milliseconds and then reads a
-- stock that already includes the first one's take. Different tools
-- never wait on each other.
--
-- Checking in the application cannot do this, however careful the
-- code is: by the time Node has the number, the row is free again.
--
-- ── And 'adjust' counts the shelf, it does not nudge it ───────────
--
-- Fix count asks "the register says 10 — what does the shelf say?"
-- That is a statement about an ABSOLUTE number, so sending a delta of
-- −3 is already a bet that nothing moved while the man was counting.
-- Callers may pass p_target instead: the man's count, turned into
-- whatever delta reaches it from the stock that is true INSIDE the
-- lock. If somebody took two while he was counting, his number still
-- wins, and the take is still in the register underneath it.
--
-- ── Who may call it ───────────────────────────────────────────────
--
-- service_role only. Mig 216 had to go round revoking anon EXECUTE
-- from definer functions that never should have had it; this one is
-- locked down in the same breath as it is created.
-- ──────────────────────────────────────────────────────────────────

begin;

create or replace function public.cnc_tool_record_move(
  p_tool_id           uuid,
  p_kind              text,
  p_delta             numeric default null,
  -- The counted number, for 'adjust'. When given, the delta is worked
  -- out inside the lock and p_delta is ignored.
  p_target            numeric default null,
  p_taken_by          text    default null,
  p_taken_by_profile  uuid    default null,
  p_taken_by_operator uuid    default null,
  p_vendor_id         uuid    default null,
  p_note              text    default null,
  p_entered_by        uuid    default null,
  p_guest_link        uuid    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tool   record;
  v_before numeric;
  v_delta  numeric;
  v_after  numeric;
  v_id     uuid;
begin
  -- The lock. Everything below this line runs one caller at a time for
  -- this one tool.
  select id, name, unit, is_active
    into v_tool
    from public.cnc_tools
   where id = p_tool_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'missing');
  end if;
  if not v_tool.is_active then
    return jsonb_build_object('ok', false, 'code', 'archived', 'tool', v_tool.name);
  end if;

  select coalesce(sum(delta), 0)
    into v_before
    from public.cnc_tool_movements
   where tool_id = p_tool_id
     and undone_at is null;

  if p_target is not null then
    v_delta := p_target - v_before;
  else
    v_delta := coalesce(p_delta, 0);
  end if;

  -- Nothing to write. Not an error: for a count fix it means somebody
  -- else already put the register where this man was about to put it.
  if v_delta = 0 then
    return jsonb_build_object(
      'ok', true, 'noop', true,
      'stock_before', v_before, 'stock_after', v_before,
      'delta', 0, 'tool', v_tool.name, 'unit', v_tool.unit
    );
  end if;

  v_after := v_before + v_delta;

  -- Going below zero means the register and the shelf disagree.
  -- Refusing is the honest answer; Fix count exists for exactly this
  -- and it leaves a line explaining the correction.
  if v_after < 0 then
    return jsonb_build_object(
      'ok', false, 'code', 'short',
      'stock', v_before, 'tool', v_tool.name, 'unit', v_tool.unit
    );
  end if;

  insert into public.cnc_tool_movements (
    tool_id, kind, delta, taken_by, taken_by_profile_id, taken_by_operator_id,
    vendor_id, note, entered_by, guest_link_id
  ) values (
    p_tool_id, p_kind, v_delta, p_taken_by, p_taken_by_profile, p_taken_by_operator,
    p_vendor_id, p_note, p_entered_by, p_guest_link
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'noop', false,
    'movement_id', v_id,
    'stock_before', v_before, 'stock_after', v_after, 'delta', v_delta,
    'tool', v_tool.name, 'unit', v_tool.unit
  );
end;
$$;

comment on function public.cnc_tool_record_move is
  'Mig 235 — the ONLY way to write a cnc_tool_movements row. Locks the tool, '
  're-reads derived stock inside the lock, refuses to go below zero, then '
  'inserts. p_target (for adjust) sets an absolute count instead of a delta. '
  'service_role only.';

revoke all on function public.cnc_tool_record_move(
  uuid, text, numeric, numeric, text, uuid, uuid, uuid, text, uuid, uuid
) from public;
revoke all on function public.cnc_tool_record_move(
  uuid, text, numeric, numeric, text, uuid, uuid, uuid, text, uuid, uuid
) from anon, authenticated;
grant execute on function public.cnc_tool_record_move(
  uuid, text, numeric, numeric, text, uuid, uuid, uuid, text, uuid, uuid
) to service_role;

-- The aggregate the live stock poll runs every few seconds. One row
-- per tool, straight off the index.
create index if not exists cnc_tool_moves_live_stock_idx
  on public.cnc_tool_movements (tool_id)
  where undone_at is null;

notify pgrst, 'reload schema';

commit;
