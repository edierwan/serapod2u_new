import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  formatSignedMovementImpact,
  historicalQuantityAfter,
  resolveStockMovementConfiguration,
  resolveStockMovementHistoryValues,
  signedMovementTotal,
} from './stock-movement-history'

const balanceTriggerMigration = readFileSync(
  new URL('../../../../supabase/migrations/20260716_stock_movement_history_balance_fix_04.sql', import.meta.url),
  'utf8',
)

const movement = (overrides: Partial<{
  quantity_before: number
  quantity_change: number
  quantity_after: number
  unit_cost: number | null
  total_cost: number | null
}> = {}) => ({
  quantity_before: 100,
  quantity_change: 5,
  quantity_after: 999,
  unit_cost: 13.86,
  total_cost: 69.3,
  ...overrides,
})

describe('stock movement historical quantities', () => {
  it.each([
    [3_997, 3, 4_000],
    [1_000, 3_000, 4_000],
    [6_183, -2_183, 4_000],
    [10_415, -6_415, 4_000],
  ])('resolves %i + %i to %i', (before, change, after) => {
    expect(historicalQuantityAfter(before, change)).toBe(after)
  })

  it('does not use allocated quantity as historical on hand', () => {
    const row = { ...movement(), quantity_allocated: 600 }
    expect(resolveStockMovementHistoryValues(row).quantity_after).toBe(105)
  })

  it('does not use available quantity as historical on hand', () => {
    const row = { ...movement(), quantity_available: 3_400 }
    expect(resolveStockMovementHistoryValues(row).quantity_after).toBe(105)
  })

  it('keeps warehouse rows isolated', () => {
    const rows = [
      { ...movement(), warehouse_id: 'warehouse-a', variant_id: 'variant-a' },
      { ...movement({ quantity_before: 800, quantity_change: -25 }), warehouse_id: 'warehouse-b', variant_id: 'variant-a' },
    ].map(resolveStockMovementHistoryValues)

    expect(rows.map(row => [row.warehouse_id, row.variant_id, row.quantity_after])).toEqual([
      ['warehouse-a', 'variant-a', 105],
      ['warehouse-b', 'variant-a', 775],
    ])
  })

  it('keeps variant rows isolated', () => {
    const rows = [
      { ...movement(), warehouse_id: 'warehouse-a', variant_id: 'variant-a' },
      { ...movement({ quantity_before: 40, quantity_change: 2 }), warehouse_id: 'warehouse-a', variant_id: 'variant-b' },
    ].map(resolveStockMovementHistoryValues)

    expect(rows.map(row => [row.warehouse_id, row.variant_id, row.quantity_after])).toEqual([
      ['warehouse-a', 'variant-a', 105],
      ['warehouse-a', 'variant-b', 42],
    ])
  })

  it('does not let a later movement change an earlier closing balance', () => {
    const earlier = { ...movement({ quantity_before: 100, quantity_change: 5 }), created_at: '2026-07-14T01:00:00Z' }
    const later = { ...movement({ quantity_before: 105, quantity_change: -2 }), created_at: '2026-07-15T01:00:00Z' }
    expect([earlier, later].map(resolveStockMovementHistoryValues).map(row => row.quantity_after)).toEqual([105, 103])
  })

  it('does not use descending display order to calculate balances', () => {
    const earlier = { ...movement({ quantity_before: 100, quantity_change: 5 }), created_at: '2026-07-14T01:00:00Z' }
    const later = { ...movement({ quantity_before: 105, quantity_change: -2 }), created_at: '2026-07-15T01:00:00Z' }
    const descending = [later, earlier].map(resolveStockMovementHistoryValues)
    expect(descending.map(row => row.quantity_after)).toEqual([103, 105])
  })

  it('does not mutate current inventory data while resolving report rows', () => {
    const inventory = { quantity_on_hand: 4_000 }
    resolveStockMovementHistoryValues(movement({ quantity_before: 3_997, quantity_change: 3 }))
    expect(inventory.quantity_on_hand).toBe(4_000)
  })

  it('preserves the invariant for a non-stock-count movement', () => {
    expect(resolveStockMovementHistoryValues({
      ...movement({ quantity_before: 25, quantity_change: -4, quantity_after: 21 }),
      movement_type: 'order_fulfillment',
    }).quantity_after).toBe(21)
  })
})

describe('stock movement configuration labels', () => {
  it('keeps four classification movements distinct by stock_config_id', () => {
    const sharedMovement = {
      variant_id: 'coffee-hazelnut',
      reference_id: 'classification-session',
      reference_no: 'Stock Classification 2026-07-18',
    }
    const configurations = [
      { id: '20nb', config_code: '20NB', config_label: '20ml · New Box', stock_sku: 'HAZ-20NB', volume_ml: 20, packaging: 'new_box', status: 'active' },
      { id: '50nb', config_code: '50NB', config_label: '50ml · New Box', stock_sku: 'HAZ-50NB', volume_ml: 50, packaging: 'new_box', status: 'active' },
      { id: '50ob', config_code: '50OB', config_label: '50ml · Old Box', stock_sku: 'HAZ-50OB', volume_ml: 50, packaging: 'old_box', status: 'phase_out' },
      { id: 'unc', config_code: 'UNCLASSIFIED', config_label: 'Unclassified (pending stock take)', stock_sku: 'HAZ-UNC', volume_ml: null, packaging: null, status: 'phase_out' },
    ]
    const movements = [
      { ...sharedMovement, stock_config_id: '20nb', quantity_change: 50 },
      { ...sharedMovement, stock_config_id: '50nb', quantity_change: 40 },
      { ...sharedMovement, stock_config_id: '50ob', quantity_change: 30 },
      { ...sharedMovement, stock_config_id: 'unc', quantity_change: -100 },
    ]

    const resolved = movements.map((row, index) =>
      resolveStockMovementConfiguration(row, configurations[index]),
    )

    expect(resolved.map(row => row.configuration_display_label)).toEqual([
      '20ml · New Box',
      '50ml · New Box',
      '50ml · Old Box',
      'Legacy / Unclassified',
    ])
    expect(resolved.map(row => row.stock_sku)).toEqual([
      'HAZ-20NB',
      'HAZ-50NB',
      'HAZ-50OB',
      'HAZ-UNC',
    ])
    expect(resolved.map(row => row.stock_config_status)).toEqual([
      'active',
      'active',
      'phase_out',
      'phase_out',
    ])
  })

  it('preserves historical null configuration identities as Legacy / Unclassified', () => {
    expect(resolveStockMovementConfiguration({
      stock_config_id: null,
      quantity_change: 50,
      config_label: '20ml · New Box',
    })).toMatchObject({
      configuration_display_label: 'Legacy / Unclassified',
      is_legacy_configuration: true,
    })
  })

  it.each([
    'addition',
    'warranty_bonus',
    'allocation',
    'deallocation',
    'order_fulfillment',
    'transfer_in',
    'transfer_out',
    'repack_in',
    'repack_out',
    'manual_in',
    'manual_out',
    'adjustment',
    'scratch_game_in',
    'scratch_game_out',
    'spin_wheel_in',
    'spin_wheel_out',
  ])('uses persisted configuration metadata for %s movements', movementType => {
    const resolved = resolveStockMovementConfiguration(
      {
        movement_type: movementType,
        stock_config_id: 'configured-stock',
        quantity_change: movementType.endsWith('_out') ? -10 : 10,
      },
      {
        id: 'configured-stock',
        config_code: '50OB',
        config_label: '50ml · Old Box',
        stock_sku: 'SKU-50OB',
        volume_ml: 50,
        packaging: 'old_box',
        status: 'phase_out',
      },
    )

    expect(resolved.configuration_display_label).toBe('50ml · Old Box')
    expect(resolved.stock_sku).toBe('SKU-50OB')
  })
})

describe('stock movement signed cost impact', () => {
  it('keeps positive movement value positive', () => {
    expect(signedMovementTotal(3, 41.58)).toBe(41.58)
  })

  it('shows reduction movement value as negative', () => {
    expect(signedMovementTotal(-6_415, 88_911.9)).toBe(-88_911.9)
  })

  it('uses the stored precise total rather than multiplying a rounded display cost', () => {
    const resolved = resolveStockMovementHistoryValues(movement({
      quantity_change: -6_415,
      unit_cost: 13.86,
      total_cost: 88_911.9,
    }))
    expect(resolved.unit_cost).toBe(13.86)
    expect(resolved.total_cost).toBe(-88_911.9)
  })

  it.each([
    [-89_810, 'RM -89,810.00'],
    [42_000, 'RM +42,000.00'],
    [42, 'RM +42.00'],
    [-30_562, 'RM -30,562.00'],
  ])('formats %s as an explicitly signed impact', (total, expected) => {
    expect(formatSignedMovementImpact(total)).toBe(expected)
  })
})

describe('stock movement balance trigger migration', () => {
  it('preserves a valid RPC-supplied invariant only when anchored to locked inventory', () => {
    expect(balanceTriggerMigration).toContain(
      'NEW.quantity_after = NEW.quantity_before + NEW.quantity_change',
    )
    expect(balanceTriggerMigration).toContain(
      'v_current_qty = NEW.quantity_before OR v_current_qty = NEW.quantity_after',
    )
  })

  it('prevents an invalid supplied balance from being stored', () => {
    expect(balanceTriggerMigration).toContain(
      'NEW.quantity_after <> NEW.quantity_before + NEW.quantity_change',
    )
    expect(balanceTriggerMigration).toContain(
      'Movement balance is not anchored to current inventory',
    )
    expect(balanceTriggerMigration).toContain(
      'BEFORE UPDATE OF quantity_before, quantity_change, quantity_after',
    )
  })

  it('derives a missing after value from an authoritative before value', () => {
    expect(balanceTriggerMigration).toContain('NEW.quantity_after := NEW.quantity_before + NEW.quantity_change')
  })

  it('derives a missing before value from an authoritative after value', () => {
    expect(balanceTriggerMigration).toContain('NEW.quantity_before := NEW.quantity_after - NEW.quantity_change')
  })

  it('rejects ambiguous missing balances for ordinary movement types', () => {
    expect(balanceTriggerMigration).toContain(
      "RAISE EXCEPTION 'Both movement balance fields are required for type %'",
    )
  })

  it('serializes the RPC before reading and locks the inventory row', () => {
    const advisoryLockIndex = balanceTriggerMigration.indexOf('PERFORM pg_advisory_xact_lock')
    const inventoryReadIndex = balanceTriggerMigration.indexOf('SELECT id, quantity_on_hand')
    expect(advisoryLockIndex).toBeGreaterThan(-1)
    expect(inventoryReadIndex).toBeGreaterThan(advisoryLockIndex)
    expect(balanceTriggerMigration).toContain('FOR UPDATE')
  })

  it('validates tenant and authenticated actor authority', () => {
    expect(balanceTriggerMigration).toContain(
      'p_company_id IS DISTINCT FROM v_company_id',
    )
    expect(balanceTriggerMigration).toContain(
      "p_created_by IS DISTINCT FROM auth.uid()",
    )
    expect(balanceTriggerMigration).toContain(
      'public.can_access_org(p_organization_id) OR public.is_hq_admin()',
    )
    expect(balanceTriggerMigration).toContain(
      'public.get_company_id(v_wh_id) IS DISTINCT FROM NEW.company_id',
    )
  })

  it('supports incoming and outgoing authoritative RPC movements', () => {
    expect(balanceTriggerMigration).toContain('IF p_quantity_change < 0 THEN')
    expect(balanceTriggerMigration).toContain('v_from_org := p_organization_id')
    expect(balanceTriggerMigration).toContain('v_to_org := p_organization_id')
  })

  it('keeps transfer legs scoped through the shared warehouse resolver', () => {
    expect(balanceTriggerMigration).toContain('public._movement_warehouse_id')
    expect(balanceTriggerMigration).toContain("'transfer_out'")
  })

  it('prevents authenticated callers from bypassing authoritative RPCs', () => {
    expect(balanceTriggerMigration).toContain(
      'REVOKE INSERT ON TABLE public.stock_movements FROM anon, authenticated',
    )
    expect(balanceTriggerMigration).toContain(
      'REVOKE ALL ON FUNCTION public.wms_record_movement_from_summary(jsonb)',
    )
  })

  it('corrects all repository-owned movement-history views consistently', () => {
    expect(balanceTriggerMigration).toContain('CREATE OR REPLACE VIEW public.v_stock_movements_display')
    expect(balanceTriggerMigration).toContain('CREATE OR REPLACE VIEW public.v_wms_movements_recent')
    expect(balanceTriggerMigration).toContain('CREATE OR REPLACE VIEW public.vw_stock_movements_ordered')
    expect(balanceTriggerMigration.match(/quantity_before \+ sm\.quantity_change AS quantity_after/g)).toHaveLength(3)
  })

  it('does not update inventory or rewrite historical movement rows', () => {
    expect(balanceTriggerMigration).not.toMatch(/UPDATE\s+public\.stock_movements/i)
  })
})
