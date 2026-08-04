import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) =>
  fs.readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

const migration = repoFile(
  'supabase/migrations/20260801210000_fix_d2h_cancel_null_config_movement_variant_default.sql',
)

// The release function body (signature through its terminating $$;). The body
// opens with `AS $$` (no semicolon) and closes with `END $$;`, so the first
// `$$;` is the terminator.
const fnBody =
  migration.match(/create or replace function public\.release_allocation_for_order[\s\S]*?\$\$;/i)?.[0] ?? ''

const ordersView = repoFile('app/src/components/orders/OrdersView.tsx')
// Just the catch block of handleCancelOrder.
const cancelCatch =
  ordersView.match(/const handleCancelOrder[\s\S]*?\n  \}\n/)?.[0] ?? ''

describe('D2H cancel — legacy NULL stock_config_id allocation release (SQL contract)', () => {
  it('is a forward-only CREATE OR REPLACE, SECURITY DEFINER, pinned search_path, transaction-wrapped', () => {
    expect(fnBody).toMatch(/create or replace function public\.release_allocation_for_order/i)
    expect(fnBody).toMatch(/security definer/i)
    expect(fnBody).toMatch(/set search_path\s*=\s*public\s*,\s*pg_temp/i)
    expect(migration.trim().toLowerCase()).toMatch(/^begin;/)
    expect(migration.trim().toLowerCase()).toMatch(/commit;\s*$/)
    // The function keeps its signature — callers (cancel trigger, hard_delete_order,
    // cut-off cancel paths) must continue to resolve it unchanged.
    expect(fnBody).toContain('release_allocation_for_order(p_order_id uuid)')
  })

  it('resolves the configuration from the allocation ledger, not order_items.stock_config_id', () => {
    // Authoritative source: the immutable allocation movement for this exact order+variant.
    expect(fnBody).toMatch(/array_agg\(distinct sm\.stock_config_id\)/i)
    expect(fnBody).toContain("sm.movement_type='allocation'")
    expect(fnBody).toContain('sm.reference_id=p_order_id')
    expect(fnBody).toContain('sm.variant_id=v_item.variant_id')
    // The buggy prior behaviour — raising because the item column is NULL — is gone.
    expect(fnBody).not.toContain('Allocated order item % has no stock configuration')
  })

  it('requires an unambiguous match and fails closed on multiple configurations', () => {
    expect(fnBody).toMatch(/array_length\(v_cfgs,1\)\s*>\s*1/i)
    expect(fnBody).toMatch(/Ambiguous allocation for order .* refusing to release/i)
  })

  it('falls back to the variant-default sink when the allocation movement has no config', () => {
    // Legacy allocations recorded stock_config_id = NULL on the movement; the
    // reservation sits on the variant is_variant_default sink. Resolve it there.
    expect(fnBody).toContain('resolve_default_stock_config(v_item.variant_id)')
    // Only take the fallback when an allocation movement actually exists.
    expect(fnBody).toMatch(/v_has_alloc/)
    // Fail closed if even the default cannot be resolved.
    expect(fnBody).toMatch(/Cannot resolve stock configuration to release/i)
  })

  it('releases exactly qty from quantity_allocated and never changes quantity_on_hand on the plain path', () => {
    expect(fnBody).toContain('quantity_allocated=quantity_allocated-v_item.qty')
    // Guard: cannot release more than is reserved.
    expect(fnBody).toMatch(/v_alloc\s*<\s*v_item\.qty/)
    expect(fnBody).toContain('Cannot safely release item % configuration allocation')
    // The plain-allocation branch must not write quantity_on_hand. Isolate it by
    // its section comment (everything after the fulfilled-order path).
    const plainRelease = fnBody.split('-- Plain-allocation path').pop() ?? ''
    expect(plainRelease).toContain('quantity_allocated=quantity_allocated-v_item.qty')
    // No write to quantity_on_hand on this path (the comment may mention it).
    expect(plainRelease).not.toMatch(/quantity_on_hand\s*=/)
  })

  it('emits exactly one deallocation movement linked to the order', () => {
    // One INSERT of a 'deallocation' movement, referenced to the order.
    const deallocInserts = fnBody.match(/'deallocation','order',p_order_id/g) ?? []
    expect(deallocInserts).toHaveLength(1)
  })

  it('is idempotent / double-click safe', () => {
    expect(fnBody).toMatch(/movement_type='deallocation'\)\s*THEN CONTINUE/i)
  })

  it('does not modify the historical order item, physical counts, opening balance or QR data', () => {
    expect(fnBody).not.toMatch(/update\s+public\.order_items/i)
    expect(fnBody).not.toMatch(/inventory_opening_cutoffs|inventory_cutoff_decisions|opening_balance/i)
    expect(fnBody).not.toMatch(/qr_codes|qr_master_codes|physical_count|stock_count_session/i)
  })

  it('preserves the fulfilled-order cancellation reversal path keyed on the resolved config', () => {
    expect(fnBody).toContain("movement_type='order_fulfillment'")
    expect(fnBody).toContain("'order_cancel_reversal'")
    expect(fnBody).toContain('Buyer credit reversed on cancellation')
    expect(fnBody).toContain('Exact configuration restored on cancellation')
  })
})

describe('OrdersView cancellation error handling', () => {
  it('surfaces the backend code/details/hint instead of logging the raw error as {}', () => {
    expect(cancelCatch).toContain('error?.code')
    expect(cancelCatch).toContain('error?.details')
    expect(cancelCatch).toContain('error?.hint')
    expect(cancelCatch).toContain('error?.message')
    // Old behaviour logged the opaque object directly; that must be gone.
    expect(cancelCatch).not.toContain("console.error('Error cancelling order:', error)\n")
  })

  it('maps the known legacy-allocation backend messages to meaningful toasts', () => {
    expect(cancelCatch).toContain('has no stock configuration')
    expect(cancelCatch).toContain('Ambiguous allocation')
    expect(cancelCatch).toContain('Cannot safely release')
  })

  it('falls back to a connection message for a genuinely empty error object', () => {
    expect(cancelCatch).toMatch(/Object\.keys\(error\)\.length\s*===\s*0/)
  })
})
