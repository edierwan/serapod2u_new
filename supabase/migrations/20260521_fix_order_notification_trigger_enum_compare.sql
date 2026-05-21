-- Fix trigger_order_notification() to compare order status via text.
--
-- Some environments no longer include 'rejected' in the order_status enum.
-- Direct enum comparisons against a removed label raise:
--   invalid input value for enum order_status: "rejected"
-- Casting NEW/OLD.status to text keeps the trigger safe across enum drift.

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

  v_payload := jsonb_build_object(
    'order_no', COALESCE(NEW.display_doc_no, NEW.order_no, ''),
    'order_date', TO_CHAR(NEW.created_at, 'DD Mon YYYY'),
    'order_type', NEW.order_type,
    'status', NEW.status,
    'buyer_org', (SELECT org_name FROM organizations WHERE id = v_buyer_org_id),
    'seller_org', (SELECT org_name FROM organizations WHERE id = v_seller_org_id),
    'customer_name', v_customer_name,
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

  PERFORM public.queue_notification(
    v_company_id,
    v_event_code,
    channel,
    NULL,
    NULL,
    NULL,
    v_payload,
    'normal',
    NULL
  )
  FROM unnest(ARRAY['whatsapp', 'sms', 'email']) AS channel;

  RETURN NEW;
END;
$_$;

COMMENT ON FUNCTION public.trigger_order_notification() IS 'Queues enriched notifications on order status change (submitted, approved, closed, cancelled). Uses display_doc_no for the order number format and compares enum statuses via text to tolerate enum drift.';