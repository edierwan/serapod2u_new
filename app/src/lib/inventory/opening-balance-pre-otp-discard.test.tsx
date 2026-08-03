import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => fs.readFileSync(
  new URL(`../../../../${path}`, import.meta.url),
  'utf8',
)

const migration = repoFile('supabase/migrations/20260801120000_inventory_cutoff_pre_otp_draft_discard.sql')
const postingStatusRoute = repoFile('app/src/app/api/inventory/stock-count/drafts/posting-status/route.ts')
const stockCountView = repoFile('app/src/components/inventory/StockAdjustmentView.tsx')
const draftsPanel = repoFile('app/src/components/inventory/StockCountDraftsPanel.tsx')
const cutoffSection = repoFile('app/src/components/inventory/InventoryOpeningCutoffSection.tsx')
const eligibility = repoFile('app/src/lib/inventory/stock-count-draft-eligibility.ts')
const d2hPolicy = repoFile('supabase/migrations/20260731230000_inventory_cutoff_d2h_policy.sql')
const h2mPolicy = repoFile('supabase/migrations/20260801090000_inventory_cutoff_h2m_policy.sql')

describe('Opening Balance pre-OTP discard boundary', () => {
  it('8–12. discard SQL releases counting freeze and removes only draft-owned cutoff data', () => {
    expect(migration).toContain('create or replace function public.archive_stock_count_draft')
    expect(migration).toContain("v_cutoff_status = 'counting'")
    expect(migration).toContain('delete from public.inventory_cutoff_d2h_policies')
    expect(migration).toContain('delete from public.inventory_cutoff_h2m_policies')
    expect(migration).toContain('delete from public.inventory_cutoff_decisions')
    expect(migration).toContain('delete from public.inventory_cutoff_audit_events')
    expect(migration).toContain('delete from public.inventory_opening_cutoffs')
    expect(migration).toContain("and status = 'counting'")
    expect(migration).toContain('and posted_at is null')
    expect(migration).toContain('and cancelled_at is null')
    // Preserve business data.
    expect(migration).not.toMatch(/delete\s+from\s+public\.orders\b/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.order_items\b/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.product_inventory\b/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.stock_movements\b/i)
    expect(migration).not.toMatch(/\bqr_/i)
  })

  it('13–15. OTP request is the discard protection boundary; cancel remains for verified exercises', () => {
    expect(migration).toContain("r.status in ('pending_delivery', 'active', 'posted')")
    expect(migration).toContain("raise exception 'stock_count_not_discardable_posting_started'")
    expect(migration).toContain("c.status = 'posted'")
    // Guard no longer treats counting alone as protected.
    expect(migration).not.toMatch(/c\.status in \('counting',\s*'posted'\)/)
    expect(cutoffSection).toContain('cancel_inventory_opening_cutoff')
    // The affordance was renamed to the protected Danger Zone action; the
    // contract (a cancel route still exists once verification has started) is
    // unchanged.
    expect(cutoffSection).toContain('Cancel Entire Opening Balance Exercise')
    expect(cutoffSection).toContain('Verification started — Cancel Entire Opening Balance Exercise is required to stop this exercise. Hard discard is no longer available.')
  })

  it('19. concurrent discard vs OTP is serialized on the session row lock', () => {
    expect(migration).toContain('for update')
    // Second OTP check after freeze release.
    const otpChecks = migration.match(
      /stock_count_verification_requests[\s\S]*?pending_delivery',\s*'active',\s*'posted'/g,
    )
    expect((otpChecks || []).length).toBeGreaterThanOrEqual(2)
  })

  it('posting-status route treats only OTP verification as posting started', () => {
    expect(postingStatusRoute).toContain("from('stock_count_verification_requests')")
    expect(postingStatusRoute).toContain("['pending_delivery', 'active', 'posted']")
    expect(postingStatusRoute).not.toContain("from('inventory_opening_cutoffs')")
    expect(postingStatusRoute).not.toContain("['counting', 'posted']")
  })

  it('UI history labels come from lifecycle helpers, not 112/112 progress', () => {
    expect(stockCountView).toContain('stockCountHistoryLifecyclePresentation')
    expect(stockCountView).toContain('history_badge')
    // Drafts & history markup lives in StockCountDraftsPanel since the wizard refactor.
    expect(draftsPanel).toContain('Draft — Removable')
    expect(stockCountView).toContain('OPENING_BALANCE_DISCARD_CONFIRMATION')
    expect(eligibility).toContain('Final verification has not started.')
    expect(eligibility).toContain('OTP has been requested. Cancel and archive this exercise to restart.')
    expect(eligibility).not.toContain('Posting has started (freeze/verification in progress)')
  })

  it('21. D2H/H2M policy migrations remain present and untouched by discard contract', () => {
    expect(d2hPolicy).toContain('inventory_cutoff_d2h_policies')
    expect(h2mPolicy).toContain('inventory_cutoff_h2m_policies')
    expect(migration).toContain('inventory_cutoff_d2h_policies')
    expect(migration).toContain('inventory_cutoff_h2m_policies')
  })

  it('22. discard remains org/warehouse scoped', () => {
    expect(migration).toContain('public.can_access_org(v_session.warehouse_organization_id)')
    expect(migration).toContain('public.is_hq_admin()')
  })

  it('18. cancelled history stays non-discardable so a fresh draft can be created after lock release', () => {
    expect(eligibility).toContain("cutoff_status === 'cancelled'")
    expect(eligibility).toContain('deletable: false')
    expect(stockCountView).toContain('isCancelledOpeningBalanceHistory')
  })
})
