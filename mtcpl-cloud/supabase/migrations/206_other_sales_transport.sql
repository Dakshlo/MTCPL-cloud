-- 206: Other Sales — transportation info on the challan (Daksh, Jul 2026).
--
-- Other-sales challans had no transport fields, so the challan + its invoice
-- couldn't show Company / LR no / Vehicle / Driver. Add the same columns the
-- temple delivery challan uses, so the print can render an identical strip.

alter table public.other_challans
  add column if not exists transport_company     text,
  add column if not exists transport_phone       text,
  add column if not exists lr_no                 text,
  add column if not exists transport_vehicle_no  text,
  add column if not exists transport_driver_name text,
  add column if not exists transport_driver_phone text;

notify pgrst, 'reload schema';
