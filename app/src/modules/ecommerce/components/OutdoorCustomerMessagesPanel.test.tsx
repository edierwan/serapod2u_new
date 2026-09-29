// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OUTDOOR_MESSAGE_EVENTS } from '@/lib/outdoor/customer-messages'
import { OutdoorCustomerMessagesPanel } from './OutdoorCustomerMessagesPanel'

vi.mock('@/lib/outdoor/auth-return', () => ({ outdoorPublicOrigin: () => 'https://stg.serapod2u.com' }))

const events = OUTDOOR_MESSAGE_EVENTS.map((info) => ({
  event: info.event,
  label: info.label,
  when: info.when,
  email: info.email,
  sms: info.sms,
  smsTemplate: null as string | null,
  defaults: { email: info.email, sms: info.sms, smsTemplate: info.smsTemplate },
  updated_at: null,
}))

function mockFetch(put: (body: any) => { status: number; json: any }, list: { ready?: boolean; templatesReady?: boolean } = {}) {
  const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      calls.push(body)
      const res = put(body)
      return { ok: res.status < 400, status: res.status, json: async () => res.json }
    }
    return { ok: true, status: 200, json: async () => ({ ready: list.ready ?? true, templatesReady: list.templatesReady ?? true, events }) }
  }))
  return calls
}

const echo = (body: any) => ({
  status: 200,
  json: {
    ready: true,
    templatesReady: true,
    events: events.map((e) => (e.event === body.event
      ? { ...e, email: body.email, sms: body.sms, smsTemplate: 'smsTemplate' in body ? body.smsTemplate || null : e.smsTemplate }
      : e)),
  },
})

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

  it('saves a switch for one event without touching its SMS text', async () => {
    const calls = mockFetch(echo)
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
    mockFetch(() => ({ status: 200, json: {} }), { ready: false, templatesReady: false })
    render(<OutdoorCustomerMessagesPanel />)
    expect(await screen.findByText(/database update for customer messages/)).toBeTruthy()
    expect((screen.getByRole('switch', { name: 'Email for Order delivered' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('edits the SMS text with a live preview and saves it', async () => {
    const calls = mockFetch(echo)
    render(<OutdoorCustomerMessagesPanel />)
    fireEvent.click((await screen.findAllByText('Edit SMS text'))[3])
    const box = screen.getByLabelText('SMS text for Order delivered') as HTMLTextAreaElement
    expect(box.value).toBe(events[3].defaults.smsTemplate)
    expect(screen.getByTestId('sms-preview').textContent).toContain('Order ORD-MUM5I5DE-OAZ2 has been delivered')

    fireEvent.change(box, { target: { value: 'Hi {{first_name}}, order {{order_no}} arrived.' } })
    expect(screen.getByTestId('sms-preview').textContent).toBe('Hi Aina, order ORD-MUM5I5DE-OAZ2 arrived.')
    expect(screen.getByText(/1 SMS/)).toBeTruthy()

    fireEvent.click(screen.getByText('Save SMS text'))
    await waitFor(() => expect(calls).toEqual([{ event: 'delivered', email: true, sms: true, smsTemplate: 'Hi {{first_name}}, order {{order_no}} arrived.' }]))
    await waitFor(() => expect(screen.queryByLabelText('SMS text for Order delivered')).toBeNull())
    expect(screen.getByText('Custom SMS text')).toBeTruthy()
  })

  it('will not save an unknown placeholder, and can go back to the default text', async () => {
    const calls = mockFetch(echo)
    render(<OutdoorCustomerMessagesPanel />)
    fireEvent.click((await screen.findAllByText('Edit SMS text'))[0])
    const box = screen.getByLabelText('SMS text for Payment received') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Hi {{name}}' } })
    expect(screen.getByText(/Unknown placeholder/)).toBeTruthy()
    expect((screen.getByText('Save SMS text') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('Use default text'))
    expect(box.value).toBe(events[0].defaults.smsTemplate)
    expect(calls).toEqual([])
  })

  it('keeps the SMS text read-only until its database update is applied', async () => {
    mockFetch(echo, { ready: true, templatesReady: false })
    render(<OutdoorCustomerMessagesPanel />)
    expect(await screen.findByText(/database update for customer SMS texts/)).toBeTruthy()
    fireEvent.click(screen.getAllByText('Edit SMS text')[0])
    expect((screen.getByLabelText('SMS text for Payment received') as HTMLTextAreaElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: 'Email for Payment received' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
