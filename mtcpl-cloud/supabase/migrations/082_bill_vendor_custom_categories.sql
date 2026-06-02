-- ──────────────────────────────────────────────────────────────────
-- Mig 082 — User-creatable bill-vendor categories
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh June 2026 — the existing bill_vendors.category column
-- accepts any text, but the UI dropdown (CategoryPicker) only
-- offered a hardcoded list from src/lib/bill-vendor-categories.ts.
-- "Other" was the escape hatch but it collapsed every truly novel
-- spend type into one bucket. Daksh wants users to create new
-- categories on the fly: the picker grows a "+ Create new
-- category" button + the new entries show up everywhere the
-- canonical list does (Due Bills filter, bill row pill, vendor
-- list, etc).
--
-- Storage:
--   • New table public.bill_vendor_custom_categories — one row per
--     user-defined category.
--   • bill_vendors.category column UNCHANGED (still TEXT NULL). The
--     value stored there is the slug from this table OR one of the
--     hardcoded slugs from the canonical list. The lookup helper on
--     the client merges both lists, so a vendor's stored value
--     stays valid regardless of which source it came from.
--   • No FK from bill_vendors → this table. Deleting a custom
--     category leaves any vendor still tagged with that slug in a
--     legacy state, where the picker shows them under a "Legacy"
--     tail (existing handling from mig 061). Safer than ON DELETE
--     CASCADE/SET NULL: we never silently wipe a vendor's
--     classification.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bill_vendor_custom_categories (
  -- Slug used as the stored value on bill_vendors.category. Server
  -- action generates it from the label (lowercased, non-alnum →
  -- "_") and prefixes "custom_" so it can never collide with any
  -- canonical slug ("block_purchase_marble" etc).
  value         TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  -- Pill colours mirror the canonical list's pill_fg / pill_bg
  -- (text + background hex). Picked by the server action on create
  -- — a 12-tone palette rotates through so freshly-created
  -- categories don't all read in the same colour.
  pill_fg       TEXT NOT NULL DEFAULT '#6b7280',
  pill_bg       TEXT NOT NULL DEFAULT '#f3f4f6',
  -- Soft-delete flag. Inactive categories stop appearing in the
  -- picker but stay readable for vendors still tagged with them
  -- (the lookup helper falls back to the row's stored label).
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Label is unique (case-insensitive lookup happens client-side
  -- so we just enforce strict uniqueness on the canonical text).
  -- Slug is already PK so no second constraint needed.
  CONSTRAINT bill_vendor_custom_categories_label_uniq UNIQUE (label),
  CONSTRAINT bill_vendor_custom_categories_label_chk
    CHECK (length(trim(label)) > 0 AND length(label) <= 60)
);

-- Lightweight index — the picker fetch sorts active categories by
-- label for stable display ordering.
CREATE INDEX IF NOT EXISTS bill_vendor_custom_categories_active_label_idx
  ON public.bill_vendor_custom_categories (is_active, label)
  WHERE is_active = TRUE;

-- RLS: same posture as the rest of the finance tables — blanket
-- SELECT for authenticated, all writes through server actions
-- using the admin client. No write policies needed because the
-- admin client bypasses RLS for inserts/updates/deletes.
ALTER TABLE public.bill_vendor_custom_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bill_vendor_custom_categories_read_all ON public.bill_vendor_custom_categories;
CREATE POLICY bill_vendor_custom_categories_read_all
  ON public.bill_vendor_custom_categories
  FOR SELECT
  TO authenticated
  USING (TRUE);

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Verification (paste separately after running):
--
--   -- New table should exist with the three constraints above.
--   \d bill_vendor_custom_categories
--
--   -- Should be empty on a fresh prod (nobody has created a
--   -- custom category yet).
--   SELECT count(*) FROM bill_vendor_custom_categories;
--
--   -- bill_vendors.category column unchanged — every existing
--   -- vendor's category value still resolves through the canonical
--   -- list or as legacy free-text. No data drift.
--   SELECT category, count(*) FROM bill_vendors
--    GROUP BY category ORDER BY count(*) DESC LIMIT 20;
-- ──────────────────────────────────────────────────────────────────
