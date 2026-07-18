import { describe, expect, it } from 'vitest'
import {
  afterTransferQty,
  buildTransferRpcItems,
  canApproveStockTransfer,
  canCancelStockTransfer,
  canDispatchStockTransfer,
  canPrintTransferNote,
  canReceiveStockTransfer,
  canRejectStockTransfer,
  consolidateTransferLines,
  filterSourceInventoryRows,
  formatTransferItemsSummary,
  inventoryRowKey,
  isHqInventoryAdmin,
  isTransferableConfiguration,
  mapDbStatusToStage,
  paginateRows,
  parseTransferQuantity,
  STOCK_TRANSFER_STAGES,
  summarizeDraftSelection,
  transferStatusLabel,
  transferStockImpactMessage,
  validateTransferQuantity,
  validateTransferRoute,
  type SourceInventoryRow,
} from './stock-transfer'
import { transferNoteLinesFromItems } from './stock-transfer-note'

const row = (overrides: Partial<SourceInventoryRow> = {}): SourceInventoryRow => ({
  inventoryKey: inventoryRowKey('var-1', 'cfg-20nb'),
  variantId: 'var-1',
  stockConfigId: 'cfg-20nb',
  productId: 'prod-1',
  productCode: 'CEL-001',
  productName: 'Cellera',
  variantName: 'Cellera [Mango]',
  flavour: 'Cellera [Mango]',
  productLine: 'Cellera',
  configLabel: '20ml New Box',
  stockSku: 'CEL-MANGO-20NB',
  volumeMl: 20,
  packaging: 'new_box',
  configCode: '20NB',
  available: 50,
  unitCost: 10,
  ...overrides,
})

describe('stock transfer validation and identity', () => {
  it('accepts whole-number quantities within available stock (20 against 50 is valid)', () => {
    expect(validateTransferQuantity(20, 50)).toEqual({ ok: true, value: 20 })
    expect(afterTransferQty(50, 20)).toBe(30)
  })

  it('rejects zero, negative, decimal and over-available quantities', () => {
    expect(parseTransferQuantity(0).ok).toBe(false)
    expect(parseTransferQuantity(-1).ok).toBe(false)
    expect(parseTransferQuantity('1.5').ok).toBe(false)
    expect(validateTransferQuantity(51, 50).ok).toBe(false)
  })

  it('rejects identical source and destination warehouses', () => {
    expect(validateTransferRoute('wh-a', 'wh-a')).toMatch(/identical/i)
    expect(validateTransferRoute('wh-a', 'wh-b')).toBeNull()
  })

  it('rejects Legacy/Unclassified sources and keeps exact configuration identity', () => {
    expect(isTransferableConfiguration({ stockConfigId: null })).toBe(false)
    expect(isTransferableConfiguration({ stockConfigId: 'x', configCode: 'UNCLASSIFIED' })).toBe(false)
    expect(isTransferableConfiguration({ stockConfigId: 'cfg-20nb', configCode: '20NB', status: 'active' })).toBe(true)

    const items = buildTransferRpcItems(
      [
        row(),
        row({
          inventoryKey: inventoryRowKey('var-1', 'cfg-50nb'),
          stockConfigId: 'cfg-50nb',
          configLabel: '50ml New Box',
          stockSku: 'CEL-MANGO-50NB',
          volumeMl: 50,
          configCode: '50NB',
          available: 12,
        }),
        row({
          inventoryKey: inventoryRowKey('var-2', 'cfg-50ob'),
          variantId: 'var-2',
          stockConfigId: 'cfg-50ob',
          variantName: 'Cellera [Mint]',
          configLabel: '50ml Old Box',
          stockSku: 'CEL-MINT-50OB',
          volumeMl: 50,
          packaging: 'old_box',
          configCode: '50OB',
          available: 8,
        }),
      ],
      {
        [inventoryRowKey('var-1', 'cfg-20nb')]: '5',
        [inventoryRowKey('var-1', 'cfg-50nb')]: '2',
        [inventoryRowKey('var-2', 'cfg-50ob')]: '1',
      },
    )

    expect(items).toHaveLength(3)
    expect(items.map((item) => item.stock_config_id).sort()).toEqual(['cfg-20nb', 'cfg-50nb', 'cfg-50ob'])
    expect(items.find((item) => item.stock_config_id === 'cfg-20nb')?.quantity).toBe(5)
  })

  it('consolidates duplicate configuration rows safely', () => {
    const consolidated = consolidateTransferLines([
      { variant_id: 'var-1', stock_config_id: 'cfg-20nb', quantity: 3 },
      { variant_id: 'var-1', stock_config_id: 'cfg-20nb', quantity: 2 },
    ])
    expect(consolidated).toEqual([
      { variant_id: 'var-1', stock_config_id: 'cfg-20nb', quantity: 5 },
    ])
  })
})

describe('stock transfer search, filters and pagination', () => {
  const rows = [
    row(),
    row({
      inventoryKey: inventoryRowKey('var-2', 'cfg-50ob'),
      variantId: 'var-2',
      stockConfigId: 'cfg-50ob',
      productCode: 'CEL-002',
      productName: 'Cellera Mint',
      variantName: 'Cellera [Mint]',
      flavour: 'Cellera [Mint]',
      productLine: 'Other',
      configLabel: '50ml Old Box',
      stockSku: 'CEL-MINT-50OB',
      volumeMl: 50,
      packaging: 'old_box',
      configCode: '50OB',
      available: 0,
    }),
  ]

  it('filters by search, product line, configuration and available-only', () => {
    expect(filterSourceInventoryRows(rows, { search: 'mint' })).toHaveLength(1)
    expect(filterSourceInventoryRows(rows, { search: 'CEL-MANGO-20NB' })).toHaveLength(1)
    expect(filterSourceInventoryRows(rows, { productLine: 'Cellera' })).toHaveLength(1)
    expect(filterSourceInventoryRows(rows, {
      configurationKey: '50|old_box|50ml Old Box',
    })).toHaveLength(1)
    expect(filterSourceInventoryRows(rows, { availableOnly: true })).toHaveLength(1)
  })

  it('paginates visible rows and summarizes selected draft quantities', () => {
    const page = paginateRows(rows, 1, 1)
    expect(page.pageRows).toHaveLength(1)
    expect(page.totalPages).toBe(2)

    const summary = summarizeDraftSelection(rows, {
      [inventoryRowKey('var-1', 'cfg-20nb')]: '20',
    })
    expect(summary.selectedConfigs).toBe(1)
    expect(summary.selectedFlavours).toBe(1)
    expect(summary.totalQuantity).toBe(20)
    expect(summary.estimatedValue).toBe(200)
    expect(summary.errors).toHaveLength(0)
  })
})

describe('stock transfer lifecycle labels and historical rendering', () => {
  it('exposes five UI stages with distinct DB statuses', () => {
    expect(STOCK_TRANSFER_STAGES.map((stage) => stage.id)).toEqual([
      'draft',
      'pending_approval',
      'ready_to_dispatch',
      'in_transit',
      'received',
    ])
    expect(STOCK_TRANSFER_STAGES.find((stage) => stage.id === 'ready_to_dispatch')?.dbStatus)
      .toBe('ready_to_dispatch')
    expect(STOCK_TRANSFER_STAGES.find((stage) => stage.id === 'in_transit')?.dbStatus)
      .toBe('in_transit')
  })

  it('maps DB statuses to the five UI stages and preserves historical in_transit readability', () => {
    expect(mapDbStatusToStage('draft')).toBe('draft')
    expect(mapDbStatusToStage('pending_approval')).toBe('pending_approval')
    expect(mapDbStatusToStage('ready_to_dispatch')).toBe('ready_to_dispatch')
    // Historical Phase-11 "Ready to Dispatch" rows used in_transit with stock already deducted.
    // They remain readable as In Transit without destructive reinterpretation.
    expect(mapDbStatusToStage('in_transit')).toBe('in_transit')
    expect(mapDbStatusToStage('received')).toBe('received')
    expect(transferStatusLabel('ready_to_dispatch')).toBe('Ready to Dispatch')
    expect(transferStatusLabel('in_transit')).toBe('In Transit')
    expect(transferStatusLabel('pending')).toBe('Draft')
  })

  it('documents stock impact messaging for every lifecycle stage', () => {
    expect(transferStockImpactMessage('draft')).toBe('Stock is not reserved.')
    expect(transferStockImpactMessage('pending_approval')).toBe('Quantity reserved; On Hand unchanged.')
    expect(transferStockImpactMessage('ready_to_dispatch')).toBe('Approved and reserved; awaiting dispatch.')
    expect(transferStockImpactMessage('in_transit')).toBe('Source stock deducted; awaiting receipt.')
    expect(transferStockImpactMessage('received')).toBe('Destination stock received; transfer complete.')
  })

  it('renders historical transfer item summaries and Transfer Note lines with configuration identity', () => {
    const items = [
      {
        variant_id: 'var-1',
        variant_name: 'Cellera [Mango]',
        product_name: 'Cellera',
        quantity: 5,
        stock_config_id: 'cfg-20nb',
        stock_sku: 'CEL-MANGO-20NB',
        config_label: '20ml New Box',
      },
      {
        variant_id: 'var-legacy',
        variant_name: 'Old Flavour',
        product_name: 'Legacy Product',
        quantity: 2,
      },
    ]
    expect(formatTransferItemsSummary(items)).toContain('20ml New Box')
    const noteLines = transferNoteLinesFromItems(items)
    expect(noteLines[0]).toMatchObject({
      configLabel: '20ml New Box',
      stockSku: 'CEL-MANGO-20NB',
      quantity: 5,
    })
    expect(noteLines[1].configLabel).toBe('Configuration')
  })
})

describe('stock transfer authorization matrix', () => {
  it('treats HQ Admin level 10 and Super Admin level 1 as is_hq_admin', () => {
    expect(isHqInventoryAdmin(1)).toBe(true)
    expect(isHqInventoryAdmin(10)).toBe(true)
    expect(isHqInventoryAdmin(20)).toBe(false)
    expect(isHqInventoryAdmin(null)).toBe(false)
  })

  it('allows HQ approve/reject only while pending approval (no silent requester self-approve)', () => {
    expect(canApproveStockTransfer({ status: 'pending_approval', isHqAdmin: true })).toBe(true)
    expect(canApproveStockTransfer({ status: 'pending_approval', isHqAdmin: false })).toBe(false)
    expect(canApproveStockTransfer({ status: 'draft', isHqAdmin: true })).toBe(false)
    expect(canRejectStockTransfer({ status: 'pending_approval', isHqAdmin: true })).toBe(true)
    expect(canRejectStockTransfer({ status: 'ready_to_dispatch', isHqAdmin: true })).toBe(false)
  })

  it('allows source warehouse dispatch and destination warehouse receive only at the correct stages', () => {
    expect(canDispatchStockTransfer({
      status: 'ready_to_dispatch',
      isHqAdmin: false,
      userOrgId: 'wh-a',
      fromOrgId: 'wh-a',
    })).toBe(true)
    expect(canDispatchStockTransfer({
      status: 'ready_to_dispatch',
      isHqAdmin: false,
      userOrgId: 'wh-b',
      fromOrgId: 'wh-a',
    })).toBe(false)
    expect(canDispatchStockTransfer({
      status: 'pending_approval',
      isHqAdmin: true,
      userOrgId: 'wh-a',
      fromOrgId: 'wh-a',
    })).toBe(false)
    expect(canReceiveStockTransfer({
      status: 'in_transit',
      isHqAdmin: false,
      userOrgId: 'wh-b',
      toOrgId: 'wh-b',
    })).toBe(true)
    expect(canReceiveStockTransfer({
      status: 'ready_to_dispatch',
      isHqAdmin: true,
      userOrgId: 'wh-b',
      toOrgId: 'wh-b',
    })).toBe(false)
  })

  it('allows cancel only before dispatch and enables Transfer Note after approval', () => {
    expect(canCancelStockTransfer({ status: 'draft' })).toBe(true)
    expect(canCancelStockTransfer({ status: 'pending_approval' })).toBe(true)
    expect(canCancelStockTransfer({ status: 'ready_to_dispatch' })).toBe(true)
    expect(canCancelStockTransfer({ status: 'in_transit' })).toBe(false)
    expect(canCancelStockTransfer({ status: 'received' })).toBe(false)
    expect(canPrintTransferNote({ status: 'pending_approval', hasTransferId: true })).toBe(false)
    expect(canPrintTransferNote({ status: 'ready_to_dispatch', hasTransferId: true })).toBe(true)
    expect(canPrintTransferNote({ status: 'in_transit', hasTransferId: true })).toBe(true)
    expect(canPrintTransferNote({ status: 'received', hasTransferId: true })).toBe(true)
  })
})
