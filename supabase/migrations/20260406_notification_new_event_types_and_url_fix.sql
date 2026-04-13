-- Migration: Add new notification event types and fix order_url in trigger
-- Events: qr_batch_generated, warehouse_received
-- Fix: order_url from /orders to /supply-chain in trigger_order_notification()

-- ============================================================================
-- 1. Insert new notification_types
-- ============================================================================

INSERT INTO public.notification_types (category, event_code, event_name, event_description, default_enabled, available_channels, is_system, sort_order)
VALUES
  ('order', 'qr_batch_generated', 'QR Batch Generated', 'Sent when all QR codes for an order batch have been generated and the Excel file is ready', false, ARRAY['whatsapp','sms','email'], false, 60),
  ('order', 'warehouse_received', 'Warehouse Receive Order', 'Sent when warehouse receiving is complete and inventory has been updated', false, ARRAY['whatsapp','sms','email'], false, 70)
ON CONFLICT (event_code) DO NOTHING;

-- ============================================================================
-- 2. Fix order_url in trigger_order_notification()
-- ============================================================================

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
BEGIN
  -- Only handle UPDATE
  IF TG_OP != 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Determine event code based on status change
  IF NEW.status = 'submitted' AND OLD.status = 'draft' THEN
    v_event_code := 'order_submitted';
  ELSIF NEW.status = 'approved' AND OLD.status = 'submitted' THEN
    v_event_code := 'order_approved';
  ELSIF NEW.status = 'closed' THEN
    v_event_code := 'order_closed';
  ELSIF NEW.status = 'rejected' THEN
    v_event_code := 'order_rejected';
  ELSIF NEW.status = 'cancelled' THEN
    v_event_code := 'order_rejected'; -- Map cancelled to rejected event
  ELSE
    RETURN NEW; -- No notification needed
  END IF;

  v_company_id := NEW.company_id;
  v_buyer_org_id := NEW.buyer_org_id;
  v_seller_org_id := NEW.seller_org_id;

  -- Calculate totals from order_items
  SELECT 
    COALESCE(SUM(oi.line_total), 0),
    COALESCE(COUNT(*), 0),
    COALESCE(SUM(CEIL(oi.qty::numeric / GREATEST(COALESCE(oi.units_per_case, NEW.units_per_case, 100), 1))), 0)
  INTO v_total_amount, v_total_items, v_total_cases
  FROM order_items oi
  WHERE oi.order_id = NEW.id;

  -- Build item list string
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

  -- Parse customer info from notes field
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

  -- Build enriched payload — using display_doc_no (ORD26000053 format) as primary order number
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

  -- For approved events, add approver info
  IF v_event_code = 'order_approved' THEN
    SELECT COALESCE(u.full_name, u.email, 'System')
    INTO v_approver_name
    FROM users u WHERE u.id = NEW.approved_by;

    v_payload := v_payload || jsonb_build_object(
      'approved_by', COALESCE(v_approver_name, 'System'),
      'approved_at', COALESCE(TO_CHAR(NEW.approved_at, 'DD Mon YYYY HH24:MI'), '')
    );
  END IF;

  -- For rejected/cancelled events, add reason
  IF v_event_code = 'order_rejected' THEN
    v_payload := v_payload || jsonb_build_object(
      'reason', CASE 
        WHEN NEW.status = 'cancelled' THEN 'Order was cancelled'
        ELSE 'Order was rejected'
      END,
      'action', NEW.status -- 'rejected' or 'cancelled'
    );
  END IF;

  -- For closed events, add closed timestamp  
  IF v_event_code = 'order_closed' THEN
    v_payload := v_payload || jsonb_build_object(
      'closed_at', TO_CHAR(NEW.updated_at, 'DD Mon YYYY HH24:MI')
    );
  END IF;

  -- Queue notifications for enabled channels
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

COMMENT ON FUNCTION public.trigger_order_notification() IS 'Queues enriched notifications on order status change (submitted, approved, closed, rejected, cancelled). Uses display_doc_no for the order number format.';
