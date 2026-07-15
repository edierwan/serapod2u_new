/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NotificationTypesTab from './NotificationTypesTab'

const types = [
  ['order', 'order_submitted', 'Order Submitted'],
  ['document', 'document_created', 'Document Created'],
  ['inventory', 'low_stock', 'Low Stock'],
  ['inventory', 'stock_count_posting_verification', 'Stock Count Posting Verification'],
  ['qr', 'qr_scanned', 'QR Scanned'],
  ['user', 'user_created', 'User Created'],
].map(([category, event_code, event_name]) => ({
  id: event_code,
  category,
  event_code,
  event_name,
  event_description: `${event_name} description`,
  default_enabled: true,
  available_channels: event_code === 'stock_count_posting_verification' ? ['email'] : ['whatsapp', 'email', 'sms'],
  is_system: false,
}))

function query(data: any[]) {
  const result: any = {
    select: () => result,
    order: () => result,
    eq: () => result,
    then: (resolve: (value: any) => void) => resolve({ data, error: null }),
  }
  return result
}

const supabase = {
  from: (table: string) => query(
    table === 'notification_types' ? types :
      table === 'notification_provider_configs' ? [
        { channel: 'whatsapp', is_active: true },
        { channel: 'email', is_active: true },
      ] : []
  ),
}

vi.mock('@/lib/hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => ({ supabase, isReady: true }),
}))

vi.mock('./NotificationFlowDrawer', () => ({ default: () => null }))

afterEach(cleanup)

describe('NotificationTypesTab', () => {
  it('shows the four routing presets, provider state, summary, and required categories', async () => {
    render(<NotificationTypesTab userProfile={{
      id: 'user-1',
      organization_id: 'org-1',
      organizations: { id: 'org-1', org_type_code: 'HQ' },
      roles: { role_level: 1 },
    }} />)

    expect(await screen.findByRole('heading', { name: 'Notification Types' })).toBeTruthy()
    expect(screen.getAllByText('WhatsApp Only').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Email Only').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SMS Only').length).toBeGreaterThan(0)
    expect(screen.getAllByText('WhatsApp → Email').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Delivery Summary' })).toBeTruthy()
    for (const category of ['Order Status', 'Order Document', 'Inventory & Stock', 'QR & Consumer', 'User Account']) {
      expect(screen.getByText(category)).toBeTruthy()
    }
    expect(screen.getByText('SMS unavailable')).toBeTruthy()
  })

  it('updates the routing guidance when Email Only is selected', async () => {
    render(<NotificationTypesTab userProfile={{
      id: 'user-1',
      organization_id: 'org-1',
      organizations: { id: 'org-1', org_type_code: 'HQ' },
      roles: { role_level: 1 },
    }} />)

    await screen.findByRole('heading', { name: 'Notification Types' })
    await userEvent.click(screen.getAllByRole('button', { name: /Email Only/ })[0])
    expect(screen.getAllByText('Send all notifications via Email.').length).toBeGreaterThan(1)
  })

  it('shows Stock Count verification under Inventory & Stock as email-only', async () => {
    render(<NotificationTypesTab userProfile={{
      id: 'user-1', organization_id: 'org-1',
      organizations: { id: 'org-1', org_type_code: 'HQ' }, roles: { role_level: 1 },
    }} />)
    await screen.findByRole('heading', { name: 'Notification Types' })
    await userEvent.click(screen.getByText('Inventory & Stock'))
    expect(screen.getByText('Stock Count Posting Verification')).toBeTruthy()
    const routing = screen.getByLabelText('Stock Count Posting Verification routing') as HTMLSelectElement
    expect(routing.value).toBe('email_only')
    expect(routing.disabled).toBe(true)
  })
})
