-- 167: Owner approval gate for invoices + dispatch "Invoice in process" lane
-- (Daksh, June 2026).
--
-- New flow:
--   Dispatch: Make Dispatch → Waiting approval → [verify] → INVOICE IN PROCESS
--             → [owner approves the priced challan] → ON THE ROAD → Delivered
--   Invoicing: Challans → [accountant prices = "convert"] → APPROVAL (owner)
--             → [approve] Invoices (bill created)  /  [reject] back to Challans
--
-- A priced challan no longer becomes a final invoice on its own — the OWNER must
-- approve it. Until then it shows on the new Approval page and its tax-invoice
-- print carries an "UNDER APPROVAL — NOT VALID" watermark.
--
-- Additive + idempotent.

-- ── challans: owner approve / reject ──────────────────────────────────────
alter table public.challans
  add column if not exists owner_approved_at  timestamptz,
  add column if not exists owner_approved_by  uuid references public.profiles(id),
  add column if not exists owner_rejected_at  timestamptz,
  add column if not exists owner_reject_reason text;

-- ── dispatches: decouple "on the road" from "verified" ────────────────────
-- approved_at still marks the Check & verify step (→ Invoice in process).
-- on_road_at is set only when the owner approves the linked challan (→ truck
-- leaves; the on-road timer counts from here). returned_* flags a dispatch that
-- the accountant bounced back to Waiting approval after an owner rejection.
alter table public.dispatches
  add column if not exists on_road_at    timestamptz,
  add column if not exists returned_at   timestamptz,
  add column if not exists return_reason text,
  -- "Handover the documents to the driver" popup: shown on the On-the-road tab
  -- for a freshly-released truck until someone acknowledges it.
  add column if not exists handover_ack_at timestamptz,
  add column if not exists handover_ack_by uuid references public.profiles(id);

-- Backfill: existing approved-but-not-delivered dispatches are already "on the
-- road" under the old model — keep them there so nothing regresses to the new
-- Invoice-in-process lane on deploy.
update public.dispatches
  set on_road_at = coalesce(on_road_at, approved_at)
  where approved_at is not null
    and delivered_at is null
    and on_road_at is null;

notify pgrst, 'reload schema';
