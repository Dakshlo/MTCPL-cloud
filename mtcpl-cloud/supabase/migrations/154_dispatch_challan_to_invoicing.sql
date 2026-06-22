-- ──────────────────────────────────────────────────────────────────
-- 154 — Dispatch challan → Invoicing bridge (Daksh, June 2026)
--
-- When a dispatch is APPROVED, auto-create an invoicing challan for the
-- delivered slabs so the invoicing team can convert it to an invoice.
-- The customer is resolved by mapping the temple/site to an invoice
-- party (temples.invoice_party_id, set in Settings → Temple Codes).
--
--   • temples.invoice_party_id   — which customer a temple bills to.
--   • challans.source_dispatch_id — the dispatch that spawned this
--     invoicing challan (idempotency: don't double-create; traceability).
-- Purely additive.
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.temples
  ADD COLUMN IF NOT EXISTS invoice_party_id UUID NULL
    REFERENCES public.invoice_parties(id) ON DELETE SET NULL;

ALTER TABLE public.challans
  ADD COLUMN IF NOT EXISTS source_dispatch_id UUID NULL
    REFERENCES public.dispatches(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS challans_source_dispatch_uidx
  ON public.challans (source_dispatch_id)
  WHERE source_dispatch_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
