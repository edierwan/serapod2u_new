-- ============================================================================
-- Legacy configuration cutover — preflight
-- ----------------------------------------------------------------------------
-- Read-only. Reports every condition that could recreate a legacy balance
-- after the cutover has zeroed it. The cutover function refuses to run while
-- any blocker stands.
--
-- This function NEVER cancels, closes or edits a document. Open transfers,
-- pending adjustments and draft count sessions belong to operations, not to a
-- migration. It reports them for management action and stops.
--
-- Legacy configurations, per the final business decision:
--   50NB          legacy 50 mg nicotine balance
--   UNCLASSIFIED  legacy / unverified system balance
--   50OB          already phase_out, zero balance, retired with them
--
-- STD is NOT legacy. It is the canonical operational configuration for every
-- non-vape product and is explicitly excluded everywhere below.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The legacy set, in one place
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.legacy_cutover_config_codes()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY['50NB', '50OB', 'UNCLASSIFIED']::text[]
$$;

COMMENT ON FUNCTION public.legacy_cutover_config_codes() IS
  'The configuration codes retired to zero by the LEGACY-CONFIG-CUTOVER-2026 programme. STD is deliberately absent: it is the canonical operational configuration for non-vape products.';

-- ---------------------------------------------------------------------------
-- 2. Preflight
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.legacy_config_cutover_preflight(
  p_writer_window_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codes            text[] := public.legacy_cutover_config_codes();
  v_blockers         jsonb  := '[]'::jsonb;
  v_open_transfers   jsonb;
  v_open_adjustments jsonb;
  v_open_counts      jsonb;
  v_live_writers     jsonb;
  v_historical_writers jsonb;
  v_inactive_rows    jsonb;
  v_activated_at     timestamptz;
  v_unbound_orders   jsonb;
  v_ambiguous        jsonb;
  v_allocated        jsonb;
  v_scope            jsonb;
BEGIN
  -- --- Blocker 1: open stock transfers ------------------------------------
  -- Every open transfer can post stock on receive. Transfers whose item
  -- payload carries no stock_config_id resolve through the ledger fallback,
  -- which is exactly how legacy balances were created.
  SELECT jsonb_agg(x ORDER BY x->>'transfer_no')
    INTO v_open_transfers
    FROM (
      SELECT jsonb_build_object(
               'transfer_no', t.transfer_no,
               'status', t.status,
               'created_at', t.created_at,
               'from_org', o1.org_code,
               'to_org', o2.org_code,
               'lines', jsonb_array_length(COALESCE(t.items, '[]'::jsonb)),
               'lines_without_config', (
                 SELECT count(*) FROM jsonb_array_elements(COALESCE(t.items, '[]'::jsonb)) it
                  WHERE NULLIF(it->>'stock_config_id', '') IS NULL
               )
             ) AS x
        FROM public.stock_transfers t
        LEFT JOIN public.organizations o1 ON o1.id = t.from_organization_id
        LEFT JOIN public.organizations o2 ON o2.id = t.to_organization_id
       WHERE t.status IN ('draft', 'pending', 'pending_approval', 'in_transit')
    ) s;

  IF v_open_transfers IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'OPEN_STOCK_TRANSFERS',
      'severity', 'blocking',
      'count', jsonb_array_length(v_open_transfers),
      'message', 'Open stock transfers can post stock after cutover. Receive, reject or cancel them first.',
      'action_owner', 'operations',
      'detail', v_open_transfers
    );
  END IF;

  -- --- Blocker 2: unposted stock adjustments ------------------------------
  SELECT jsonb_agg(x ORDER BY x->>'created_at')
    INTO v_open_adjustments
    FROM (
      SELECT jsonb_build_object(
               'adjustment_id', a.id,
               'status', a.status,
               'org', o.org_code,
               'created_at', a.created_at,
               'items', count(ai.id),
               'items_without_config', count(*) FILTER (WHERE ai.stock_config_id IS NULL)
             ) AS x
        FROM public.stock_adjustments a
        LEFT JOIN public.stock_adjustment_items ai ON ai.adjustment_id = a.id
        LEFT JOIN public.organizations o ON o.id = a.organization_id
       WHERE a.status NOT IN ('posted', 'cancelled', 'rejected')
       GROUP BY a.id, a.status, o.org_code, a.created_at
    ) s;

  IF v_open_adjustments IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'UNPOSTED_STOCK_ADJUSTMENTS',
      'severity', 'blocking',
      'count', jsonb_array_length(v_open_adjustments),
      'message', 'Unposted stock adjustments can post stock after cutover. Post or discard them first.',
      'action_owner', 'operations',
      'detail', v_open_adjustments
    );
  END IF;

  -- --- Blocker 3: open stock count sessions -------------------------------
  SELECT jsonb_agg(x ORDER BY x->>'created_at')
    INTO v_open_counts
    FROM (
      SELECT jsonb_build_object(
               'session_id', s.id,
               'status', s.status,
               'count_type', s.count_type,
               'warehouse', o.org_code,
               'created_at', s.created_at,
               'scope_rows', (SELECT count(*) FROM public.stock_count_session_scope sc
                               WHERE sc.session_id = s.id),
               'legacy_scope_rows', (
                 SELECT count(*) FROM public.stock_count_session_scope sc
                   JOIN public.inventory_stock_configurations c ON c.id = sc.stock_config_id
                  WHERE sc.session_id = s.id AND c.config_code = ANY (v_codes)
               )
             ) AS x
        FROM public.stock_count_sessions s
        LEFT JOIN public.organizations o ON o.id = s.warehouse_organization_id
       WHERE s.status NOT IN ('posted', 'archived', 'cancelled')
    ) s;

  IF v_open_counts IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'OPEN_STOCK_COUNT_SESSIONS',
      'severity', 'blocking',
      'count', jsonb_array_length(v_open_counts),
      'message', 'An open stock count session posts variances against its own scope snapshot, which would re-create retired balances. Post or discard it first.',
      'action_owner', 'operations',
      'detail', v_open_counts
    );
  END IF;

  -- --- Blocker 4: a live writer into a legacy configuration ---------------
  -- Activation-relative, never window-relative.
  --
  -- Production carries 484 historical UNCLASSIFIED return movements from
  -- post_return_case_inventory resolving through the is_variant_default sink,
  -- and more arrive until migration 20260904100000 is applied. Those are
  -- history: they are the reason for the cutover, not a reason to refuse it,
  -- and a rolling day-window would let them block it permanently.
  --
  -- What must block is a legacy movement posted AFTER the write-path fix went
  -- live, because that proves a path was missed and the retired balance would
  -- grow back. canonical_stock_config_activation.activated_at is stamped in the
  -- same transaction that repoints those paths, so the boundary is exact and
  -- cannot drift with the clock or with when the preflight happens to run.
  --
  -- Cutover retirement movements are excluded: they post to legacy
  -- configurations by design.
  v_activated_at := public.canonical_stock_config_activated_at();

  IF v_activated_at IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'CANONICAL_RESOLVER_NOT_ACTIVATED',
      'severity', 'blocking',
      'message', 'Migration 20260904100000 has not been applied here, so operational write paths still resolve to the legacy sink. Retiring balances now would let them grow straight back.',
      'action_owner', 'engineering'
    );
  ELSE
    SELECT jsonb_agg(x ORDER BY x->>'last_seen' DESC)
      INTO v_live_writers
      FROM (
        SELECT jsonb_build_object(
                 'config_code', c.config_code,
                 'movement_type', sm.movement_type,
                 'reference_type', sm.reference_type,
                 'movements', count(*),
                 'net_quantity', sum(sm.quantity_change),
                 'first_seen', min(sm.created_at),
                 'last_seen', max(sm.created_at)
               ) AS x
          FROM public.stock_movements sm
          JOIN public.inventory_stock_configurations c ON c.id = sm.stock_config_id
         WHERE c.config_code = ANY (v_codes)
           AND sm.created_at > v_activated_at
           AND sm.reference_type <> 'legacy_config_cutover'
         GROUP BY c.config_code, sm.movement_type, sm.reference_type
      ) s;

    IF v_live_writers IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_object(
        'code', 'LIVE_LEGACY_WRITER',
        'severity', 'blocking',
        'activated_at', v_activated_at,
        'message', 'A code path posted into a legacy configuration AFTER the canonical resolver was activated. A write path was missed; retiring the balance now would leave the next posting stranded.',
        'action_owner', 'engineering',
        'detail', v_live_writers
      );
    END IF;
  END IF;

  -- Historical legacy writes, reported for context and never blocking. These
  -- are what the cutover exists to retire.
  SELECT jsonb_agg(x ORDER BY x->>'last_seen' DESC)
    INTO v_historical_writers
    FROM (
      SELECT jsonb_build_object(
               'config_code', c.config_code,
               'movement_type', sm.movement_type,
               'reference_type', sm.reference_type,
               'movements', count(*),
               'net_quantity', sum(sm.quantity_change),
               'first_seen', min(sm.created_at),
               'last_seen', max(sm.created_at)
             ) AS x
        FROM public.stock_movements sm
        JOIN public.inventory_stock_configurations c ON c.id = sm.stock_config_id
       WHERE c.config_code = ANY (v_codes)
         AND sm.created_at > now() - make_interval(days => GREATEST(p_writer_window_days, 0))
         AND (v_activated_at IS NULL OR sm.created_at <= v_activated_at)
       GROUP BY c.config_code, sm.movement_type, sm.reference_type
    ) s;

  -- --- Blocker 4b: legacy balance on a deactivated inventory row ----------
  -- record_stock_movement only finds product_inventory rows with
  -- is_active = true, so the cutover cannot retire an inactive row and would
  -- silently leave the balance behind. Report it rather than skip it.
  SELECT jsonb_agg(x ORDER BY x->>'org_code')
    INTO v_inactive_rows
    FROM (
      SELECT jsonb_build_object(
               'org_code', o.org_code,
               'config_code', c.config_code,
               'rows', count(*),
               'quantity_on_hand', sum(pi.quantity_on_hand)
             ) AS x
        FROM public.product_inventory pi
        JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
        JOIN public.organizations o ON o.id = pi.organization_id
       WHERE c.config_code = ANY (v_codes)
         AND COALESCE(pi.quantity_on_hand, 0) <> 0
         AND pi.is_active IS DISTINCT FROM true
       GROUP BY o.org_code, c.config_code
    ) s;

  IF v_inactive_rows IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'INACTIVE_LEGACY_INVENTORY_ROWS',
      'severity', 'blocking',
      'count', jsonb_array_length(v_inactive_rows),
      'message', 'Legacy balances sit on deactivated product_inventory rows, which the cutover cannot post against. Reactivate the rows or clear them separately, so nothing is left behind.',
      'action_owner', 'operations',
      'detail', v_inactive_rows
    );
  END IF;

  -- --- Blocker 5: open order items with no confirmed configuration --------
  -- orders.status is the order_status ENUM: draft, submitted, approved, closed,
  -- cancelled, warehouse_packed, shipped_distributor. Only cancelled and closed
  -- are terminal, so everything else is still able to post stock.
  SELECT jsonb_agg(x ORDER BY x->>'order_type', x->>'status')
    INTO v_unbound_orders
    FROM (
      SELECT jsonb_build_object(
               'order_type', o.order_type,
               'status', o.status,
               'orders', count(DISTINCT o.id),
               'items', count(*),
               'quantity', sum(oi.qty)
             ) AS x
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
       WHERE oi.stock_config_id IS NULL
         AND o.status NOT IN ('cancelled', 'closed')
       GROUP BY o.order_type, o.status
    ) s;

  IF v_unbound_orders IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'UNBOUND_OPEN_ORDER_ITEMS',
      'severity', 'warning',
      'message', 'Open order items carry no confirmed stock configuration. After migration 20260904100000 they resolve to the canonical configuration rather than to the legacy sink, but they should be confirmed before cutover so the resolution is explicit.',
      'action_owner', 'operations',
      'detail', v_unbound_orders
    );
  END IF;

  -- --- Blocker 6: variants the canonical resolver cannot resolve ----------
  SELECT jsonb_agg(x ORDER BY x->>'variant_name')
    INTO v_ambiguous
    FROM (
      SELECT jsonb_build_object(
               'variant_id', v.id,
               'variant_name', v.variant_name,
               'product_name', p.product_name,
               'candidates', COALESCE((SELECT count(*) FROM public.v_canonical_stock_config vc
                                        WHERE vc.variant_id = v.id), 0),
               'configs', (SELECT string_agg(c.config_code || ':' || c.status, ', ' ORDER BY c.config_code)
                             FROM public.inventory_stock_configurations c
                            WHERE c.variant_id = v.id)
             ) AS x
        FROM public.product_variants v
        JOIN public.products p ON p.id = v.product_id
       WHERE v.is_active
         AND (SELECT count(*) FROM public.v_canonical_stock_config vc
               WHERE vc.variant_id = v.id) <> 1
    ) s;

  IF v_ambiguous IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'UNRESOLVABLE_ACTIVE_VARIANTS',
      'severity', 'blocking',
      'count', jsonb_array_length(v_ambiguous),
      'message', 'Active variants resolve to zero or to more than one canonical operational configuration. Every operational write for these variants fails closed until master data is corrected.',
      'action_owner', 'master data',
      'detail', v_ambiguous
    );
  END IF;

  -- --- Blocker 7: allocated stock on a legacy configuration ---------------
  -- Reserved stock belongs to an order. It cannot be retired underneath one.
  SELECT jsonb_agg(x ORDER BY x->>'org_code')
    INTO v_allocated
    FROM (
      SELECT jsonb_build_object(
               'org_code', o.org_code,
               'config_code', c.config_code,
               'rows', count(*),
               'quantity_allocated', sum(pi.quantity_allocated)
             ) AS x
        FROM public.product_inventory pi
        JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
        JOIN public.organizations o ON o.id = pi.organization_id
       WHERE c.config_code = ANY (v_codes)
         AND COALESCE(pi.quantity_allocated, 0) <> 0
       GROUP BY o.org_code, c.config_code
    ) s;

  IF v_allocated IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'ALLOCATED_LEGACY_STOCK',
      'severity', 'blocking',
      'count', jsonb_array_length(v_allocated),
      'message', 'Legacy configurations carry allocated (reserved) stock. Release or fulfil the reservations before retiring the balance.',
      'action_owner', 'operations',
      'detail', v_allocated
    );
  END IF;

  -- --- Scope: what the cutover would actually retire -----------------------
  SELECT jsonb_agg(x ORDER BY x->>'config_code')
    INTO v_scope
    FROM (
      SELECT jsonb_build_object(
               'config_code', c.config_code,
               'inventory_rows', count(*) FILTER (WHERE COALESCE(pi.quantity_on_hand, 0) <> 0),
               'organizations', count(DISTINCT pi.organization_id) FILTER (WHERE COALESCE(pi.quantity_on_hand, 0) <> 0),
               'quantity_on_hand', COALESCE(sum(pi.quantity_on_hand), 0),
               'quantity_allocated', COALESCE(sum(pi.quantity_allocated), 0)
             ) AS x
        FROM public.inventory_stock_configurations c
        LEFT JOIN public.product_inventory pi ON pi.stock_config_id = c.id
       WHERE c.config_code = ANY (v_codes)
       GROUP BY c.config_code
    ) s;

  RETURN jsonb_build_object(
    'ok', v_blockers = '[]'::jsonb,
    'checked_at', now(),
    'legacy_config_codes', to_jsonb(v_codes),
    'writer_window_days', p_writer_window_days,
    'blocking_count', (SELECT count(*) FROM jsonb_array_elements(v_blockers) b
                        WHERE b->>'severity' = 'blocking'),
    'warning_count', (SELECT count(*) FROM jsonb_array_elements(v_blockers) b
                       WHERE b->>'severity' = 'warning'),
    'canonical_resolver_activated_at', v_activated_at,
    'blockers', v_blockers,
    'historical_legacy_writers', COALESCE(v_historical_writers, '[]'::jsonb),
    'retirement_scope', COALESCE(v_scope, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.legacy_config_cutover_preflight(integer) IS
  'Read-only readiness report for LEGACY-CONFIG-CUTOVER-2026. Reports open transfers, unposted adjustments, open count sessions, legacy writes after canonical-resolver activation, inactive legacy inventory rows, unbound open order items, unresolvable variants and allocated legacy stock. Legacy movements from BEFORE activation are reported as history and never block. p_writer_window_days sizes that historical summary only; blocking is decided by canonical_stock_config_activation.activated_at. Cancels nothing. execute_legacy_config_cutover() refuses to run while any blocking entry stands.';

REVOKE ALL ON FUNCTION public.legacy_config_cutover_preflight(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_config_cutover_preflight(integer) TO authenticated, service_role;

COMMIT;
