import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../../supabase/migrations/20260726_inventory_opening_balance_cutoff/', import.meta.url)
const sql = (name: string) => fs.readFileSync(new URL(name, root), 'utf8')
const foundation = sql('01_cutoff_foundation.sql')
const preview = sql('02_cutoff_preview_and_decisions.sql')
const posting = sql('03_cutoff_atomic_posting.sql')
const doNotCarryForward = sql('05_cutoff_do_not_carry_forward.sql')
const authoritativeCarryForward = fs.readFileSync(
  new URL('../../../../supabase/migrations/20260731_inventory_cutoff_authoritative_carry_forward_resolver.sql', import.meta.url),
  'utf8',
)
const authoritativeH2mIncoming = fs.readFileSync(
  new URL('../../../../supabase/migrations/20260731_inventory_cutoff_authoritative_h2m_incoming_resolver.sql', import.meta.url),
  'utf8',
)
const h2mBulkCorrection = fs.readFileSync(
  new URL('../../../../supabase/migrations/20260731173000_inventory_cutoff_h2m_bulk_contract_targeting_fix.sql', import.meta.url),
  'utf8',
)
const carryForwardPreflightRoute = fs.readFileSync(
  new URL('../../app/api/inventory/opening-balance/carry-forward-preflight/route.ts', import.meta.url),
  'utf8',
)
const h2mIncomingPreflightRoute = fs.readFileSync(
  new URL('../../app/api/inventory/opening-balance/h2m-incoming-preflight/route.ts', import.meta.url),
  'utf8',
)
const d2hPolicyMigration = fs.readFileSync(
  new URL('../../../../supabase/migrations/20260731230000_inventory_cutoff_d2h_policy.sql', import.meta.url),
  'utf8',
)
const h2mBulkRoute = fs.readFileSync(
  new URL('../../app/api/inventory/opening-balance/h2m-bulk/route.ts', import.meta.url),
  'utf8',
)
const soLifecycle = fs.readFileSync(
  new URL('../../../../supabase/migrations/20260717_stock_config_05_so_fulfilment.sql', import.meta.url),
  'utf8',
)
const confirmShipment = fs.readFileSync(
  new URL('../../app/api/warehouse/confirm-shipment/route.ts', import.meta.url),
  'utf8',
)
const verificationRequest = fs.readFileSync(
  new URL('../../app/api/inventory/stock-count/verification/request/route.ts', import.meta.url),
  'utf8',
)

describe('Inventory Opening Balance Cut-off SQL contract', () => {
  it('uses the existing Stock Count tables and applies a warehouse-scoped freeze', () => {
    expect(foundation).toContain("'opening_balance_cutoff'")
    expect(foundation).toContain('inventory_cutoff_product_inventory_guard')
    expect(foundation).toContain('inventory_cutoff_stock_movement_guard')
    expect(foundation).toContain('warehouse_organization_id = p_warehouse_id')
    expect(foundation).toContain('inventory_cutoff_is_hq_admin')
  })

  it('keeps preview read-only and classifies exact lifecycle statuses', () => {
    const body = preview.match(
      /create or replace function public\.inventory_cutoff_preview[\s\S]*?\n\$\$;/i,
    )?.[0] || ''
    expect(body).not.toMatch(/\b(update|delete|insert into)\s+public\./i)
    expect(body).toContain("o.status='submitted'")
    expect(body).toContain("o.status in ('approved','warehouse_packed')")
    expect(body).toContain("o.status='shipped_distributor'")
    expect(body).toContain("'approved','closed'")
    expect(body).toContain('Protected — No Impact')
  })

  it('classifies only actual confirmed shipment as Stock in Transit', () => {
    expect(soLifecycle).toContain("PERFORM public.fulfill_order_inventory(p_order_id)")
    expect(soLifecycle).toContain("UPDATE public.orders SET status='approved'")
    expect(soLifecycle).toContain('quantity_on_hand=quantity_on_hand-v_item.qty')
    expect(confirmShipment).toContain("status: 'shipped_distributor'")
    expect(confirmShipment).toContain(".eq('status', 'warehouse_packed')")
    expect(preview).toContain("when o.status in ('approved','warehouse_packed') then 'Complete Before Cut-off'")
    expect(preview).toContain("when o.status='shipped_distributor' then 'Stock in Transit'")
  })

  it('leaves the normal post-cut-off order lifecycle authoritative and idempotent', () => {
    expect(`${foundation}\n${preview}\n${posting}`).not.toContain(
      'create or replace function public.allocate_inventory_for_order',
    )
    expect(`${foundation}\n${preview}\n${posting}`).not.toContain(
      'create or replace function public.orders_approve',
    )
    expect(soLifecycle).toContain("movement_type='order_fulfillment') THEN CONTINUE")
    expect(soLifecycle).toContain("IF v.status<>'submitted'")
  })

  it('cancels submitted distributor orders through release_allocation_for_order', () => {
    expect(posting).toContain("v_order.status<>'submitted'")
    expect(posting).toContain("status='cancelled'")
    expect(posting).toContain('release_allocation_for_order(v_order.id)')
    expect(posting).toContain('Cancelled during Inventory Opening Balance Cut-off')
  })

  it('maps carried distributor allocations only to active 20ml New Box', () => {
    expect(preview).toContain("c.volume_ml=20 and c.packaging='new_box'")
    expect(posting).toContain("c.volume_ml=20 and c.packaging='new_box'")
    expect(posting).toContain('inventory_cutoff_carried_allocation_shortage')
  })

  it('preserves partial H2M receiving and the selected item configuration', () => {
    expect(posting).toContain("v_order.order_type<>'H2M'")
    expect(posting).toContain('sum(received_now)')
    expect(posting).toContain('p_quantity_change=>v_received')
    expect(posting).toContain('p_stock_config_id=>v_config')
    expect(posting).toContain('warehouse_receipt_order_item_configuration_missing_or_conflicting')
    expect(posting).toContain('warehouse_receipt_order_already_fully_received')
    expect(posting).toContain("d.decision='history_only'")
    expect(posting).toContain("status='cancelled'")
  })

  it('uses a protected transaction context rather than a client-settable GUC for freeze bypass', () => {
    expect(foundation).toContain('inventory_cutoff_posting_context')
    expect(foundation).toMatch(
      /inventory_cutoff_assert_not_frozen\(p_warehouse_id uuid\)\s+returns void language plpgsql volatile/i,
    )
    expect(foundation).toContain('ctx.backend_pid=pg_backend_pid()')
    expect(foundation).toContain('ctx.transaction_id=txid_current()')
    expect(foundation).toContain('revoke all on public.inventory_cutoff_posting_context')
    expect(`${foundation}\n${posting}`).not.toContain("set_config('app.inventory_cutoff_bypass'")
    expect(posting).toContain('insert into public.inventory_cutoff_posting_context')
    expect(posting).toContain('delete from public.inventory_cutoff_posting_context')
  })

  it('does not mutate or reclassify QR records', () => {
    const dml = `${foundation}\n${preview}\n${posting}`.match(
      /\b(?:insert\s+into|update|delete\s+from|truncate\s+(?:table\s+)?)\s+public\.(qr_[a-z0-9_]+|consumer_qr_scans|qr_verification_log)\b/gi,
    )
    expect(dml).toBeNull()
  })

  it('rechecks readiness and consumes OTP atomically and idempotently', () => {
    expect(posting).toContain('for update')
    expect(posting).toContain('inventory_cutoff_preview(v_cutoff.id)')
    expect(preview).toContain('inventory_cutoff_snapshot_hash')
    expect(preview).toContain("'inventory_cutoff_decision_changed'")
    expect(verificationRequest).toContain('bind_inventory_cutoff_verification_snapshot')
    expect(posting).toContain('inventory_cutoff_snapshot_hash(v_cutoff.id)')
    expect(posting).toContain("v_request.status='posted'")
    expect(posting).toContain("where id=v_session.id and status='draft'")
    expect(posting).toContain("where id=v_cutoff.id and status='counting'")
  })

  it('keeps the established service-role warehouse receipt call compatible', () => {
    expect(posting).toContain("coalesce(auth.role(),'')<>'service_role'")
    expect(posting).toContain('p_received_by is distinct from auth.uid()')
    expect(posting).toContain('warehouse_receipt_order_already_fully_received')
  })
})

describe('Do Not Carry Forward (migration 05) SQL contract', () => {
  it('is forward-only and does not edit the applied 01–04 migrations', () => {
    // The prior migrations still declare only the original four decisions.
    expect(foundation).toContain(
      "'carry_forward', 'cancel_release', 'carry_forward_incoming', 'history_only'",
    )
    expect(foundation).not.toContain('do_not_carry_forward')
    expect(preview).not.toContain('do_not_carry_forward')
    expect(posting).not.toContain('do_not_carry_forward')
  })

  it('widens the decision CHECK constraint idempotently and non-destructively', () => {
    expect(doNotCarryForward).toContain('drop constraint if exists inventory_cutoff_decisions_decision_check')
    expect(doNotCarryForward).toContain('add constraint inventory_cutoff_decisions_decision_check')
    expect(doNotCarryForward).toContain("'do_not_carry_forward'")
    // No destructive data statements.
    expect(doNotCarryForward).not.toMatch(/\b(drop table|truncate|delete from public\.inventory_cutoff_decisions)\b/i)
  })

  it('accepts the explicit exclude only for submitted distributor orders', () => {
    expect(doNotCarryForward).toContain(
      "p_decision not in ('carry_forward','cancel_release','do_not_carry_forward')",
    )
    // Exclude neither requires nor manipulates an allocation.
    expect(doNotCarryForward).toContain("if p_decision in ('carry_forward','cancel_release') then")
  })

  it('classifies and offers the explicit exclude in preview, resolving the blocker', () => {
    expect(doNotCarryForward).toContain("when o.status='submitted' and d.decision='do_not_carry_forward' then 'Do Not Carry Forward'")
    expect(doNotCarryForward).toContain("'Carry Forward','Cancel & Release','Do Not Carry Forward'")
    expect(doNotCarryForward).toContain('do-not-carry-forward decision')
  })

  it('posts one immutable audit event and no inventory/order mutation for exclude', () => {
    const excludeLoop = doNotCarryForward.match(
      /Explicit Do Not Carry Forward:[\s\S]*?end loop;/i,
    )?.[0] || ''
    expect(excludeLoop).toContain("d.decision='do_not_carry_forward'")
    expect(excludeLoop).toContain('distributor_order_excluded_do_not_carry_forward')
    // The loop writes an audit event but performs no order/inventory write.
    expect(excludeLoop).toContain('insert into public.inventory_cutoff_audit_events')
    expect(excludeLoop).not.toMatch(/update public\.orders/i)
    expect(excludeLoop).not.toMatch(/update public\.product_inventory/i)
    expect(excludeLoop).not.toContain('release_allocation_for_order')
    expect(excludeLoop).toContain("'allocation_released',false")
    expect(excludeLoop).toContain("'inventory_impact','none'")
  })

  it('inherits idempotency and stale-posting protection from the atomic post', () => {
    // Single post: session/cut-off flip to posted guards replay.
    expect(doNotCarryForward).toContain("where id=v_session.id and status='draft'")
    expect(doNotCarryForward).toContain("where id=v_cutoff.id and status='counting'")
    // Distributor stale check (covers exclude) still present.
    expect(doNotCarryForward).toContain('inventory_cutoff_distributor_decision_stale')
    expect(doNotCarryForward).toContain('inventory_cutoff_snapshot_hash(v_cutoff.id)')
  })

  it('touches no QR tables', () => {
    const dml = doNotCarryForward.match(
      /\b(?:insert\s+into|update|delete\s+from|truncate\s+(?:table\s+)?)\s+public\.(qr_[a-z0-9_]+|consumer_qr_scans|qr_verification_log)\b/gi,
    )
    expect(dml).toBeNull()
    expect(doNotCarryForward).toContain("'qr_impact','none'")
  })
})

describe('Authoritative Opening Balance Carry Forward resolver', () => {
  it('is a new forward-only migration and does not mutate operational data', () => {
    expect(authoritativeCarryForward).toContain(
      'create or replace function public.resolve_inventory_cutoff_d2h_carry_forward',
    )
    expect(authoritativeCarryForward).not.toMatch(
      /\b(insert into|update|delete from)\s+public\.(product_inventory|stock_count_session_scope|stock_count_session_items|orders|order_items)\b/i,
    )
  })

  it('matches exact order-item variant, cutoff/session warehouse, and immutable scope', () => {
    expect(authoritativeCarryForward).toContain('c.variant_id = v_item.variant_id')
    expect(authoritativeCarryForward).toContain(
      'public.order_inventory_organization(v_order.id)',
    )
    expect(authoritativeCarryForward).toContain(
      'v_session.warehouse_organization_id is distinct from',
    )
    expect(authoritativeCarryForward).toContain(
      'from public.stock_count_session_scope scope_row',
    )
    expect(authoritativeCarryForward).toContain(
      'scope_row.session_id = v_cutoff.stock_count_session_id',
    )
    expect(authoritativeCarryForward).toContain(
      'scope_row.stock_config_id = v_config.id',
    )
  })

  it('requires exact active, allow_so 20ml New Box without product_inventory', () => {
    expect(authoritativeCarryForward).toContain('c.volume_ml = 20')
    expect(authoritativeCarryForward).toContain("c.packaging = 'new_box'")
    expect(authoritativeCarryForward).toContain("v_config.status <> 'active'")
    expect(authoritativeCarryForward).toContain('not v_config.allow_so')
    const resolver = authoritativeCarryForward.match(
      /create or replace function public\.resolve_inventory_cutoff_d2h_carry_forward[\s\S]*?\n\$\$;/i,
    )?.[0] || ''
    expect(resolver).not.toContain('public.product_inventory')
    expect(resolver).not.toContain('physical_quantity')
  })

  it('returns precise reasons and refuses ambiguous candidates', () => {
    for (const reason of [
      'inventory_cutoff_configuration_missing',
      'inventory_cutoff_configuration_inactive',
      'inventory_cutoff_configuration_wrong_warehouse',
      'inventory_cutoff_configuration_wrong_variant',
      'inventory_cutoff_configuration_not_order_eligible',
      'inventory_cutoff_configuration_not_in_session_scope',
      'inventory_cutoff_configuration_ambiguous',
      'inventory_cutoff_stale_preflight_data',
    ]) {
      expect(authoritativeCarryForward).toContain(reason)
    }
    expect(authoritativeCarryForward).toContain('if v_candidate_count > 1')
  })

  it('is consumed by decision application and atomic posting', () => {
    const uses = authoritativeCarryForward.match(
      /resolve_inventory_cutoff_d2h_carry_forward/g,
    ) || []
    expect(uses.length).toBeGreaterThanOrEqual(4)
    expect(authoritativeCarryForward).toContain(
      'verify_and_post_inventory_opening_cutoff_scoped_legacy',
    )
    expect(authoritativeCarryForward).toContain(
      "decision_row.decision = 'carry_forward'",
    )
  })

  it('makes the preflight a no-store adapter over the database resolver', () => {
    expect(carryForwardPreflightRoute).toContain(
      "'resolve_inventory_cutoff_d2h_carry_forward'",
    )
    expect(carryForwardPreflightRoute).toContain(
      "'Cache-Control': 'private, no-store, max-age=0'",
    )
    expect(carryForwardPreflightRoute).not.toContain(
      ".from('inventory_stock_configurations')",
    )
    expect(carryForwardPreflightRoute).not.toContain(".from('product_inventory')")
  })
})

describe('Authoritative H2M bulk decision contract', () => {
  it('uses one exact SQL and TypeScript RPC contract', () => {
    expect(h2mBulkCorrection).toMatch(
      /inventory_cutoff_h2m_bulk_preflight\(\s*p_cutoff_id uuid,\s*p_action text,\s*p_order_ids uuid\[\]/,
    )
    expect(h2mBulkRoute).toContain(
      "'inventory_cutoff_h2m_bulk_preflight'",
    )
    expect(h2mBulkRoute).toContain('p_cutoff_id: cutoffId')
    expect(h2mBulkRoute).toContain('p_action: action')
    expect(h2mBulkRoute).toContain('p_order_ids: orderIds')
    expect(h2mBulkRoute).not.toContain('p_order_item_ids')
  })

  it('derives category scope and all-remaining targets on the server', () => {
    expect(h2mBulkCorrection).toContain(
      'create or replace function public.inventory_cutoff_h2m_bulk_preflight',
    )
    expect(h2mBulkCorrection).toContain(
      'session_row.product_category_id = v_cutoff.product_category_id',
    )
    expect(h2mBulkCorrection).toContain(
      'product.category_id = v_cutoff.product_category_id',
    )
    expect(h2mBulkCorrection).toContain(
      "p_action = 'all_remaining_not_incoming'",
    )
    expect(h2mBulkCorrection).toContain('scoped.order_id = any')
    expect(h2mBulkCorrection).toContain('scoped.decision is null unresolved')
  })

  it('preserves saved decisions and requires Incoming configuration only for selected Incoming', () => {
    expect(h2mBulkCorrection).toContain(
      'when scoped.decision is not null then false',
    )
    expect(h2mBulkCorrection).toContain(
      "when p_action = 'selected_incoming' then scoped.incoming_eligible",
    )
    expect(h2mBulkCorrection).toMatch(
      /when p_action = 'selected_incoming' then scoped\.incoming_eligible\s+else true/,
    )
    expect(h2mBulkCorrection).toMatch(
      /count\(\*\) filter \(\s*where decision = 'carry_forward_incoming'/,
    )
    expect(h2mBulkCorrection).toContain(
      "where p_action = 'selected_incoming'",
    )
  })

  it('applies one locked atomic batch with stale-scope and replay protection', () => {
    expect(authoritativeH2mIncoming).toContain(
      'create table if not exists public.inventory_cutoff_h2m_bulk_requests',
    )
    expect(h2mBulkCorrection).toContain('pg_advisory_xact_lock')
    expect(h2mBulkCorrection).toContain(
      'inventory_cutoff_h2m_bulk_scope_changed',
    )
    expect(h2mBulkCorrection).toContain(
      'inventory_cutoff_h2m_bulk_idempotency_conflict',
    )
    expect(h2mBulkCorrection).toContain(
      'perform public.set_inventory_cutoff_decision',
    )
    expect(h2mBulkCorrection).toContain(
      "jsonb_array_elements_text(v_summary->'eligible_item_ids')",
    )
  })

  it('keeps preflight read-only, restricts it to HQ, and reloads PostgREST discovery', () => {
    const preflightBody = h2mBulkCorrection.match(
      /create or replace function public\.inventory_cutoff_h2m_bulk_preflight[\s\S]*?\n\$\$;/i,
    )?.[0] || ''
    expect(preflightBody).not.toMatch(
      /\b(insert into|update|delete from)\s+public\./i,
    )
    expect(preflightBody).toContain('public.inventory_cutoff_is_hq_admin()')
    expect(h2mBulkCorrection).toContain("notify pgrst, 'reload schema'")
  })

  it('reports a missing bulk RPC distinctly and promises no unsafe fallback', () => {
    expect(h2mBulkRoute).toContain('categorizeH2mBulkError(error, apply)')
    expect(h2mBulkRoute).toContain("'h2m_bulk_resolver_unavailable'")
    expect(h2mBulkRoute).toContain('savedDecisionsPreserved: true')
    expect(h2mBulkRoute).toContain('responseHeaders(correlationId)')
    expect(h2mBulkRoute).not.toContain('set_inventory_cutoff_decision')
  })

  it('returns the canonical snake_case response and rejects empty mutation targets', () => {
    for (const key of [
      'cutoff_id',
      'confirmation_fingerprint',
      'eligible_item_count',
      'affected_order_count',
      'resolved_item_count',
      'saved_incoming_count',
      'saved_not_incoming_count',
      'blocked_item_count',
      'eligible_item_ids',
      'eligible_order_ids',
      'blocked_item_ids',
    ]) {
      expect(h2mBulkCorrection).toContain(`'${key}'`)
    }
    expect(h2mBulkCorrection).toContain(
      'inventory_cutoff_h2m_bulk_selection_required',
    )
    expect(h2mBulkCorrection).toContain(
      'inventory_cutoff_h2m_bulk_no_eligible_items',
    )
  })

  it('keeps the historical migration unchanged and corrects it forward-only', () => {
    expect(authoritativeH2mIncoming).toContain("'fingerprint'")
    expect(authoritativeH2mIncoming).toContain("'eligible_order_item_ids'")
    expect(h2mBulkCorrection).not.toContain("'eligible_order_item_ids'")
    expect(h2mBulkCorrection).toContain("'confirmation_fingerprint'")
  })
})

describe('Authoritative H2M Incoming resolver', () => {
  const resolver = authoritativeH2mIncoming.match(
    /create or replace function public\.resolve_inventory_cutoff_h2m_incoming[\s\S]*?\n\$\$;/i,
  )?.[0] || ''

  it('is forward-only and keeps preflight free of operational writes', () => {
    expect(authoritativeH2mIncoming).toContain(
      'create or replace function public.resolve_inventory_cutoff_h2m_incoming',
    )
    expect(resolver).not.toMatch(
      /\b(insert into|update|delete from)\s+public\.(product_inventory|orders|order_items|inventory_cutoff_decisions|inventory_cutoff_audit_events)\b/i,
    )
  })

  it('uses exact variant UUID, cutoff/session warehouse and immutable scope', () => {
    expect(resolver).toContain('c.variant_id = v_item.variant_id')
    expect(resolver).toContain(
      'public.resolve_order_destination_warehouse(v_order.buyer_org_id)',
    )
    expect(resolver).toContain(
      'v_session.warehouse_organization_id is distinct from',
    )
    expect(resolver).toContain('join public.stock_count_session_scope')
    expect(resolver).toContain(
      'scope_row.session_id = v_cutoff.stock_count_session_id',
    )
    expect(resolver).toContain('p.category_id')
    expect(resolver).toContain(
      'v_item_product_category_id is distinct from',
    )
    expect(resolver).toContain(
      'v_cutoff.product_category_id',
    )
  })

  it('scopes preview, decisions, blockers and posting by the saved category id', () => {
    expect(authoritativeH2mIncoming).toContain(
      'v_session.product_category_id is distinct from v_cutoff.product_category_id',
    )
    expect(authoritativeH2mIncoming).toContain(
      'product.category_id = v_cutoff.product_category_id',
    )
    expect(authoritativeH2mIncoming).toContain(
      'inventory_cutoff_product_category_scope_mismatch',
    )
    expect(authoritativeH2mIncoming).toContain(
      "decision_row.transaction_kind = 'manufacturer'",
    )
    expect(authoritativeH2mIncoming).toContain(
      'product.category_id is distinct from v_category_id',
    )
    expect(authoritativeH2mIncoming).not.toMatch(
      /where\s+(?:coalesce\([^)]*\)|order_(?:row\.)?display_doc_no|order_(?:row\.)?order_no)\s*(?:like|=)/i,
    )
    expect(authoritativeH2mIncoming).not.toContain('ORD25000004')
  })

  it('sorts the scoped H2M preview newest first with deterministic tie-breakers', () => {
    expect(authoritativeH2mIncoming).toMatch(
      /scoped\.created_at desc,\s+scoped\.base_seq desc nulls last,\s+scoped\.order_id desc,\s+scoped\.order_item_id/i,
    )
    expect(authoritativeH2mIncoming).toContain(
      "'order_created_at', scoped.created_at",
    )
    expect(authoritativeH2mIncoming).toContain(
      "'order_sequence', scoped.base_seq",
    )
  })

  it('fails closed when the cutoff category is missing or invalid', () => {
    expect(authoritativeH2mIncoming).toContain(
      "raise exception 'stock_count_active_product_category_required'",
    )
    expect(authoritativeH2mIncoming).toContain(
      'category_row.is_active = true',
    )
  })

  it('requires active allow_ord without inventory, quantity or name matching', () => {
    expect(resolver).toContain("c.status = 'active'")
    expect(resolver).toContain('c.allow_ord')
    expect(resolver).not.toContain('public.product_inventory')
    expect(resolver).not.toContain('physical_quantity')
    expect(resolver).not.toMatch(/variant_name\s*=/)
  })

  it('fails closed with precise reasons for missing, invalid and ambiguous candidates', () => {
    for (const reason of [
      'inventory_cutoff_configuration_missing',
      'inventory_cutoff_configuration_inactive',
      'inventory_cutoff_configuration_wrong_warehouse',
      'inventory_cutoff_configuration_wrong_variant',
      'inventory_cutoff_configuration_not_receiving_eligible',
      'inventory_cutoff_configuration_not_in_session_scope',
      'inventory_cutoff_configuration_ambiguous',
    ]) {
      expect(resolver).toContain(reason)
    }
    expect(resolver).toContain('if v_scoped_count > 1')
  })

  it('is shared by preflight, decision application and final posting', () => {
    expect(
      authoritativeH2mIncoming.match(/resolve_inventory_cutoff_h2m_incoming/g)?.length,
    ).toBeGreaterThanOrEqual(4)
    expect(h2mIncomingPreflightRoute).toContain(
      "'resolve_inventory_cutoff_h2m_incoming'",
    )
    expect(h2mIncomingPreflightRoute).toContain(
      'p_cutoff_id: cutoffId, p_order_item_ids: orderItemIds',
    )
    expect(h2mIncomingPreflightRoute).toContain(
      "'Cache-Control': 'private, no-store, max-age=0'",
    )
    expect(h2mIncomingPreflightRoute).not.toContain(
      ".from('inventory_stock_configurations')",
    )
    expect(h2mIncomingPreflightRoute).toContain('correlationId')
    expect(h2mIncomingPreflightRoute).toContain('failure.category')
  })

  it('pins the resolved config atomically and revalidates it before legacy posting', () => {
    expect(authoritativeH2mIncoming).toMatch(
      /update public\.order_items\s+set stock_config_id = v_config,\s+stock_config_confirmed_at = now\(\),\s+stock_config_confirmed_by = v_user/,
    )
    expect(authoritativeH2mIncoming).toContain(
      "decision_row.decision = 'carry_forward_incoming'",
    )
    expect(authoritativeH2mIncoming).toContain(
      'v_resolution.selected_stock_config_id',
    )
    expect(authoritativeH2mIncoming).toContain(
      'verify_and_post_inventory_opening_cutoff_scoped_legacy',
    )
  })

  it('preserves History Only and existing outstanding quantity calculation', () => {
    expect(authoritativeH2mIncoming).toContain(
      "p_decision not in ('carry_forward_incoming','history_only')",
    )
    expect(authoritativeH2mIncoming).toContain(
      'v_item.qty-v_received <= 0',
    )
    expect(authoritativeH2mIncoming).toContain(
      "case when v_kind='manufacturer' then v_item.qty-v_received else v_item.qty end",
    )
    expect(authoritativeH2mIncoming).not.toContain(
      'create or replace function public.post_warehouse_receipt',
    )
  })
})

describe('Stock adjustment activity eligibility (Transactions step)', () => {
  const stockAdjustmentEligibility = fs.readFileSync(
    new URL(
      '../../../../supabase/migrations/20260731190000_inventory_cutoff_stock_adjustment_activity_eligibility.sql',
      import.meta.url,
    ),
    'utf8',
  )
  const stockAdjustmentDetail = fs.readFileSync(
    new URL(
      '../../../../supabase/migrations/20260731210000_inventory_cutoff_stock_adjustment_activity_detail_category.sql',
      import.meta.url,
    ),
    'utf8',
  )

  it('is a forward-only wrapper and does not mutate business transactions', () => {
    expect(stockAdjustmentEligibility).toContain(
      'rename to inventory_cutoff_preview_pre_stock_adjustment_eligibility',
    )
    expect(stockAdjustmentEligibility).toContain(
      'create function public.inventory_cutoff_preview(p_cutoff_id uuid)',
    )
    expect(stockAdjustmentEligibility).not.toMatch(
      /\b(insert into|update|delete from)\s+public\.(stock_adjustments|stock_adjustment_items|stock_movements|product_inventory)\b/i,
    )
    expect(stockAdjustmentDetail).toContain(
      'rename to inventory_cutoff_preview_pre_stock_adjustment_detail',
    )
    expect(stockAdjustmentDetail).not.toMatch(
      /\b(insert into|update|delete from)\s+public\.(stock_adjustments|stock_adjustment_items|stock_movements|product_inventory|orders|order_items)\b/i,
    )
  })

  it('keeps the UUID internal and does not invent a document number', () => {
    const body = stockAdjustmentDetail.match(
      /create function public\.inventory_cutoff_preview[\s\S]*?\n\$\$;/i,
    )?.[0] || ''
    expect(body).toContain("'reference_id', a.id")
    expect(body).toContain("'reference_no', null")
    expect(body).not.toContain('a.id::text')
    expect(body).not.toContain('QI-')
  })

  it('sums child-line impact quantity instead of hardcoding header zero', () => {
    expect(stockAdjustmentDetail).toContain('sum(abs(i.adjustment_quantity))')
    expect(stockAdjustmentDetail).toContain('from public.stock_adjustment_items i')
    expect(stockAdjustmentDetail).toContain("'line_count', coalesce(impact.line_count, 0)")
    expect(stockAdjustmentDetail).toContain("'items', coalesce(impact.items, '[]'::jsonb)")
    expect(stockAdjustmentDetail).not.toMatch(
      /select 'stock_adjustment','adjustment',a\.id::text,a\.status,0,/i,
    )
  })

  it('excludes quality-issue tickets and empty drafts from readiness blockers', () => {
    expect(stockAdjustmentDetail).toContain("'quality_issue', 'return_to_supplier', 'damaged_goods'")
    expect(stockAdjustmentDetail).toContain(
      "'completed', 'cancelled', 'resolved', 'rejected'",
    )
    expect(stockAdjustmentDetail).toContain('coalesce(i.adjustment_quantity, 0) <> 0')
    expect(stockAdjustmentDetail).toContain("blocker.value not like 'Stock adjustment %'")
  })

  it('preserves warehouse and product-category boundaries for adjustment eligibility', () => {
    expect(stockAdjustmentDetail).toContain(
      'a.organization_id = v_cutoff.warehouse_organization_id',
    )
    expect(stockAdjustmentDetail).toContain(
      'p.category_id = v_cutoff.product_category_id',
    )
    expect(stockAdjustmentDetail).toContain(
      "raise exception 'stock_count_active_product_category_required'",
    )
    expect(stockAdjustmentDetail).toContain('pv.variant_name')
    expect(stockAdjustmentDetail).toContain('c.config_label')
  })

  it('recomputes readiness after replacing the adjustment blocker slice', () => {
    expect(stockAdjustmentDetail).toContain("when jsonb_array_length(v_blockers) > 0 then 'Blocked'")
    expect(stockAdjustmentDetail).toContain("'warehouse_activity', v_activity")
    expect(stockAdjustmentDetail).toContain("'blockers', v_blockers")
    expect(stockAdjustmentDetail).toContain("'readiness', v_readiness")
  })

  it('keeps one activity row per adjustment header and does not group by timestamp', () => {
    expect(stockAdjustmentDetail).toContain('from public.stock_adjustments a')
    expect(stockAdjustmentDetail).not.toContain('group by a.created_at')
    expect(stockAdjustmentDetail).toContain("'required_action', 'Complete or Cancel'")
  })
})

describe('Cancel freeze archives Opening Balance draft session', () => {
  const cancelArchives = fs.readFileSync(
    new URL(
      '../../../../supabase/migrations/20260731220000_inventory_cutoff_cancel_archives_draft_session.sql',
      import.meta.url,
    ),
    'utf8',
  )

  it('archives the linked draft and backfills stuck cancelled drafts without mutating stock', () => {
    expect(cancelArchives).toContain('create or replace function public.cancel_inventory_opening_cutoff')
    expect(cancelArchives).toContain("status = 'archived'")
    expect(cancelArchives).toContain("count_type = 'opening_balance_cutoff'")
    expect(cancelArchives).toContain("c.status = 'cancelled'")
    expect(cancelArchives).not.toMatch(
      /\b(insert into|update|delete from)\s+public\.(product_inventory|stock_movements|orders|order_items)\b/i,
    )
  })
})

describe('D2H policy (fresh baseline Option A / Option B)', () => {
  it('adds an immutable policy snapshot and authoritative apply/preflight RPCs', () => {
    expect(d2hPolicyMigration).toContain('create table if not exists public.inventory_cutoff_d2h_policies')
    expect(d2hPolicyMigration).toContain("check (policy in ('exclude_all', 'review_select'))")
    expect(d2hPolicyMigration).toContain('inventory_cutoff_d2h_policy_preflight')
    expect(d2hPolicyMigration).toContain('apply_inventory_cutoff_d2h_policy')
    expect(d2hPolicyMigration).toContain('coalesce(v_cutoff.posted_at, v_cutoff.proposed_cutoff_at)')
    expect(d2hPolicyMigration).toContain('p.category_id = v_cutoff.product_category_id')
    expect(d2hPolicyMigration).toContain("'cutoff_cancelled', false")
    expect(d2hPolicyMigration).not.toMatch(/perform public\.cancel_inventory_opening_cutoff/)
  })

  it('wraps preview with policy-aware D2H blockers and historical exclusion summary', () => {
    expect(d2hPolicyMigration).toContain('rename to inventory_cutoff_preview_pre_d2h_policy')
    expect(d2hPolicyMigration).toContain("'d2h_policy'")
    expect(d2hPolicyMigration).toContain("'d2h_historical_summary'")
    expect(d2hPolicyMigration).toContain("'Historical Excluded'")
    expect(d2hPolicyMigration).toContain('A D2H policy is required before Opening Balance can be posted')
  })

  it('category-scopes allocation ownership and never cancels orders under exclude_all', () => {
    expect(d2hPolicyMigration).toContain("v_decision := 'do_not_carry_forward'")
    expect(d2hPolicyMigration).toContain('and p.category_id = v_cutoff.product_category_id')
    expect(d2hPolicyMigration).toContain("'orders_cancelled', false")
    expect(d2hPolicyMigration).toContain("'historical_movements_reversed', false")
    expect(d2hPolicyMigration).toContain("'qr_impact', 'none'")
  })
})

