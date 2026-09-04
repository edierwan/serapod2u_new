BEGIN;

ALTER TABLE public.serapp_messages
  ADD COLUMN IF NOT EXISTS attachment_json jsonb;

COMMENT ON COLUMN public.serapp_messages.attachment_json IS
  'Optional single attachment metadata for Serapp chat message (bucket/path/name/size/mime/url).';

COMMIT;
