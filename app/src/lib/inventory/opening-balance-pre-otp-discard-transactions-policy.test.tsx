import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => fs.readFileSync(
  new URL(`../../../../${path}`, import.meta.url),
  'utf8',
)

const migration = repoFile(
  'supabase/migrations/20260801170000_inventory_cutoff_pre_otp_discard_transactions_policy.sql',
)
const txPolicyMigration = repoFile(
  'supabase/migrations/20260801140000_inventory_cutoff_transactions_policy.sql',
)
const stockCountView = repoFile('app/src/components/inventory/StockAdjustmentView.tsx')

describe('Opening Balance pre-OTP discard — Transactions policy cleanup', () => {
  it('root cause: transactions_policies has ON DELETE RESTRICT on the cutoff FK', () => {
    // The new child introduced after the discard function was last written.
    expect(txPolicyMigration).toMatch(
      /create table if not exists public\.inventory_cutoff_transactions_policies[\s\S]*?references public\.inventory_opening_cutoffs\(id\) on delete restrict/,
    )
    expect(txPolicyMigration).toMatch(
      /create table if not exists public\.inventory_cutoff_excluded_transactions[\s\S]*?references public\.inventory_opening_cutoffs\(id\) on delete restrict/,
    )
  })

  it('1–2. forward-only redefinition removes the exact-cutoff Transactions policy', () => {
    expect(migration).toContain('create or replace function public.archive_stock_count_draft')
    expect(migration).toContain('delete from public.inventory_cutoff_transactions_policies')
    expect(migration).toMatch(
      /delete from public\.inventory_cutoff_transactions_policies\s*\n\s*where cutoff_id = v_cutoff_id/,
    )
  })

  it('3. Transactions policy request/idempotency rows are cleared and never block discard', () => {
    expect(migration).toContain('delete from public.inventory_cutoff_transactions_policy_requests')
    expect(migration).toMatch(
      /delete from public\.inventory_cutoff_transactions_policy_requests\s*\n\s*where cutoff_id = v_cutoff_id/,
    )
  })

  it('4. draft-only excluded-transaction rows for the exact cutoff do not block discard', () => {
    expect(migration).toContain('delete from public.inventory_cutoff_excluded_transactions')
    expect(migration).toMatch(
      /delete from public\.inventory_cutoff_excluded_transactions\s*\n\s*where cutoff_id = v_cutoff_id/,
    )
  })

  it('5–6. D2H / H2M policies and decisions/reports/context/audit remain cleaned up', () => {
    expect(migration).toContain('delete from public.inventory_cutoff_d2h_policies')
    expect(migration).toContain('delete from public.inventory_cutoff_h2m_policies')
    expect(migration).toContain('delete from public.inventory_cutoff_h2m_bulk_requests')
    expect(migration).toContain('delete from public.inventory_cutoff_decisions')
    expect(migration).toContain('delete from public.inventory_cutoff_reports')
    expect(migration).toContain('delete from public.inventory_cutoff_posting_context')
    expect(migration).toContain('delete from public.inventory_cutoff_audit_events')
  })

  it('7. every child delete precedes the parent cutoff delete (valid dependency order)', () => {
    const parentDelete = migration.indexOf('delete from public.inventory_opening_cutoffs')
    expect(parentDelete).toBeGreaterThan(0)
    for (const child of [
      'inventory_cutoff_transactions_policy_requests',
      'inventory_cutoff_transactions_policies',
      'inventory_cutoff_excluded_transactions',
      'inventory_cutoff_d2h_policies',
      'inventory_cutoff_h2m_policies',
      'inventory_cutoff_decisions',
      'inventory_cutoff_reports',
      'inventory_cutoff_posting_context',
      'inventory_cutoff_audit_events',
    ]) {
      const childDelete = migration.indexOf(`delete from public.${child}`)
      expect(childDelete).toBeGreaterThan(0)
      expect(childDelete).toBeLessThan(parentDelete)
    }
  })

  it('7. the exact counting cutoff (pre-OTP) is the only cutoff removed', () => {
    expect(migration).toContain("and v_cutoff_status = 'counting'")
    expect(migration).toMatch(
      /delete from public\.inventory_opening_cutoffs\s*\n\s*where id = v_cutoff_id\s*\n\s*and status = 'counting'\s*\n\s*and posted_at is null\s*\n\s*and cancelled_at is null/,
    )
  })

  it('8. the Stock Count session is soft-archived, not hard-deleted', () => {
    expect(migration).toContain('update public.stock_count_sessions')
    expect(migration).toContain("status = 'archived'")
    expect(migration).not.toMatch(/delete\s+from\s+public\.stock_count_sessions\b/i)
  })

  it('9. only the freeze owned by this cutoff is released (exact cutoff/session scoping)', () => {
    // All child deletes are keyed on the single locked v_cutoff_id, never the
    // warehouse or category.
    expect(migration).not.toMatch(/where\s+warehouse_organization_id\s*=/i)
    expect(migration).not.toMatch(/where\s+product_category_id\s*=/i)
    expect(migration).toContain('where c.stock_count_session_id = p_session_id')
  })

  it('11–12. OTP-requested and posted drafts stay protected', () => {
    expect(migration).toContain("r.status in ('pending_delivery', 'active', 'posted')")
    expect(migration).toContain("v_cutoff_status = 'posted'")
    expect(migration).toContain("raise exception 'stock_count_not_discardable_posting_started'")
    // Defensive OTP recheck after freeze release survives the rewrite.
    const otpChecks = migration.match(
      /stock_count_verification_requests[\s\S]*?pending_delivery',\s*'active',\s*'posted'/g,
    )
    expect((otpChecks || []).length).toBeGreaterThanOrEqual(2)
  })

  it('13–17. business + posted/cancelled history data is never deleted by discard', () => {
    expect(migration).not.toMatch(/delete\s+from\s+public\.orders\b/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.order_items\b/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.product_inventory\b/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.stock_movements\b/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.stock_adjustments\b/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.return_cases\b/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.stock_transfers\b/i)
    expect(migration).not.toMatch(/\bqr_/i)
  })

  it('19–20. cleanup stays in one function/transaction and idempotent for archived sessions', () => {
    expect(migration).toContain('begin;')
    expect(migration).toContain('commit;')
    expect(migration).toContain("'already_archived', true")
    expect(migration).toContain('for update')
  })

  it('18/22. discard remains org/warehouse scoped and access-checked', () => {
    expect(migration).toContain('public.can_access_org(v_session.warehouse_organization_id)')
    expect(migration).toContain('public.is_hq_admin()')
  })

  it('UI maps a raw FK cleanup failure to a safe message instead of exposing it', () => {
    expect(stockCountView).toContain('DISCARD_CLEANUP_INCOMPLETE_MESSAGE')
    expect(stockCountView).toContain(
      'Draft could not be discarded because its Opening Balance cleanup was incomplete. No data was changed.',
    )
    expect(stockCountView).toContain('isDiscardCleanupError')
    // Every discard toast routes through the resolver rather than the raw error.
    expect(stockCountView).toMatch(/description:\s*discardErrorMessage\(firstError\)/)
    expect(stockCountView).toMatch(/description:\s*discardErrorMessage\(message\)/)
    // The raw first-error string must not be piped straight into the toast.
    expect(stockCountView).not.toMatch(/firstError\s*\|\|\s*DISCARD_INELIGIBLE_MESSAGE/)
  })
})
