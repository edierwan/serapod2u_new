-- Stock Count posting verification: durable challenge/audit state and event seed.
-- Apply before 20260715_stock_count_verification_02.sql. Do not expose this table to clients.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  category = EXCLUDED.category,
  event_name = EXCLUDED.event_name,
  event_description = EXCLUDED.event_description,
  available_channels = EXCLUDED.available_channels,
  is_system = EXCLUDED.is_system,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS public.stock_count_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  session_id uuid NOT NULL REFERENCES public.stock_count_sessions(id) ON DELETE RESTRICT,
  requesting_user_id uuid NOT NULL REFERENCES public.users(id),
  verified_by uuid REFERENCES public.users(id),
  code_hash text NOT NULL,
  snapshot_hash text NOT NULL,
  recipient_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending_delivery',
  requested_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  resend_count integer NOT NULL DEFAULT 0,
  failed_attempt_count integer NOT NULL DEFAULT 0,
  snapshot_mismatch boolean NOT NULL DEFAULT false,
  posting_result jsonb,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT stock_count_verification_status_check CHECK (status IN (
    'pending_delivery','active','delivery_failed','verified','expired','invalidated','too_many_attempts','posted'
  )),
  CONSTRAINT stock_count_verification_attempts_check CHECK (failed_attempt_count BETWEEN 0 AND 5),
  CONSTRAINT stock_count_verification_resends_check CHECK (resend_count >= 0),
  CONSTRAINT stock_count_verification_expiry_check CHECK (expires_at > requested_at)
);

CREATE INDEX IF NOT EXISTS idx_stock_count_verification_session_requested
  ON public.stock_count_verification_requests (session_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_count_verification_rate
  ON public.stock_count_verification_requests (requesting_user_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_count_verification_active_session
  ON public.stock_count_verification_requests (session_id)
  WHERE status IN ('pending_delivery','active');

ALTER TABLE public.stock_count_verification_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_count_verification_requests FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.stock_count_verification_requests TO service_role;

COMMENT ON TABLE public.stock_count_verification_requests IS
  'Security audit state for Stock Count posting. code_hash is a server-side HMAC; raw codes must never be persisted.';
COMMENT ON COLUMN public.stock_count_verification_requests.recipient_summary IS
  'Masked recipient representations only; never store raw recipient addresses here.';
