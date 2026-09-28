BEGIN;

-- History of every website order (Outdoor and /store): who changed what, when and why.
-- Append-only; storefront_orders stays the source of truth for the current state.
CREATE TABLE IF NOT EXISTS public.storefront_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.storefront_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('created', 'status_changed', 'shipping_updated', 'note')),
  from_status text,
  to_status text,
  actor_type text NOT NULL
    CHECK (actor_type IN ('customer', 'staff', 'payment', 'system')),
  actor_id uuid,
  actor_label text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS storefront_order_events_order_idx
  ON public.storefront_order_events (order_id, created_at);

ALTER TABLE public.storefront_order_events ENABLE ROW LEVEL SECURITY;
-- No public policies: reads and writes go through Next.js with the service role.
REVOKE ALL ON TABLE public.storefront_order_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.storefront_order_events TO service_role;

COMMENT ON TABLE public.storefront_order_events IS
  'Append-only history of website orders: status changes, shipping updates and who made them';

COMMIT;
