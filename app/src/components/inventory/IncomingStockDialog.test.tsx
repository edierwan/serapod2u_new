// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import IncomingStockDialog from './IncomingStockDialog'

const ORDER_DB_ID = '10000000-0000-0000-0000-000000000001'
const TRANSFER_DB_ID = '20000000-0000-0000-0000-000000000001'

const orderRows = [
  {
    company_id: 'company-a',
    order_id: ORDER_DB_ID,
    order_no: 'ORD-INTERNAL-001',
    display_doc_no: 'ORD26000008',
    order_status: 'approved',
    approved_at: '2026-01-15T00:00:00Z',
    manufacturer_org_id: 'mfg-1',
    manufacturer_name: 'Shenzen VapeHome Technologies Co. Limited',
    declared_warehouse_org_id: 'wh-1',
    destination_warehouse_org_id: 'wh-1',
    warehouse_mismatch: false,
    variant_id: 'variant-x',
    product_id: 'product-1',
    ordered_qty: 4000,
    received_qty: 0,
    incoming_qty: 4000,
    excluded_reason: null,
    qr_stage: 'qr_generated',
  },
]

const transferRows = [
  {
    company_id: 'company-a',
    transfer_id: TRANSFER_DB_ID,
    transfer_no: 'TRF-2026-0001',
    status: 'in_transit',
    source_warehouse_org_id: 'wh-2',
    source_warehouse_name: 'WH Penang',
    destination_warehouse_org_id: 'wh-1',
    destination_warehouse_name: 'WH Alma Jaya',
    variant_id: 'variant-x',
    quantity: 500,
    dispatched_at: '2026-07-10T00:00:00Z',
    received_at: null,
    destination_posted: false,
    incoming_qty: 500,
    excluded_reason: null,
  },
]

function buildQuery(result: unknown[]) {
  const query: any = {}
  for (const method of ['select', 'eq', 'gt', 'order']) {
    query[method] = vi.fn(() => query)
  }
  query.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
    resolve({ data: result, error: null })
  return query
}

vi.mock('@/lib/hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => ({
    isReady: true,
    supabase: {
      from: (table: string) =>
        buildQuery(table === 'v_incoming_stock_detail' ? orderRows : transferRows),
    },
  }),
}))

describe('IncomingStockDialog navigation and source split', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  const renderDialog = (onClose = vi.fn()) => {
    render(
      <IncomingStockDialog
        open
        onClose={onClose}
        variantId="variant-x"
        warehouseOrgId="wh-1"
        productName="Cellera Hero"
        variantName="Banana Milk"
      />
    )
    return onClose
  }

  it('links the Order No. to the Order Detail deep link using the database id, not the displayed number', async () => {
    renderDialog()
    const link = await screen.findByRole('link', { name: /ORD26000008/ })
    expect(link.getAttribute('href')).toBe(`/supply-chain?view=view-order&orderId=${ORDER_DB_ID}`)
    expect(link.getAttribute('href')).not.toContain('ORD26000008')
  })

  it('closes the dialog when the order link is activated', async () => {
    const onClose = renderDialog()
    const link = await screen.findByRole('link', { name: /ORD26000008/ })
    fireEvent.click(link)
    expect(onClose).toHaveBeenCalled()
  })

  it('links the Transfer No. to the movement report deep link by transfer number', async () => {
    renderDialog()
    const link = await screen.findByRole('link', { name: /TRF-2026-0001/ })
    expect(link.getAttribute('href')).toBe('/dashboard?view=stock-movements&id=TRF-2026-0001')
  })

  it('closes the dialog when the transfer link is activated', async () => {
    const onClose = renderDialog()
    const link = await screen.findByRole('link', { name: /TRF-2026-0001/ })
    fireEvent.click(link)
    expect(onClose).toHaveBeenCalled()
  })

  it('shows Total Incoming with separate manufacturer and transfer subtotals', async () => {
    renderDialog()
    await waitFor(() => {
      expect(screen.getByText(/Incoming Stock — 4,500 units/)).toBeTruthy()
    })
    expect(screen.getByText(/manufacturer 4,000 · transfers 500/)).toBeTruthy()
    expect(screen.getByText('Manufacturer Orders')).toBeTruthy()
    expect(screen.getByText('Warehouse Transfers')).toBeTruthy()
  })

  it('shows source and destination warehouses for a transfer without mixing them', async () => {
    renderDialog()
    await screen.findByRole('link', { name: /TRF-2026-0001/ })
    expect(screen.getByText('WH Penang')).toBeTruthy()
    expect(screen.getByText('WH Alma Jaya')).toBeTruthy()
  })
})
