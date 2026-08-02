import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  new URL(
    '../../../../supabase/migrations/20260801190000_inventory_cutoff_allocation_resolver.sql',
    import.meta.url,
  ),
  'utf8',
)

// The resolver function body (between its signature and its terminating $$;).
const resolverBody =
  migration.match(/create or replace function public\.resolve_inventory_cutoff_allocation[\s\S]*?\n\$\$;/i)?.[0] ?? ''
// The exclude_and_release branch (the only branch permitted to mutate inventory).
const releaseBranch =
  resolverBody.match(/else -- exclude_and_release([\s\S]*?)end if;\s*\n\s*-- Recompute/i)?.[1] ?? ''

describe('Opening Balance allocation resolver migration (SQL contract)', () => {
  it('is forward-only, HQ-admin only, security definer with a pinned search_path', () => {
    expect(resolverBody).toContain('create or replace function public.resolve_inventory_cutoff_allocation')
    expect(resolverBody).toContain('security definer')
    expect(resolverBody).toContain('set search_path = public, pg_temp')
    expect(resolverBody).toContain('not public.inventory_cutoff_is_hq_admin()')
    expect(resolverBody).toContain("raise exception 'permission_denied'")
    // Never renames the existing preview chain.
    expect(migration).not.toMatch(/alter function[\s\S]*inventory_cutoff_preview[\s\S]*rename to/i)
  })

  it('supports exactly the four explicit user-confirmed actions', () => {
    for (const action of [
      'select_related_order', 'carry_forward_related',
      'exclude_and_release', 'mark_manual_investigation',
    ]) {
      expect(migration).toContain(`'${action}'`)
    }
    expect(resolverBody).toContain("raise exception 'inventory_cutoff_allocation_action_invalid'")
  })

  it('locks and revalidates cut-off, inventory and order rows', () => {
    expect(resolverBody).toContain('pg_advisory_xact_lock')
    expect(resolverBody).toMatch(/from public\.inventory_opening_cutoffs[\s\S]*for update/)
    expect(resolverBody).toMatch(/from public\.product_inventory[\s\S]*for update/)
    expect(resolverBody).toContain('from public.orders o where o.id = p_related_order_id for update')
  })

  it('rejects stale preview quantities', () => {
    expect(resolverBody).toContain('p_expected_allocated is not null and p_expected_allocated <> v_allocated_before')
    expect(resolverBody).toContain('p_expected_selected is not null and p_expected_selected <> v_selected_before')
    expect(resolverBody).toContain("raise exception 'inventory_cutoff_stale_preview'")
  })

  it('detects the owner from evidence (submitted order + allocation movement), not source_order_id', () => {
    // Only 'submitted' D2H/S2D orders still hold a reservation on quantity_allocated.
    expect(resolverBody).toContain("o.status = 'submitted'")
    expect(resolverBody).toContain("o.order_type in ('D2H', 'S2D')")
    expect(resolverBody).toContain('public.order_inventory_organization(o.id) = v_cutoff.warehouse_organization_id')
    expect(resolverBody).toContain("movement_type = 'allocation'")
    expect(resolverBody).toContain("movement_type = 'deallocation'")
    expect(resolverBody).toContain('v_has_active_owner := v_owner_id is not null')
  })

  it('refuses release while a genuine active order owns the allocation', () => {
    expect(releaseBranch).toContain('if v_has_active_owner then')
    expect(releaseBranch).toContain("raise exception 'inventory_cutoff_allocation_active_owner")
    // Release path decrements ONLY quantity_allocated and writes a deallocation.
    expect(releaseBranch).toContain('update public.product_inventory')
    expect(releaseBranch).toContain('set quantity_allocated = v_after_alloc')
    expect(releaseBranch).not.toMatch(/quantity_on_hand\s*=/)
    expect(releaseBranch).toContain("'deallocation', 'opening_balance_cutoff'")
    expect(releaseBranch).toContain("raise exception 'inventory_cutoff_allocation_nothing_to_release'")
  })

  it('never releases merely by an action other than an explicit confirmed exclude', () => {
    // Only the exclude_and_release branch mutates product_inventory / stock_movements.
    const invUpdates = (resolverBody.match(/update public\.product_inventory/g) ?? []).length
    const movementInserts = (resolverBody.match(/insert into public\.stock_movements/g) ?? []).length
    expect(invUpdates).toBe(1)
    expect(movementInserts).toBe(1)
    expect(releaseBranch).toContain('update public.product_inventory')
    expect(releaseBranch).toContain('insert into public.stock_movements')
  })

  it('is idempotent and double-submit safe', () => {
    expect(migration).toContain('create table if not exists public.inventory_cutoff_allocation_requests')
    expect(migration).toContain('primary key (cutoff_id, idempotency_key)')
    expect(resolverBody).toContain("raise exception 'inventory_cutoff_allocation_idempotency_key_required'")
    expect(resolverBody).toContain("raise exception 'inventory_cutoff_allocation_idempotency_conflict'")
    expect(resolverBody).toContain("jsonb_build_object('idempotent_replay', true)")
    expect(resolverBody).toContain('insert into public.inventory_cutoff_allocation_requests')
  })

  it('records an immutable audit event with before/after, actor, cut-off, variant, config, reason and order', () => {
    expect(resolverBody).toContain('insert into public.inventory_cutoff_audit_events')
    for (const key of [
      "'allocated_before'", "'selected_before'", "'allocated_after'", "'selected_after'",
      "'product_variant_id'", "'stock_config_id'", "'reason'", "'related_order_id'",
      "'has_active_owner'", "'blocker_cleared'",
    ]) {
      expect(resolverBody).toContain(key)
    }
  })

  it('re-runs the preview after a successful resolution', () => {
    expect(resolverBody).toContain('v_preview := public.inventory_cutoff_preview(p_cutoff_id)')
    expect(resolverBody).toContain("'readiness', v_preview->>'readiness'")
    expect(resolverBody).toContain("'blocker_details', coalesce(v_preview->'blocker_details'")
  })

  it('never touches physical count / import rows or QR data', () => {
    expect(migration).not.toMatch(
      /\b(insert into|update|delete from|truncate)\s+public\.(stock_count_session_items|stock_count_sessions|stock_count_imports)\b/i,
    )
    const qrDml = migration.match(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+public\.(qr_[a-z0-9_]+|consumer_qr_scans|qr_verification_log)\b/gi,
    )
    expect(qrDml).toBeNull()
    expect(resolverBody).toContain("'qr_impact', 'none'")
    expect(resolverBody).toContain("'physical_count_impact', 'none'")
  })

  it('grants execute only to authenticated and revokes from public/anon', () => {
    expect(migration).toContain('revoke all on function public.resolve_inventory_cutoff_allocation')
    expect(migration).toContain('grant execute on function public.resolve_inventory_cutoff_allocation')
    expect(migration).toMatch(/grant execute on function public\.resolve_inventory_cutoff_allocation[\s\S]*to authenticated/)
    expect(migration).toContain('revoke all on public.inventory_cutoff_allocation_requests\n  from public, anon, authenticated')
  })
})

describe('OTP-binding RPC readiness hardening (SQL contract)', () => {
  const bind = migration.match(
    /create or replace function public\.bind_inventory_cutoff_verification_snapshot[\s\S]*?\n\$\$;/i,
  )?.[0] ?? ''

  it('independently rejects binding while any blocker remains', () => {
    expect(bind).toContain('v_preview := public.inventory_cutoff_preview(v_cutoff.id)')
    expect(bind).toContain("coalesce(v_preview->>'readiness', '') <> 'Ready'")
    expect(bind).toContain("raise exception 'inventory_cutoff_not_ready")
    // Forward-only replace; keeps the snapshot bind + does not rename.
    expect(bind).toContain('inventory_cutoff_snapshot_hash(v_cutoff.id)')
    expect(migration).not.toMatch(/rename to[\s\S]*bind_inventory_cutoff_verification_snapshot/i)
  })
})

describe('Allocation resolver API route (bridge contract)', () => {
  const route = fs.readFileSync(
    new URL('../../app/api/inventory/opening-balance/allocation-resolve/route.ts', import.meta.url),
    'utf8',
  )

  it('forwards to the RPC under the caller session and validates the action', () => {
    // User-context client (not the service-role admin) so auth.uid()/HQ-admin work.
    expect(route).toContain("context.supabase.rpc('resolve_inventory_cutoff_allocation'")
    expect(route).not.toContain("context.admin.rpc('resolve_inventory_cutoff_allocation'")
    for (const p of [
      'p_cutoff_id', 'p_product_variant_id', 'p_stock_config_id', 'p_action',
      'p_related_order_id', 'p_expected_allocated', 'p_expected_selected',
      'p_reason', 'p_idempotency_key',
    ]) {
      expect(route).toContain(p)
    }
  })

  it('requires a related order for select/carry and a reason for exclude/investigation', () => {
    expect(route).toContain("action === 'select_related_order' || action === 'carry_forward_related'")
    expect(route).toContain("action === 'exclude_and_release' || action === 'mark_manual_investigation'")
    expect(route).toContain('A related order is required')
    expect(route).toContain('A reason is required')
  })

  it('always supplies an idempotency key and performs no writes of its own', () => {
    expect(route).toMatch(/idempotencyKey[\s\S]*crypto\.randomUUID\(\)/)
    expect(route).not.toMatch(/\.from\(['"][a-z_]+['"]\)\s*\.(insert|update|delete|upsert)/)
    expect(route).toContain("'Cache-Control': 'private, no-store, max-age=0'")
  })
})
