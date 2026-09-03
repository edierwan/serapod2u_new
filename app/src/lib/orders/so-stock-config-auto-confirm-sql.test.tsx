import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoFile = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, '../../../../', relativePath), 'utf8')

const autoConfirm = repoFile('supabase/migrations/20260814100000_so_stock_config_auto_confirm.sql')
const fulfilment = repoFile('supabase/migrations/20260717_stock_config_05_so_fulfilment.sql')
const orderDetails = repoFile('app/src/components/orders/ViewOrderDetailsView.tsx')

describe('Submitted sales orders are approvable without a manual configuration step', () => {
  // Statements only: the header comment quotes the old behaviour it replaces.
  const allocation = autoConfirm.slice(
    autoConfirm.indexOf('CREATE OR REPLACE FUNCTION public.allocate_inventory_for_order'),
  )

  it('confirms the resolved configuration inside allocation', () => {
    expect(autoConfirm).toContain('CREATE OR REPLACE FUNCTION public.allocate_inventory_for_order')
    expect(allocation).toContain('stock_config_confirmed_at = now()')
    expect(allocation).toContain('stock_config_confirmed_by = v_actor')
    // No allocation path may leave a line unconfirmed any more.
    expect(allocation).not.toContain('stock_config_confirmed_at = NULL')
  })

  it('keeps the same configuration choice, only marking it confirmed', () => {
    expect(autoConfirm).toContain('public.resolve_so_stock_config(')
    expect(autoConfirm).toContain('Insufficient available stock at %')
    expect(autoConfirm).toContain('assert_hq_fulfillment_warehouse')
  })

  it('backfills only submitted D2H/S2D lines that already hold a configuration', () => {
    const backfill = autoConfirm.slice(autoConfirm.indexOf('UPDATE public.order_items oi'))
    expect(backfill).toContain("o.order_type IN ('D2H', 'S2D')")
    expect(backfill).toContain("o.status = 'submitted'")
    expect(backfill).toContain('oi.stock_config_id IS NOT NULL')
    expect(backfill).toContain('oi.stock_config_confirmed_at IS NULL')
  })

  it('leaves the downstream guards in place for lines that never allocated', () => {
    expect(fulfilment).toContain('stock configuration is not confirmed')
    const wms = fulfilment.slice(fulfilment.indexOf('CREATE OR REPLACE FUNCTION public.wms_from_unique_codes'))
    expect(wms).toContain('oi.stock_config_confirmed_at IS NOT NULL')
  })

  it('drops the manual confirmation UI from the order view', () => {
    expect(orderDetails).not.toContain('Confirmation required before approval')
    expect(orderDetails).not.toContain('set_order_item_stock_config')
    expect(orderDetails).not.toContain('Stock configuration')
    // The line now carries master-data identity instead.
    expect(orderDetails).toContain('Product Code')
    expect(orderDetails).toContain('item.variant?.product_code')
  })
})
