import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildAddStockMovementParams,
  fetchExistingStockForWarehouse,
} from './add-stock-inventory'

type InventoryRow = {
  organization_id: string
  variant_id: string
  is_active: boolean
  quantity_on_hand: number
  quantity_allocated: number
  quantity_available: number
  warehouse_location: string | null
  average_cost: number | null
  organization: { org_name: string }
}

function inventoryRow(
  organizationId: string,
  variantId: string,
  quantity: number,
  warehouseName: string
): InventoryRow {
  return {
    organization_id: organizationId,
    variant_id: variantId,
    is_active: true,
    quantity_on_hand: quantity,
    quantity_allocated: 0,
    quantity_available: quantity,
    warehouse_location: null,
    average_cost: 14,
    organization: { org_name: warehouseName },
  }
}

function fakeSupabase(rows: InventoryRow[]) {
  const queries: Array<{ table: string; filters: Record<string, unknown>; methods: string[] }> = []

  return {
    queries,
    client: {
      from(table: string) {
        const query = { table, filters: {} as Record<string, unknown>, methods: [] as string[] }
        queries.push(query)
        const builder = {
          select() {
            query.methods.push('select')
            return builder
          },
          eq(column: string, value: unknown) {
            query.methods.push(`eq:${column}`)
            query.filters[column] = value
            return builder
          },
          async maybeSingle() {
            query.methods.push('maybeSingle')
            const matches = rows.filter(row =>
              Object.entries(query.filters).every(([column, value]) =>
                row[column as keyof InventoryRow] === value
              )
            )
            if (matches.length > 1) return { data: null, error: new Error('Multiple rows') }
            return { data: matches[0] ?? null, error: null }
          },
        }
        return builder
      },
    },
  }
}

const BALAKONG = 'warehouse-balakong'
const SAHABAT = 'warehouse-sahabat'
const BANANA_MILK = 'variant-banana-milk'
const addStockComponent = readFileSync(
  new URL('../../components/inventory/AddStockView.tsx', import.meta.url),
  'utf8'
)

describe('Add Stock existing inventory balance', () => {
  it('keeps the same variant in two warehouses as separate balances', async () => {
    const database = fakeSupabase([
      inventoryRow(BALAKONG, BANANA_MILK, 100, 'Serapod Warehouse Balakong'),
      inventoryRow(SAHABAT, BANANA_MILK, 3_500, 'Sahabat Vape'),
    ])

    const balakong = await fetchExistingStockForWarehouse(database.client, BALAKONG, BANANA_MILK)
    const sahabat = await fetchExistingStockForWarehouse(database.client, SAHABAT, BANANA_MILK)

    expect(balakong?.quantity_available).toBe(100)
    expect(balakong?.warehouse_name).toBe('Serapod Warehouse Balakong')
    expect(sahabat?.quantity_available).toBe(3_500)
    expect(sahabat?.warehouse_name).toBe('Sahabat Vape')
  })

  it('does not query or show arbitrary stock when no warehouse is selected', async () => {
    const database = fakeSupabase([
      inventoryRow(SAHABAT, BANANA_MILK, 3_500, 'Sahabat Vape'),
    ])

    expect(await fetchExistingStockForWarehouse(database.client, '', BANANA_MILK)).toBeNull()
    expect(database.queries).toHaveLength(0)
  })

  it('refetches by organization and variant when switching warehouses', async () => {
    const database = fakeSupabase([
      inventoryRow(BALAKONG, BANANA_MILK, 100, 'Serapod Warehouse Balakong'),
      inventoryRow(SAHABAT, BANANA_MILK, 3_500, 'Sahabat Vape'),
    ])

    await fetchExistingStockForWarehouse(database.client, BALAKONG, BANANA_MILK)
    await fetchExistingStockForWarehouse(database.client, SAHABAT, BANANA_MILK)

    expect(database.queries.map(query => query.filters)).toEqual([
      { organization_id: BALAKONG, variant_id: BANANA_MILK, is_active: true },
      { organization_id: SAHABAT, variant_id: BANANA_MILK, is_active: true },
    ])
    expect(database.queries.flatMap(query => query.methods)).not.toContain('order')
  })

  it('clears the old result when switching variants or organizations', async () => {
    const otherVariant = 'variant-other'
    const otherOrganization = 'warehouse-other'
    const database = fakeSupabase([
      inventoryRow(BALAKONG, BANANA_MILK, 100, 'Serapod Warehouse Balakong'),
    ])

    expect(await fetchExistingStockForWarehouse(database.client, BALAKONG, otherVariant)).toBeNull()
    expect(await fetchExistingStockForWarehouse(database.client, otherOrganization, BANANA_MILK)).toBeNull()
  })

  it('reports no existing stock only after the exact lookup finds no record', async () => {
    const database = fakeSupabase([])

    expect(await fetchExistingStockForWarehouse(database.client, BALAKONG, BANANA_MILK)).toBeNull()
    expect(database.queries[0].methods).toContain('maybeSingle')
  })

  it('builds a manual movement for only the selected warehouse', () => {
    const params = buildAddStockMovementParams({
      variantId: BANANA_MILK,
      warehouseId: BALAKONG,
      quantity: 25,
      unitCost: 14,
      manufacturerId: null,
      warehouseLocation: null,
      notes: null,
      companyId: 'company-1',
      createdBy: 'user-1',
    })

    expect(params.p_organization_id).toBe(BALAKONG)
    expect(params.p_variant_id).toBe(BANANA_MILK)
    expect(params.p_quantity_change).toBe(25)
    expect(JSON.stringify(params)).not.toContain(SAHABAT)
  })

  it('keeps Inventory View and Add Stock aligned after a genuine selected-warehouse movement', async () => {
    const rows = [
      inventoryRow(BALAKONG, BANANA_MILK, 100, 'Serapod Warehouse Balakong'),
      inventoryRow(SAHABAT, BANANA_MILK, 3_500, 'Sahabat Vape'),
    ]
    const movement = buildAddStockMovementParams({
      variantId: BANANA_MILK,
      warehouseId: BALAKONG,
      quantity: 25,
      unitCost: 14,
      manufacturerId: null,
      warehouseLocation: null,
      notes: null,
      companyId: 'company-1',
      createdBy: 'user-1',
    })
    const selectedRow = rows.find(row =>
      row.organization_id === movement.p_organization_id && row.variant_id === movement.p_variant_id
    )!
    selectedRow.quantity_on_hand += movement.p_quantity_change
    selectedRow.quantity_available += movement.p_quantity_change

    const database = fakeSupabase(rows)
    const addStockBalance = await fetchExistingStockForWarehouse(database.client, BALAKONG, BANANA_MILK)
    const inventoryViewBalance = rows.find(row =>
      row.organization_id === BALAKONG && row.variant_id === BANANA_MILK
    )?.quantity_available

    expect(addStockBalance?.quantity_available).toBe(125)
    expect(addStockBalance?.quantity_available).toBe(inventoryViewBalance)
    expect(rows.find(row => row.organization_id === SAHABAT)?.quantity_available).toBe(3_500)
  })

  it('does not change Stock Count balances during read-only lookups', async () => {
    const rows = [inventoryRow(BALAKONG, BANANA_MILK, 100, 'Serapod Warehouse Balakong')]
    const database = fakeSupabase(rows)

    await fetchExistingStockForWarehouse(database.client, BALAKONG, BANANA_MILK)
    await fetchExistingStockForWarehouse(database.client, BALAKONG, BANANA_MILK)

    expect(rows[0].quantity_on_hand).toBe(100)
    expect(rows[0].quantity_available).toBe(100)
  })

  it('renders explicit unselected, loading, and not-found states without a default warehouse', () => {
    expect(addStockComponent).toContain('Select a warehouse to view existing stock.')
    expect(addStockComponent).toContain('Loading existing stock...')
    expect(addStockComponent).toContain('No existing stock at this warehouse.')
    expect(addStockComponent).toContain('Selected Warehouse:')
    expect(addStockComponent).not.toContain('const hqLocation')
  })

  it('cancels stale lookups and keys the effect by both warehouse and variant', () => {
    expect(addStockComponent).toContain('if (cancelled) return')
    expect(addStockComponent).toContain('[selectedVariant, selectedWarehouse, selectedStockConfig, supabase]')
  })
})
