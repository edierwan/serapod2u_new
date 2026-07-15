-- Corrective Stock Count verification rollout for existing installations.
-- Apply after:
--   1. 20260715_stock_count_verification_01.sql
--   2. 20260715_stock_count_verification_02.sql
--
-- This migration is intentionally idempotent and does not enable the security
-- event automatically. Administrators must choose authorized email recipients.

INSERT INTO public.notification_types (
  category, event_code, event_name, event_description,
  default_enabled, available_channels, is_system, sort_order
)
VALUES (
  'inventory', 'stock_count_posting_verification', 'Stock Count Posting Verification',
  'Sends a security code to authorized recipients before inventory adjustments can be posted.',
  false, ARRAY['email'], true, 40
)
ON CONFLICT (event_code) DO UPDATE SET
  category = 'inventory',
  event_name = EXCLUDED.event_name,
  event_description = EXCLUDED.event_description,
  available_channels = ARRAY['email'],
  is_system = true,
  sort_order = 40;

-- Give every existing organization a visible, disabled, email-only setting.
-- Existing recipient selections are retained on conflict.
INSERT INTO public.notification_settings (
  org_id, event_code, enabled, channels_enabled, priority,
  recipient_config, templates, retry_enabled, max_retries
)
SELECT
  o.id,
  'stock_count_posting_verification',
  false,
  ARRAY['email'],
  'critical',
  jsonb_build_object(
    'recipient_targets', jsonb_build_object('roles', false, 'dynamic_org', false, 'users', false, 'consumer', false),
    'recipient_users', '[]'::jsonb,
    'manual_email_addresses', '[]'::jsonb,
    'manual_whatsapp_numbers', '[]'::jsonb,
    'include_consumer', false,
    'routing', jsonb_build_object('preset', 'email_only', 'source', 'event')
  ),
  '{}'::jsonb,
  true,
  3
FROM public.organizations o
ON CONFLICT (org_id, event_code) DO UPDATE SET
  channels_enabled = ARRAY['email'],
  priority = 'critical',
  recipient_config = coalesce(public.notification_settings.recipient_config, '{}'::jsonb)
    || jsonb_build_object(
      'include_consumer', false,
      'manual_whatsapp_numbers', '[]'::jsonb,
      'routing', jsonb_build_object('preset', 'email_only', 'source', 'event')
    );

-- Add the dedicated permission to existing default-authorized roles. Preserve
-- an explicit existing post_stock_count value and mirror an explicit
-- adjust_stock=false denial during the first backfill.
UPDATE public.roles r
SET permissions = CASE
  WHEN jsonb_typeof(coalesce(r.permissions::jsonb, '{}'::jsonb)) = 'array' THEN
    CASE
      WHEN coalesce(r.permissions::jsonb, '[]'::jsonb) ? 'post_stock_count' THEN r.permissions::jsonb
      ELSE coalesce(r.permissions::jsonb, '[]'::jsonb) || '"post_stock_count"'::jsonb
    END
  ELSE
    CASE
      WHEN coalesce(r.permissions::jsonb, '{}'::jsonb) ? 'post_stock_count' THEN r.permissions::jsonb
      ELSE coalesce(r.permissions::jsonb, '{}'::jsonb) || jsonb_build_object(
        'post_stock_count',
        CASE
          WHEN coalesce(r.permissions::jsonb, '{}'::jsonb) ? 'adjust_stock'
            THEN coalesce((r.permissions::jsonb->>'adjust_stock')::boolean, false)
          ELSE true
        END
      )
    END
END
WHERE r.role_level IN (1, 10, 20, 30);

-- Carry explicit department allow/deny overrides forward to the dedicated key.
UPDATE public.departments d
SET permission_overrides = jsonb_set(
  jsonb_set(
    coalesce(d.permission_overrides::jsonb, '{}'::jsonb),
    '{allow}',
    CASE
      WHEN coalesce(d.permission_overrides::jsonb->'allow', '[]'::jsonb) ? 'adjust_stock'
       AND NOT (coalesce(d.permission_overrides::jsonb->'allow', '[]'::jsonb) ? 'post_stock_count')
        THEN coalesce(d.permission_overrides::jsonb->'allow', '[]'::jsonb) || '"post_stock_count"'::jsonb
      ELSE coalesce(d.permission_overrides::jsonb->'allow', '[]'::jsonb)
    END,
    true
  ),
  '{deny}',
  CASE
    WHEN coalesce(d.permission_overrides::jsonb->'deny', '[]'::jsonb) ? 'adjust_stock'
     AND NOT (coalesce(d.permission_overrides::jsonb->'deny', '[]'::jsonb) ? 'post_stock_count')
      THEN coalesce(d.permission_overrides::jsonb->'deny', '[]'::jsonb) || '"post_stock_count"'::jsonb
    ELSE coalesce(d.permission_overrides::jsonb->'deny', '[]'::jsonb)
  END,
  true
)
WHERE coalesce(d.permission_overrides::jsonb->'allow', '[]'::jsonb) ? 'adjust_stock'
   OR coalesce(d.permission_overrides::jsonb->'deny', '[]'::jsonb) ? 'adjust_stock';

CREATE OR REPLACE FUNCTION public.stock_count_user_can_post(p_user_id uuid, p_warehouse_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role_level integer;
  v_role_permissions jsonb;
  v_overrides jsonb;
BEGIN
  SELECT r.role_level, coalesce(r.permissions::jsonb, '{}'::jsonb), coalesce(d.permission_overrides::jsonb, '{}'::jsonb)
    INTO v_role_level, v_role_permissions, v_overrides
  FROM public.users u
  LEFT JOIN public.roles r ON r.role_code = u.role_code
  LEFT JOIN public.departments d ON d.id = u.department_id
  WHERE u.id = p_user_id AND coalesce(u.is_active, true) = true;

  IF NOT FOUND OR NOT (public.can_access_org(p_warehouse_id) OR public.is_hq_admin()) THEN RETURN false; END IF;
  IF coalesce(v_overrides->'deny', '[]'::jsonb) ? 'post_stock_count' THEN RETURN false; END IF;
  RETURN v_role_level = 1
    OR coalesce(v_overrides->'allow', '[]'::jsonb) ? 'post_stock_count'
    OR coalesce(v_role_permissions->>'post_stock_count', 'false')::boolean
    OR coalesce(v_role_permissions, '[]'::jsonb) ? 'post_stock_count';
END;
$$;

REVOKE ALL ON FUNCTION public.stock_count_user_can_post(uuid, uuid) FROM PUBLIC;
