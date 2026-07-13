-- 199: Multiple GST slabs in one invoice (Daksh, Jul 2026).
--
-- Until now an invoice carried ONE GST % (challans / bulk_invoices /
-- other_challans gst_mode + igst/cgst/sgst_percent). Some bills mix goods with
-- different slabs, so GST becomes a PER-TABLE (per section / per stone band)
-- mandatory field on all four invoice paths:
--
--   • Work order (bulk) + Running + Other Sales — the line items already carry
--     their table via section_index/section_head (migs 179/182/183). Add
--     section_gst (the table's slab %, denormalised onto each row exactly like
--     section_head). In CGST+SGST mode the slab splits half/half.
--   • Purchase (priced dispatch challan) — tables are the stone bands; add
--     challans.stone_gst jsonb { "<stone>|<unit>" → pct }, sibling of the
--     mig-187 stone_heads map.
--
-- The invoice-level *_percent columns stay: they are written when every table
-- shares one slab (keeps every legacy reader correct) and NULL when tables
-- differ. Rendering prefers the per-table values when present; invoices created
-- BEFORE this migration have no per-table values and keep computing exactly as
-- before — nothing changes on already-created invoices.

alter table public.bulk_invoice_items   add column if not exists section_gst numeric;
alter table public.challan_custom_items add column if not exists section_gst numeric;
alter table public.other_challan_items  add column if not exists section_gst numeric;

-- Purchase items too — the slab is denormalised per LINE at pricing time (same
-- as rate/amount), so every totals consumer (dashboard, invoices list, approval,
-- WhatsApp report, prints) reads all four invoice types the same way.
alter table public.challan_items add column if not exists section_gst numeric;

alter table public.challans add column if not exists stone_gst jsonb;

notify pgrst, 'reload schema';
