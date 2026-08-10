-- Messaging receipt + invoice (additive, telegram/whatsapp D2H only):
-- Shipped → distributor acknowledges DO → auto Invoice (full receipt)
-- Or report discrepancy → HQ resolves → then Invoice
-- Classic Serapp approve-at-once invoice path unchanged.

BEGIN;

-- ---------------------------------------------------------------------------
-- Receipt tracking on warehouse inbox
-- ---------------------------------------------------------------------------
ALTER TABLE public.messaging_warehouse_inbox
  ADD COLUMN IF NOT EXISTS receipt_status text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS receipt_channel text,
  ADD COLUMN IF NOT EXISTS receipt_channel_user_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messaging_warehouse_inbox_receipt_status_check'
      AND conrelid = 'public.messaging_warehouse_inbox'::regclass
  ) THEN
    ALTER TABLE public.messaging_warehouse_inbox
      ADD CONSTRAINT messaging_warehouse_inbox_receipt_status_check
      CHECK (
        receipt_status IS NULL
        OR receipt_status IN (
          'pending_receipt',
          'received',
          'discrepancy_pending',
          'discrepancy_resolved'
        )
      );
  END IF;
END $$;

-- When warehouse marks shipped, open distributor receipt window.
CREATE OR REPLACE FUNCTION public.messaging_inbox_set_pending_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'shipped'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'shipped')
     AND NEW.receipt_status IS NULL THEN
    NEW.receipt_status := 'pending_receipt';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messaging_inbox_pending_receipt ON public.messaging_warehouse_inbox;
CREATE TRIGGER trg_messaging_inbox_pending_receipt
  BEFORE INSERT OR UPDATE OF status ON public.messaging_warehouse_inbox
  FOR EACH ROW
  EXECUTE FUNCTION public.messaging_inbox_set_pending_receipt();

-- Backfill already-shipped rows (if any) from manual testing.
UPDATE public.messaging_warehouse_inbox
SET receipt_status = 'pending_receipt',
    updated_at = now()
WHERE status = 'shipped'
  AND receipt_status IS NULL;

-- ---------------------------------------------------------------------------
-- Acknowledgement + discrepancy records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messaging_delivery_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  delivery_order_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL,
  acknowledged_by_user_id uuid NOT NULL REFERENCES public.users(id),
  acknowledged_channel text NOT NULL,
  acknowledged_channel_user_id text,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS public.messaging_delivery_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  delivery_order_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL,
  reported_by_user_id uuid NOT NULL REFERENCES public.users(id),
  reported_channel text NOT NULL,
  reported_channel_user_id text,
  status text NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported', 'under_review', 'resolved', 'rejected')),
  remarks text,
  resolution text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  reported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_delivery_discrepancies_order
  ON public.messaging_delivery_discrepancies (order_id, status);

ALTER TABLE public.messaging_delivery_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messaging_delivery_discrepancies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messaging_delivery_ack_select ON public.messaging_delivery_acknowledgements;
CREATE POLICY messaging_delivery_ack_select
  ON public.messaging_delivery_acknowledgements FOR SELECT TO authenticated
  USING (
    public.is_hq_admin()
    OR public.can_access_org(organization_id)
  );

DROP POLICY IF EXISTS messaging_delivery_disc_select ON public.messaging_delivery_discrepancies;
CREATE POLICY messaging_delivery_disc_select
  ON public.messaging_delivery_discrepancies FOR SELECT TO authenticated
  USING (
    public.is_hq_admin()
    OR public.can_access_org(organization_id)
  );

REVOKE ALL ON TABLE public.messaging_delivery_acknowledgements FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.messaging_delivery_discrepancies FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.messaging_delivery_acknowledgements TO authenticated;
GRANT SELECT ON TABLE public.messaging_delivery_discrepancies TO authenticated;
GRANT ALL ON TABLE public.messaging_delivery_acknowledgements TO service_role;
GRANT ALL ON TABLE public.messaging_delivery_discrepancies TO service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_assert_distributor_order(
  p_order_id uuid,
  p_user_id uuid
)
RETURNS public.orders
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_user_org uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User is required';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.order_type <> 'D2H' OR v_order.source_channel NOT IN ('telegram', 'whatsapp') THEN
    RAISE EXCEPTION 'Not a messaging distributor order';
  END IF;

  SELECT organization_id INTO v_user_org FROM public.users WHERE id = p_user_id;
  IF v_user_org IS NULL OR v_user_org <> v_order.buyer_org_id THEN
    RAISE EXCEPTION 'Only the buyer distributor can perform this action';
  END IF;

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_assert_distributor_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_assert_distributor_order(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.messaging_create_invoice_for_order(p_order_id uuid)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_invoice public.documents%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  SELECT * INTO v_invoice
  FROM public.documents
  WHERE order_id = p_order_id AND doc_type = 'INVOICE'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_invoice;
  END IF;

  INSERT INTO public.documents (
    company_id, order_id, doc_type, doc_no, status,
    issued_by_org_id, issued_to_org_id, created_by
  ) VALUES (
    v_order.company_id, v_order.id, 'INVOICE', 'INV-' || v_order.order_no, 'pending',
    v_order.seller_org_id, v_order.buyer_org_id,
    COALESCE(auth.uid(), v_order.created_by)
  )
  RETURNING * INTO v_invoice;

  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_create_invoice_for_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_create_invoice_for_order(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Full receipt → acknowledge DO + invoice
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_acknowledge_receipt(
  p_order_id uuid,
  p_user_id uuid,
  p_channel text DEFAULT 'telegram',
  p_channel_user_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
  v_do public.documents%ROWTYPE;
  v_invoice public.documents%ROWTYPE;
  v_total numeric := 0;
  v_channel text := lower(trim(COALESCE(p_channel, 'telegram')));
BEGIN
  v_order := public.messaging_assert_distributor_order(p_order_id, p_user_id);

  SELECT * INTO v_inbox
  FROM public.messaging_warehouse_inbox
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Messaging fulfilment record not found'; END IF;
  IF v_inbox.status <> 'shipped' THEN
    RAISE EXCEPTION 'Order is not shipped yet';
  END IF;
  IF v_inbox.receipt_status IN ('received', 'discrepancy_resolved') THEN
    RAISE EXCEPTION 'Receipt already recorded for this order';
  END IF;
  IF v_inbox.receipt_status = 'discrepancy_pending' THEN
    RAISE EXCEPTION 'Discrepancy is pending review. Wait for HQ resolution before full receipt.';
  END IF;

  SELECT * INTO v_do
  FROM public.documents
  WHERE order_id = p_order_id AND doc_type = 'DO'
  ORDER BY created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery Order not found'; END IF;

  IF v_do.status = 'pending' THEN
    UPDATE public.documents
    SET status = 'acknowledged',
        acknowledged_by = p_user_id,
        acknowledged_at = now(),
        updated_at = now()
    WHERE id = v_do.id
    RETURNING * INTO v_do;
  END IF;

  v_invoice := public.messaging_create_invoice_for_order(p_order_id);

  INSERT INTO public.messaging_delivery_acknowledgements (
    order_id, delivery_order_id, organization_id,
    acknowledged_by_user_id, acknowledged_channel, acknowledged_channel_user_id
  ) VALUES (
    p_order_id, v_do.id, v_order.buyer_org_id,
    p_user_id, v_channel, p_channel_user_id
  )
  ON CONFLICT (order_id) DO NOTHING;

  UPDATE public.messaging_warehouse_inbox
  SET receipt_status = 'received',
      received_at = now(),
      received_by = p_user_id,
      receipt_channel = v_channel,
      receipt_channel_user_id = p_channel_user_id,
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

  SELECT COALESCE(SUM(oi.qty * oi.unit_price), 0) INTO v_total
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_no', COALESCE(v_order.display_doc_no, v_order.order_no),
    'do_id', v_do.id,
    'do_no', COALESCE(v_do.display_doc_no, v_do.doc_no),
    'invoice_id', v_invoice.id,
    'invoice_no', COALESCE(v_invoice.display_doc_no, v_invoice.doc_no),
    'invoice_total', v_total,
    'receipt_status', v_inbox.receipt_status
  );
END;
$$;

COMMENT ON FUNCTION public.messaging_acknowledge_receipt(uuid, uuid, text, text) IS
  'Messaging D2H: distributor confirms full receipt, acknowledges DO, creates Invoice (first price visibility).';

REVOKE ALL ON FUNCTION public.messaging_acknowledge_receipt(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_acknowledge_receipt(uuid, uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Report discrepancy (invoice hold)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_report_discrepancy(
  p_order_id uuid,
  p_user_id uuid,
  p_remarks text,
  p_channel text DEFAULT 'telegram',
  p_channel_user_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
  v_do public.documents%ROWTYPE;
  v_disc public.messaging_delivery_discrepancies%ROWTYPE;
  v_channel text := lower(trim(COALESCE(p_channel, 'telegram')));
BEGIN
  IF NULLIF(trim(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Please describe the delivery difference';
  END IF;

  v_order := public.messaging_assert_distributor_order(p_order_id, p_user_id);

  SELECT * INTO v_inbox
  FROM public.messaging_warehouse_inbox
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Messaging fulfilment record not found'; END IF;
  IF v_inbox.status <> 'shipped' THEN
    RAISE EXCEPTION 'Order is not shipped yet';
  END IF;
  IF v_inbox.receipt_status IN ('received', 'discrepancy_resolved') THEN
    RAISE EXCEPTION 'Receipt already finalized for this order';
  END IF;

  SELECT * INTO v_do
  FROM public.documents
  WHERE order_id = p_order_id AND doc_type = 'DO'
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.messaging_delivery_discrepancies (
    order_id, delivery_order_id, organization_id,
    reported_by_user_id, reported_channel, reported_channel_user_id,
    status, remarks
  ) VALUES (
    p_order_id, v_do.id, v_order.buyer_org_id,
    p_user_id, v_channel, p_channel_user_id,
    'reported', trim(p_remarks)
  )
  RETURNING * INTO v_disc;

  UPDATE public.messaging_warehouse_inbox
  SET receipt_status = 'discrepancy_pending',
      receipt_channel = v_channel,
      receipt_channel_user_id = p_channel_user_id,
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_no', COALESCE(v_order.display_doc_no, v_order.order_no),
    'discrepancy_id', v_disc.id,
    'status', v_disc.status,
    'receipt_status', v_inbox.receipt_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_report_discrepancy(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_report_discrepancy(uuid, uuid, text, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- HQ resolve discrepancy → invoice at current order lines (Phase 1)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_resolve_discrepancy_invoice(
  p_order_id uuid,
  p_resolution text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
  v_invoice public.documents%ROWTYPE;
  v_total numeric := 0;
  v_disc_id uuid;
BEGIN
  IF NOT (public.is_hq_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'HQ authorization required';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.source_channel NOT IN ('telegram', 'whatsapp') THEN
    RAISE EXCEPTION 'Not a messaging order';
  END IF;

  SELECT * INTO v_inbox
  FROM public.messaging_warehouse_inbox
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Messaging fulfilment record not found'; END IF;
  IF v_inbox.receipt_status <> 'discrepancy_pending' THEN
    RAISE EXCEPTION 'No open discrepancy for this order';
  END IF;

  SELECT id INTO v_disc_id
  FROM public.messaging_delivery_discrepancies
  WHERE order_id = p_order_id AND status IN ('reported', 'under_review')
  ORDER BY reported_at DESC
  LIMIT 1;

  IF v_disc_id IS NOT NULL THEN
    UPDATE public.messaging_delivery_discrepancies
    SET status = 'resolved',
        resolution = NULLIF(trim(p_resolution), ''),
        resolved_by = auth.uid(),
        resolved_at = now(),
        updated_at = now()
    WHERE id = v_disc_id;
  END IF;

  v_invoice := public.messaging_create_invoice_for_order(p_order_id);

  UPDATE public.messaging_warehouse_inbox
  SET receipt_status = 'discrepancy_resolved',
      received_at = COALESCE(received_at, now()),
      received_by = COALESCE(received_by, auth.uid()),
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

  SELECT COALESCE(SUM(oi.qty * oi.unit_price), 0) INTO v_total
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_no', COALESCE(v_order.display_doc_no, v_order.order_no),
    'invoice_id', v_invoice.id,
    'invoice_no', COALESCE(v_invoice.display_doc_no, v_invoice.doc_no),
    'invoice_total', v_total,
    'receipt_status', v_inbox.receipt_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_resolve_discrepancy_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_resolve_discrepancy_invoice(uuid, text)
  TO authenticated, service_role;

COMMIT;
