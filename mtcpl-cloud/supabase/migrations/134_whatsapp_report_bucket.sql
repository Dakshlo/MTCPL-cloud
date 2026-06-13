-- ──────────────────────────────────────────────────────────────────
-- 134 — WhatsApp daily-report PDF bucket (Daksh, June 2026)
--
-- The daily work-report PDF is generated server-side, uploaded here,
-- and its PUBLIC url is handed to MSG91 → WhatsApp (Meta fetches the
-- document from the url to attach it to the template message). Public
-- so Meta's servers can pull it; paths are uuid-random so they aren't
-- guessable/listable.
--
-- Purely additive — one storage bucket.
-- ──────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp_reports', 'whatsapp_reports', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ROLLBACK: DELETE FROM storage.buckets WHERE id = 'whatsapp_reports';
