-- Hotfix: messaging timeline trigger passes orders.status (enum order_status)
-- into messaging_timeline_append(..., text, text, ...) which fails resolution:
--   function messaging_timeline_append(uuid, unknown, uuid, text, order_status, unknown, jsonb) does not exist
-- Cast enum statuses to text. Messaging/Telegram path only.

BEGIN;

CREATE OR REPLACE FUNCTION public.messaging_order_submit_timeline_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source_channel IN ('telegram', 'whatsapp')
     AND NEW.status = 'submitted'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'submitted') THEN
    PERFORM public.messaging_timeline_append(
      NEW.id, 'ORDER_SUBMITTED', NEW.created_by, NEW.source_channel,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text ELSE 'draft' END,
      'submitted',
      jsonb_build_object('order_no', COALESCE(NEW.display_doc_no, NEW.order_no))
    );
  END IF;

  IF NEW.source_channel IN ('telegram', 'whatsapp')
     AND NEW.status = 'approved'
     AND (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'approved') THEN
    PERFORM public.messaging_timeline_append(
      NEW.id, 'ORDER_APPROVED', NEW.approved_by, 'admin',
      OLD.status::text, 'approved', '{}'::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
