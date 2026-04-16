BEGIN;

CREATE TABLE IF NOT EXISTS public.shop_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_org_id uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  requester_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requester_name text NULL,
  requester_phone text NULL,
  requested_shop_name text NOT NULL,
  requested_branch text NULL,
  requested_contact_name text NULL,
  requested_contact_phone text NULL,
  requested_address text NULL,
  requested_state text NULL,
  notes text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  review_notes text NULL,
  approved_organization_id uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  approved_organization_name text NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_shop_requests_status_created_at
  ON public.shop_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_requests_requester_user_id
  ON public.shop_requests(requester_user_id);

CREATE TABLE IF NOT EXISTS public.shop_request_notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_request_id uuid NOT NULL REFERENCES public.shop_requests(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN ('admin_request', 'requester_approved', 'requester_rejected')),
  phone_number text NOT NULL,
  recipient_label text NULL,
  send_status text NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending', 'sent', 'failed')),
  rendered_message text NULL,
  provider_message_id text NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  sent_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_request_notification_logs_request_id
  ON public.shop_request_notification_logs(shop_request_id, created_at DESC);

COMMIT;