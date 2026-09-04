-- Messaging Phase 1 polish (additive):
-- 1) order timeline events
-- 2) discrepancy line items (short/extra/wrong/damaged)
-- Classic Serapp path untouched.

BEGIN;

-- ---------------------------------------------------------------------------
-- Timeline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messaging_order_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  organization_id uuid,
  actor_user_id uuid REFERENCES public.users(id),
  actor_channel text,
  action text NOT NULL,
  previous_status text,
  new_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_timeline_order_created
  ON public.messaging_order_timeline_events (order_id, created_at ASC);

ALTER TABLE public.messaging_order_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messaging_timeline_select ON public.messaging_order_timeline_events;
CREATE POLICY messaging_timeline_select
  ON public.messaging_order_timeline_events FOR SELECT TO authenticated
  USING (
    public.is_hq_admin()
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND (
          public.can_access_org(o.buyer_org_id)
          OR public.can_access_org(o.seller_org_id)
          OR public.can_access_org(COALESCE(o.fulfillment_warehouse_id, o.seller_org_id))
        )
    )
  );

REVOKE ALL ON TABLE public.messaging_order_timeline_events FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.messaging_order_timeline_events TO authenticated;
GRANT ALL ON TABLE public.messaging_order_timeline_events TO service_role;

CREATE OR REPLACE FUNCTION public.messaging_timeline_append(
  p_order_id uuid,
  p_action text,
  p_actor_user_id uuid DEFAULT NULL,
  p_actor_channel text DEFAULT NULL,
  p_previous_status text DEFAULT NULL,
  p_new_status text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_org uuid;
BEGIN
  SELECT buyer_org_id INTO v_org FROM public.orders WHERE id = p_order_id;
  INSERT INTO public.messaging_order_timeline_events (
    order_id, organization_id, actor_user_id, actor_channel,
    action, previous_status, new_status, metadata
  ) VALUES (
    p_order_id, v_org, COALESCE(p_actor_user_id, auth.uid()), p_actor_channel,
    p_action, p_previous_status, p_new_status, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_timeline_append(uuid, text, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_timeline_append(uuid, text, uuid, text, text, text, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.messaging_inbox_timeline_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.messaging_timeline_append(
      NEW.order_id, 'WAREHOUSE_INBOX_CREATED', auth.uid(), NEW.source_channel,
      NULL, NEW.status, jsonb_build_object('order_no', NEW.order_no)
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_action := CASE NEW.status
      WHEN 'preparing' THEN 'PREPARATION_STARTED'
      WHEN 'awaiting_partial_confirmation' THEN 'PARTIAL_FULFILMENT_REQUESTED'
      WHEN 'ready_to_ship' THEN 'READY_TO_SHIP'
      WHEN 'shipped' THEN 'ORDER_DISPATCHED'
      WHEN 'cancelled' THEN 'ORDER_CANCELLED'
      ELSE 'INBOX_STATUS_CHANGED'
    END;
    PERFORM public.messaging_timeline_append(
      NEW.order_id, v_action, auth.uid(), NEW.source_channel,
      OLD.status, NEW.status,
      jsonb_build_object(
        'delivery_method', NEW.delivery_method,
        'delivery_reference', NEW.delivery_reference,
        'receipt_status', NEW.receipt_status
      )
    );
  ELSIF NEW.receipt_status IS DISTINCT FROM OLD.receipt_status THEN
    v_action := CASE NEW.receipt_status
      WHEN 'pending_receipt' THEN 'AWAITING_RECEIPT'
      WHEN 'received' THEN 'DELIVERY_ACKNOWLEDGED'
      WHEN 'discrepancy_pending' THEN 'DISCREPANCY_REPORTED'
      WHEN 'discrepancy_resolved' THEN 'DISCREPANCY_RESOLVED'
      ELSE 'RECEIPT_STATUS_CHANGED'
    END;
    PERFORM public.messaging_timeline_append(
      NEW.order_id, v_action, auth.uid(), NEW.receipt_channel,
      OLD.receipt_status, NEW.receipt_status, '{}'::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messaging_inbox_timeline ON public.messaging_warehouse_inbox;
CREATE TRIGGER trg_messaging_inbox_timeline
  AFTER INSERT OR UPDATE OF status, receipt_status ON public.messaging_warehouse_inbox
  FOR EACH ROW
  EXECUTE FUNCTION public.messaging_inbox_timeline_trg();

-- Log messaging order submit
CREATE OR REPLACE FUNCTION public.messaging_order_submit_timeline_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source_channel IN ('telegram', 'whatsapp')
     AND NEW.status = 'submitted'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'submitted') THEN
    PERFORM public.messaging_timeline_append(
      NEW.id, 'ORDER_SUBMITTED', NEW.created_by, NEW.source_channel,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE 'draft' END,
      'submitted',
      jsonb_build_object('order_no', COALESCE(NEW.display_doc_no, NEW.order_no))
    );
  END IF;

  IF NEW.source_channel IN ('telegram', 'whatsapp')
     AND NEW.status = 'approved'
     AND (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'approved') THEN
    PERFORM public.messaging_timeline_append(
      NEW.id, 'ORDER_APPROVED', NEW.approved_by, 'admin',
      OLD.status, 'approved', '{}'::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messaging_order_submit_timeline ON public.orders;
CREATE TRIGGER trg_messaging_order_submit_timeline
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.messaging_order_submit_timeline_trg();

-- ---------------------------------------------------------------------------
-- Discrepancy line items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messaging_delivery_discrepancy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discrepancy_id uuid NOT NULL REFERENCES public.messaging_delivery_discrepancies(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  shipped_quantity integer NOT NULL DEFAULT 0 CHECK (shipped_quantity >= 0),
  received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  difference_quantity integer GENERATED ALWAYS AS (received_quantity - shipped_quantity) STORED,
  issue_type text NOT NULL DEFAULT 'short_quantity'
    CHECK (issue_type IN ('short_quantity', 'extra_quantity', 'wrong_item', 'damaged_item')),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_disc_items_disc
  ON public.messaging_delivery_discrepancy_items (discrepancy_id);

ALTER TABLE public.messaging_delivery_discrepancy_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messaging_disc_items_select ON public.messaging_delivery_discrepancy_items;
CREATE POLICY messaging_disc_items_select
  ON public.messaging_delivery_discrepancy_items FOR SELECT TO authenticated
  USING (
    public.is_hq_admin()
    OR EXISTS (
      SELECT 1
      FROM public.messaging_delivery_discrepancies d
      WHERE d.id = discrepancy_id
        AND public.can_access_org(d.organization_id)
    )
  );

REVOKE ALL ON TABLE public.messaging_delivery_discrepancy_items FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.messaging_delivery_discrepancy_items TO authenticated;
GRANT ALL ON TABLE public.messaging_delivery_discrepancy_items TO service_role;

-- Replace report discrepancy to accept optional line items
DROP FUNCTION IF EXISTS public.messaging_report_discrepancy(uuid, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.messaging_report_discrepancy(
  p_order_id uuid,
  p_user_id uuid,
  p_remarks text,
  p_channel text DEFAULT 'telegram',
  p_channel_user_id text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
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
  v_item jsonb;
  v_issue text;
  v_shipped integer;
  v_received integer;
  v_order_item uuid;
  v_line_remarks text;
  v_item_count integer := 0;
BEGIN
  IF NULLIF(trim(p_remarks), '') IS NULL
     AND (p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0) THEN
    RAISE EXCEPTION 'Please describe the delivery difference or provide line items';
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
    'reported', NULLIF(trim(COALESCE(p_remarks, '')), '')
  )
  RETURNING * INTO v_disc;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      v_order_item := NULLIF(v_item->>'order_item_id', '')::uuid;
      v_shipped := COALESCE((v_item->>'shipped_quantity')::integer, 0);
      v_received := COALESCE((v_item->>'received_quantity')::integer, 0);
      v_issue := lower(trim(COALESCE(v_item->>'issue_type', 'short_quantity')));
      v_line_remarks := NULLIF(trim(COALESCE(v_item->>'remarks', '')), '');

      IF v_issue NOT IN ('short_quantity', 'extra_quantity', 'wrong_item', 'damaged_item') THEN
        RAISE EXCEPTION 'Invalid issue_type: %', v_issue;
      END IF;
      IF v_shipped < 0 OR v_received < 0 THEN
        RAISE EXCEPTION 'Quantities must be >= 0';
      END IF;

      INSERT INTO public.messaging_delivery_discrepancy_items (
        discrepancy_id, order_item_id, shipped_quantity, received_quantity, issue_type, remarks
      ) VALUES (
        v_disc.id, v_order_item, v_shipped, v_received, v_issue, v_line_remarks
      );
      v_item_count := v_item_count + 1;
    END LOOP;
  END IF;

  UPDATE public.messaging_warehouse_inbox
  SET receipt_status = 'discrepancy_pending',
      receipt_channel = v_channel,
      receipt_channel_user_id = p_channel_user_id,
      updated_at = now()
  WHERE order_id = p_order_id
  RETURNING * INTO v_inbox;

  PERFORM public.messaging_timeline_append(
    p_order_id, 'DISCREPANCY_REPORTED', p_user_id, v_channel,
    NULL, 'discrepancy_pending',
    jsonb_build_object('discrepancy_id', v_disc.id, 'line_count', v_item_count)
  );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_no', COALESCE(v_order.display_doc_no, v_order.order_no),
    'discrepancy_id', v_disc.id,
    'status', v_disc.status,
    'receipt_status', v_inbox.receipt_status,
    'line_count', v_item_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_report_discrepancy(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_report_discrepancy(uuid, uuid, text, text, text, jsonb)
  TO authenticated, service_role;

-- Compatibility wrapper for older 5-arg callers
CREATE OR REPLACE FUNCTION public.messaging_report_discrepancy(
  p_order_id uuid,
  p_user_id uuid,
  p_remarks text,
  p_channel text,
  p_channel_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.messaging_report_discrepancy(
    p_order_id, p_user_id, p_remarks, p_channel, p_channel_user_id, '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_report_discrepancy(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_report_discrepancy(uuid, uuid, text, text, text)
  TO authenticated, service_role;

-- Invoice timeline when messaging invoice is created
CREATE OR REPLACE FUNCTION public.messaging_invoice_timeline_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel text;
BEGIN
  IF NEW.doc_type <> 'INVOICE' THEN
    RETURN NEW;
  END IF;

  SELECT source_channel INTO v_channel FROM public.orders WHERE id = NEW.order_id;
  IF v_channel IN ('telegram', 'whatsapp') THEN
    PERFORM public.messaging_timeline_append(
      NEW.order_id, 'INVOICE_CREATED', NEW.created_by, v_channel,
      NULL, NEW.status,
      jsonb_build_object('invoice_no', COALESCE(NEW.display_doc_no, NEW.doc_no))
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messaging_invoice_timeline ON public.documents;
CREATE TRIGGER trg_messaging_invoice_timeline
  AFTER INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.messaging_invoice_timeline_trg();

COMMIT;
