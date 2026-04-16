-- Phone normalization hardening
-- Canonical internal format: E.164 with leading plus, e.g. +60123456789

CREATE OR REPLACE FUNCTION public.normalize_phone_e164(phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    cleaned text;
BEGIN
    IF phone IS NULL OR btrim(phone) = '' THEN
        RETURN NULL;
    END IF;

    cleaned := regexp_replace(phone, '[^0-9+]', '', 'g');
    IF cleaned IS NULL OR cleaned = '' THEN
        RETURN NULL;
    END IF;

    IF cleaned ~ '^\+' THEN
        cleaned := regexp_replace(cleaned, '^\+', '');
    ELSIF cleaned ~ '^00' THEN
        cleaned := substring(cleaned FROM 3);
    ELSIF cleaned ~ '^0' THEN
        cleaned := '60' || substring(cleaned FROM 2);
    ELSIF cleaned ~ '^1[0-9]{7,9}$' THEN
        cleaned := '60' || cleaned;
    END IF;

    IF cleaned !~ '^[1-9][0-9]{7,14}$' THEN
        RETURN NULL;
    END IF;

    RETURN '+' || cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION public._normalize_phone_my(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_phone_e164(p_phone)
$$;

CREATE OR REPLACE FUNCTION public.normalize_phone_columns_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    idx integer;
    column_name text;
    raw_value text;
BEGIN
    FOR idx IN 0..TG_NARGS - 1 LOOP
        column_name := TG_ARGV[idx];
        EXECUTE format('SELECT ($1).%I::text', column_name) USING NEW INTO raw_value;
        NEW := jsonb_populate_record(
            NEW,
            jsonb_build_object(column_name, public.normalize_phone_e164(raw_value))
        );
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_phone_exists(p_phone text, p_exclude_user_id uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text;
  v_exists boolean;
BEGIN
  v_phone := public.normalize_phone_e164(p_phone);
  IF v_phone IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE public.normalize_phone_e164(phone) = v_phone
      AND (p_exclude_user_id IS NULL OR id != p_exclude_user_id)
    UNION ALL
    SELECT 1
    FROM public.users
    WHERE public.normalize_phone_e164(phone) = v_phone
      AND (p_exclude_user_id IS NULL OR id != p_exclude_user_id)
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_serapod_user_phone(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_phone text;
  v_exists boolean;
BEGIN
  v_phone := public.normalize_phone_e164(p_phone);
  IF v_phone IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.organizations o ON u.organization_id = o.id
    WHERE public.normalize_phone_e164(u.phone) = v_phone
      AND u.is_active = true
      AND (
        o.org_type_code = 'HQ'
        OR o.org_name ILIKE '%Serapod%'
      )
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_whatsapp_admin(p_org_id uuid, p_phone_digits text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_phone text;
BEGIN
  v_phone := public.normalize_phone_e164(p_phone_digits);
  IF v_phone IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.whatsapp_bot_admins
    WHERE org_id = p_org_id
      AND public.normalize_phone_e164(phone_digits) = v_phone
      AND is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_email_by_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text;
  v_email text;
BEGIN
  v_phone := public.normalize_phone_e164(p_phone);
  IF v_phone IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email
  FROM auth.users
  WHERE public.normalize_phone_e164(phone) = v_phone
  LIMIT 1;

  RETURN v_email;
END;
$$;

DO $$
DECLARE
    item record;
    column_is_nullable boolean;
BEGIN
    FOR item IN
        SELECT *
        FROM (VALUES
            ('users', 'phone'),
            ('users', 'referral_phone'),
            ('organizations', 'contact_phone'),
            ('notification_events', 'recipient_phone'),
            ('marketing_send_logs', 'recipient_phone'),
            ('marketing_report_sessions', 'recipient_phone'),
            ('roadtour_claim_notification_logs', 'phone_number'),
            ('roadtour_scan_events', 'consumer_phone'),
            ('shop_requests', 'requester_phone'),
            ('shop_requests', 'requested_contact_phone'),
            ('consumer_activations', 'consumer_phone'),
            ('feedback', 'consumer_phone'),
            ('lucky_draw_entries', 'consumer_phone'),
            ('points_transactions', 'consumer_phone'),
            ('whatsapp_bot_admins', 'phone_digits'),
            ('whatsapp_conversations', 'user_phone_digits'),
            ('whatsapp_conversations', 'takeover_by_admin_phone'),
            ('whatsapp_bot_sessions', 'gateway_phone_digits')
        ) AS t(table_name, column_name)
    LOOP
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = item.table_name
              AND column_name = item.column_name
        ) THEN
            SELECT (is_nullable = 'YES')
            INTO column_is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = item.table_name
              AND column_name = item.column_name;

            IF column_is_nullable THEN
                EXECUTE format(
                    'UPDATE public.%I SET %I = public.normalize_phone_e164(%I) WHERE %I IS NOT NULL;',
                    item.table_name,
                    item.column_name,
                    item.column_name,
                    item.column_name
                );
            ELSE
                EXECUTE format(
                    'UPDATE public.%I SET %I = public.normalize_phone_e164(%I) WHERE %I IS NOT NULL AND public.normalize_phone_e164(%I) IS NOT NULL;',
                    item.table_name,
                    item.column_name,
                    item.column_name,
                    item.column_name,
                    item.column_name
                );
            END IF;
        END IF;
    END LOOP;
END;
$$;

DO $$
DECLARE
    trigger_spec record;
    existing_columns text[];
    args text;
BEGIN
    FOR trigger_spec IN
        SELECT *
        FROM (VALUES
            ('users', 'users_phone_normalization_trg', ARRAY['phone', 'referral_phone']),
            ('organizations', 'organizations_contact_phone_normalization_trg', ARRAY['contact_phone']),
            ('notification_events', 'notification_events_phone_normalization_trg', ARRAY['recipient_phone']),
            ('marketing_send_logs', 'marketing_send_logs_phone_normalization_trg', ARRAY['recipient_phone']),
            ('marketing_report_sessions', 'marketing_report_sessions_phone_normalization_trg', ARRAY['recipient_phone']),
            ('roadtour_claim_notification_logs', 'roadtour_claim_notification_logs_phone_normalization_trg', ARRAY['phone_number']),
            ('roadtour_scan_events', 'roadtour_scan_events_phone_normalization_trg', ARRAY['consumer_phone']),
            ('shop_requests', 'shop_requests_phone_normalization_trg', ARRAY['requester_phone', 'requested_contact_phone']),
            ('consumer_activations', 'consumer_activations_phone_normalization_trg', ARRAY['consumer_phone']),
            ('feedback', 'feedback_phone_normalization_trg', ARRAY['consumer_phone']),
            ('lucky_draw_entries', 'lucky_draw_entries_phone_normalization_trg', ARRAY['consumer_phone']),
            ('points_transactions', 'points_transactions_phone_normalization_trg', ARRAY['consumer_phone']),
            ('whatsapp_bot_admins', 'whatsapp_bot_admins_phone_normalization_trg', ARRAY['phone_digits']),
            ('whatsapp_conversations', 'whatsapp_conversations_phone_normalization_trg', ARRAY['user_phone_digits', 'takeover_by_admin_phone']),
            ('whatsapp_bot_sessions', 'whatsapp_bot_sessions_phone_normalization_trg', ARRAY['gateway_phone_digits'])
        ) AS t(table_name, trigger_name, columns)
    LOOP
        IF to_regclass(format('public.%s', trigger_spec.table_name)) IS NULL THEN
            CONTINUE;
        END IF;

        SELECT array_agg(column_name ORDER BY array_position(trigger_spec.columns, column_name))
        INTO existing_columns
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = trigger_spec.table_name
          AND column_name = ANY(trigger_spec.columns);

        IF existing_columns IS NULL OR array_length(existing_columns, 1) IS NULL THEN
            CONTINUE;
        END IF;

        args := array_to_string(
            ARRAY(
                SELECT quote_literal(column_name)
                FROM unnest(existing_columns) AS column_name
            ),
            ', '
        );

        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_spec.trigger_name, trigger_spec.table_name);
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.normalize_phone_columns_trigger(%s)',
            trigger_spec.trigger_name,
            trigger_spec.table_name,
            args
        );
    END LOOP;
END;
$$;

ALTER TABLE IF EXISTS public.whatsapp_bot_admins
    DROP CONSTRAINT IF EXISTS whatsapp_bot_admins_phone_valid;

ALTER TABLE IF EXISTS public.whatsapp_bot_admins
    ADD CONSTRAINT whatsapp_bot_admins_phone_valid
    CHECK (phone_digits ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

ALTER TABLE IF EXISTS public.users
    DROP CONSTRAINT IF EXISTS users_phone_e164_chk;

ALTER TABLE IF EXISTS public.users
    ADD CONSTRAINT users_phone_e164_chk
    CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

ALTER TABLE IF EXISTS public.organizations
    DROP CONSTRAINT IF EXISTS organizations_contact_phone_e164_chk;

ALTER TABLE IF EXISTS public.organizations
    ADD CONSTRAINT organizations_contact_phone_e164_chk
    CHECK (contact_phone IS NULL OR contact_phone ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

ALTER TABLE IF EXISTS public.notification_events
    DROP CONSTRAINT IF EXISTS notification_events_recipient_phone_e164_chk;

ALTER TABLE IF EXISTS public.notification_events
    ADD CONSTRAINT notification_events_recipient_phone_e164_chk
    CHECK (recipient_phone IS NULL OR recipient_phone ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

ALTER TABLE IF EXISTS public.marketing_send_logs
    DROP CONSTRAINT IF EXISTS marketing_send_logs_recipient_phone_e164_chk;

ALTER TABLE IF EXISTS public.marketing_send_logs
    ADD CONSTRAINT marketing_send_logs_recipient_phone_e164_chk
    CHECK (recipient_phone IS NULL OR recipient_phone ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

ALTER TABLE IF EXISTS public.roadtour_claim_notification_logs
    DROP CONSTRAINT IF EXISTS roadtour_claim_notification_logs_phone_number_e164_chk;

ALTER TABLE IF EXISTS public.roadtour_claim_notification_logs
    ADD CONSTRAINT roadtour_claim_notification_logs_phone_number_e164_chk
    CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

ALTER TABLE IF EXISTS public.whatsapp_conversations
    DROP CONSTRAINT IF EXISTS whatsapp_conversations_user_phone_e164_chk;

ALTER TABLE IF EXISTS public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_user_phone_e164_chk
    CHECK (user_phone_digits ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

ALTER TABLE IF EXISTS public.whatsapp_bot_sessions
    DROP CONSTRAINT IF EXISTS whatsapp_bot_sessions_gateway_phone_e164_chk;

ALTER TABLE IF EXISTS public.whatsapp_bot_sessions
    ADD CONSTRAINT whatsapp_bot_sessions_gateway_phone_e164_chk
    CHECK (gateway_phone_digits ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

ALTER TABLE IF EXISTS public.whatsapp_bot_admins VALIDATE CONSTRAINT whatsapp_bot_admins_phone_valid;
ALTER TABLE IF EXISTS public.users VALIDATE CONSTRAINT users_phone_e164_chk;
ALTER TABLE IF EXISTS public.organizations VALIDATE CONSTRAINT organizations_contact_phone_e164_chk;
ALTER TABLE IF EXISTS public.notification_events VALIDATE CONSTRAINT notification_events_recipient_phone_e164_chk;
ALTER TABLE IF EXISTS public.marketing_send_logs VALIDATE CONSTRAINT marketing_send_logs_recipient_phone_e164_chk;
ALTER TABLE IF EXISTS public.roadtour_claim_notification_logs VALIDATE CONSTRAINT roadtour_claim_notification_logs_phone_number_e164_chk;
ALTER TABLE IF EXISTS public.whatsapp_conversations VALIDATE CONSTRAINT whatsapp_conversations_user_phone_e164_chk;
ALTER TABLE IF EXISTS public.whatsapp_bot_sessions VALIDATE CONSTRAINT whatsapp_bot_sessions_gateway_phone_e164_chk;

CREATE OR REPLACE VIEW public.phone_normalization_collision_report AS
SELECT
    'users.phone'::text AS source_field,
    public.normalize_phone_e164(phone) AS canonical_phone,
    count(*) AS row_count,
    array_agg(id::text ORDER BY created_at DESC) AS record_ids
FROM public.users
WHERE phone IS NOT NULL
  AND btrim(phone) <> ''
GROUP BY 1, 2
HAVING count(*) > 1;