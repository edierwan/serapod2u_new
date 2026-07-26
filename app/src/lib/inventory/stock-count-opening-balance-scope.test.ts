import { describe, expect, it } from 'vitest'
import {
  buildOpeningBalanceScopeRows,
  resolveOpeningBalanceVisibleRows,
  type StockCountCatalogRow,
} from './stock-count-catalog'

type Row = Pick<
  StockCountCatalogRow,
  'stockConfigId' | 'categoryId' | 'configCode' | 'configStatus' | 'systemQuantity' | 'physicalCount' | 'note' | 'eligible'
>

const row = (overrides: Partial<Row> & Pick<Row, 'stockConfigId' | 'categoryId'>): Row => ({
  configCode: '20NB',
  configStatus: 'active',
  systemQuantity: 0,
  physicalCount: '',
  note: '',
  eligible: true,
  ...overrides,
})

// A 140-item Opening Balance snapshot, all in one category.
const snapshot: Row[] = Array.from({ length: 140 }, (_, index) =>
  row({ stockConfigId: `cfg-${index}`, categoryId: 'category-raya', configCode: index === 0 ? 'UNCLASSIFIED' : '20NB', systemQuantity: index === 0 ? 10 : 0 }))
const scopeIds = new Set(snapshot.map(item => item.stockConfigId))

describe('Opening Balance snapshot scope (bug 2)', () => {
  it('reopens a 140-row draft with all 140 rows', () => {
    const visible = resolveOpeningBalanceVisibleRows(snapshot, {
      currentSessionId: 'session-1',
      selectedCategory: 'category-raya',
      scopeIds,
    })
    expect(visible).toHaveLength(140)
  })

  it('does NOT drop snapshot rows whose live product category drifted after saving', () => {
    // 139 rows were recategorized/deactivated in the live catalog; only one
    // still matches the draft category. The immutable snapshot must still show
    // every scoped row on reopen (the incident: only "Jagung" survived).
    const drifted = snapshot.map((item, index) =>
      index === 0 ? item : { ...item, categoryId: 'category-other' })
    const visible = resolveOpeningBalanceVisibleRows(drifted, {
      currentSessionId: 'session-1',
      selectedCategory: 'category-raya',
      scopeIds,
    })
    expect(visible).toHaveLength(140)
  })

  it('only shows scoped rows on reopen (rows outside the snapshot are excluded)', () => {
    const withExtra = [...snapshot, row({ stockConfigId: 'not-in-scope', categoryId: 'category-raya' })]
    const visible = resolveOpeningBalanceVisibleRows(withExtra, {
      currentSessionId: 'session-1',
      selectedCategory: 'category-raya',
      scopeIds,
    })
    expect(visible).toHaveLength(140)
    expect(visible.some(item => item.stockConfigId === 'not-in-scope')).toBe(false)
  })

  it('for a NEW draft, scopes strictly to the selected category and excludes ineligible zero-balance phantoms', () => {
    const catalog: Row[] = [
      row({ stockConfigId: 'in-1', categoryId: 'category-raya' }),
      row({ stockConfigId: 'in-2', categoryId: 'category-raya', configCode: 'UNCLASSIFIED', systemQuantity: 5 }),
      // Ineligible Device concentration phantom with no balance -> excluded.
      row({ stockConfigId: 'phantom', categoryId: 'category-raya', eligible: false, systemQuantity: 0 }),
      // Different category -> excluded.
      row({ stockConfigId: 'other-cat', categoryId: 'category-other' }),
    ]
    const created = resolveOpeningBalanceVisibleRows(catalog, {
      currentSessionId: null,
      selectedCategory: 'category-raya',
      scopeIds: new Set(),
    })
    expect(created.map(item => item.stockConfigId).sort()).toEqual(['in-1', 'in-2'])
  })

  it('buildOpeningBalanceScopeRows validates category membership at creation', () => {
    const catalog: Row[] = [
      row({ stockConfigId: 'a', categoryId: 'category-raya' }),
      row({ stockConfigId: 'b', categoryId: 'category-other' }),
    ]
    const scope = buildOpeningBalanceScopeRows(catalog, 'category-raya')
    expect(scope.map(item => item.stockConfigId)).toEqual(['a'])
    expect(buildOpeningBalanceScopeRows(catalog, '')).toEqual([])
  })

  it('keeps a blank Physical Count row in scope so Excel exports every snapshotted item', () => {
    // Blank physical counts must NOT be filtered out — the export row count must
    // equal the snapshot row count.
    const visible = resolveOpeningBalanceVisibleRows(snapshot, {
      currentSessionId: 'session-1',
      selectedCategory: 'category-raya',
      scopeIds,
    })
    const blankRows = visible.filter(item => item.physicalCount === '')
    expect(blankRows.length).toBeGreaterThan(0)
    expect(visible).toHaveLength(140)
  })
})
