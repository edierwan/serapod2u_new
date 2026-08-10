-- Phase 1 polish (spec §26 evidence + §54 fulfilment line detail):
-- Discrepancy photo attachments + fulfilment quantities API helper.
-- Additive only; classic paths untouched.

BEGIN;

-- ---------------------------------------------------------------------------
-- Discrepancy evidence attachments (§26)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messaging_delivery_discrepancy_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discrepancy_id uuid NOT NULL REFERENCES public.messaging_delivery_discrepancies(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'messaging-discrepancy-evidence',
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  uploaded_channel text NOT NULL DEFAULT 'telegram',
  uploaded_channel_user_id text,
  uploaded_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_disc_attach_disc
  ON public.messaging_delivery_discrepancy_attachments (discrepancy_id, created_at DESC);

ALTER TABLE public.messaging_delivery_discrepancy_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messaging_disc_attach_select ON public.messaging_delivery_discrepancy_attachments;
CREATE POLICY messaging_disc_attach_select
  ON public.messaging_delivery_discrepancy_attachments FOR SELECT TO authenticated
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

REVOKE ALL ON TABLE public.messaging_delivery_discrepancy_attachments FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.messaging_delivery_discrepancy_attachments TO authenticated;
GRANT ALL ON TABLE public.messaging_delivery_discrepancy_attachments TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'messaging-discrepancy-evidence',
  'messaging-discrepancy-evidence',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- HQ / warehouse / buyer org members may read evidence for their orders
DROP POLICY IF EXISTS messaging_disc_evidence_select ON storage.objects;
CREATE POLICY messaging_disc_evidence_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'messaging-discrepancy-evidence'
    AND (
      public.is_hq_admin()
      OR EXISTS (
        SELECT 1
        FROM public.messaging_delivery_discrepancy_attachments a
        JOIN public.orders o ON o.id = a.order_id
        WHERE a.storage_path = objects.name
          AND (
            public.can_access_org(o.buyer_org_id)
            OR public.can_access_org(o.seller_org_id)
            OR public.can_access_org(COALESCE(o.fulfillment_warehouse_id, o.seller_org_id))
          )
      )
    )
  );

DROP POLICY IF EXISTS messaging_disc_evidence_service ON storage.objects;
CREATE POLICY messaging_disc_evidence_service
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'messaging-discrepancy-evidence')
  WITH CHECK (bucket_id = 'messaging-discrepancy-evidence');

CREATE OR REPLACE FUNCTION public.messaging_attach_discrepancy_evidence(
  p_discrepancy_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_file_name text DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_file_size_bytes bigint DEFAULT NULL,
  p_channel text DEFAULT 'telegram',
  p_channel_user_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_disc public.messaging_delivery_discrepancies%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_attach public.messaging_delivery_discrepancy_attachments%ROWTYPE;
BEGIN
  IF NULLIF(trim(p_storage_path), '') IS NULL THEN
    RAISE EXCEPTION 'storage_path is required';
  END IF;

  SELECT * INTO v_disc
  FROM public.messaging_delivery_discrepancies
  WHERE id = p_discrepancy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Discrepancy not found'; END IF;

  v_order := public.messaging_assert_distributor_order(v_disc.order_id, p_user_id);

  INSERT INTO public.messaging_delivery_discrepancy_attachments (
    discrepancy_id, order_id, storage_path, file_name, mime_type, file_size_bytes,
    uploaded_channel, uploaded_channel_user_id, uploaded_by_user_id
  ) VALUES (
    v_disc.id, v_disc.order_id, trim(p_storage_path),
    NULLIF(trim(COALESCE(p_file_name, '')), ''),
    NULLIF(trim(COALESCE(p_mime_type, '')), ''),
    p_file_size_bytes,
    lower(trim(COALESCE(p_channel, 'telegram'))),
    p_channel_user_id,
    p_user_id
  )
  RETURNING * INTO v_attach;

  IF to_regprocedure('public.messaging_timeline_append(uuid,text,uuid,text,text,text,jsonb)') IS NOT NULL THEN
    PERFORM public.messaging_timeline_append(
      v_disc.order_id, 'DISCREPANCY_EVIDENCE_UPLOADED', p_user_id, lower(trim(COALESCE(p_channel, 'telegram'))),
      NULL, v_disc.status,
      jsonb_build_object('discrepancy_id', v_disc.id, 'attachment_id', v_attach.id)
    );
  END IF;

  RETURN jsonb_build_object(
    'attachment_id', v_attach.id,
    'discrepancy_id', v_disc.id,
    'order_id', v_disc.order_id,
    'storage_path', v_attach.storage_path
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_attach_discrepancy_evidence(uuid, uuid, text, text, text, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_attach_discrepancy_evidence(uuid, uuid, text, text, text, bigint, text, text)
  TO authenticated, service_role;

-- Resolve latest open discrepancy for distributor photo follow-up
CREATE OR REPLACE FUNCTION public.messaging_latest_open_discrepancy(
  p_order_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.messaging_assert_distributor_order(p_order_id, p_user_id);

  SELECT d.id INTO v_id
  FROM public.messaging_delivery_discrepancies d
  WHERE d.order_id = p_order_id
    AND d.status IN ('reported', 'under_review')
  ORDER BY d.reported_at DESC
  LIMIT 1;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_latest_open_discrepancy(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_latest_open_discrepancy(uuid, uuid)
  TO authenticated, service_role;

-- Fulfilment line quantities for order detail (§54)
CREATE OR REPLACE FUNCTION public.messaging_fulfilment_lines(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inbox public.messaging_warehouse_inbox%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.source_channel NOT IN ('telegram', 'whatsapp') THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT * INTO v_inbox FROM public.messaging_warehouse_inbox WHERE order_id = p_order_id;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY row->>'variant_name')
    FROM (
      SELECT jsonb_build_object(
        'order_item_id', oi.id,
        'variant_id', oi.variant_id,
        'variant_name', COALESCE(pv.variant_name, 'Item'),
        'ordered', COALESCE(pi.ordered_quantity, oi.qty),
        'reserved', CASE
          WHEN EXISTS (
            SELECT 1 FROM public.stock_movements sm
            WHERE sm.reference_type = 'order' AND sm.reference_id = p_order_id
              AND sm.variant_id = oi.variant_id AND sm.movement_type = 'allocation'
          ) THEN oi.qty
          ELSE 0
        END,
        'prepared', COALESCE(pi.prepared_quantity, CASE WHEN v_inbox.status IN ('preparing', 'awaiting_partial_confirmation', 'ready_to_ship', 'shipped') THEN oi.qty ELSE NULL END),
        'shipped', CASE WHEN v_inbox.status = 'shipped' THEN oi.qty ELSE NULL END,
        'received', CASE
          WHEN v_inbox.receipt_status = 'received' THEN oi.qty
          WHEN v_inbox.receipt_status IN ('discrepancy_pending', 'discrepancy_resolved') THEN (
            SELECT di.received_quantity
            FROM public.messaging_delivery_discrepancy_items di
            JOIN public.messaging_delivery_discrepancies d ON d.id = di.discrepancy_id
            WHERE d.order_id = p_order_id AND di.order_item_id = oi.id
            ORDER BY d.reported_at DESC
            LIMIT 1
          )
          ELSE NULL
        END,
        'inbox_status', v_inbox.status,
        'receipt_status', v_inbox.receipt_status,
        'delivery_method', v_inbox.delivery_method,
        'delivery_reference', v_inbox.delivery_reference,
        'do_number', (
          SELECT COALESCE(doc.display_doc_no, doc.doc_no)
          FROM public.documents doc
          WHERE doc.order_id = p_order_id AND doc.doc_type = 'DO'
          ORDER BY doc.created_at DESC
          LIMIT 1
        )
      ) AS row
      FROM public.order_items oi
      LEFT JOIN public.messaging_preparation_items pi ON pi.order_item_id = oi.id
      LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id = p_order_id
    ) sub
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.messaging_fulfilment_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_fulfilment_lines(uuid) TO authenticated, service_role;

COMMIT;
