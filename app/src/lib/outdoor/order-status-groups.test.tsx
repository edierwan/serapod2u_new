import { describe, expect, it } from 'vitest'
import { defaultOrderGroup, groupOfStatus, orderInGroup, orderStatusLabel } from '@/lib/outdoor/order-status-groups'

describe('outdoor order status groups', () => {
  it('puts every order status in one group', () => {
    expect(groupOfStatus('pending_payment')).toBe('to_pay')
    expect(groupOfStatus('paid')).toBe('to_ship')
    expect(groupOfStatus('processing')).toBe('to_ship')
    expect(groupOfStatus('shipped')).toBe('shipped')
    expect(groupOfStatus('delivered')).toBe('delivered')
    expect(groupOfStatus('cancelled')).toBe('closed')
    expect(groupOfStatus('payment_failed')).toBe('closed')
    expect(groupOfStatus('refunded')).toBe('closed')
  })

  it('shows everything under All', () => {
    expect(orderInGroup('pending_payment', 'all')).toBe(true)
    expect(orderInGroup('delivered', 'all')).toBe(true)
    expect(orderInGroup('delivered', 'to_pay')).toBe(false)
  })

  it('opens on orders on their way before unpaid ones', () => {
    expect(defaultOrderGroup(['pending_payment', 'pending_payment', 'shipped'])).toBe('shipped')
    expect(defaultOrderGroup(['pending_payment', 'paid'])).toBe('to_ship')
    expect(defaultOrderGroup(['pending_payment'])).toBe('to_pay')
    expect(defaultOrderGroup(['delivered', 'cancelled'])).toBe('all')
  })

  it('uses plain words for statuses', () => {
    expect(orderStatusLabel('pending_payment')).toBe('waiting for payment')
    expect(orderStatusLabel('payment_failed')).toBe('payment failed')
    expect(orderStatusLabel('shipped')).toBe('shipped')
  })
})
