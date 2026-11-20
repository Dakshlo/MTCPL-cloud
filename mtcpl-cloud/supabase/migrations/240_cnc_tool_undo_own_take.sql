-- ══════════════════════════════════════════════════════════════════
-- 240 — A man may take back his own take
-- ══════════════════════════════════════════════════════════════════
--
-- Daksh, Nov 2026: "when someone takes a tool from phone — eg I take a
-- tool, after take 1 pcs it only gives a small feedback. Instead it
-- should give a full page card that this is taken… and on that card
-- there will be an undo button."
--
-- The card is screen work. The undo is not.
--
-- Until now the only way to void a take was the office screen, so a man
-- who typed 10 and meant 1 — the easiest mistake to make on this flow,
-- because the number comes up as a keypad with his gloves on — had to
-- telephone somebody, and in the meantime the shelf was nine short and
-- his own account nine over. Both of those are numbers other people act
-- on within the hour.
--
-- ── Why a function and not an UPDATE ──────────────────────────────
--
-- Because custody is DERIVED (mig 238: held = taken − returned − used)
-- and voiding a take walks backwards through it. Take 5, spend 1 on a
-- machine, then void the take, and the man is holding −1 while a real
-- pc is inside a real CNC. There is no row to collide on, so the check
-- has to happen under the same lock on cnc_tools that mig 235 and mig
-- 238 take, for the same reason: two taps on a bad signal.
--
-- ── What it will refuse ───────────────────────────────────────────
--
--   not_mine   somebody else's line. The man who signed for it is the
--              man who may unsign it; the office has its own screen.
--   too_late   past the ten minutes. After that it is a Return or a
--              Fix count, which leave both lines standing — an hour-old
--              take that silently disappears is how a register stops
--              being evidence.
--   spent      the pcs have already gone into a machine or back on the
--              shelf. Undoing now would make custody negative.
--   already    two taps. The UPDATE is also guarded on undone_at.
--
-- ── Scope ─────────────────────────────────────────────────────────
--
-- 'issue' and 'return' only — the two kinds a cupboard sticker is
-- allowed to write at all (mig 239). The office's own undo keeps its
-- plain UPDATE: it covers receive, scrap and adjust as well, each of
-- which needs a different check, and it has been live for months.
-- Worth tightening the same way later; not worth changing blind today.
-- ══════════════════════════════════════════════════════════════════

begin;

-- ── 1. An operator can be an undoer ───────────────────────────────
--
-- The table has had `undone_by uuid references profiles(id)` since mig
-- 227, from when only the office could undo anything. A man at the
-- cupboard has no profile — he is a row in cnc_tool_operators — so
-- without this column his undo would write undone_at with nobody beside
-- it, and the one question anybody asks of a voided line ("who voided
-- it?") would have no answer. Mig 238 hit this on the usage table and
-- solved it the same way.

alter table public.cnc_tool_movements
  add column if not exists undone_by_operator_id uuid
    references public.cnc_tool_operators(id) on delete set null;

comment on column public.cnc_tool_movements.undone_by_operator_id is
  'Mig 240 — the operator who voided this line, when the undoer was a '
  'man at the cupboard rather than somebody with an app login. Exactly '
  'one of undone_by / undone_by_operator_id is set on a voided row.';

-- Checked, not merely intended: a void with no undoer is a void nobody
-- can be asked about. Validated against the live table, which had one
-- undone row and an undoer on it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cnc_tool_movements_undo_is_named'
  ) then
    alter table public.cnc_tool_movements
      add constraint cnc_tool_movements_undo_is_named
      check (
        (undone_at is null)
        = (undone_by is null and undone_by_operator_id is null)
      );
  end if;
end $$;

create index if not exists cnc_tool_movements_undone_by_operator_idx
  on public.cnc_tool_movements (undone_by_operator_id)
  where undone_by_operator_id is not null;

-- ── 2. The undo itself ────────────────────────────────────────────

create or replace function public.cnc_tool_undo_take(
  p_movement_id uuid,
  p_profile_id  uuid default null,
  p_operator_id uuid default null,
  p_window_secs integer default 600
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mv    record;
  v_tool  record;
  v_qty   numeric;
  v_held  numeric;
  v_stock numeric;
  v_age   numeric;
begin
  -- Exactly one signer. A call with neither would match a line whose
  -- own signer columns are null and read as "mine".
  if (p_profile_id is not null) = (p_operator_id is not null) then
    return jsonb_build_object('ok', false, 'code', 'no_person');
  end if;

  select id, tool_id, kind, delta, created_at, undone_at,
         taken_by_profile_id, taken_by_operator_id
    into v_mv
    from public.cnc_tool_movements
   where id = p_movement_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'gone');
  end if;
  if v_mv.kind not in ('issue', 'return') then
    return jsonb_build_object('ok', false, 'code', 'bad_kind');
  end if;
  if v_mv.undone_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;

  -- ── His own line, and no argument about it ──────────────────────
  --
  -- `is not distinct from`, not `=`, and the whole gate hangs on it.
  --
  -- The first version of this wrote `v_mv.taken_by_operator_id =
  -- p_operator_id`. On a line taken by a PROFILE that column is null,
  -- so for a caller passing any operator id the comparison was
  -- null — not false — and `false or null` is null, and `not null` is
  -- null, and `if null then` does not fire. A stranger's operator id
  -- walked straight through the ownership check. It was a probe against
  -- the real schema that found it, not reading it back: the test asked
  -- for `not_mine` and got `spent`, which is the custody ceiling two
  -- checks further down catching it by accident. On a 'return' line
  -- there is no custody ceiling and it would have voided somebody
  -- else's line.
  --
  -- Three-valued logic in an authorisation check fails OPEN. Every
  -- comparison here is null-safe for that reason.
  if not (
    (p_profile_id is not null
      and v_mv.taken_by_profile_id is not distinct from p_profile_id)
    or (p_operator_id is not null
      and v_mv.taken_by_operator_id is not distinct from p_operator_id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_mine');
  end if;

  v_age := extract(epoch from (now() - v_mv.created_at));
  if v_age > greatest(p_window_secs, 0) then
    return jsonb_build_object('ok', false, 'code', 'too_late',
                              'age_secs', round(v_age));
  end if;

  -- ── The lock, on the tool, as everywhere else in this module ────
  select id, name, unit
    into v_tool
    from public.cnc_tools
   where id = v_mv.tool_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'gone');
  end if;

  -- Re-read inside the lock: between the read above and here, the same
  -- man's second tap may already have voided it.
  if exists (
    select 1 from public.cnc_tool_movements
     where id = p_movement_id and undone_at is not null
  ) then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;

  v_qty := abs(v_mv.delta);

  if v_mv.kind = 'issue' then
    -- Voiding a take removes v_qty from his hands. It may not take him
    -- below nothing: those pcs are either in a machine or back on the
    -- shelf, and both of those are facts somebody else has acted on.
    select coalesce(sum(qty), 0)
      into v_held
      from public.cnc_tool_holdings
     where tool_id = v_mv.tool_id
       and ((p_profile_id is not null and profile_id = p_profile_id and operator_id is null)
         or (p_operator_id is not null and operator_id = p_operator_id and profile_id is null));

    if v_held < v_qty then
      return jsonb_build_object(
        'ok', false, 'code', 'spent',
        'tool', v_tool.name, 'unit', v_tool.unit,
        'qty', v_qty, 'held', v_held
      );
    end if;
  else
    -- Voiding a RETURN puts the pcs back in his hands and takes them
    -- off the shelf, so the shelf is the one that must not go negative.
    select coalesce(sum(delta), 0)
      into v_stock
      from public.cnc_tool_movements
     where tool_id = v_mv.tool_id
       and undone_at is null;

    if v_stock - v_mv.delta < 0 then
      return jsonb_build_object(
        'ok', false, 'code', 'short',
        'tool', v_tool.name, 'unit', v_tool.unit,
        'qty', v_qty, 'stock', v_stock
      );
    end if;
  end if;

  update public.cnc_tool_movements
     set undone_at = now(),
         undone_by = p_profile_id,
         undone_by_operator_id = p_operator_id
   where id = p_movement_id
     and undone_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;

  select coalesce(sum(delta), 0)
    into v_stock
    from public.cnc_tool_movements
   where tool_id = v_mv.tool_id
     and undone_at is null;

  return jsonb_build_object(
    'ok', true,
    'tool', v_tool.name,
    'unit', v_tool.unit,
    'kind', v_mv.kind,
    'qty', v_qty,
    'stock_after', v_stock
  );
end $$;

comment on function public.cnc_tool_undo_take(uuid, uuid, uuid, integer) is
  'Mig 240 — a man voids his OWN take (or return) from the cupboard, '
  'inside ten minutes, under the cnc_tools lock, and only while the pcs '
  'are still in his hands. Refuses with not_mine / too_late / spent / '
  'short / already.';

-- Every cupboard write goes through the service role inside a server
-- action; a man at the sticker holds an OTP session of ours and no
-- Postgres role at all. Same shape as mig 235 and mig 238 — and spelled
-- out because the system audit found other RPCs in this database that
-- anon can execute, which is exactly the mistake these three lines
-- exist to avoid.
revoke all on function public.cnc_tool_undo_take(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.cnc_tool_undo_take(uuid, uuid, uuid, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;

-- ── Verification (paste separately after running) ─────────────────
--
-- -- the column, the check and the grant
-- select column_name from information_schema.columns
--  where table_name = 'cnc_tool_movements'
--    and column_name = 'undone_by_operator_id';
--
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'cnc_tool_movements_undo_is_named';
--
-- select has_function_privilege('anon', 'public.cnc_tool_undo_take(uuid,uuid,uuid,integer)', 'execute') as anon_can,
--        has_function_privilege('service_role', 'public.cnc_tool_undo_take(uuid,uuid,uuid,integer)', 'execute') as service_can;
--
-- -- somebody else's line must be refused, whatever is passed
-- select public.cnc_tool_undo_take(
--   (select id from cnc_tool_movements where kind = 'issue' order by created_at desc limit 1),
--   '00000000-0000-0000-0000-000000000000'::uuid, null, 600);
