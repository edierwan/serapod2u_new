BEGIN;

ALTER TABLE public.serapp_messages
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS seen_by_owner boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_serapp_messages_seen
  ON public.serapp_messages (conversation_id, seen_by_owner, created_at ASC);

CREATE TABLE IF NOT EXISTS public.serapp_user_presence (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  current_conversation_id uuid REFERENCES public.serapp_conversations(id) ON DELETE SET NULL,
  is_online boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.serapp_user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS serapp_user_presence_select ON public.serapp_user_presence;
CREATE POLICY serapp_user_presence_select ON public.serapp_user_presence
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_hq_admin());

DROP POLICY IF EXISTS serapp_user_presence_insert ON public.serapp_user_presence;
CREATE POLICY serapp_user_presence_insert ON public.serapp_user_presence
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_hq_admin());

DROP POLICY IF EXISTS serapp_user_presence_update ON public.serapp_user_presence;
CREATE POLICY serapp_user_presence_update ON public.serapp_user_presence
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_hq_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_hq_admin());

COMMENT ON TABLE public.serapp_user_presence IS
  'Serapp lightweight presence/heartbeat for WhatsApp-like online and last-seen UI.';

COMMIT;
