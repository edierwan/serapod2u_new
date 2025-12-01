-- Migration: 069_fix_shop_points_ledger_and_stats.sql

-- 1. Fix shop_points_ledger view to use company_id from points_transactions
CREATE OR REPLACE VIEW public.shop_points_ledger AS
 SELECT cqs.id,
    cqs.shop_id,
    cqs.consumer_id,
    cqs.journey_config_id,
    qc.order_id,
    qc.order_item_id,
    qc.product_id,
    qc.variant_id,
    cqs.points_collected_at AS occurred_at,
    COALESCE(cqs.points_amount, 0) AS points_change,
        CASE
            WHEN cqs.is_manual_adjustment THEN COALESCE(cqs.adjustment_type, 'manual'::text)
            ELSE 'scan'::text
        END AS transaction_type,
    cqs.is_manual_adjustment,
    cqs.adjusted_by,
    cqs.adjustment_reason,
    NULL::uuid AS redeem_item_id,
    NULL::text AS consumer_phone,
    NULL::text AS consumer_email,
    NULL::text AS description,
    pv.variant_name,
    p.product_name,
    NULL::text AS reward_name,
    NULL::text AS reward_code,
    o.order_no
   FROM ((((public.consumer_qr_scans cqs
     LEFT JOIN public.qr_codes qc ON ((qc.id = cqs.qr_code_id)))
     LEFT JOIN public.product_variants pv ON ((pv.id = qc.variant_id)))
     LEFT JOIN public.products p ON ((p.id = pv.product_id)))
     LEFT JOIN public.orders o ON ((o.id = qc.order_id)))
  WHERE ((cqs.shop_id IS NOT NULL) AND (cqs.collected_points = true))
UNION ALL
 SELECT pt.id,
    COALESCE(pt.company_id, ( SELECT u.organization_id
           FROM (public.users u
             JOIN public.organizations o ON ((o.id = u.organization_id)))
          WHERE (((u.phone = pt.consumer_phone) OR (u.email = pt.consumer_email)) AND (o.org_type_code = 'SHOP'::text))
         LIMIT 1)) AS shop_id,
    NULL::uuid AS consumer_id,
    NULL::uuid AS journey_config_id,
    NULL::uuid AS order_id,
    NULL::uuid AS order_item_id,
    NULL::uuid AS product_id,
    NULL::uuid AS variant_id,
    pt.transaction_date AS occurred_at,
    pt.points_amount AS points_change,
    pt.transaction_type,
        CASE
            WHEN (pt.transaction_type = 'adjust'::text) THEN true
            ELSE false
        END AS is_manual_adjustment,
    NULL::uuid AS adjusted_by,
    NULL::text AS adjustment_reason,
    pt.redeem_item_id,
    pt.consumer_phone,
    pt.consumer_email,
    pt.description,
    NULL::text AS variant_name,
    NULL::text AS product_name,
    ri.item_name AS reward_name,
    ri.item_code AS reward_code,
    NULL::text AS order_no
   FROM (public.points_transactions pt
     LEFT JOIN public.redeem_items ri ON ((ri.id = pt.redeem_item_id)))
  WHERE ((pt.consumer_phone IS NOT NULL) OR (pt.consumer_email IS NOT NULL) OR (pt.company_id IS NOT NULL));

-- 2. Create RPC to get scratch campaign stats
CREATE OR REPLACE FUNCTION get_scratch_campaign_stats(p_org_id UUID)
RETURNS TABLE (
    campaign_id UUID,
    plays_count BIGINT,
    winners_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id AS campaign_id,
        COUNT(p.id) AS plays_count,
        COUNT(CASE WHEN p.is_win THEN 1 END) AS winners_count
    FROM scratch_card_campaigns c
    LEFT JOIN scratch_card_plays p ON p.campaign_id = c.id
    WHERE c.org_id = p_org_id
    GROUP BY c.id;
END;
$$;
