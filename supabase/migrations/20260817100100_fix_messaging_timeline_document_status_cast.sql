-- Hotfix round 2: invoice timeline passes documents.status (enum document_status)
-- into messaging_timeline_append which expects text:
--   function messaging_timeline_append(uuid, unknown, uuid, text, unknown, document_status, jsonb) does not exist
-- Also re-assert order_status casts from the previous hotfix.

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

CREATE OR REPLACE FUNCTION public.messaging_invoice_timeline_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel text;
BEGIN
  IF NEW.doc_type <> 'INVOICE' THEN
    RETURN NEW;
  END IF;

  SELECT source_channel INTO v_channel FROM public.orders WHERE id = NEW.order_id;
  IF v_channel IN ('telegram', 'whatsapp') THEN
    PERFORM public.messaging_timeline_append(
      NEW.order_id, 'INVOICE_CREATED', NEW.created_by, v_channel,
      NULL, NEW.status::text,
      jsonb_build_object('invoice_no', COALESCE(NEW.display_doc_no, NEW.doc_no))
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
