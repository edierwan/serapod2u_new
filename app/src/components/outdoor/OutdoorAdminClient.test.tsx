// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutdoorDeskData } from '@/lib/outdoor/desk'
import OutdoorAdminClient from './OutdoorAdminClient'

const desk: OutdoorDeskData = {
  subscribers: 12,
  summary: {
    toSend: 3,
    awaitingPayment: 1,
    openRequests: 2,
    messagesThisWeek: null,
    salesThisMonth: { orders: 4, amount: 1234.5 },
  },
  products: [
    {
      id: 'p1',
      name: 'SERAPOD® TUMBLER',
      code: 'TMB',
      imageUrl: '/outdoor/products/tumbler-black.png',
      hasOwnPhoto: false,
      price: 49,
      variantCount: 2,
      stock: 4,
      status: 'live',
    },
    {
      id: 'p2',
      name: 'Camp Chair',
      code: 'CHR',
      imageUrl: 'https://cdn.example.com/chair.png',
      hasOwnPhoto: true,
      price: null,
      variantCount: 1,
      stock: 10,
      status: 'hidden_no_price',
    },
  ],
}

function stubFetch(allowed: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/outdoor/fulfilment/access') return new Response(JSON.stringify({ allowed }))
      if (url === '/api/outdoor/desk') return new Response(JSON.stringify(desk))
      return new Response('{}', { status: 404 })
    }),
  )
}

beforeEach(() => stubFetch(true))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OutdoorAdminClient', () => {
  it('shows today’s work and links each card to the right desk view', async () => {
    render(<OutdoorAdminClient />)
    await screen.findByText('To send out')

    expect(screen.getByText('To send out').closest('a')?.getAttribute('href')).toBe('/outdoor/fulfilment')
    expect(screen.getByText('Awaiting payment').closest('a')?.getAttribute('href')).toBe('/outdoor/fulfilment?status=pending_payment')
    expect(screen.getByText('Open requests').closest('a')?.getAttribute('href')).toBe('/outdoor/fulfilment?tab=requests')
    expect(screen.getByText('RM 1,234.50')).toBeTruthy()
    expect(screen.getByText('4 paid orders')).toBeTruthy()
  })

  it('previews products in the Outdoor shop and edits them in the main admin, never the main store', async () => {
    render(<OutdoorAdminClient />)
    await screen.findByText('SERAPOD® TUMBLER')

    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href') || '')
    expect(hrefs).toContain('/outdoor/shop/p1')
    expect(hrefs).toContain('/supply-chain/products/p1/edit')
    expect(hrefs).toContain('/supply-chain/products/p2/edit')
    expect(hrefs.some((href) => href.startsWith('/store'))).toBe(false)
    // A hidden product has no shop page to preview.
    expect(hrefs).not.toContain('/outdoor/shop/p2')
  })

  it('flags hidden products and standard pictures', async () => {
    render(<OutdoorAdminClient />)
    await screen.findByText('SERAPOD® TUMBLER')
    expect(screen.getByText(/1 product is hidden from the shop/)).toBeTruthy()
    expect(screen.getByText(/1 product shows a standard picture/)).toBeTruthy()
    expect(screen.getByText('Hidden · no price')).toBeTruthy()
  })

  it('does not load the desk for shoppers', async () => {
    stubFetch(false)
    render(<OutdoorAdminClient />)
    await waitFor(() => expect(screen.getByText('This desk is for Outdoor staff.')).toBeTruthy())
    expect((fetch as any).mock.calls.map((call: any[]) => call[0])).not.toContain('/api/outdoor/desk')
  })
})
