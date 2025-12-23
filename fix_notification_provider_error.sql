CREATE OR REPLACE FUNCTION public.queue_notification(p_org_id uuid, p_event_code text, p_channel text, p_recipient_phone text DEFAULT NULL::text, p_recipient_email text DEFAULT NULL::text, p_template_code text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_priority text DEFAULT 'normal'::text, p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
    -- RAISE NOTICE 'Notification event % not enabled for org % on channel %', p_event_code, p_org_id, p_channel;
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
    -- CHANGED: Log warning instead of raising exception to prevent blocking transactions
    RAISE WARNING 'No active provider configured for channel % in org %', p_channel, p_org_id;
    RETURN NULL;
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
    scheduled_for,
    provider_name
  ) VALUES (
    p_org_id,
    p_event_code,
    p_channel,
    p_recipient_phone,
    p_recipient_email,
    p_template_code,
    p_payload,
    p_priority,
    p_scheduled_for,
    v_provider_name
  ) RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;
