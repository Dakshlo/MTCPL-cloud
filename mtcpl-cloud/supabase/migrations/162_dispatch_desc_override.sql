-- Mig 162 — per-slab Description / Additional overrides for the challan + invoice.
--
-- On the dispatch "Check & verify" page the team can (behind a toggle) edit a
-- row's Description and Additional Description so the printed challan + the
-- invoice read the way the client needs. This is CHALLAN/INVOICE-ONLY: it is
-- stored on the dispatch leg, NOT on slab_requirements, so Temple View and every
-- other system view keep the slab's original text untouched.
--
-- NULL  → use the slab's own description / additional_description.
-- ''    → an explicit blank on the challan (the team cleared the field).

ALTER TABLE dispatch_logs
  ADD COLUMN IF NOT EXISTS desc_override        TEXT,
  ADD COLUMN IF NOT EXISTS additional_override  TEXT;

COMMENT ON COLUMN dispatch_logs.desc_override IS
  'Challan/invoice-only override for the slab Description on THIS dispatch. NULL = use slab_requirements.description. Never affects Temple View.';
COMMENT ON COLUMN dispatch_logs.additional_override IS
  'Challan/invoice-only override for the slab Additional Description on THIS dispatch. NULL = use slab_requirements.additional_description.';
