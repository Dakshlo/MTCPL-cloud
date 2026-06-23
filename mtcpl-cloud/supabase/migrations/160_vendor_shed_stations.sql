-- 160 — Vendor "shed" dispatch stations.
--
-- A dispatch station can now belong to a CNC vendor (its shed), so a CNC slab
-- can be dispatched from the vendor's shade itself instead of being moved to
-- Main Dispatch. Main Dispatch keeps vendor_id NULL. One shed per vendor.
-- Additive + idempotent.

ALTER TABLE public.dispatch_stations
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_stations_vendor_uidx
  ON public.dispatch_stations (vendor_id)
  WHERE vendor_id IS NOT NULL;
