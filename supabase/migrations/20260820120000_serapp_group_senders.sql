BEGIN;

ALTER TABLE public.serapp_messages
  ADD COLUMN IF NOT EXISTS sender_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sender_display_name text,
  ADD COLUMN IF NOT EXISTS sender_kind text
    CHECK (sender_kind IS NULL OR sender_kind IN ('distributor', 'hq'));

CREATE INDEX IF NOT EXISTS idx_serapp_messages_sender
  ON public.serapp_messages (conversation_id, sender_user_id);

COMMENT ON COLUMN public.serapp_messages.sender_kind IS
  'WhatsApp-group sender: distributor member or HQ/accounts intervening in the same org chat.';

COMMIT;
