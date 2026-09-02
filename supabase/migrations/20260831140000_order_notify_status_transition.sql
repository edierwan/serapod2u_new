-- Only queue order notifications when status actually changes.
-- A later UPDATE on an already-cancelled order was re-firing order_rejected.

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
  v_setting_enabled BOOLEAN;
  v_channels_enabled TEXT[];
  v_recipient_config JSONB;
  v_preset TEXT;
  v_chain TEXT[];
  v_first_channel TEXT;
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
  ELSIF v_status_text = 'closed' AND v_old_status_text IS DISTINCT FROM 'closed' THEN
    v_event_code := 'order_closed';
  ELSIF v_status_text = 'rejected' AND v_old_status_text IS DISTINCT FROM 'rejected' THEN
    v_event_code := 'order_rejected';
  ELSIF v_status_text = 'cancelled' AND v_old_status_text IS DISTINCT FROM 'cancelled' THEN
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
    'order_id', NEW.id,
    'order_no', COALESCE(NEW.display_doc_no, NEW.order_no, ''),
    'order_date', TO_CHAR(NEW.created_at, 'DD Mon YYYY'),
    'order_type', NEW.order_type,
    'status', NEW.status,
    'buyer_org', (SELECT org_name FROM organizations WHERE id = v_buyer_org_id),
    'seller_org', (SELECT org_name FROM organizations WHERE id = v_seller_org_id),
    'customer_name', v_customer_name,
    'created_by', COALESCE(v_created_by_name, 'Unknown'),
    'User', COALESCE(v_created_by_name, 'Unknown'),
    'created_by_id', NEW.created_by,
    'created_by_phone', COALESCE(NULLIF(TRIM(COALESCE(v_creator_phone, '')), ''), ''),
    'created_by_email', COALESCE(NULLIF(TRIM(COALESCE(v_creator_email, '')), ''), ''),
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
    SELECT ns.enabled, ns.channels_enabled, ns.recipient_config
    INTO v_setting_enabled, v_channels_enabled, v_recipient_config
    FROM notification_settings ns
    WHERE ns.org_id = v_company_id
      AND ns.event_code = v_event_code
    LIMIT 1;

    IF v_setting_enabled IS NOT TRUE THEN
      RETURN NEW;
    END IF;

    v_preset := COALESCE(v_recipient_config->'routing'->>'preset', '');

    IF v_preset = 'email_only' THEN
      v_chain := ARRAY['email'];
    ELSIF v_preset = 'sms_only' THEN
      v_chain := ARRAY['sms'];
    ELSIF v_preset = 'whatsapp_only' THEN
      v_chain := ARRAY['whatsapp'];
    ELSIF v_preset = 'whatsapp_email_fallback' THEN
      v_chain := ARRAY['whatsapp', 'email'];
    ELSIF v_preset = 'whatsapp_sms_email_fallback' THEN
      v_chain := ARRAY['whatsapp', 'sms', 'email'];
    ELSIF v_channels_enabled IS NOT NULL AND 'whatsapp' = ANY(v_channels_enabled) AND 'email' = ANY(v_channels_enabled) THEN
      v_chain := ARRAY['whatsapp', 'email'];
    ELSIF v_channels_enabled IS NOT NULL AND 'email' = ANY(v_channels_enabled) AND array_length(v_channels_enabled, 1) = 1 THEN
      v_chain := ARRAY['email'];
    ELSIF v_channels_enabled IS NOT NULL AND 'sms' = ANY(v_channels_enabled) AND array_length(v_channels_enabled, 1) = 1 THEN
      v_chain := ARRAY['sms'];
    ELSE
      v_chain := ARRAY['whatsapp'];
    END IF;

    SELECT p.channel
    INTO v_first_channel
    FROM unnest(v_chain) WITH ORDINALITY AS c(channel, ord)
    JOIN notification_provider_configs p
      ON p.org_id = v_company_id
     AND p.channel = c.channel
     AND p.is_active IS TRUE
    ORDER BY c.ord
    LIMIT 1;

    IF v_first_channel IS NULL THEN
      v_first_channel := v_chain[1];
    END IF;

    PERFORM public.queue_notification(
      v_company_id,
      v_event_code,
      v_first_channel,
      CASE
        WHEN v_first_channel IN ('sms', 'whatsapp')
         AND COALESCE((v_recipient_config->'recipient_targets'->>'order_creator')::boolean, true)
        THEN NULLIF(TRIM(COALESCE(v_creator_phone, '')), '')
        ELSE NULL
      END,
      CASE
        WHEN v_first_channel = 'email'
         AND COALESCE((v_recipient_config->'recipient_targets'->>'order_creator')::boolean, true)
        THEN NULLIF(TRIM(COALESCE(v_creator_email, '')), '')
        ELSE NULL
      END,
      NULL,
      v_payload,
      'normal',
      NULL
    );
  ELSE
    PERFORM public.queue_notification(
      v_company_id, v_event_code, channel, NULL, NULL, NULL, v_payload, 'normal', NULL
    )
    FROM unnest(ARRAY['whatsapp', 'sms', 'email']) AS channel;
  END IF;

  RETURN NEW;
END;
$_$;

COMMENT ON FUNCTION public.trigger_order_notification() IS
  'Queues notifications only when order status actually changes. cancelled/rejected/closed do not re-queue on later updates of the same status. order_rejected queues the first hop from notification_settings; fallback hops are handled by the outbox worker.';
