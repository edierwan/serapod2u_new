import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => fs.readFileSync(
  new URL(`../../../../${path}`, import.meta.url),
  'utf8',
)

const stockCountView = repoFile('app/src/components/inventory/StockAdjustmentView.tsx')
const draftsPanel = repoFile('app/src/components/inventory/StockCountDraftsPanel.tsx')
const referenceMigration = repoFile('supabase/migrations/20260730_stock_count_reference_required.sql')

describe('Count Type History wiring', () => {
  it('renames the section and shows the selected count type', () => {
    expect(stockCountView).toContain('Count Type History')
    expect(stockCountView).not.toContain('Saved counts and legacy history')
    expect(stockCountView).toContain('countTypeHistoryLabel')
  })

  it('filters the history and Manage Drafts by the selected count type (display-only memo)', () => {
    expect(stockCountView).toContain('filterSessionsByCountType(drafts, countType)')
    // Chips, Manage Drafts table and Select All all read the filtered list.
    // The count-type-scoped list is passed into StockCountDraftsPanel as `drafts`.
    expect(stockCountView).toContain('drafts={countTypeDrafts}')
    expect(draftsPanel).toContain('drafts.map(draft =>')
    expect(stockCountView).toContain('stockCountHistoryEmptyMessage(countType)')
  })

  it('drops any Manage Drafts selection when the count type changes', () => {
    expect(stockCountView).toContain('setSelectedDraftIds(new Set())')
  })
})

describe('Mandatory Reference / Batch Name wiring', () => {
  it('marks the field required and enforces it before every persisting action', () => {
    expect(stockCountView).toContain('Reference / Batch Name <span className="text-red-500">*</span>')
    expect(stockCountView).toContain('const ensureReferenceProvided')
    // saveDraft is the single funnel for Save / Excel download / Review & Post.
    expect(stockCountView).toContain('if (!ensureReferenceProvided()) return null')
    // Import is guarded too (a draft must exist, and none exists without a ref).
    expect(stockCountView).toContain('if (!ensureReferenceProvided()) return')
    expect(stockCountView).toContain('maxLength={STOCK_COUNT_REFERENCE_MAX_LENGTH}')
  })

  it('prompts (never auto-generates) when an existing editable draft has no reference', () => {
    expect(stockCountView).toContain('This count does not have a Reference / Batch Name. Please update it before continuing.')
    expect(stockCountView).toContain('isStockCountReferenceMissing((session as any).reference_name)')
  })

  it('keeps posted/legacy records readable with a placeholder instead of blocking', () => {
    expect(stockCountView).toContain('STOCK_COUNT_REFERENCE_LEGACY_PLACEHOLDER')
  })

  it('enforces the same rule server-side via a draft-only trigger that spares legacy rows', () => {
    expect(referenceMigration).toContain('enforce_stock_count_reference_required')
    expect(referenceMigration).toContain('BEFORE INSERT OR UPDATE')
    expect(referenceMigration).toContain("NEW.status = 'draft'")
    expect(referenceMigration).toContain("NEW.count_type <> 'initial_configuration_classification'")
    expect(referenceMigration).toContain('Reference / Batch Name is required.')
  })
})
