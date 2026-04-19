-- 005_chat_sessions.sql
--
-- Persistent chat history for the /ask-ai page — "recent chats" sidebar so
-- users can come back and pick up any past conversation. Scoped per user
-- via RLS: you only ever see your own sessions and messages.
--
-- Tables:
--
--   chat_sessions(id, user_id, title, created_at, updated_at)
--   chat_messages(id, session_id, role, content, created_at)
--
-- Deleting a session cascades to its messages. Read policies are
-- auth.uid() = owner; writes happen from the server using the admin client,
-- so no insert/update policy needed for end users.

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
  ON public.chat_sessions (user_id, updated_at DESC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_sessions own read" ON public.chat_sessions;
CREATE POLICY "chat_sessions own read" ON public.chat_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON public.chat_messages (session_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_messages own read" ON public.chat_messages;
CREATE POLICY "chat_messages own read" ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions s
      WHERE s.id = chat_messages.session_id
        AND s.user_id = auth.uid()
    )
  );

-- ROLLBACK:
--   DROP TABLE IF EXISTS public.chat_messages;
--   DROP TABLE IF EXISTS public.chat_sessions;
--   -- Existing chat history is lost on rollback.
