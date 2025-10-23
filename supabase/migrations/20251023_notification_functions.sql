-- =====================================================
-- NOTIFICATION SYSTEM - DATABASE FUNCTIONS
-- =====================================================
-- Created: 2025-10-23
-- Description: Core functions for notification processing, queuing, and logging

-- =====================================================
-- 1. QUEUE NOTIFICATION FUNCTION
-- =====================================================
-- Main function to queue a notification for delivery
CREATE OR REPLACE FUNCTION public.queue_notification(
  p_org_id UUID,
  p_event_code TEXT,
  p_channel TEXT,
  p_recipient_phone TEXT DEFAULT NULL,
  p_recipient_email TEXT DEFAULT NULL,
  p_template_code TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}',
  p_priority TEXT DEFAULT 'normal',
  p_scheduled_for TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
  v_template_body TEXT;
  v_provider_name TEXT;
  v_is_enabled BOOLEAN;
BEGIN
  -- Check if this event type is enabled for the org
  SELECT enabled INTO v_is_enabled
  FROM public.notification_settings
  WHERE org_id = p_org_id 
    AND event_code = p_event_code
    AND p_channel = ANY(channels_enabled);

  IF NOT FOUND OR v_is_enabled = false THEN
    RAISE NOTICE 'Notification event % not enabled for org % on channel %', p_event_code, p_org_id, p_channel;
    RETURN NULL;
  END IF;

  -- Get active provider for this channel
  SELECT provider_name INTO v_provider_name
  FROM public.notification_provider_configs
  WHERE org_id = p_org_id
    AND channel = p_channel
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_provider_name IS NULL THEN
    RAISE EXCEPTION 'No active provider configured for channel % in org %', p_channel, p_org_id;
  END IF;

  -- Get template if specified, otherwise use default from notification_types
  IF p_template_code IS NULL THEN
    SELECT default_template_code INTO p_template_code
    FROM public.notification_types
    WHERE event_code = p_event_code;
  END IF;

  -- Insert into outbox
  INSERT INTO public.notifications_outbox (
    org_id,
    event_code,
    channel,
    to_phone,
    to_email,
    template_code,
    payload_json,
    priority,
    provider_name,
    scheduled_for,
    status,
    retry_count,
    max_retries,
    created_at
  ) VALUES (
    p_org_id,
    p_event_code,
    p_channel,
    p_recipient_phone,
    p_recipient_email,
    p_template_code,
    p_payload,
    p_priority,
    v_provider_name,
    p_scheduled_for,
    CASE WHEN p_scheduled_for IS NOT NULL THEN 'scheduled' ELSE 'queued' END,
    0,
    3,
    NOW()
  ) RETURNING id INTO v_notification_id;

  -- Log the queued notification
  INSERT INTO public.notification_logs (
    outbox_id,
    org_id,
    event_code,
    channel,
    provider_name,
    recipient_type,
    recipient_value,
    status,
    queued_at,
    created_at
  ) VALUES (
    v_notification_id,
    p_org_id,
    p_event_code,
    p_channel,
    v_provider_name,
    CASE 
      WHEN p_recipient_phone IS NOT NULL THEN 'phone'
      WHEN p_recipient_email IS NOT NULL THEN 'email'
      ELSE 'unknown'
    END,
    COALESCE(p_recipient_phone, p_recipient_email, 'unknown'),
    'queued',
    NOW(),
    NOW()
  );

  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.queue_notification IS 'Queues a notification for delivery. Checks if event is enabled and provider is configured.';

-- =====================================================
-- 2. LOG NOTIFICATION ATTEMPT
-- =====================================================
CREATE OR REPLACE FUNCTION public.log_notification_attempt(
  p_outbox_id UUID,
  p_status TEXT,
  p_provider_message_id TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_provider_response JSONB DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_outbox RECORD;
BEGIN
  -- Get outbox record
  SELECT * INTO v_outbox
  FROM public.notifications_outbox
  WHERE id = p_outbox_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outbox record not found: %', p_outbox_id;
  END IF;

  -- Update outbox
  UPDATE public.notifications_outbox
  SET 
    status = p_status,
    provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
    error = CASE WHEN p_status = 'failed' THEN p_error_message ELSE NULL END,
    sent_at = CASE WHEN p_status = 'sent' THEN NOW() ELSE sent_at END,
    retry_count = CASE WHEN p_status = 'failed' THEN retry_count + 1 ELSE retry_count END,
    next_retry_at = CASE 
      WHEN p_status = 'failed' AND retry_count < max_retries 
      THEN NOW() + (INTERVAL '5 minutes' * POWER(2, retry_count)) -- Exponential backoff
      ELSE NULL 
    END
  WHERE id = p_outbox_id;

  -- Log the attempt
  INSERT INTO public.notification_logs (
    outbox_id,
    org_id,
    event_code,
    channel,
    provider_name,
    recipient_type,
    recipient_value,
    status,
    status_details,
    provider_message_id,
    provider_response,
    sent_at,
    failed_at,
    error_message,
    retry_count,
    created_at
  ) VALUES (
    p_outbox_id,
    v_outbox.org_id,
    v_outbox.event_code,
    v_outbox.channel,
    v_outbox.provider_name,
    CASE 
      WHEN v_outbox.to_phone IS NOT NULL THEN 'phone'
      WHEN v_outbox.to_email IS NOT NULL THEN 'email'
      ELSE 'unknown'
    END,
    COALESCE(v_outbox.to_phone, v_outbox.to_email, 'unknown'),
    p_status,
    CASE 
      WHEN p_status = 'sent' THEN 'Successfully sent to provider'
      WHEN p_status = 'failed' THEN p_error_message
      ELSE NULL
    END,
    p_provider_message_id,
    p_provider_response,
    CASE WHEN p_status = 'sent' THEN NOW() ELSE NULL END,
    CASE WHEN p_status = 'failed' THEN NOW() ELSE NULL END,
    p_error_message,
    v_outbox.retry_count,
    NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.log_notification_attempt IS 'Logs delivery attempt and updates outbox status with retry logic';

-- =====================================================
-- 3. GET PENDING NOTIFICATIONS (For Processing)
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_pending_notifications(
  p_limit INTEGER DEFAULT 100
) RETURNS TABLE (
  id UUID,
  org_id UUID,
  event_code TEXT,
  channel TEXT,
  to_phone TEXT,
  to_email TEXT,
  template_code TEXT,
  payload_json JSONB,
  priority TEXT,
  provider_name TEXT,
  retry_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.org_id,
    n.event_code,
    n.channel,
    n.to_phone,
    n.to_email,
    n.template_code,
    n.payload_json,
    n.priority,
    n.provider_name,
    n.retry_count
  FROM public.notifications_outbox n
  WHERE 
    -- Ready to send
    (n.status = 'queued' OR (n.status = 'failed' AND n.retry_count < n.max_retries AND n.next_retry_at <= NOW()))
    -- Or scheduled and time has come
    OR (n.status = 'scheduled' AND n.scheduled_for <= NOW())
  ORDER BY 
    -- Priority order
    CASE n.priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low' THEN 4
    END,
    n.created_at ASC
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED; -- Prevent race conditions
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.get_pending_notifications IS 'Gets pending notifications ready for delivery with priority ordering and locking';

-- =====================================================
-- 4. GET NOTIFICATION STATISTICS
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_notification_stats(
  p_org_id UUID,
  p_days INTEGER DEFAULT 30
) RETURNS TABLE (
  total_sent BIGINT,
  total_failed BIGINT,
  total_pending BIGINT,
  success_rate NUMERIC,
  by_channel JSONB,
  by_event JSONB,
  recent_failures JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
      COUNT(*) FILTER (WHERE status = 'failed' AND retry_count >= max_retries) as failed_count,
      COUNT(*) FILTER (WHERE status IN ('queued', 'scheduled', 'processing')) as pending_count,
      jsonb_object_agg(
        channel,
        jsonb_build_object(
          'sent', COUNT(*) FILTER (WHERE status = 'sent'),
          'failed', COUNT(*) FILTER (WHERE status = 'failed')
        )
      ) FILTER (WHERE channel IS NOT NULL) as channel_stats,
      jsonb_object_agg(
        event_code,
        jsonb_build_object(
          'sent', COUNT(*) FILTER (WHERE status = 'sent'),
          'failed', COUNT(*) FILTER (WHERE status = 'failed')
        )
      ) FILTER (WHERE event_code IS NOT NULL) as event_stats
    FROM public.notifications_outbox
    WHERE org_id = p_org_id
      AND created_at >= NOW() - (p_days || ' days')::INTERVAL
  ),
  failures AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', id,
        'event_code', event_code,
        'channel', channel,
        'error', error,
        'created_at', created_at
      ) ORDER BY created_at DESC
    ) as failure_list
    FROM public.notifications_outbox
    WHERE org_id = p_org_id
      AND status = 'failed'
      AND created_at >= NOW() - INTERVAL '7 days'
    LIMIT 10
  )
  SELECT
    s.sent_count::BIGINT,
    s.failed_count::BIGINT,
    s.pending_count::BIGINT,
    CASE 
      WHEN (s.sent_count + s.failed_count) > 0 
      THEN ROUND((s.sent_count::NUMERIC / (s.sent_count + s.failed_count)::NUMERIC) * 100, 2)
      ELSE 0
    END as success_rate,
    COALESCE(s.channel_stats, '{}'::jsonb),
    COALESCE(s.event_stats, '{}'::jsonb),
    COALESCE(f.failure_list, '[]'::jsonb)
  FROM stats s
  CROSS JOIN failures f;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.get_notification_stats IS 'Returns comprehensive notification statistics for an organization';

-- =====================================================
-- 5. RENDER MESSAGE TEMPLATE
-- =====================================================
CREATE OR REPLACE FUNCTION public.render_template(
  p_template_code TEXT,
  p_org_id UUID,
  p_payload JSONB
) RETURNS TEXT AS $$
DECLARE
  v_template_body TEXT;
  v_result TEXT;
  v_key TEXT;
  v_value TEXT;
BEGIN
  -- Get template body
  SELECT body INTO v_template_body
  FROM public.message_templates
  WHERE code = p_template_code
    AND org_id = p_org_id
    AND is_active = true;

  IF v_template_body IS NULL THEN
    RAISE EXCEPTION 'Template not found: % for org %', p_template_code, p_org_id;
  END IF;

  v_result := v_template_body;

  -- Simple variable replacement ({{variable_name}})
  FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_payload)
  LOOP
    v_result := REPLACE(v_result, '{{' || v_key || '}}', v_value);
  END LOOP;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.render_template IS 'Renders a message template with variable substitution from payload';

-- =====================================================
-- 6. CLEANUP OLD NOTIFICATIONS
-- =====================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications(
  p_retention_days INTEGER DEFAULT 90
) RETURNS INTEGER AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Archive to logs if needed, then delete from outbox
  WITH deleted AS (
    DELETE FROM public.notifications_outbox
    WHERE created_at < NOW() - (p_retention_days || ' days')::INTERVAL
      AND status IN ('sent', 'failed')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;

  -- Also cleanup very old logs
  DELETE FROM public.notification_logs
  WHERE created_at < NOW() - ((p_retention_days + 30) || ' days')::INTERVAL;

  RAISE NOTICE 'Cleaned up % old notifications', v_deleted_count;
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.cleanup_old_notifications IS 'Removes old sent/failed notifications from outbox to maintain performance';

-- =====================================================
-- 7. TRIGGER: Auto-queue notification on order status change
-- =====================================================
CREATE OR REPLACE FUNCTION public.trigger_order_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_event_code TEXT;
  v_company_id UUID;
  v_buyer_org_id UUID;
  v_seller_org_id UUID;
BEGIN
  -- Determine event code based on status change
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'submitted' AND OLD.status = 'draft' THEN
      v_event_code := 'order_submitted';
    ELSIF NEW.status = 'approved' AND OLD.status = 'submitted' THEN
      v_event_code := 'order_approved';
    ELSIF NEW.status = 'closed' AND OLD.status = 'approved' THEN
      v_event_code := 'order_closed';
    ELSE
      RETURN NEW; -- No notification needed
    END IF;

    v_company_id := NEW.company_id;
    v_buyer_org_id := NEW.buyer_org_id;
    v_seller_org_id := NEW.seller_org_id;

    -- Queue notifications for enabled channels
    PERFORM public.queue_notification(
      v_company_id,
      v_event_code,
      channel,
      NULL, -- Phone will be looked up from user
      NULL, -- Email will be looked up from user  
      NULL, -- Use default template
      jsonb_build_object(
        'order_no', NEW.order_no,
        'order_type', NEW.order_type,
        'buyer_org', (SELECT org_name FROM organizations WHERE id = v_buyer_org_id),
        'seller_org', (SELECT org_name FROM organizations WHERE id = v_seller_org_id),
        'status', NEW.status
      ),
      'normal',
      NULL
    )
    FROM unnest(ARRAY['whatsapp', 'sms', 'email']) AS channel;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_order_status_notification ON public.orders;

-- Create trigger
CREATE TRIGGER trigger_order_status_notification
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_order_notification();

COMMENT ON FUNCTION public.trigger_order_notification IS 'Automatically queues notifications when order status changes';

-- =====================================================
-- 8. TRIGGER: Auto-queue notification on document workflow
-- =====================================================
CREATE OR REPLACE FUNCTION public.trigger_document_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_event_code TEXT;
  v_order RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Map document type and status to event code
    v_event_code := CASE
      WHEN NEW.doc_type = 'PO' AND NEW.status = 'pending' THEN 'po_created'
      WHEN NEW.doc_type = 'PO' AND NEW.status = 'acknowledged' THEN 'po_acknowledged'
      WHEN NEW.doc_type = 'INVOICE' AND NEW.status = 'pending' THEN 'invoice_created'
      WHEN NEW.doc_type = 'INVOICE' AND NEW.status = 'acknowledged' THEN 'invoice_acknowledged'
      WHEN NEW.doc_type = 'PAYMENT' AND NEW.status = 'acknowledged' THEN 'payment_received'
      WHEN NEW.doc_type = 'RECEIPT' THEN 'receipt_issued'
      ELSE NULL
    END;

    IF v_event_code IS NOT NULL THEN
      -- Get order details
      SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;

      -- Queue notification
      PERFORM public.queue_notification(
        NEW.company_id,
        v_event_code,
        channel,
        NULL,
        NULL,
        NULL,
        jsonb_build_object(
          'doc_type', NEW.doc_type,
          'doc_no', NEW.doc_no,
          'order_no', v_order.order_no,
          'issued_by', (SELECT org_name FROM organizations WHERE id = NEW.issued_by_org_id),
          'issued_to', (SELECT org_name FROM organizations WHERE id = NEW.issued_to_org_id)
        ),
        'normal',
        NULL
      )
      FROM unnest(ARRAY['whatsapp', 'email']) AS channel;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_document_notification ON public.documents;

-- Create trigger
CREATE TRIGGER trigger_document_notification
  AFTER INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_document_notification();

COMMENT ON FUNCTION public.trigger_document_notification IS 'Automatically queues notifications for document workflow events';

-- =====================================================
-- COMPLETION
-- =====================================================
DO $$ 
BEGIN
  RAISE NOTICE '✅ Notification system functions created successfully!';
  RAISE NOTICE '📋 Functions: queue_notification, log_notification_attempt, get_pending_notifications';
  RAISE NOTICE '📊 Statistics: get_notification_stats, cleanup_old_notifications';
  RAISE NOTICE '🔔 Triggers: Order status changes, Document workflow';
  RAISE NOTICE '⏭️  Next: Build Settings UI components';
END $$;
