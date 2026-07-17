import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const order = source('components/orders/ViewOrderDetailsView.tsx')
const receive = source('components/dashboard/views/qr-tracking/WarehouseReceiveView2.tsx')
const ship = source('components/dashboard/views/qr-tracking/WarehouseShipV2.tsx')
const addStock = source('components/inventory/AddStockView.tsx')
const transfer = source('components/inventory/StockTransferView.tsx')
const inventory = source('components/inventory/InventoryView.tsx')
const movementReport = source('components/inventory/StockMovementReportView.tsx')

describe('stock configuration operational UI contracts', () => {
  it('offers SO configurations only through eligibility and sufficient availability', () => {
    expect(order).toContain("config.eligible")
    expect(order).toContain('effectiveAvailable >= Number(item.qty || 0)')
    expect(order).toContain('Insufficient available stock. Fulfilment is blocked.')
    expect(order).toContain("config.packaging !== 'old_box'")
    expect(order).toContain('Move this line\'s allocation')
  })

  it('shows the exact ORD destination and receipt history configuration', () => {
    expect(receive).toContain('Inventory destination:')
    expect(receive).toContain('destination_stock_config.stock_sku')
    expect(receive).toContain('Inventory Destination')
    expect(receive).toContain('Legacy / Unclassified')
  })

  it('makes WMS picking order-item configuration explicit and fail-closed', () => {
    expect(ship).toContain('order_items_stock_config_variant_fkey')
    expect(ship).toContain('Every order line must have a confirmed Stock SKU and order-item allocation before scanning.')
    expect(ship).toContain('Blocked: missing confirmed order-item configuration')
    expect(ship).toContain('QR identity does not select inventory')
  })

  it('uses exact configurations while hiding dimension controls for STD products', () => {
    for (const screen of [addStock, transfer]) {
      expect(screen).toContain("config.volume_ml !== null || config.packaging !== null")
      expect(screen).toContain('Standard inventory configuration selected automatically.')
      expect(screen).toContain('stock_config_id')
    }
    expect(transfer).toContain('availableStock')
    expect(transfer).toContain('stock_config_label')
  })

  it('provides non-duplicating inventory summaries and configuration movement filters', () => {
    expect(inventory).toContain('Aggregate variant total')
    expect(inventory).toContain('Show inactive zero-balance configurations')
    expect(inventory).toContain('Legacy / Unclassified')
    expect(movementReport).toContain('Stock SKU / Configuration')
    expect(movementReport).toContain('All volumes')
    expect(movementReport).toContain('All packaging')
  })
})
