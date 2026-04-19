-- 006_chat_messages_images.sql
--
-- Adds image attachment support to Templ-AI / MTCPL-AI chats. Images are
-- stored inline as base64 data URLs in a TEXT[] column on chat_messages.
--
-- Rationale for inline base64 (not Supabase Storage):
--   - Typical resized image (client-side ≤1024px, JPEG 0.8) ~200 KB
--   - No public-bucket / signed-URL plumbing
--   - Cleans up naturally when a session is deleted (ON DELETE CASCADE)
--   - Plenty of headroom inside Supabase's base plan
--
-- Claude's API accepts base64 image blocks directly; the server splits each
-- data URL into {media_type, data} when forwarding.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS images TEXT[];

-- ROLLBACK:
--   ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS images;
--   -- Any attached images on existing messages are lost.
