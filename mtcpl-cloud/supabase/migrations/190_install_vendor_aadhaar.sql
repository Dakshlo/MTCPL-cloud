-- 190: Aadhaar number on installation vendors (Daksh, Jul 2026).
--
-- The installation-contract vendor master gains an Aadhaar card number
-- (identity on the contract, alongside GSTIN). Snapshotted onto the contract
-- like the other vendor fields so a printed contract keeps the number even if
-- the vendor master is later edited/deleted. Additive + nullable.

alter table public.install_vendors  add column if not exists aadhaar text;
alter table public.install_contracts add column if not exists vendor_aadhaar text;

notify pgrst, 'reload schema';
