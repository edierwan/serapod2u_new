import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => fs.readFileSync(
  new URL(`../../../../${path}`, import.meta.url),
  'utf8',
)
const stockCountView = repoFile('app/src/components/inventory/StockAdjustmentView.tsx')
const postingStatusRoute = repoFile('app/src/app/api/inventory/stock-count/drafts/posting-status/route.ts')

describe('Stock Count verification permission fix', () => {
  it('never queries the server-only verification table from the browser component', () => {
    expect(stockCountView).not.toContain("from('stock_count_verification_requests')")
    expect(stockCountView).toContain('/api/inventory/stock-count/drafts/posting-status')
    expect(stockCountView).toContain('loadPostingStartedIds')
  })

  it('reads posting status behind an authenticated, warehouse-scoped server route', () => {
    // Authenticated caller required.
    expect(postingStatusRoute).toContain('supabase.auth.getUser()')
    expect(postingStatusRoute).toContain('authentication_required')
    // Authorization: only sessions RLS already exposes are considered.
    expect(postingStatusRoute).toContain("from('stock_count_sessions')")
    expect(postingStatusRoute).toContain('accessibleIds')
    // The protected table is read with the service role, server-side only.
    expect(postingStatusRoute).toContain('createAdminClient')
    expect(postingStatusRoute).toContain("from('stock_count_verification_requests')")
    // Only session IDs are returned — never code, hash, recipients, snapshot.
    expect(postingStatusRoute).toContain('postingStartedSessionIds')
    expect(postingStatusRoute).not.toContain('code_hash')
    expect(postingStatusRoute).not.toContain('snapshot_hash')
    expect(postingStatusRoute).not.toContain('recipient_summary')
    // Only the id columns are ever selected from the sensitive table.
    expect(postingStatusRoute).toContain(".select('session_id')")
  })

  it('degrades safely: on failure a draft is treated as not deletable', () => {
    // Fallback returns the full requested id set (posting-started => not deletable).
    expect(stockCountView).toContain('return new Set<string>(sessionIds)')
  })
})

describe('Category-based Stock Count scope selector', () => {
  it('drives every count type from the official active Product Category list', () => {
    // Categories come from product_categories (Product Management), filtered active.
    expect(stockCountView).toContain("from('product_categories')")
    expect(stockCountView).toMatch(/\.eq\('is_active', true\)/)
    // Category is the primary lens; group tabs derive from the category-scoped set.
    expect(stockCountView).toContain('countableRows')
    expect(stockCountView).toContain('!selectedCategory || row.categoryId === selectedCategory')
  })

  it('offers All Categories only for non-Opening-Balance counts', () => {
    expect(stockCountView).toContain('ALL_CATEGORIES_VALUE')
    expect(stockCountView).toContain('{!isOpeningBalanceMode && <SelectItem value={ALL_CATEGORIES_VALUE}>All Categories</SelectItem>}')
    // Opening Balance keeps category mandatory (no All Categories path).
    expect(stockCountView).toContain('isOpeningBalanceMode ? selectedCategory : (selectedCategory || ALL_CATEGORIES_VALUE)')
  })

  it('never derives categories from group/product/brand names', () => {
    // The scope predicate is the stable category id, not any name string.
    expect(stockCountView).toContain('row.categoryId === selectedCategory')
    expect(stockCountView).not.toMatch(/groupName\s*===\s*selectedCategory/)
  })

  it('persists product_category_id only for Opening Balance and resets group tab on category change', () => {
    expect(stockCountView).toContain('product_category_id: isOpeningBalanceMode ? selectedCategory : null')
    expect(stockCountView).toContain('}, [selectedCategory])')
  })

  it('marks old category-less / legacy drafts as Reset Required', () => {
    expect(stockCountView).toContain('Legacy Draft – Reset Required')
    expect(stockCountView).toContain('isLegacyResetRequiredDraft')
    expect(stockCountView).toContain("count_type === 'opening_balance_cutoff' && !draft.product_category_id")
  })
})
