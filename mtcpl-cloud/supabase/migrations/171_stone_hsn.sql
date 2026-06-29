-- 171: HSN codes per stone type, shown on the tax invoice (Daksh, June 2026).
--
-- HSN belongs to the STONE (same on every temple's invoice). Each stone can
-- carry a normal HSN and a "vendor" HSN. Per temple, the invoice prints the
-- normal HSN by default; if the temple is set to use the vendor HSN, that code
-- prints instead AND the GST slab is forced to 18%. Managed by accountants on
-- the new Invoicing → Stone & HSN page. Additive + idempotent.

alter table public.stone_types
  add column if not exists hsn_code        text,
  add column if not exists hsn_vendor_code text;

alter table public.temples
  add column if not exists hsn_use_vendor  boolean not null default false;

notify pgrst, 'reload schema';
