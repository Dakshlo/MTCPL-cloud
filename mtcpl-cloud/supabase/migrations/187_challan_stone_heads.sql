-- 187: per-invoice custom stone-table headings on the purchase tax invoice (Daksh, Jul 2026).
--
-- Each stone band on the tax invoice becomes a 3-zone header:
--   LEFT  = a custom TITLE the accountant types on the review page (always CAPS),
--   CENTRE= the HSN code (already mandatory, saved on the stone master),
--   RIGHT = the stone-type name (auto).
--
-- The typed title is per-invoice (not global), so it lives on the challan itself
-- as a jsonb map { "<stone name>": "<TITLE>" }. Additive + best-effort — a
-- pre-migration deploy just can't store the title and the band falls back to the
-- stone name on the left (exactly today's behaviour).
alter table public.challans add column if not exists stone_heads jsonb;

notify pgrst, 'reload schema';
