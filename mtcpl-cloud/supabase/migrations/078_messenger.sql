-- ──────────────────────────────────────────────────────────────────
-- Mig 078 — Messenger pilot (owner ↔ developer)
-- ──────────────────────────────────────────────────────────────────
--
-- Daksh May 2026 — WhatsApp-shaped 1:1 chat built into the MTCPL
-- app. Pilot scope is two people (the owner profile + the developer
-- profile) so we can validate the realtime + storage roundtrip on
-- the real Supabase + Vercel pair before widening to more users.
--
-- Schema notes:
--   • Only one table — messenger_messages. The "thread" is implicit:
--     (sender_id, recipient_id) unordered. Two indexes — one keyed
--     on the unordered pair for fast thread fetches, one partial
--     index on unread rows for cheap badge counts.
--   • kind ∈ {text, voice, image}. Text bodies live in body; voice +
--     image bodies live in storage and the row carries media_path.
--   • Soft delete only — deleted_at + deleted_by stamped, body /
--     media_path blanked at the action level so the row stays
--     auditable. UI renders "🚫 This message was deleted".
--   • read_at is a single timestamp (not an array) because each
--     row has exactly one recipient.
--   • media_duration_sec is voice-only; capped at 600s (10 min) as
--     a sanity ceiling — UI enforces 2 min, this is the upper bound
--     in case future code wants longer notes.
--
-- Storage:
--   • messenger_media bucket — PRIVATE. Voice notes (webm/opus,
--     ≤2 MB) and images (jpeg/png, ≤1 MB) per the action-level
--     gate. Served via short-lived signed URLs minted by
--     getSignedMediaUrl().
--
-- RLS / permissions:
--   • Mig 029's footnote: every new public table must enable RLS
--     and add an `authenticated_read_all` SELECT policy itself
--     (the 029 loop doesn't retroactively pick up later tables).
--     We do that at the bottom of this migration.
--   • Reads: the SELECT-to-authenticated policy covers the browser
--     supabase client + realtime subscriptions. We don't filter
--     "only my own conversations" here because the pilot pair is
--     the only conversation that exists (and listing rows you're
--     not part of would still require knowing UUIDs).
--   • Writes: NO insert / update / delete policies. Every write
--     flows through server actions using createAdminSupabaseClient()
--     (service role bypasses RLS). The action-level gate
--     canUseMessenger(profile) is the only enforcement we rely on
--     — developer + owner only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.messenger_messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id          UUID NOT NULL REFERENCES public.profiles(id),
  recipient_id       UUID NOT NULL REFERENCES public.profiles(id),
  kind               TEXT NOT NULL CHECK (kind IN ('text', 'voice', 'image')),
  body               TEXT NULL,
  media_path         TEXT NULL,
  media_mime         TEXT NULL,
  media_duration_sec INT NULL CHECK (
    media_duration_sec IS NULL OR media_duration_sec BETWEEN 0 AND 600
  ),
  read_at            TIMESTAMPTZ NULL,
  deleted_at         TIMESTAMPTZ NULL,
  deleted_by         UUID NULL REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Sanity: sender + recipient must be distinct profiles.
  CONSTRAINT messenger_distinct_parties CHECK (sender_id <> recipient_id)
);

-- Unordered-pair thread key. LEAST/GREATEST normalises so the same
-- conversation has a stable key whichever way the message was sent.
CREATE INDEX IF NOT EXISTS messenger_thread_idx
  ON public.messenger_messages (
    LEAST(sender_id, recipient_id),
    GREATEST(sender_id, recipient_id),
    created_at DESC
  );

-- Partial index for unread badge counts — the panel queries
-- "messages where recipient_id = me AND read_at IS NULL AND
-- deleted_at IS NULL".
CREATE INDEX IF NOT EXISTS messenger_unread_idx
  ON public.messenger_messages (recipient_id, created_at DESC)
  WHERE read_at IS NULL AND deleted_at IS NULL;

-- Private storage bucket. ON CONFLICT keeps this idempotent if the
-- migration is re-run on a stage env that already had it. Media
-- access from the browser is via signed URLs minted server-side
-- (createSignedUrl) so we don't need to add storage.objects
-- policies — signed URLs bypass RLS by design.
INSERT INTO storage.buckets (id, name, public)
VALUES ('messenger_media', 'messenger_media', FALSE)
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────
-- RLS — mandatory follow-on from mig 029. Without this:
--   • Supabase advisor flags rls_disabled_in_public.
--   • Anyone with the anon key (which ships in every client bundle)
--     could SELECT / INSERT directly via PostgREST, skipping the
--     canUseMessenger gate.
--
-- Pattern matches every other table created post-029: enable RLS,
-- add the single `authenticated_read_all` SELECT policy. Writes
-- continue via service-role bypass.
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.messenger_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read_all
  ON public.messenger_messages
  FOR SELECT
  TO authenticated
  USING (TRUE);

NOTIFY pgrst, 'reload schema';
COMMIT;
