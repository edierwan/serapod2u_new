import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertImmutableOpeningScopeComplete,
  assertOpeningDraftRowsComplete,
  changedOpeningDraftItems,
  openingDraftSaveDescription,
  type OpeningDraftItemState,
} from './stock-count-opening-draft-update'

const stockCountView = fs.readFileSync(
  new URL('../../components/inventory/StockAdjustmentView.tsx', import.meta.url),
  'utf8',
)

const scope = ['cartridge-a', 'cartridge-b', 'device-a', 'archived-a']
const blankItems = (): OpeningDraftItemState[] => scope.map(stockConfigId => ({
  stockConfigId,
  physicalQuantity: null,
  note: '',
}))

describe('Opening Balance immutable draft updates', () => {
  it('preserves every scoped item and all blank rows as not counted', () => {
    const persisted = assertImmutableOpeningScopeComplete(scope, scope)
    assertOpeningDraftRowsComplete(persisted, scope)
    expect(persisted.size).toBe(4)
    expect(blankItems().filter(item => item.physicalQuantity === null)).toHaveLength(4)
  })

  it('is idempotent when Update Draft is repeated with no changes', () => {
    const current = blankItems()
    expect(changedOpeningDraftItems(current, blankItems())).toEqual([])
    expect(changedOpeningDraftItems(current, blankItems())).toEqual([])
    expect(openingDraftSaveDescription({
      scopeCount: scope.length,
      changedItemCount: 0,
      countedOrNotedCount: 0,
    })).toBe('No quantity or note changes. 4 scoped item(s) preserved; 0 counted or noted, 4 not counted.')
  })

  it('updates only entered quantities or notes without rebuilding the scope', () => {
    const current = blankItems()
    current[1] = { ...current[1], physicalQuantity: 7 }
    current[2] = { ...current[2], note: 'Checked separately' }
    expect(changedOpeningDraftItems(current, blankItems()).map(item => item.stockConfigId))
      .toEqual(['cartridge-b', 'device-a'])
    expect(assertImmutableOpeningScopeComplete(scope, scope).size).toBe(4)
  })

  it('retains group totals and archived snapshot rows across repeated updates', () => {
    const groups = new Map<string, number>()
    const rows = [
      { id: 'cartridge-a', group: 'Cartridge', archived: false },
      { id: 'cartridge-b', group: 'Cartridge', archived: false },
      { id: 'device-a', group: 'Device', archived: false },
      { id: 'archived-a', group: 'Device', archived: true },
    ]
    for (const row of rows) groups.set(row.group, (groups.get(row.group) || 0) + 1)

    for (let update = 0; update < 3; update += 1) {
      assertOpeningDraftRowsComplete(scope, rows.map(row => row.id))
      expect(rows).toHaveLength(4)
      expect(Object.fromEntries(groups)).toEqual({ Cartridge: 2, Device: 2 })
      expect(rows.some(row => row.archived)).toBe(true)
    }
  })

  it('rejects a one-row scope read and a partial reload instead of publishing collapse', () => {
    expect(() => assertImmutableOpeningScopeComplete(['cartridge-a'], scope))
      .toThrow(/incomplete \(1 of 4 expected items\)/)
    expect(() => assertOpeningDraftRowsComplete(scope, ['cartridge-a']))
      .toThrow(/returned 1 of 4 scoped items/)
  })

  it('does not allow a partial mutation response to define the complete scope', () => {
    const partialMutationRows = ['cartridge-a']
    const authoritativeScope = assertImmutableOpeningScopeComplete(scope, scope)
    expect(authoritativeScope).toEqual(new Set(scope))
    expect(authoritativeScope).not.toEqual(new Set(partialMutationRows))
  })

  it('reads the complete authoritative scope on Update Draft and never applies limit(1)', () => {
    const saveFlow = stockCountView.slice(
      stockCountView.indexOf('const saveDraft = async'),
      stockCountView.indexOf('// Atomic autosave after an Excel import'),
    )
    const scopeRead = saveFlow.slice(
      saveFlow.indexOf("from('stock_count_session_scope' as any)"),
      saveFlow.indexOf('// Classification sessions always force'),
    )
    expect(scopeRead).toContain(".select('stock_config_id')")
    expect(scopeRead).not.toContain('.limit(1)')
    expect(scopeRead).toContain('assertImmutableOpeningScopeComplete')
    expect(scopeRead.indexOf('assertImmutableOpeningScopeComplete'))
      .toBeLessThan(scopeRead.indexOf('setOpeningDraftScopeIds(verifiedScopeIds)'))
  })

  it('blocks partial draft reload before publishing rows and does not reuse the active-only catalog state', () => {
    const loadFlow = stockCountView.slice(
      stockCountView.indexOf('const loadDraft = async'),
      stockCountView.indexOf('const exitManageDrafts ='),
    )
    expect(loadFlow).toContain("loadCountRows(draftWarehouseId, { publish: false })")
    expect(loadFlow).toContain('assertOpeningDraftRowsComplete')
    expect(loadFlow.indexOf('assertOpeningDraftRowsComplete'))
      .toBeLessThan(loadFlow.indexOf('setRows(scopedCatalogRows.map'))
  })

  it('writes only changed Opening Balance items and reports scope/count status accurately', () => {
    const saveFlow = stockCountView.slice(
      stockCountView.indexOf('const saveDraft = async'),
      stockCountView.indexOf('// Atomic autosave after an Excel import'),
    )
    expect(saveFlow).toContain('changedOpeningDraftItems')
    expect(saveFlow).toContain('openingDraftSaveDescription')
    expect(saveFlow).not.toContain('`${draftRows.length} counted or noted row(s) saved.`')
  })
})
