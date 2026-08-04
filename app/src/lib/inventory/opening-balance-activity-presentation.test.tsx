import { describe, expect, it } from 'vitest'
import {
  formatActivityOccurredAt,
  formatActivityOccurredDate,
  formatActivityRequiredAction,
  formatActivityStockConfiguration,
  formatActivityVariantLabel,
  formatTransactionsRemainingLabel,
  formatWarehouseActivityReference,
  formatWarehouseActivityType,
  isRawUuidReference,
  summarizeWarehouseActivity,
  warehouseActivityLineCount,
  warehouseActivityOpenHref,
  warehouseActivityOpenLabel,
  warehouseActivityQuantity,
  warehouseActivityTechnicalId,
} from './opening-balance-activity-presentation'
import {
  classifyActivityBucket,
  deriveWorkspaceState,
  groupWarehouseActivity,
} from './opening-balance-workspace'

const SAMPLE_UUID = '9b587a24-dd17-44c3-a675-edcba5915993'
const SAMPLE_UUID_B = '1c2d3e4f-a111-4b22-8c33-445566778899'

describe('Opening Balance activity presentation', () => {
  it('converts machine transaction names into readable labels', () => {
    expect(formatWarehouseActivityType('stock_adjustment')).toBe('Stock Adjustment')
    expect(formatWarehouseActivityType('stock_transfer')).toBe('Stock Transfer')
    expect(formatWarehouseActivityType('return')).toBe('Return')
    expect(formatWarehouseActivityType('transfer_out')).toBe('Transfer Out')
  })

  it('detects raw UUID references and never treats them as business numbers', () => {
    expect(isRawUuidReference(SAMPLE_UUID)).toBe(true)
    expect(isRawUuidReference('TR-2026-0001')).toBe(false)
    expect(isRawUuidReference('RC-88')).toBe(false)
    expect(isRawUuidReference(null)).toBe(false)
  })

  it('prefers an existing human-readable business reference when available', () => {
    expect(
      formatWarehouseActivityReference({
        movement_type: 'stock_transfer',
        reference_no: 'TR-2026-0042',
        reference_id: SAMPLE_UUID,
        occurred_at: '2026-07-19T03:05:00.000Z',
      }),
    ).toBe('TR-2026-0042')

    expect(
      formatWarehouseActivityReference({
        movement_type: 'return',
        reference_no: 'RET-100',
        occurred_at: '2026-07-19T03:05:00.000Z',
      }),
    ).toBe('RET-100')
  })

  it('falls back to a date-only label without repeating full date/time', () => {
    const label = formatWarehouseActivityReference({
      movement_type: 'stock_adjustment',
      reference_no: null,
      reference_id: SAMPLE_UUID,
      occurred_at: '2026-07-19T03:05:00.000Z',
    })

    expect(label).toBe(`Stock Adjustment · ${formatActivityOccurredDate('2026-07-19T03:05:00.000Z')}`)
    expect(label).not.toMatch(/AM|PM/i)
    expect(label).not.toContain(SAMPLE_UUID)
    expect(label).not.toContain(SAMPLE_UUID.slice(0, 8))
    expect(isRawUuidReference(label)).toBe(false)
  })

  it('does not use a raw UUID as the normal table reference even when reference_no is a UUID', () => {
    const label = formatWarehouseActivityReference({
      movement_type: 'stock_adjustment',
      reference_no: SAMPLE_UUID,
      occurred_at: '2026-07-19T03:05:00.000Z',
    })
    expect(label).not.toBe(SAMPLE_UUID)
    expect(label).not.toContain(SAMPLE_UUID)
    expect(warehouseActivityTechnicalId({
      reference_no: SAMPLE_UUID,
    })).toBe(SAMPLE_UUID)
    expect(warehouseActivityTechnicalId({
      reference_id: SAMPLE_UUID,
      reference_no: null,
    })).toBe(SAMPLE_UUID)
  })

  it('formats occurred-at for display helpers', () => {
    const formatted = formatActivityOccurredAt('2026-07-19T03:05:00.000Z')
    expect(formatted).toBeTruthy()
    expect(formatted).toMatch(/Jul/)
    expect(formatted).toMatch(/2026/)
    expect(formatted).toMatch(/AM|PM/)
  })

  it('replaces Complete Before Cut-off with Complete or Cancel', () => {
    expect(formatActivityRequiredAction({
      classification: 'Complete Before Cut-off',
    })).toBe('Complete or Cancel')
    expect(formatActivityRequiredAction({
      required_action: 'Complete or Cancel',
      classification: 'Complete Before Cut-off',
    })).toBe('Complete or Cancel')
  })

  it('builds an original-transaction link without showing UUID as the label', () => {
    expect(warehouseActivityOpenHref({
      movement_type: 'stock_adjustment',
      reference_id: SAMPLE_UUID,
    })).toBe(`/supply-chain/inventory/count?adjustmentId=${SAMPLE_UUID}`)
    expect(warehouseActivityOpenLabel({
      movement_type: 'stock_adjustment',
    })).toBe('Open Adjustment')
    expect(warehouseActivityOpenHref({
      movement_type: 'stock_transfer',
      reference_no: 'TR-2026-0042',
    })).toBe('/supply-chain/inventory/transfer?transfer=TR-2026-0042')
    expect(warehouseActivityOpenLabel({
      movement_type: 'stock_transfer',
    })).toBe('View Transaction')
  })

  it('formats variant and configuration labels without raw UUIDs', () => {
    expect(formatActivityVariantLabel({
      variant_name: 'Mango Ice',
      alternative_name: 'Mango Ice',
    })).toBe('Mango Ice')
    expect(formatActivityVariantLabel({
      variant_name: 'Mango Ice',
      alternative_name: 'MI-20',
    })).toBe('Mango Ice (MI-20)')
    expect(formatActivityStockConfiguration({
      stock_configuration: '20ml · New Box',
    })).toBe('20ml · New Box')
    expect(formatActivityStockConfiguration({})).toBe('Unclassified')
  })
})

describe('document versus line-item summary', () => {
  const rows = [
    {
      movement_type: 'stock_adjustment',
      reference_id: SAMPLE_UUID,
      status: 'pending',
      quantity: 15,
      line_count: 2,
      variant_count: 2,
      classification: 'Complete Before Cut-off',
      occurred_at: '2026-07-18T08:58:41.000Z',
      items: [
        {
          item_id: 'i1',
          variant_id: 'v1',
          variant_name: 'Mango Ice',
          alternative_name: 'MI',
          stock_configuration: '20ml · New Box',
          quantity: 10,
          warehouse: 'Serapod Warehouse Balakong',
          status: 'pending',
        },
        {
          item_id: 'i2',
          variant_id: 'v2',
          variant_name: 'Grape Ice',
          stock_configuration: '50ml · Old Box',
          quantity: 5,
          warehouse: 'Serapod Warehouse Balakong',
          status: 'pending',
        },
      ],
    },
    {
      movement_type: 'stock_adjustment',
      reference_id: SAMPLE_UUID_B,
      status: 'pending',
      quantity: 7,
      line_count: 1,
      variant_count: 1,
      classification: 'Complete Before Cut-off',
      // Same timestamp as the first header — must remain a separate document.
      occurred_at: '2026-07-18T08:58:41.000Z',
      items: [
        {
          item_id: 'i3',
          variant_id: 'v3',
          variant_name: 'Cool Mint',
          stock_configuration: 'Unclassified',
          quantity: 7,
          warehouse: 'Serapod Warehouse Balakong',
          status: 'pending',
        },
      ],
    },
  ]

  it('counts distinct adjustment documents separately from child items', () => {
    const summary = summarizeWarehouseActivity(rows)
    expect(summary.documentCount).toBe(2)
    expect(summary.lineItemCount).toBe(3)
    expect(summary.totalAffectedQuantity).toBe(22)
    expect(summary.zeroImpactCount).toBe(0)
    expect(summary.remainingLabel).toBe('3 pending items across 2 stock adjustments')
    expect(formatTransactionsRemainingLabel(summary)).toBe('3 pending items across 2 stock adjustments')
  })

  it('derives total quantity from authoritative child lines', () => {
    expect(warehouseActivityQuantity(rows[0])).toBe(15)
    expect(warehouseActivityLineCount(rows[0])).toBe(2)
    expect(warehouseActivityQuantity({
      movement_type: 'stock_adjustment',
      quantity: 0,
      items: [{ quantity: 12 }, { quantity: -3 }],
    })).toBe(15)
  })

  it('keeps same-timestamp headers as separate documents', () => {
    expect(rows[0].occurred_at).toBe(rows[1].occurred_at)
    expect(rows[0].reference_id).not.toBe(rows[1].reference_id)
    const summary = summarizeWarehouseActivity(rows)
    expect(summary.documentCount).toBe(2)
    expect(groupWarehouseActivity(rows).mustResolve).toHaveLength(2)
  })
})

describe('zero-impact drafts vs genuine child-line stock impact', () => {
  it('does not count closed quality-issue statuses as must-resolve', () => {
    expect(classifyActivityBucket({
      movement_type: 'stock_adjustment',
      status: 'resolved',
      quantity: 12,
      classification: 'Complete Before Cut-off',
    })).toBe('history')

    expect(classifyActivityBucket({
      movement_type: 'stock_adjustment',
      status: 'rejected',
      quantity: 0,
    })).toBe('history')
  })

  it('keeps History Only classification out of must-resolve even when status is draft', () => {
    expect(classifyActivityBucket({
      movement_type: 'stock_adjustment',
      status: 'draft',
      quantity: 0,
      classification: 'History Only',
    })).toBe('history')
  })

  it('keeps genuine open stock-impacting adjustments actionable', () => {
    expect(classifyActivityBucket({
      movement_type: 'stock_adjustment',
      status: 'pending',
      quantity: 25,
      classification: 'Complete Before Cut-off',
      reference_id: SAMPLE_UUID,
    })).toBe('mustResolve')
  })

  it('preserves child-line impact quantity in remaining counts (header may be zero upstream)', () => {
    const state = deriveWorkspaceState({
      readiness: 'Blocked',
      inventory: [{ stock_config_id: 'c1', physical_quantity: 10 }],
      distributor_orders: [],
      manufacturer_incoming: [],
      warehouse_activity: [
        {
          movement_type: 'stock_adjustment',
          status: 'draft',
          quantity: 0,
          classification: 'History Only',
          reference_id: '00000000-0000-4000-8000-000000000001',
        },
        {
          movement_type: 'stock_adjustment',
          status: 'pending',
          quantity: 40,
          line_count: 2,
          classification: 'Complete Before Cut-off',
          reference_id: '00000000-0000-4000-8000-000000000002',
          reference_no: null,
          occurred_at: '2026-07-19T03:05:00.000Z',
          items: [
            { variant_name: 'A', stock_configuration: '20ml · New Box', quantity: 25 },
            { variant_name: 'B', stock_configuration: '50ml · New Box', quantity: 15 },
          ],
        },
        {
          movement_type: 'stock_transfer',
          status: 'pending',
          quantity: 3,
          reference_no: 'TR-9',
          classification: 'Complete Before Cut-off',
        },
      ],
      blockers: ['Stock adjustment dated 19 Jul 2026, 03:05 is pending and must be completed before cut-off (impact quantity 40 across 2 item(s)).'],
    })

    // Progression uses distinct unresolved headers, not child lines.
    expect(state.transactionsRemaining).toBe(2)
    expect(state.remainingByStep.transactions).toBe(2)
    expect(state.remainingByStep.review).toBe(2)
    expect(state.status).toBe('Blocked')

    const groups = groupWarehouseActivity([
      {
        movement_type: 'stock_adjustment',
        status: 'draft',
        quantity: 0,
        classification: 'History Only',
      },
      {
        movement_type: 'stock_adjustment',
        status: 'pending',
        quantity: 40,
        classification: 'Complete Before Cut-off',
      },
      {
        movement_type: 'stock_transfer',
        status: 'pending',
        quantity: 3,
        reference_no: 'TR-9',
        classification: 'Complete Before Cut-off',
      },
    ])

    expect(groups.mustResolve).toHaveLength(2)
    expect(groups.mustResolve.every(row => Number(row.quantity || 0) > 0)).toBe(true)
    expect(groups.history).toHaveLength(1)

    const summary = summarizeWarehouseActivity(groups.mustResolve)
    expect(summary.documentCount).toBe(2)
    expect(summary.byType.length).toBe(2)
  })

  it('reports Ready with zero transaction remaining when only closed/history activity remains', () => {
    const state = deriveWorkspaceState({
      readiness: 'Ready',
      inventory: [{ stock_config_id: 'c1', physical_quantity: 10 }],
      distributor_orders: [],
      manufacturer_incoming: [],
      warehouse_activity: [
        {
          movement_type: 'stock_adjustment',
          status: 'resolved',
          quantity: 5,
          classification: 'History Only',
        },
        {
          movement_type: 'adjustment',
          status: 'posted',
          quantity: 2,
          reference_no: 'COUNT-JUL',
          classification: 'History Only',
        },
      ],
      blockers: [],
    })

    expect(state.transactionsRemaining).toBe(0)
    expect(state.remainingByStep.review).toBe(0)
    expect(state.status).toBe('Ready')
  })

  it('treats completed/cancelled headers as disappeared after refresh (history bucket)', () => {
    const before = groupWarehouseActivity([
      {
        movement_type: 'stock_adjustment',
        status: 'pending',
        quantity: 12,
        reference_id: SAMPLE_UUID,
        classification: 'Complete Before Cut-off',
      },
    ])
    expect(before.mustResolve).toHaveLength(1)

    const after = groupWarehouseActivity([
      {
        movement_type: 'stock_adjustment',
        status: 'completed',
        quantity: 12,
        reference_id: SAMPLE_UUID,
        classification: 'History Only',
      },
    ])
    expect(after.mustResolve).toHaveLength(0)
    expect(after.history).toHaveLength(1)
    expect(deriveWorkspaceState({
      readiness: 'Ready',
      inventory: [],
      distributor_orders: [],
      manufacturer_incoming: [],
      warehouse_activity: after.history,
      blockers: [],
    }).transactionsRemaining).toBe(0)
  })
})
