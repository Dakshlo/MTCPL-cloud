-- 203: VOID invoices (Daksh, Jul 2026) — the e-way-bill case.
--
-- When an e-way bill was already generated against an invoice number and the
-- invoice is then cancelled with the government, the NUMBER IS BURNED: the
-- government keeps a record of the cancelled bill, so the system must too.
-- "Void" is the third option next to Edit / Cancel:
--
--   • the invoice stays ON RECORD, shown as CANCELLED on the Invoices page
--     (so "where is INV-103?" always has an answer), with a mandatory reason;
--   • its number is NEVER freed or reused — the next invoice takes the next
--     number (freeInvoiceNumber is simply not called);
--   • the underlying challan(s) return to their source page for a fresh cycle
--     (they will take a NEW number when re-invoiced);
--   • voided amounts are excluded from dashboard totals (the live rows drop
--     out of the invoiced states; the register row lives in this table).
--
-- Same approval flow as cancel: any invoicing user STAGES the void (with the
-- reason); owner / developer / accountant★ approve or reject it.
--
-- ⚠ If you ever run a "reconcile INV counter to max" repair, include
--   voided_invoices in the max() — their numbers are consumed forever.

create table if not exists public.voided_invoices (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('purchase','running','bulk','other')),
  source_id     uuid not null,           -- original live row id (challan / bulk / other)
  inv_fy        text,
  inv_seq       int,
  invoice_code  text not null,           -- "INV-26/27-103" as displayed
  party         text,                    -- temple / client billed
  invoice_date  date,                    -- original invoice date
  amount        numeric,                 -- final payable at void time (register info only)
  reason        text not null,           -- mandatory — why it was cancelled
  snapshot      jsonb,                   -- frozen header + items (+ challan refs)
  requested_by  uuid references public.profiles(id),
  voided_by     uuid references public.profiles(id),
  voided_at     timestamptz not null default now()
);

create index if not exists idx_voided_invoices_seq on public.voided_invoices (inv_fy, inv_seq);

-- Service-role only (same posture as the salary tables) — pages read it
-- through server code.
alter table public.voided_invoices enable row level security;

-- Staged void request (mirrors pending_edit_* / pending_cancel_* from mig 184).
alter table public.challans
  add column if not exists pending_void_at timestamptz,
  add column if not exists pending_void_by uuid,
  add column if not exists pending_void_reason text,
  add column if not exists pending_void_amount numeric;

alter table public.bulk_invoices
  add column if not exists pending_void_at timestamptz,
  add column if not exists pending_void_by uuid,
  add column if not exists pending_void_reason text,
  add column if not exists pending_void_amount numeric;

alter table public.other_challans
  add column if not exists pending_void_at timestamptz,
  add column if not exists pending_void_by uuid,
  add column if not exists pending_void_reason text,
  add column if not exists pending_void_amount numeric;

notify pgrst, 'reload schema';
