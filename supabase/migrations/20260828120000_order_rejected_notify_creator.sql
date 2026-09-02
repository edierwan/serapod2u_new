-- Order Rejected/Cancelled notifications should reach the order creator directly,
-- not fan out to every staff member matching the org's configured notification
-- roles. Previously all three channels were queued with NULL recipient_phone/
-- recipient_email, so the outbox worker always fell back to recipient_config
-- role resolution (e.g. every "Admin") -> multiple wrong messages to staff,
-- none to the person who actually needs to know their order was rejected.
--
-- Fix: for event_code = 'order_rejected' only, resolve the creator's own
-- phone/email (NEW.created_by) and pass them directly as the recipient. This
-- makes to_phone/to_email non-NULL at insert time, so the worker's fan-out
-- resolution block is skipped entirely for this event -> exactly one message
-- per channel, sent straight to the order creator. If the creator has no
-- phone (for sms/whatsapp) or no email, that channel's recipient stays NULL
-- and falls back to the existing staff resolution as a safety net, so the
-- notification is never silently dropped.
--
-- order_submitted / order_approved / order_closed are UNCHANGED by this
-- migration -- still queued with NULL recipients (staff/role fan-out), as
-- discussed separately.

CREATE OR REPLACE FUNCTION public.trigger_order_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  v_event_code TEXT;
  v_company_id UUID;
  v_buyer_org_id UUID;
  v_seller_org_id UUID;
  v_payload JSONB;
  v_total_amount NUMERIC;
  v_total_cases INT;
  v_total_items INT;
  v_item_list TEXT;
  v_customer_name TEXT;
  v_customer_phone TEXT;
  v_delivery_address TEXT;
  v_created_by_name TEXT;
  v_creator_phone TEXT;
  v_creator_email TEXT;
  v_notes TEXT;
  v_approver_name TEXT;
  v_status_text TEXT;
  v_old_status_text TEXT;
BEGIN
  IF TG_OP != 'UPDATE' THEN
    RETURN NEW;
  END IF;

  v_status_text := NEW.status::text;
  v_old_status_text := OLD.status::text;

  IF v_status_text = 'submitted' AND v_old_status_text = 'draft' THEN
    v_event_code := 'order_submitted';
  ELSIF v_status_text = 'approved' AND v_old_status_text = 'submitted' THEN
    v_event_code := 'order_approved';
  ELSIF v_status_text = 'closed' THEN
    v_event_code := 'order_closed';
  ELSIF v_status_text = 'rejected' THEN
    v_event_code := 'order_rejected';
  ELSIF v_status_text = 'cancelled' THEN
    v_event_code := 'order_rejected';
  ELSE
    RETURN NEW;
  END IF;

  v_company_id := NEW.company_id;
  v_buyer_org_id := NEW.buyer_org_id;
  v_seller_org_id := NEW.seller_org_id;

  SELECT
    COALESCE(SUM(oi.line_total), 0),
    COALESCE(COUNT(*), 0),
    COALESCE(SUM(CEIL(oi.qty::numeric / GREATEST(COALESCE(oi.units_per_case, NEW.units_per_case, 100), 1))), 0)
  INTO v_total_amount, v_total_items, v_total_cases
  FROM order_items oi
  WHERE oi.order_id = NEW.id;

  SELECT string_agg(
    '• ' || COALESCE(p.product_name, 'Product') ||
    CASE WHEN pv.variant_name IS NOT NULL AND pv.variant_name != ''
         THEN ' – ' || pv.variant_name ELSE '' END ||
    ' × ' || oi.qty || ' units' ||
    ' (' || CEIL(oi.qty::numeric / GREATEST(COALESCE(oi.units_per_case, NEW.units_per_case, 100), 1)) || ' case' ||
    CASE WHEN CEIL(oi.qty::numeric / GREATEST(COALESCE(oi.units_per_case, NEW.units_per_case, 100), 1)) > 1 THEN 's' ELSE '' END ||
    ') — RM ' || TO_CHAR(oi.line_total, 'FM999,999,990.00'),
    E'\n'
  )
  INTO v_item_list
  FROM order_items oi
  LEFT JOIN products p ON p.id = oi.product_id
  LEFT JOIN product_variants pv ON pv.id = oi.variant_id
  WHERE oi.order_id = NEW.id;

  v_notes := COALESCE(NEW.notes, '');
  v_customer_name := COALESCE(
    (SELECT m[1] FROM regexp_matches(v_notes, 'Customer:\s*([^,]+)') AS m),
    (SELECT org_name FROM organizations WHERE id = v_buyer_org_id),
    'Customer'
  );
  v_customer_phone := COALESCE(
    (SELECT m[1] FROM regexp_matches(v_notes, 'Phone:\s*([^,]+)') AS m),
    ''
  );
  v_delivery_address := COALESCE(
    (SELECT m[1] FROM regexp_matches(v_notes, 'Address:\s*(.+)$') AS m),
    ''
  );

  SELECT
    COALESCE(NULLIF(TRIM(u.full_name), ''), u.email, 'Unknown'),
    u.phone,
    u.email
  INTO v_created_by_name, v_creator_phone, v_creator_email
  FROM users u
  WHERE u.id = NEW.created_by;

  v_payload := jsonb_build_object(
    'order_no', COALESCE(NEW.display_doc_no, NEW.order_no, ''),
    'order_date', TO_CHAR(NEW.created_at, 'DD Mon YYYY'),
    'order_type', NEW.order_type,
    'status', NEW.status,
    'buyer_org', (SELECT org_name FROM organizations WHERE id = v_buyer_org_id),
    'seller_org', (SELECT org_name FROM organizations WHERE id = v_seller_org_id),
    'customer_name', v_customer_name,
    'created_by', COALESCE(v_created_by_name, 'Unknown'),
    'customer_phone', v_customer_phone,
    'delivery_address', v_delivery_address,
    'amount', TO_CHAR(v_total_amount, 'FM999,999,990.00'),
    'total_cases', v_total_cases::text,
    'total_items', v_total_items::text,
    'item_list', COALESCE(v_item_list, 'No items'),
    'order_url', 'https://app.serapod2u.com/supply-chain'
  );

  IF v_event_code = 'order_approved' THEN
    SELECT COALESCE(u.full_name, u.email, 'System')
    INTO v_approver_name
    FROM users u WHERE u.id = NEW.approved_by;

    v_payload := v_payload || jsonb_build_object(
      'approved_by', COALESCE(v_approver_name, 'System'),
      'approved_at', COALESCE(TO_CHAR(NEW.approved_at, 'DD Mon YYYY HH24:MI'), '')
    );
  END IF;

  IF v_event_code = 'order_rejected' THEN
    v_payload := v_payload || jsonb_build_object(
      'reason', CASE
        WHEN v_status_text = 'cancelled' THEN 'Order was cancelled'
        ELSE 'Order was rejected'
      END,
      'action', v_status_text
    );
  END IF;

  IF v_event_code = 'order_closed' THEN
    v_payload := v_payload || jsonb_build_object(
      'closed_at', TO_CHAR(NEW.updated_at, 'DD Mon YYYY HH24:MI')
    );
  END IF;

  IF v_event_code = 'order_rejected' THEN
    -- Notify the order creator directly. Non-NULL recipient here means the
    -- outbox worker will NOT fall back to recipient_config/role resolution
    -- for this row, so this is exactly one message per channel, to one person.
    PERFORM public.queue_notification(
      v_company_id,
      v_event_code,
      channel,
      CASE WHEN channel IN ('sms', 'whatsapp') THEN NULLIF(v_creator_phone, '') ELSE NULL END,
      CASE WHEN channel = 'email' THEN NULLIF(v_creator_email, '') ELSE NULL END,
      NULL,
      v_payload,
      'normal',
      NULL
    )
    FROM unnest(ARRAY['whatsapp', 'sms', 'email']) AS channel;
  ELSE
    PERFORM public.queue_notification(
      v_company_id, v_event_code, channel, NULL, NULL, NULL, v_payload, 'normal', NULL
    )
    FROM unnest(ARRAY['whatsapp', 'sms', 'email']) AS channel;
  END IF;

  RETURN NEW;
END;
$_$;

COMMENT ON FUNCTION public.trigger_order_notification() IS 'Queues enriched notifications on order status change (submitted, approved, closed, cancelled). order_rejected (rejected/cancelled) notifies the order creator directly instead of fanning out to staff roles. Includes created_by (user full name) for SMS templates.';
