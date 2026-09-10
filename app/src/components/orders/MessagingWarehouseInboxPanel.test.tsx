// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessagingWarehouseInboxPanel } from './MessagingWarehouseInboxPanel'

// Where the messaging fulfilment migrations are not installed the API now
// answers 200 with an empty inbox instead of a 500, so the Orders page shows
// nothing at all rather than a red "Unable to load warehouse inbox." banner.
// A real failure must still be visible.

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  })) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MessagingWarehouseInboxPanel', () => {
  it('renders nothing when messaging is unavailable in this environment', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        items: [],
        actor: { orgType: 'HQ', organizationId: 'hq-1' },
        messagingAvailable: false,
      },
    })

    const { container } = render(<MessagingWarehouseInboxPanel />)

    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(screen.queryByText(/Unable to load warehouse inbox/i)).toBeNull()
    expect(screen.queryByText(/Warehouse incoming/i)).toBeNull()
    // No "messaging unavailable" notice is shown to ordinary users either.
    expect(screen.queryByText(/unavailable/i)).toBeNull()
  })

  it('renders nothing when messaging is installed but the queue is empty', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        items: [],
        actor: { orgType: 'HQ', organizationId: 'hq-1' },
        messagingAvailable: true,
      },
    })

    const { container } = render(<MessagingWarehouseInboxPanel />)

    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('renders the queue when the inbox has rows', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        items: [
          {
            id: 'inbox-1',
            order_id: 'order-1',
            order_no: 'ORD-DH-0926-11',
            source_channel: 'telegram',
            status: 'pending_preparation',
            created_at: '2026-09-07T00:00:00.000Z',
          },
        ],
        actor: { orgType: 'HQ', organizationId: 'hq-1' },
        messagingAvailable: true,
      },
    })

    render(<MessagingWarehouseInboxPanel />)

    expect(await screen.findByText(/Warehouse incoming/i)).toBeTruthy()
    expect(screen.getByText(/ORD-DH-0926-11/)).toBeTruthy()
  })

  it('still surfaces a genuine server failure', async () => {
    mockFetch({
      ok: false,
      status: 500,
      body: { error: 'Unable to load warehouse inbox.' },
    })

    render(<MessagingWarehouseInboxPanel />)

    expect(await screen.findByText('Unable to load warehouse inbox.')).toBeTruthy()
  })

  it('stays hidden for an organization the inbox is not offered to', async () => {
    mockFetch({
      ok: false,
      status: 403,
      body: { error: 'Warehouse inbox is available to HQ and warehouse users only.' },
    })

    const { container } = render(<MessagingWarehouseInboxPanel />)

    await waitFor(() => expect(container.innerHTML).toBe(''))
  })
})
