// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { receiptLineLimit } from '@/lib/warehouse/receipt-limits'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
const toast = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }))

import WarehouseReceiveView2 from './WarehouseReceiveView2'

const userProfile: any = {
  id: 'u1', email: 'wh@example.com', role_code: 'WH', organization_id: 'org-1',
  organizations: { id: 'org-1', org_name: 'HQ', org_type_code: 'HQ' }, roles: { role_level: 10 },
}

function item(variant: string, name: string, code: string, ordered: number, previous: number, warranty: number) {
  return {
    product_id: 'p', variant_id: variant, product_name: 'Cellera Hero', variant_name: `Deluxe Cellera Cartridge [ ${name} ]`, product_code: code,
    ordered_qty: ordered, previously_received: previous, cumulative_received: previous,
    ordered_balance: Math.max(ordered - previous, 0), extra_received: Math.max(previous - ordered, 0),
    destination_stock_config: null, destination_error: null, cases_per_box: 100, pcs_per_case: 4,
    receipt_limit: receiptLineLimit({ orderedQty: ordered, previouslyReceived: previous, warrantyBonusPercent: warranty }),
  }
}

function summary(orderId: string, docNo: string, items: any[]) {
  const ordered = items.reduce((s, i) => s + i.ordered_qty, 0)
  const received = items.reduce((s, i) => s + i.previously_received, 0)
  return {
    order: { id: orderId, order_no: `NO-${docNo}`, display_doc_no: docNo },
    batch: {
      id: `b-${orderId}`, batch_code: 'B', receiving_status: 'completed', receiving_mode: 'partial', receiving_worker_id: null, receiving_heartbeat: null,
      receiving_progress: null, qr_completed: true, is_stale: false, total_master_codes: 1, received_master_codes: 1, total_unique_codes: ordered,
      received_unique_codes: ordered, buffer_codes: 1, received_buffer_codes: 0, total_qr_codes: ordered, consumer_scan_enabled: true,
    },
    summary: { ordered_qty: ordered, expected_buffer: 1, expected_total: ordered + 1, inventory_received: received, remaining_ordered: Math.max(ordered - received, 0), actual_extra_received: 0, receipt_status: 'partially_received' },
    items, warranty_bonus_percent: 1, receipt_tables_available: true,
  }
}

const SUMMARIES: Record<string, any> = {
  o93: summary('o93', 'ORD26000093', [item('corn', 'Corn', 'CO', 100, 70, 1)]),
  o24: summary('o24', 'ORD26000024', [item('cv', 'Corn Vanilla', 'CV', 600, 300, 1), item('ha', 'Hazelnut', 'HA', 100, 10, 1)]),
}

beforeEach(() => {
  toast.mockReset()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/warehouse/active-orders')) {
      return new Response(JSON.stringify({ orders: [
        { id: 'o93', order_no: 'NO-93', display_doc_no: 'ORD26000093', buyer_org: { org_name: 'HQ' }, created_at: '2026-09-02' },
        { id: 'o24', order_no: 'NO-24', display_doc_no: 'ORD26000024', buyer_org: { org_name: 'HQ' }, created_at: '2026-07-07' },
      ] }))
    }
    if (url.startsWith('/api/warehouse/receipt-summary')) {
      const id = new URL(url, 'http://x').searchParams.get('order_id')!
      return new Response(JSON.stringify(SUMMARIES[id]))
    }
    return new Response('{}')
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function selectOrder(id: string) {
  const select = await screen.findByRole('combobox')
  await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1))
  fireEvent.change(select, { target: { value: id } })
  await screen.findByText('Receive Items')
}

const receiptSummaryOrder = () => screen.getByTestId('receipt-summary-order').textContent
const confirmButton = () => screen.getByRole('button', { name: /Confirm Receipt/ }) as HTMLButtonElement
const cornInput = () => screen.getByLabelText('Receive now (cases) for Cellera Hero Deluxe Cellera Cartridge [ Corn ]') as HTMLInputElement

describe('order reference in lower sections', () => {
  it('shows the selected order under Receive Items and in Receipt Summary, and follows order changes', async () => {
    render(<WarehouseReceiveView2 userProfile={userProfile} />)
    await selectOrder('o93')
    await waitFor(() => expect(screen.getByTestId('receive-items-order').textContent).toBe('Order: ORD26000093'))
    expect(receiptSummaryOrder()).toBe('Order NumberORD26000093')

    await selectOrder('o24')
    await waitFor(() => expect(screen.getByTestId('receive-items-order').textContent).toBe('Order: ORD26000024'))
    expect(receiptSummaryOrder()).toBe('Order NumberORD26000024')
  })
})

describe('Receive Now validation (ordered 100, buffer 1, previous 70)', () => {
  it.each([['30', true], ['31', true], ['32', false], ['40', false]])('Receive %s → valid %s while typing', async (value, valid) => {
    render(<WarehouseReceiveView2 userProfile={userProfile} />)
    await selectOrder('o93')
    fireEvent.change(cornInput(), { target: { value } })

    if (valid) {
      expect(cornInput().getAttribute('aria-invalid')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(confirmButton().disabled).toBe(false)
    } else {
      expect(cornInput().getAttribute('aria-invalid')).toBe('true')
      expect(cornInput().className).toContain('border-red-500')
      expect(screen.getByRole('alert').textContent).toBe('Maximum receivable now is 31 cases (30 ordered balance + 1 remaining buffer).')
      expect(confirmButton().disabled).toBe(true)
      expect(cornInput().value).toBe(value) // not clamped
    }
  })

  it('correcting the value clears the error and re-enables Confirm; totals ignore invalid lines', async () => {
    render(<WarehouseReceiveView2 userProfile={userProfile} />)
    await selectOrder('o93')
    fireEvent.change(cornInput(), { target: { value: '40' } })
    expect(confirmButton().disabled).toBe(true)
    expect(screen.getByText(/Total Receive Now/).textContent).toContain('0 cases • 0 Boxes • 0 pcs')
    expect(screen.getByText(/1 line exceeds the maximum/)).toBeTruthy()

    fireEvent.change(cornInput(), { target: { value: '31' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(confirmButton().disabled).toBe(false)
    expect(screen.getByText(/Total Receive Now/).textContent).toContain('31 cases • 0 Boxes + 31 Cases • 124 pcs')
  })

  it('negative and non-numeric input follow the existing convention (treated as 0, no error)', async () => {
    render(<WarehouseReceiveView2 userProfile={userProfile} />)
    await selectOrder('o93')
    fireEvent.change(cornInput(), { target: { value: '-5' } })
    expect(cornInput().value).toBe('0')
    fireEvent.change(cornInput(), { target: { value: 'abc' } })
    expect(cornInput().value).toBe('0')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('multiple lines', () => {
  it('validates per line and one invalid line blocks Confirm', async () => {
    render(<WarehouseReceiveView2 userProfile={userProfile} />)
    await selectOrder('o24')
    const cv = screen.getByLabelText('Receive now (cases) for Cellera Hero Deluxe Cellera Cartridge [ Corn Vanilla ]')
    const ha = screen.getByLabelText('Receive now (cases) for Cellera Hero Deluxe Cellera Cartridge [ Hazelnut ]')
    fireEvent.change(cv, { target: { value: '306' } }) // max 306
    fireEvent.change(ha, { target: { value: '92' } })  // max 91
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Maximum receivable now is 91 cases (90 ordered balance + 1 remaining buffer).'])
    expect(confirmButton().disabled).toBe(true)
    expect(screen.getByText(/Total Receive Now/).textContent).toContain('306 cases')

    fireEvent.change(ha, { target: { value: '91' } })
    expect(confirmButton().disabled).toBe(false)
    expect(screen.getByText(/Total Receive Now/).textContent).toContain('397 cases')
  })
})
