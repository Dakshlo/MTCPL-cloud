-- ──────────────────────────────────────────────────────────────────
-- Migration 042: Finance — CGST/SGST/IGST split + TDS/TCS tracking
-- ──────────────────────────────────────────────────────────────────
-- Why
-- ───
-- Three follow-on asks from Daksh on the existing Accounts module:
--
--   1. The single `gst_percent` field on bills isn't enough — Indian
--      B2B invoices break GST into CGST + SGST (intra-state) OR IGST
--      (inter-state). The accountant needs to enter the three
--      components so the bill matches the physical invoice.
--
--   2. Some vendors carry TDS (we deduct, pay to govt) or TCS (they
--      add, we pay vendor inclusive). The flag belongs on the vendor
--      so when that vendor is picked in the bill form, the relevant
--      tax input surfaces automatically — and the per-vendor running
--      totals on the vendor profile page need to be queryable.
--
--   3. The due-bills + payable-to-vendor math has to net TDS out and
--      add TCS in — otherwise "Pay Today" tells the accountant to
--      pay too much.
--
-- Approach
-- ────────
-- We keep the existing single `gst_percent` column as the source of
-- truth for the GST math (and therefore amount_gst, amount_total)
-- because those are stored generated columns and ripping them out
-- would touch every existing query. Instead we ADD a three-column
-- breakdown (cgst/sgst/igst percent + their generated amounts) that
-- the UI fills, and on save the server action stores their sum into
-- `gst_percent`. Old bills (with the breakdown columns all zero)
-- keep working exactly as before.
--
-- TDS / TCS work the same way: percent on the bill, generated amount
-- column. The new `amount_payable_to_vendor` and the rebuilt
-- `amount_outstanding` columns factor them in:
--
--   amount_payable_to_vendor = subtotal + GST − TDS + TCS
--   amount_outstanding        = amount_payable_to_vendor − amount_paid
--
-- Existing rows (tds_percent = tcs_percent = 0) → behaviour unchanged.
--
-- The recalc trigger (mig 028) doesn't need touching: it still flips
-- 'approved' ↔ 'fully_paid' based on amount_outstanding crossing 0.
-- Just the FORMULA for outstanding changes; the trigger's contract
-- holds.
--
-- The `bills_due_idx` partial index gets dropped + recreated because
-- it references amount_outstanding in its WHERE; rebuilding is the
-- safest way to ensure it points at the new generated column.
--
-- No data migration. Existing bills get the new columns at their
-- defaults (0); the new columns kick in for bills entered AFTER
-- this migration runs.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. bill_vendors — TDS / TCS applicability flags ──────────────
-- Two independent flags (a few vendors carry both). When the flag is
-- on, the bill-entry form for that vendor surfaces the tax input.
-- Optional default rates so the form pre-fills sensibly; user can
-- still override on the bill.
ALTER TABLE public.bill_vendors
  ADD COLUMN IF NOT EXISTS tds_applicable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tcs_applicable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_tds_percent NUMERIC(5,2) NULL
    CHECK (default_tds_percent IS NULL
           OR (default_tds_percent >= 0 AND default_tds_percent <= 100)),
  ADD COLUMN IF NOT EXISTS default_tcs_percent NUMERIC(5,2) NULL
    CHECK (default_tcs_percent IS NULL
           OR (default_tcs_percent >= 0 AND default_tcs_percent <= 100));

-- ── 2. bills — CGST / SGST / IGST breakdown ──────────────────────
-- Percents are independent inputs the UI controls. The server action
-- stores cgst + sgst + igst into gst_percent for backward-compat
-- with the existing amount_gst / amount_total generated columns.
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS cgst_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (cgst_percent >= 0 AND cgst_percent <= 100),
  ADD COLUMN IF NOT EXISTS sgst_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (sgst_percent >= 0 AND sgst_percent <= 100),
  ADD COLUMN IF NOT EXISTS igst_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (igst_percent >= 0 AND igst_percent <= 100);

-- ── 3. bills — TDS / TCS percent ─────────────────────────────────
-- Standard practice: TDS is computed on (subtotal + GST) for service
-- bills, TCS likewise. Both rates default to 0 so existing bills are
-- unaffected.
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS tds_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (tds_percent >= 0 AND tds_percent <= 100),
  ADD COLUMN IF NOT EXISTS tcs_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (tcs_percent >= 0 AND tcs_percent <= 100);

-- ── 4. bills — generated amount columns for the breakdown ────────
-- All STORED so they're indexable + show up in normal SELECTs.
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS amount_cgst NUMERIC(14,2) GENERATED ALWAYS AS (
    ROUND(amount_subtotal * cgst_percent / 100, 2)
  ) STORED,
  ADD COLUMN IF NOT EXISTS amount_sgst NUMERIC(14,2) GENERATED ALWAYS AS (
    ROUND(amount_subtotal * sgst_percent / 100, 2)
  ) STORED,
  ADD COLUMN IF NOT EXISTS amount_igst NUMERIC(14,2) GENERATED ALWAYS AS (
    ROUND(amount_subtotal * igst_percent / 100, 2)
  ) STORED,
  ADD COLUMN IF NOT EXISTS amount_tds NUMERIC(14,2) GENERATED ALWAYS AS (
    ROUND(
      (amount_subtotal + ROUND(amount_subtotal * gst_percent / 100, 2))
      * tds_percent / 100,
      2
    )
  ) STORED,
  ADD COLUMN IF NOT EXISTS amount_tcs NUMERIC(14,2) GENERATED ALWAYS AS (
    ROUND(
      (amount_subtotal + ROUND(amount_subtotal * gst_percent / 100, 2))
      * tcs_percent / 100,
      2
    )
  ) STORED;

-- ── 5. amount_payable_to_vendor (NEW generated column) ───────────
-- = subtotal + GST − TDS + TCS. This is the number the accountant
-- actually pays the beneficiary. For TDS-deducted bills it's lower
-- than amount_total; for TCS bills it's higher.
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS amount_payable_to_vendor NUMERIC(14,2) GENERATED ALWAYS AS (
    amount_subtotal
    + ROUND(amount_subtotal * gst_percent / 100, 2)
    - ROUND(
        (amount_subtotal + ROUND(amount_subtotal * gst_percent / 100, 2))
        * tds_percent / 100,
        2
      )
    + ROUND(
        (amount_subtotal + ROUND(amount_subtotal * gst_percent / 100, 2))
        * tcs_percent / 100,
        2
      )
  ) STORED;

-- ── 6. amount_outstanding REBUILD ────────────────────────────────
-- The existing generated column hard-codes the OLD formula
-- (subtotal + GST − amount_paid). We need it to start from the new
-- amount_payable_to_vendor instead.
--
-- Postgres doesn't let us change a generated expression in place, so
-- we drop the index that depends on it, drop the column, recreate
-- both. Existing rows with tds_percent=tcs_percent=0 land on the
-- same number as before — no observable change for legacy data.
DROP INDEX IF EXISTS public.bills_due_idx;
ALTER TABLE public.bills DROP COLUMN IF EXISTS amount_outstanding;
ALTER TABLE public.bills
  ADD COLUMN amount_outstanding NUMERIC(14,2) GENERATED ALWAYS AS (
    amount_subtotal
    + ROUND(amount_subtotal * gst_percent / 100, 2)
    - ROUND(
        (amount_subtotal + ROUND(amount_subtotal * gst_percent / 100, 2))
        * tds_percent / 100,
        2
      )
    + ROUND(
        (amount_subtotal + ROUND(amount_subtotal * gst_percent / 100, 2))
        * tcs_percent / 100,
        2
      )
    - amount_paid
  ) STORED;

-- Rebuild the partial index — same WHERE predicate, new column.
CREATE INDEX IF NOT EXISTS bills_due_idx
  ON public.bills (bill_date DESC)
  WHERE status = 'approved' AND amount_outstanding > 0;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-migration notes
-- ──────────────────────────────────────────────────────────────────
-- 1. No manual UPDATE required. Existing bills have:
--      cgst=sgst=igst=tds=tcs = 0
--      gst_percent untouched
--      amount_gst, amount_total, amount_outstanding → same numbers
--    The breakdown only kicks in on new bills entered through the
--    updated form.
--
-- 2. Flagging vendors for TDS/TCS is a separate manual step after
--    deploy — open each vendor in /accounts/vendors/[id] and tick
--    the new flag, or run:
--
--      UPDATE public.bill_vendors
--         SET tds_applicable = TRUE, default_tds_percent = 10.00
--       WHERE name ILIKE '%<vendor name>%';
--
-- 3. UTR is enforced in the React form (mark-paid screen). No DB
--    constraint added — cash payments legitimately have no UTR,
--    so the rule is method-aware and lives in the form.
-- ──────────────────────────────────────────────────────────────────
