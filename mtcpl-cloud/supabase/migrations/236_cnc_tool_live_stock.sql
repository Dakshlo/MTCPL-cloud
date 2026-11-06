-- ──────────────────────────────────────────────────────────────────
-- Migration 236 — what is on the shelf, right now
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh, Nov 2026: "stock should update every second."
--
-- Mig 235 made the WRITES safe — two men can no longer take the same
-- last bit. This is the other half: the number on the screen should
-- not sit there being wrong while somebody else empties the shelf.
--
-- Both screens poll a tiny endpoint every few seconds and reload only
-- when something actually moved. That poll must not cost a table scan
-- every time, so the sum happens here, once per tool, off the partial
-- index mig 235 added. One row out, whatever the register grows to.
--
-- STABLE and read-only; safe for anyone the endpoint lets through, and
-- the endpoint is the thing that checks who is asking.
-- ──────────────────────────────────────────────────────────────────

begin;

create or replace function public.cnc_tool_stock_map()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(t.id::text, s.stock),
    '{}'::jsonb
  )
  from public.cnc_tools t
  left join lateral (
    select coalesce(sum(m.delta), 0) as stock
      from public.cnc_tool_movements m
     where m.tool_id = t.id
       and m.undone_at is null
  ) s on true
  where t.is_active;
$$;

comment on function public.cnc_tool_stock_map is
  'Mig 236 — {tool_id: stock} for every live tool, in one aggregate. Feeds '
  'the few-second poll behind the cupboard QR and the keeper screen.';

revoke all on function public.cnc_tool_stock_map() from public;
revoke all on function public.cnc_tool_stock_map() from anon, authenticated;
grant execute on function public.cnc_tool_stock_map() to service_role;

notify pgrst, 'reload schema';

commit;
