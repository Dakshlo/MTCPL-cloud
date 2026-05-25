-- ──────────────────────────────────────────────────────────────────
-- Mig 077 — profiles.managed_vendor_ids
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh May 2026 round 3 — Alkesh (a CNC vendor) is temporarily out
-- of the cockpit. Mohit needs to manage Alkesh's CNCs in addition to
-- his own until Alkesh is back. We could hand Mohit's profile a new
-- role, but that resets every other flag (can_assign_carving etc.).
--
-- Simpler: per-profile UUID array of vendor IDs this user is
-- additionally allowed to act as. The /vendor page reads it, the
-- sidebar renders one "Manage <vendor>" entry per id, and the
-- vendor-cockpit server actions extend their ownership check from
-- "profile.vendor_id === item.vendor_id" to also accept "item.
-- vendor_id IN managed_vendor_ids[]".
--
-- Empty array (the default) means no change in behaviour — only
-- profiles with explicit IDs configured get the extra access. Set
-- via Settings UI by owner / developer.
--
-- ALTER TABLE inside a BEGIN/COMMIT block — different from the
-- ADD VALUE pattern used for enum changes.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS managed_vendor_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.profiles.managed_vendor_ids IS
  'Extra vendor IDs this user can act as on the /vendor cockpit, beyond their own vendor_id. Vendor-action server actions extend their ownership check to accept item.vendor_id IN managed_vendor_ids[]. Sidebar renders one Manage <vendor> entry per id. Mig 077 — added for Mohit covering Alkesh''s CNC ops while Alkesh is unavailable.';

-- GIN index so the ownership check (managed_vendor_ids @> ARRAY[id])
-- stays fast as the array grows. Partial — most profiles have an
-- empty array.
CREATE INDEX IF NOT EXISTS profiles_managed_vendor_ids_idx
  ON public.profiles USING GIN (managed_vendor_ids)
  WHERE array_length(managed_vendor_ids, 1) IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
