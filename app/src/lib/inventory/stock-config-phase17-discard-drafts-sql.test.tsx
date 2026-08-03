import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260719_stock_config_17_discard_stock_count_drafts.sql', import.meta.url),
  'utf8',
)
const stockCountView = readFileSync(
  new URL('../../components/inventory/StockAdjustmentView.tsx', import.meta.url),
  'utf8',
)
// Drafts & history markup was extracted here by the Stock Count wizard refactor.
const draftsPanel = readFileSync(
  new URL('../../components/inventory/StockCountDraftsPanel.tsx', import.meta.url),
  'utf8',
)

describe('Phase 17 Stock Count draft discard SQL + UI contract', () => {
  it('is a forward-only soft-archive migration that never mutates inventory', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(migration).toContain("status = 'archived'")
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.product_inventory/i)
    expect(migration).not.toMatch(/UPDATE\s+public\.product_inventory/i)
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.stock_movements/i)
    expect(migration).not.toContain('DELETE FROM public.stock_count_sessions')
  })

  it('records who discarded and when, and only targets draft sessions', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS archived_by')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS archived_at')
    expect(migration).toContain("v_session.status <> 'draft' OR v_session.posted_at IS NOT NULL")
    expect(migration).toContain("RAISE EXCEPTION 'stock_count_not_discardable'")
    expect(migration).toContain("AND status = 'draft'")
    expect(migration).toContain('AND posted_at IS NULL')
  })

  it('blocks discard when the session already has inventory movements', () => {
    expect(migration).toContain('FROM public.stock_movements')
    expect(migration).toContain('reference_id = p_session_id')
    expect(migration).toContain("reference_type IN ('adjustment', 'stock_classification')")
  })

  it('enforces org/warehouse access and grants authenticated execute', () => {
    expect(migration).toContain('public.can_access_org(v_session.warehouse_organization_id)')
    expect(migration).toContain('public.is_hq_admin()')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.archive_stock_count_draft(uuid) TO authenticated')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.discard_stock_count_drafts(uuid[]) TO authenticated')
  })

  it('bulk discard is per-session and idempotent for already-archived drafts', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.discard_stock_count_drafts(p_session_ids uuid[])')
    expect(migration).toContain('FOREACH v_session_id IN ARRAY p_session_ids')
    expect(migration).toContain("'already_archived', true")
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.stock_count_sessions\s+WHERE\s+warehouse/i)
  })

  it('does not auto-discard existing drafts during migration', () => {
    // Strip function bodies so we only assert against top-level migration SQL.
    const withoutFunctions = migration.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g, '')
    expect(withoutFunctions).not.toMatch(/UPDATE\s+public\.stock_count_sessions/i)
    expect(withoutFunctions).not.toMatch(/DELETE\s+FROM\s+public\.stock_count_sessions/i)
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.archive_stock_count_draft')
  })

  it('Stock Count UI exposes Manage Drafts with Discard Draft wording and confirmation', () => {
    // Manage Drafts chrome now renders from StockCountDraftsPanel.
    expect(draftsPanel).toContain('Manage Drafts')
    expect(draftsPanel).toContain('Select All')
    expect(draftsPanel).toContain('Deselect All')
    expect(draftsPanel).toContain('Discard Selected Drafts')
    expect(draftsPanel).toContain('Discard Draft')
    expect(stockCountView).toContain('Discard Drafts')
    expect(draftsPanel).toContain('Open Draft')
    expect(stockCountView).toContain('discard_stock_count_drafts')
    expect(stockCountView).toContain(
      'Discard the selected draft(s)? Unsaved Stock Count entries and imported data in these drafts will be removed. Inventory will not be affected.',
    )
    expect(stockCountView).toContain('OPENING_BALANCE_DISCARD_CONFIRMATION')
    expect(stockCountView).toContain('Draft discarded successfully. Inventory, orders, stock movements and QR records were not changed.')
    expect(stockCountView).toContain(
      'This Stock Count can no longer be discarded because final verification has started or it is no longer a draft.',
    )
    expect(stockCountView).not.toContain('Delete Stock Count')
    expect(stockCountView).not.toMatch(/>\s*Archive\s*</)
  })

  it('legacy history query excludes archived (discarded) sessions so they do not resurface', () => {
    // Root-cause guard for the reported bug: the "Saved counts and legacy
    // history" query must not re-surface archived (discarded) sessions.
    expect(stockCountView).toContain("LEGACY_HISTORY_STATUSES")
    expect(stockCountView).not.toContain("['posted', 'archived']")
    expect(stockCountView).toContain('stock-count-draft-eligibility')
  })

  it('Manage Drafts labels protected/official records and disables their selection', () => {
    expect(draftsPanel).toContain('protection_reason')
    expect(draftsPanel).toContain('disabled={discardingDrafts || !draft.deletable}')
    expect(draftsPanel).toContain('protected')
    expect(draftsPanel).toContain('history_badge')
  })
})

