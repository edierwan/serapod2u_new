import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * SQL contract for 20260801250000 — the fix for the SC-MSB3UFDM-1FSK final-post
 * failure. The '5th Initial' Opening Balance held ONE distributor decision,
 * 'do_not_carry_forward' for D2H order SO26000085, captured while that order was
 * still 'submitted'. The order was later cancelled and its orphan allocation
 * released by the Opening Balance's own allocation resolver. The final post then
 * raised P0001 'inventory_cutoff_distributor_decision_stale' because the gate
 * demanded o.status = 'submitted' for EVERY distributor decision — including a
 * metadata-only exclusion that performs no inventory, allocation or order work.
 */

const url = (name: string) => new URL(`../../../../supabase/migrations/${name}`, import.meta.url)
const MIGRATION_250000 = '20260801250000_opening_balance_post_excluded_d2h_order_status_tolerance.sql'
const MIGRATION_240000 = '20260801240000_opening_balance_post_allows_review_required.sql'

const migration = fs.readFileSync(url(MIGRATION_250000), 'utf8')
const previous = fs.readFileSync(url(MIGRATION_240000), 'utf8')

const fnBody = (sql: string, name: string) => {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\n\\$function\\$;`, 'i'))
  return m?.[0] ?? ''
}
const scoped = fnBody(migration, 'verify_and_post_inventory_opening_cutoff_scoped_legacy')
const scopedPrevious = fnBody(previous, 'verify_and_post_inventory_opening_cutoff_scoped_legacy')

const collapse = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

describe('Opening Balance post tolerates a non-submitted excluded D2H order (20260801250000)', () => {
  it('is a forward-only transactional migration that reloads the PostgREST schema cache', () => {
    expect(migration.trim().toLowerCase().startsWith('begin;')).toBe(true)
    expect(migration.trim().toLowerCase().endsWith('commit;')).toBe(true)
    expect(migration.toLowerCase()).toContain("notify pgrst, 'reload schema'")
    // Forward-only: never drops or renames the function it replaces.
    expect(migration.toLowerCase()).not.toContain('drop function')
    expect(migration.toLowerCase()).not.toContain('alter function')
  })

  it('replaces exactly one function and keeps its signature and attributes', () => {
    expect(scoped).toBeTruthy()
    expect(scoped).toContain('verify_and_post_inventory_opening_cutoff_scoped_legacy(p_request_id uuid, p_code_hash text)')
    expect(scoped).toMatch(/security definer/i)
    expect(scoped).toMatch(/SET search_path TO 'public', 'pg_temp'/i)
    expect(scoped).toMatch(/SET statement_timeout TO '300s'/i)
    expect(scoped).toMatch(/SET lock_timeout TO '30s'/i)
    // Only the scoped_legacy overload is touched; the wrappers are untouched.
    expect(migration).not.toMatch(/create or replace function public\.verify_and_post_inventory_opening_cutoff\(/i)
    expect(migration).not.toMatch(/create or replace function public\.verify_and_post_inventory_opening_cutoff_pre_transactions_policy/i)
    expect(migration).not.toMatch(/create or replace function public\.bind_inventory_cutoff_verification_snapshot/i)
  })

  it('no longer requires a submitted order for a metadata-only do_not_carry_forward decision', () => {
    const gate = collapse(scoped)
    // The blanket "every distributor decision needs status='submitted'" is gone.
    expect(collapse(scopedPrevious)).toContain(
      "and (o.status<>'submitted' or o.order_type not in ('D2H','S2D') or d.quantity<>oi.qty)",
    )
    expect(gate).not.toContain(
      "and (o.status<>'submitted' or o.order_type not in ('D2H','S2D') or d.quantity<>oi.qty)",
    )
    // The status requirement now applies only to the mutating decisions.
    expect(gate).toContain("d.decision in ('carry_forward','cancel_release') and o.status<>'submitted'")
  })

  it('still enforces order type and decision-quantity integrity for every distributor decision', () => {
    const gate = collapse(scoped)
    expect(gate).toContain('d.quantity<>oi.qty')
    expect(gate).toContain("o.order_type not in ('D2H','S2D')")
    expect(scoped).toContain("raise exception 'inventory_cutoff_distributor_decision_stale'")
  })

  it('keeps the strict submitted requirement on the cancel_release loop (it mutates orders)', () => {
    const cancelLoop = scoped.slice(
      scoped.indexOf("d.decision='cancel_release'"),
      scoped.indexOf("d.decision='do_not_carry_forward'"),
    )
    expect(cancelLoop).toContain("if v_order.status<>'submitted' or v_order.order_type not in ('D2H','S2D') then")
    expect(cancelLoop).toContain("raise exception 'inventory_cutoff_distributor_not_eligible'")
    // It still actually cancels and releases.
    expect(cancelLoop).toContain("update public.orders set status='cancelled'")
    expect(cancelLoop).toContain('release_allocation_for_order')
  })

  it('the do_not_carry_forward loop accepts any order status and records the real one', () => {
    const excludeLoop = scoped.slice(scoped.indexOf("d.decision='do_not_carry_forward'"))
      .slice(0, scoped.slice(scoped.indexOf("d.decision='do_not_carry_forward'")).indexOf('end loop;'))
    // Scoped to distributor decisions only.
    expect(excludeLoop.length).toBeGreaterThan(0)
    expect(scoped).toContain("where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'\n        and d.order_id=o.id and d.decision='do_not_carry_forward'")
    // No status veto, but the order type is still checked.
    expect(excludeLoop).not.toContain("v_order.status<>'submitted'")
    expect(excludeLoop).toContain("if v_order.order_type not in ('D2H','S2D') then")
    // The order's true status is preserved verbatim in the audit event.
    expect(excludeLoop).toContain("'order_status_preserved',v_order.status")
    // It remains metadata-only: no inventory, no allocation, no order mutation.
    expect(excludeLoop).toContain("'allocation_released',false,'inventory_impact','none','qr_impact','none'")
    expect(excludeLoop).not.toContain('update public.orders')
    expect(excludeLoop).not.toContain('update public.product_inventory')
    expect(excludeLoop).not.toContain('insert into public.stock_movements')
  })

  it('changes NOTHING else: every other guard, write and status transition matches 240000', () => {
    // Whole-function equality apart from the two intended gates.
    const normalise = (sql: string) => collapse(sql)
      .replace(
        "and (o.status<>'submitted' or o.order_type not in ('D2H','S2D') or d.quantity<>oi.qty)",
        '@@DISTRIBUTOR_STALE_GATE@@',
      )
      .replace(
        "and ( d.quantity<>oi.qty or o.order_type not in ('D2H','S2D') or (d.decision in ('carry_forward','cancel_release') and o.status<>'submitted') )",
        '@@DISTRIBUTOR_STALE_GATE@@',
      )
    const dropExcludeLoopStatusCheck = (sql: string) => sql
      .replace(
        /if v_order\.status<>'submitted' or v_order\.order_type not in \('D2H','S2D'\) then raise exception 'inventory_cutoff_distributor_not_eligible'; end if; insert into public\.inventory_cutoff_audit_events\( cutoff_id,event_type,actor_id,order_id,details \) values\(v_cutoff\.id,'distributor_order_excluded_do_not_carry_forward'/,
        '@@EXCLUDE_LOOP_GATE@@',
      )
      .replace(
        /if v_order\.order_type not in \('D2H','S2D'\) then raise exception 'inventory_cutoff_distributor_not_eligible'; end if; insert into public\.inventory_cutoff_audit_events\( cutoff_id,event_type,actor_id,order_id,details \) values\(v_cutoff\.id,'distributor_order_excluded_do_not_carry_forward'/,
        '@@EXCLUDE_LOOP_GATE@@',
      )
    expect(dropExcludeLoopStatusCheck(normalise(scoped)))
      .toBe(dropExcludeLoopStatusCheck(normalise(scopedPrevious)))
  })

  it('preserves the atomic posting contract the workflow depends on', () => {
    // One authoritative postability rule: only real blockers reject.
    expect(scoped).toMatch(/v_preview->>'readiness'\s*=\s*'Blocked'\s*then/i)
    expect(scoped).not.toContain("<>'Ready'")
    // Snapshot binding, replay protection and code consumption stay intact.
    expect(scoped).toContain("raise exception 'verification_code_already_used'")
    expect(scoped).toContain("return jsonb_build_object('error_code','stock_count_snapshot_changed')")
    expect(scoped).toContain("raise exception 'stock_count_already_posted'")
    // Locks are taken before any write.
    expect(scoped).toContain('pg_advisory_xact_lock')
    expect(scoped).toContain('order by stock_config_id for update')
    // Allocation ownership is still enforced.
    expect(scoped).toContain("raise exception 'inventory_cutoff_allocation_owner_unresolved'")
    // One movement per genuinely changed configuration; none for zero-difference.
    expect(scoped).toContain('if v_item.physical_quantity<>v_old_on then')
    expect(scoped).toContain("'adjustment','adjustment',v_session.id")
    // Status finalisation happens after the inventory writes, in one transaction.
    expect(scoped.indexOf('insert into public.product_inventory('))
      .toBeLessThan(scoped.indexOf("update public.stock_count_sessions set status='posted'"))
    expect(scoped.indexOf("update public.stock_count_sessions set status='posted'"))
      .toBeLessThan(scoped.indexOf("update public.inventory_opening_cutoffs set status='posted'"))
    expect(scoped).toContain("'cutoff_posted_and_warehouse_reopened'")
  })

  it('does not duplicate or reinterpret the allocation resolver deallocation movement', () => {
    // The resolver's audited deallocation uses reference_type
    // 'opening_balance_cutoff' (20260801230000). Final posting only ever writes
    // 'adjustment' / 'order_config_change' movements, so the earlier Potato
    // -1 deallocation can never be duplicated or mistaken for the final post.
    const movementInserts = scoped.match(/insert into public\.stock_movements\(/g) ?? []
    expect(movementInserts).toHaveLength(2)
    // Both movement inserts pass movement_type/reference_type as the first two
    // literals of their VALUES list. Neither is the resolver's pair.
    const movementKinds = [...scoped.matchAll(/\) values\(\s*'([a-z_]+)','([a-z_]+)'/g)]
      .map(([, movementType, referenceType]) => `${movementType}/${referenceType}`)
    expect(movementKinds).toEqual(['adjustment/adjustment', 'allocation/order_config_change'])
    expect(movementKinds).not.toContain('deallocation/opening_balance_cutoff')
  })
})
