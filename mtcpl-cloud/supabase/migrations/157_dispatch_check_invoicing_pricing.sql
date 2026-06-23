-- 157 — Dispatch "Check & verify" portal + Invoicing price/GST flow.
--
-- The dispatch approval step becomes a full-page Excel-style "Check": every
-- slab grouped (identical label+desc+dims collapse into one row with a qty and
-- all their codes), each row billed in CFT (default) or SFT, shown in separate
-- groups. Verifying creates the challan (landscape A4) and pushes the SAME grid
-- to Invoicing, where the team adds a price per row + GST (IGST, or CGST+SGST,
-- manual %) and prints a landscape tax invoice.
--
-- All additive + idempotent. No data backfill needed — existing rows default
-- to 'cft' and NULL pricing, exactly the prior behaviour.

-- ── Dispatch: per-slab billing unit chosen at Check time ──────────────────
ALTER TABLE public.dispatch_logs
  ADD COLUMN IF NOT EXISTS measure_unit TEXT NOT NULL DEFAULT 'cft'
    CHECK (measure_unit IN ('cft', 'sft'));

-- ── Invoicing challan_items: full slab snapshot, so the invoicing team sees
--    the exact same Excel grid the dispatch team verified, plus per-row price.
ALTER TABLE public.challan_items
  ADD COLUMN IF NOT EXISTS codes                  TEXT,    -- all slab codes in the group, comma-joined
  ADD COLUMN IF NOT EXISTS label                  TEXT,
  ADD COLUMN IF NOT EXISTS additional_description TEXT,
  ADD COLUMN IF NOT EXISTS component_section      TEXT,    -- Category 1
  ADD COLUMN IF NOT EXISTS component_element      TEXT,    -- Category 2
  ADD COLUMN IF NOT EXISTS length_ft              NUMERIC, -- inches (legacy column name)
  ADD COLUMN IF NOT EXISTS width_ft               NUMERIC,
  ADD COLUMN IF NOT EXISTS thickness_ft           NUMERIC,
  ADD COLUMN IF NOT EXISTS weight_tonnes          NUMERIC, -- summed over the group
  ADD COLUMN IF NOT EXISTS measure_unit           TEXT,    -- 'cft' | 'sft' for this line
  ADD COLUMN IF NOT EXISTS measure_qty            NUMERIC, -- billable cft or sft for the whole group
  ADD COLUMN IF NOT EXISTS rate                   NUMERIC, -- ₹ per cft/sft, filled by invoicing
  ADD COLUMN IF NOT EXISTS amount                 NUMERIC; -- rate * measure_qty, frozen by invoicing

-- ── Invoicing challan: GST + pricing state for the landscape tax invoice ──
ALTER TABLE public.challans
  ADD COLUMN IF NOT EXISTS gst_mode     TEXT,                 -- 'igst' | 'cgst_sgst' | NULL (none)
  ADD COLUMN IF NOT EXISTS igst_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS cgst_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS sgst_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS priced_at    TIMESTAMPTZ,          -- set when invoicing finalises pricing
  ADD COLUMN IF NOT EXISTS priced_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
