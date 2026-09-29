// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OUTDOOR_MESSAGE_EVENTS } from '@/lib/outdoor/customer-messages'
import { OutdoorCustomerMessagesPanel } from './OutdoorCustomerMessagesPanel'

const events = OUTDOOR_MESSAGE_EVENTS.map((info) => ({ ...info, defaults: { email: info.email, sms: info.sms }, updated_at: null }))

function mockFetch(put: (body: any) => { status: number; json: any }, ready = true) {
  const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      calls.push(body)
      const res = put(body)
      return { ok: res.status < 400, status: res.status, json: async () => res.json }
    }
    return { ok: true, status: 200, json: async () => ({ ready, events }) }
  }))
  return calls
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OutdoorCustomerMessagesPanel', () => {
  it('shows each event with its email and SMS switch', async () => {
    mockFetch(() => ({ status: 200, json: {} }))
    render(<OutdoorCustomerMessagesPanel />)
    expect(await screen.findByText('Order shipped')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'SMS for Payment received' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'SMS for Order shipped' }).getAttribute('aria-checked')).toBe('false')
  })

  it('saves a switch for one event', async () => {
    const calls = mockFetch((body) => ({
      status: 200,
      json: { ready: true, events: events.map((e) => (e.event === body.event ? { ...e, email: body.email, sms: body.sms } : e)) },
    }))
    render(<OutdoorCustomerMessagesPanel />)
    fireEvent.click(await screen.findByRole('switch', { name: 'SMS for Order shipped' }))
    await waitFor(() => expect(calls).toEqual([{ event: 'shipped', email: true, sms: true }]))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'SMS for Order shipped' }).getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByText('Changed')).toBeTruthy()
  })

  it('puts the switch back and explains when saving fails', async () => {
    mockFetch(() => ({ status: 503, json: { error: 'Saving is not ready yet.' } }))
    render(<OutdoorCustomerMessagesPanel />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Email for Refunded' }))
    expect(await screen.findByText('Saving is not ready yet.')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Email for Refunded' }).getAttribute('aria-checked')).toBe('true')
  })

  it('locks the switches until the database update is applied', async () => {
    mockFetch(() => ({ status: 200, json: {} }), false)
    render(<OutdoorCustomerMessagesPanel />)
    expect(await screen.findByText(/database update for customer messages/)).toBeTruthy()
    expect((screen.getByRole('switch', { name: 'Email for Order delivered' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
