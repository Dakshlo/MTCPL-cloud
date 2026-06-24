-- Mig 163 — whole-truck weight option on the dispatch challan.
--
-- Sometimes the team doesn't weigh each slab — they put the WHOLE TRUCK on the
-- weighbridge and record one figure. The Check & verify page now has a toggle:
--
--   weight_mode = 'slab'  (default) → per-slab weights as before; the challan
--                                     shows the Wt column per row + the sum.
--   weight_mode = 'truck'           → one load weight for the whole truck; the
--                                     challan shows that single figure, not
--                                     slab-wise. Per-slab weights are cleared.
--
-- load_weight_tonnes holds the single truck weight (tonnes) when mode='truck'.

ALTER TABLE dispatches
  ADD COLUMN IF NOT EXISTS weight_mode        TEXT NOT NULL DEFAULT 'slab',
  ADD COLUMN IF NOT EXISTS load_weight_tonnes NUMERIC;

COMMENT ON COLUMN dispatches.weight_mode IS
  'slab = per-slab weights (dispatch_logs.weight_tonnes); truck = one whole-truck weight in load_weight_tonnes.';
COMMENT ON COLUMN dispatches.load_weight_tonnes IS
  'Whole-truck weight (tonnes) when weight_mode = truck. NULL in slab mode.';
