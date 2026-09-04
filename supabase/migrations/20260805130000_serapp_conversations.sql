BEGIN;

-- Serapp WhatsApp-style conversations (persisted threads)

CREATE TABLE IF NOT EXISTS public.serapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  owner_org_id uuid NOT NULL REFERENCES public.organizations(id),
  -- Optional distributor context (HQ Support UAT); distributors use their own org
  distributor_org_id uuid REFERENCES public.organizations(id),
  kind text NOT NULL DEFAULT 'assistant'
    CHECK (kind IN ('assistant', 'warehouse', 'news', 'support')),
  title text NOT NULL,
  subtitle text,
  avatar_key text NOT NULL DEFAULT 'bot',
  last_message_preview text,
  last_message_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0,
  -- Per-thread order session (independent chats)
  session_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serapp_conversations_owner_last
  ON public.serapp_conversations (owner_user_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_serapp_conversations_org
  ON public.serapp_conversations (owner_org_id, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.serapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.serapp_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'bot', 'system')),
  body text NOT NULL DEFAULT '',
  card_json jsonb,
  quick_replies_json jsonb,
  client_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serapp_messages_conversation_created
  ON public.serapp_messages (conversation_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_serapp_messages_client_id
  ON public.serapp_messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE public.serapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.serapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS serapp_conversations_select ON public.serapp_conversations;
CREATE POLICY serapp_conversations_select ON public.serapp_conversations
  FOR SELECT TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.is_hq_admin()
    OR public.can_access_org(owner_org_id)
  );

DROP POLICY IF EXISTS serapp_conversations_insert ON public.serapp_conversations;
CREATE POLICY serapp_conversations_insert ON public.serapp_conversations
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS serapp_conversations_update ON public.serapp_conversations;
CREATE POLICY serapp_conversations_update ON public.serapp_conversations
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid() OR public.is_hq_admin())
  WITH CHECK (owner_user_id = auth.uid() OR public.is_hq_admin());

DROP POLICY IF EXISTS serapp_messages_select ON public.serapp_messages;
CREATE POLICY serapp_messages_select ON public.serapp_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.serapp_conversations c
      WHERE c.id = conversation_id
        AND (
          c.owner_user_id = auth.uid()
          OR public.is_hq_admin()
          OR public.can_access_org(c.owner_org_id)
        )
    )
  );

DROP POLICY IF EXISTS serapp_messages_insert ON public.serapp_messages;
CREATE POLICY serapp_messages_insert ON public.serapp_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.serapp_conversations c
      WHERE c.id = conversation_id
        AND c.owner_user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.serapp_conversations IS
  'Serapp WhatsApp-style chat threads. Each conversation has independent message history and order session_json.';

COMMENT ON TABLE public.serapp_messages IS
  'Persisted Serapp chat messages (user / bot / system) belonging to one conversation thread.';

COMMIT;
