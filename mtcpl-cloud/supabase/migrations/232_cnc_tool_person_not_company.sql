-- 232: a take is signed by the PERSON, not by a company (Daksh, Oct 2026).
--
-- The QR asked, after the OTP, which company the take was for. Daksh:
-- "why you ask vendors selection, no need of that — eg Mohit login, then
-- if he take any stock that means its taken from his account. No need of
-- vendor specially like Aarav Stone."
--
-- He is right, and the schema already agreed with him: mig 230 put
-- `taken_by_profile_id` on every movement and made it mandatory for
-- anything coming through the QR. The person is proven by a code sent to
-- the number on their own profile. The company added nothing that the
-- person did not already say, and it cost a whole extra screen at the
-- cupboard door.
--
-- The only thing standing in the way was the mig-227 CHECK, which said a
-- take MUST carry a vendor. This relaxes it to what we actually mean:
--
--     a company may be named on a take or a return,
--     and must never be named on a receive / scrap / fix-count,
--
-- which is the store-vs-vendor distinction the column was always for.
-- Who took it stays mandatory — `cnc_tool_movements_issue_needs_name`
-- (mig 227) and `cnc_tool_movements_guest_needs_taker` (mig 230) are
-- untouched, so a take still cannot be recorded without a signer.
--
-- Safety: one CHECK swapped for a strictly weaker one. Every existing
-- row satisfies the new form (verified before writing this: 2 movements
-- in the table — one receive with no vendor, one issue with a vendor,
-- both legal either way). Nothing is read, rewritten or dropped.

begin;

alter table public.cnc_tool_movements
  drop constraint if exists cnc_tool_movements_vendor_shape;

alter table public.cnc_tool_movements
  add constraint cnc_tool_movements_vendor_shape
  check (
    kind in ('issue', 'return')      -- a company is allowed, never required
    or vendor_id is null             -- store-level: receive / scrap / adjust
  );

comment on column public.cnc_tool_movements.vendor_id is
  'Optional: the company a take belonged to. Since mig 232 the signer is '
  'taken_by_profile_id — this is kept for the older rows and for the day a '
  'take genuinely needs to be billed to a company. Never set on receive, '
  'scrap or adjust.';

notify pgrst, 'reload schema';

commit;

-- ROLLBACK
-- begin;
-- alter table public.cnc_tool_movements
--   drop constraint if exists cnc_tool_movements_vendor_shape;
-- alter table public.cnc_tool_movements
--   add constraint cnc_tool_movements_vendor_shape
--   check (
--     (kind in ('issue','return') and vendor_id is not null)
--     or (kind in ('receive','scrap','adjust') and vendor_id is null)
--   );
-- notify pgrst, 'reload schema';
-- commit;
-- NOTE: the rollback fails if any take has been recorded without a
-- company since this migration ran — set a vendor_id on those rows first.
