BEGIN;

-- Customer returns and complaints on website orders (Outdoor and /store).
-- Linked to storefront_orders, which stays the single source of truth for the order.
CREATE TABLE IF NOT EXISTS public.storefront_order_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES public.storefront_orders(id) ON DELETE CASCADE,
  organization_id uuid,
  sales_channel text NOT NULL DEFAULT 'store',
  customer_email text NOT NULL,
  customer_name text,
  request_type text NOT NULL
    CHECK (request_type IN ('return', 'damaged', 'wrong_item', 'not_received', 'other')),
  message text NOT NULL,
  photo_paths text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'reviewing', 'approved', 'rejected', 'refunded', 'closed')),
  staff_reply text,
  handled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS storefront_order_requests_order_idx
  ON public.storefront_order_requests (order_id);
CREATE INDEX IF NOT EXISTS storefront_order_requests_status_idx
  ON public.storefront_order_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS storefront_order_requests_email_idx
  ON public.storefront_order_requests (lower(customer_email), created_at DESC);

ALTER TABLE public.storefront_order_requests ENABLE ROW LEVEL SECURITY;
-- No public policies: reads and writes go through Next.js with the service role.
REVOKE ALL ON TABLE public.storefront_order_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.storefront_order_requests TO service_role;

COMMENT ON TABLE public.storefront_order_requests IS
  'Returns and complaints raised by website customers on a storefront order';

-- Customer photos stay private; staff see them through short-lived signed links.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'storefront-requests',
  'storefront-requests',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
