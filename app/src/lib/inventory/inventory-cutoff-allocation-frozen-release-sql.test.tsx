import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) =>
  fs.readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

const mig190 = repoFile('supabase/migrations/20260801190000_inventory_cutoff_allocation_resolver.sql')
const mig220 = repoFile('supabase/migrations/20260801220000_fix_inventory_cutoff_allocation_resolver_frozen_release.sql')

const resolverBody = (m: string) =>
  m.match(/create or replace function public\.resolve_inventory_cutoff_allocation[\s\S]*?\nend;\n\$\$;/i)?.[0] ?? ''

// The exclude_and_release branch (the only branch permitted to mutate inventory).
const excludeBranch = (m: string) =>
  resolverBody(m).match(/else -- exclude_and_release([\s\S]*?)end if;\s*\n\s*-- Recompute/i)?.[1] ?? ''

const body190 = resolverBody(mig190)
const body220 = resolverBody(mig220)
const branch190 = excludeBranch(mig190)
const branch220 = excludeBranch(mig220)

describe('190000 resolver release is blocked by the warehouse freeze guard', () => {
  it('has a real exclude_and_release that writes frozen product_inventory / stock_movements', () => {
    expect(branch190).toContain('update public.product_inventory')
    expect(branch190).toContain("'deallocation', 'opening_balance_cutoff'")
  })

  it('registers NO posting context, so inventory_cutoff_assert_not_frozen raises', () => {
    // Without a matching inventory_cutoff_posting_context row, the BEFORE triggers
    // inventory_cutoff_product_inventory_guard / _stock_movement_guard fail closed.
    expect(branch190).not.toContain('inventory_cutoff_posting_context')
    expect(body190).not.toContain('inventory_cutoff_posting_context')
  })
})

describe('220000 grants ONLY the resolver a scoped, transaction-local freeze exemption', () => {
  it('reuses the exact posting-context key honoured by assert_not_frozen', () => {
    expect(branch220).toContain('insert into public.inventory_cutoff_posting_context')
    expect(branch220).toContain('pg_backend_pid(), txid_current(), p_cutoff_id, v_user')
    // Idempotent registration against the (backend_pid, transaction_id, cutoff_id) PK.
    expect(branch220).toMatch(/on conflict \(backend_pid, transaction_id, cutoff_id\) do nothing/i)
  })

  it('removes the exemption immediately after the two frozen writes (no persistent bypass)', () => {
    expect(branch220).toContain('delete from public.inventory_cutoff_posting_context')
    // The delete is scoped to this exact backend + txid + cutoff + user.
    expect(branch220).toMatch(/delete from public\.inventory_cutoff_posting_context[\s\S]*backend_pid = pg_backend_pid\(\)[\s\S]*transaction_id = txid_current\(\)[\s\S]*cutoff_id = p_cutoff_id[\s\S]*created_by = v_user/i)
    // Insert precedes the UPDATE; delete follows the deallocation INSERT.
    const iIns = branch220.indexOf('insert into public.inventory_cutoff_posting_context')
    const iUpd = branch220.indexOf('update public.product_inventory')
    const iMov = branch220.indexOf("'deallocation', 'opening_balance_cutoff'")
    const iDel = branch220.indexOf('delete from public.inventory_cutoff_posting_context')
    expect(iIns).toBeGreaterThanOrEqual(0)
    expect(iIns).toBeLessThan(iUpd)
    expect(iUpd).toBeLessThan(iMov)
    expect(iMov).toBeLessThan(iDel)
  })

  it('grants the exemption in exclude_and_release ONLY — not the other three actions', () => {
    expect((body220.match(/insert into public\.inventory_cutoff_posting_context/g) ?? [])).toHaveLength(1)
    expect((body220.match(/delete from public\.inventory_cutoff_posting_context/g) ?? [])).toHaveLength(1)
    // select_related_order, carry_forward_related, mark_manual_investigation branches
    // must not carry any exemption.
    const nonExclude = body220.split('else -- exclude_and_release')[0]
    expect(nonExclude).not.toContain('inventory_cutoff_posting_context')
  })

  it('is registered only AFTER the active-owner and stale guards pass', () => {
    const iOwner = branch220.indexOf('inventory_cutoff_allocation_active_owner')
    const iIns = branch220.indexOf('insert into public.inventory_cutoff_posting_context')
    expect(iOwner).toBeGreaterThanOrEqual(0)
    expect(iOwner).toBeLessThan(iIns)
  })
})

describe('220000 preserves the full safety envelope', () => {
  it('HQ-admin only, SECURITY DEFINER, pinned search_path, forward-only, schema reload', () => {
    expect(body220).toContain('not public.inventory_cutoff_is_hq_admin()')
    expect(body220).toContain("raise exception 'permission_denied'")
    expect(body220).toContain('security definer')
    expect(body220).toContain('set search_path = public, pg_temp')
    expect(mig220).toContain('create or replace function public.resolve_inventory_cutoff_allocation')
    expect(mig220.toLowerCase()).toContain("notify pgrst, 'reload schema'")
    expect(mig220.trim().toLowerCase().startsWith('begin;')).toBe(true)
    expect(mig220.trim().toLowerCase().endsWith('commit;')).toBe(true)
  })

  it('locks and revalidates cutoff + inventory row and rejects stale quantities', () => {
    expect(body220).toContain('pg_advisory_xact_lock')
    expect(body220).toMatch(/from public\.inventory_opening_cutoffs[\s\S]*for update/)
    expect(body220).toMatch(/from public\.product_inventory[\s\S]*for update/)
    expect(body220).toContain("raise exception 'inventory_cutoff_stale_preview'")
  })

  it('decreases quantity_allocated only by the verified residual (allocated - selected)', () => {
    expect(branch220).toContain('v_release_qty := v_allocated_before - v_selected_before')
    expect(branch220).toContain('v_after_alloc := greatest(0, v_allocated_before - v_release_qty)')
    expect(branch220).toContain('set quantity_allocated = v_after_alloc')
    expect(branch220).toContain("raise exception 'inventory_cutoff_allocation_nothing_to_release'")
  })

  it('never changes quantity_on_hand or average_cost', () => {
    expect(branch220).not.toMatch(/quantity_on_hand\s*=/)
    expect(branch220).not.toMatch(/average_cost\s*=/)
  })

  it('refuses release while a submitted order still owns the allocation', () => {
    expect(branch220).toContain('if v_has_active_owner then')
    expect(branch220).toContain('inventory_cutoff_allocation_active_owner')
    // Owner detection keys on submitted D2H/S2D orders with an allocation movement.
    expect(body220).toContain("o.status = 'submitted'")
  })

  it('creates exactly one deallocation movement and never touches on-hand', () => {
    expect((body220.match(/'deallocation', 'opening_balance_cutoff'/g) ?? [])).toHaveLength(1)
  })

  it('is idempotent / double-submit safe (stored-result replay)', () => {
    expect(body220).toContain("return v_existing.result || jsonb_build_object('idempotent_replay', true)")
    expect(body220).toContain('inventory_cutoff_allocation_requests')
  })

  it('recomputes the blocker to difference=0 after release and re-runs the preview', () => {
    expect(body220).toContain('v_blocker_cleared := (v_allocated_after - v_selected_after) = 0')
    expect(body220).toContain('public.inventory_cutoff_preview(p_cutoff_id)')
  })

  it('leaves physical counts, QR and imported rows untouched (no such writes)', () => {
    expect(body220).not.toMatch(/(insert|update|delete)[\s\S]{0,40}(qr_codes|qr_master_codes|physical_count|stock_count_session_items|inventory_cutoff_physical)/i)
  })

  it('cancelled owner: select_related_order & carry_forward_related require a submitted owner', () => {
    // Both nomination branches only accept an order with status='submitted', so a
    // cancelled order (SO26000085) fails closed as not-owner and cannot resolve.
    expect(body220).toContain("raise exception 'inventory_cutoff_allocation_order_not_owner'")
    expect((body220.match(/o\.status = 'submitted'/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})
