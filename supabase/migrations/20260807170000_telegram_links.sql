BEGIN;

-- Telegram ↔ Serapod distributor account linking (pilot channel alongside Serapp PWA)

CREATE TABLE IF NOT EXISTS public.telegram_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  telegram_username text,
  telegram_first_name text,
  session_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT telegram_links_user_unique UNIQUE (user_id),
  CONSTRAINT telegram_links_tg_user_unique UNIQUE (telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_links_org
  ON public.telegram_links (organization_id);

CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_link_tokens_token_unique UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user_active
  ON public.telegram_link_tokens (user_id, expires_at DESC)
  WHERE consumed_at IS NULL;

ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_links_select_own ON public.telegram_links;
CREATE POLICY telegram_links_select_own ON public.telegram_links
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_hq_admin());

DROP POLICY IF EXISTS telegram_links_delete_own ON public.telegram_links;
CREATE POLICY telegram_links_delete_own ON public.telegram_links
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS telegram_link_tokens_select_own ON public.telegram_link_tokens;
CREATE POLICY telegram_link_tokens_select_own ON public.telegram_link_tokens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMIT;
