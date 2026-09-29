import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  order: null as any,
  sent: [] as any[],
  sendResult: { success: true } as any,
  sms: [] as Array<[string, string]>,
}))

vi.mock('@/lib/outdoor/order-sms', () => ({
  notifyOutdoorOrderSms: async (orderId: string, kind: string) => { state.sms.push([orderId, kind]) },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: state.order }) }
      return chain
    },
  }),
}))
vi.mock('@/server/auth/passwordResetService', () => ({ resolveOrgForEmail: async () => 'hq' }))
vi.mock('@/lib/outdoor/auth-return', () => ({ outdoorPublicOrigin: () => 'https://stg.serapod2u.com' }))
vi.mock('@/lib/email/transactional-html-email', () => ({
  sendTransactionalHtmlEmail: async (_admin: any, _org: string, input: any) => {
    state.sent.push(input)
    if (state.sendResult instanceof Error) throw state.sendResult
    return state.sendResult
  },
}))

import { buildOutdoorOrderStatusEmail, notifyOutdoorOrderStatus, outdoorOrderEmailFor } from './order-status-email'

const origin = 'https://stg.serapod2u.com'
const order = {
  order_ref: 'SO-1001',
  customer_name: 'Aina Rahman',
  total_amount: 189,
  currency: 'MYR',
  shipping_courier_name: 'J&T Express',
  shipping_tracking_no: 'JT123',
}

describe('outdoorOrderEmailFor', () => {
  const outdoor = { salesChannel: 'outdoor' }

  it('emails when an Outdoor order ships, arrives, is cancelled or refunded', () => {
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'processing', toStatus: 'shipped' })).toBe('shipped')
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'shipped', toStatus: 'delivered' })).toBe('delivered')
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'pending_payment', toStatus: 'cancelled' })).toBe('cancelled')
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'paid', toStatus: 'refunded', moneyReturned: true })).toBe('refunded')
  })

  it('never emails for classic /store orders', () => {
    expect(outdoorOrderEmailFor({ salesChannel: 'store', fromStatus: 'paid', toStatus: 'shipped' })).toBeNull()
    expect(outdoorOrderEmailFor({ salesChannel: null, fromStatus: 'shipped', toStatus: 'delivered' })).toBeNull()
  })

  it('stays quiet when the status did not really change', () => {
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'delivered', toStatus: 'delivered' })).toBeNull()
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'cancelled', toStatus: 'cancelled' })).toBeNull()
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'shipped', toStatus: 'shipped', fromTracking: 'JT1', toTracking: 'JT1' })).toBeNull()
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'paid', toStatus: 'processing' })).toBeNull()
  })

  it('sends the new tracking number when it changes on a shipped order', () => {
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'shipped', toStatus: 'shipped', fromTracking: null, toTracking: 'JT9' })).toBe('tracking_updated')
  })

  it('does not claim a refund when no money was returned', () => {
    expect(outdoorOrderEmailFor({ ...outdoor, fromStatus: 'pending_payment', toStatus: 'refunded' })).toBeNull()
  })
})

describe('buildOutdoorOrderStatusEmail', () => {
  it('gives the courier, tracking number and tracking link when shipped', () => {
    const email = buildOutdoorOrderStatusEmail('shipped', order, origin)
    expect(email.subject).toBe('Order SO-1001 is on its way')
    expect(email.text).toContain('Hi Aina,')
    expect(email.text).toContain('with J&T Express')
    expect(email.text).toContain('Tracking number: JT123')
    expect(email.text).toContain('https://stg.serapod2u.com/outdoor/track?order=SO-1001')
    expect(email.html).toContain('J&amp;T Express')
  })

  it('says our own team delivers, without a tracking number', () => {
    const email = buildOutdoorOrderStatusEmail('shipped', { ...order, shipping_courier_name: 'Serapod delivery team', shipping_tracking_no: null }, origin)
    expect(email.text).toContain('Our own delivery team is bringing it to you.')
    expect(email.text).not.toContain('Tracking number')
  })

  it('points to Report a problem once delivered', () => {
    expect(buildOutdoorOrderStatusEmail('delivered', order, origin).text).toContain('Report a problem')
  })

  it('tells an unpaid customer they were not charged', () => {
    const auto = buildOutdoorOrderStatusEmail('auto_cancelled', order, origin)
    expect(auto.text).toContain('not completed within 24 hours')
    expect(auto.text).toContain('You have not been charged.')
    expect(auto.text).toContain('/outdoor/shop')
    expect(buildOutdoorOrderStatusEmail('cancelled', order, origin).text).toContain('You have not been charged.')
  })

  it('names the refunded amount when money went back', () => {
    const cancelled = buildOutdoorOrderStatusEmail('cancelled', order, origin, { moneyReturned: true })
    expect(cancelled.text).toContain('We have refunded RM')
    expect(cancelled.text).toContain('189.00')
    expect(cancelled.text).not.toContain('not been charged')
    expect(buildOutdoorOrderStatusEmail('refunded', order, origin).subject).toBe('Refund for order SO-1001')
  })

  it('escapes customer text in the HTML', () => {
    const email = buildOutdoorOrderStatusEmail('delivered', { ...order, customer_name: '<b>Eve</b>' }, origin)
    expect(email.html).not.toContain('<b>Eve</b>')
  })
})

describe('notifyOutdoorOrderStatus', () => {
  beforeEach(() => {
    state.order = { ...order, sales_channel: 'outdoor', customer_email: 'aina@example.com' }
    state.sent = []
    state.sms = []
    state.sendResult = { success: true }
  })

  it('also texts the customer when the order is delivered, even without an email address', async () => {
    await notifyOutdoorOrderStatus('o1', 'delivered')
    state.order = { ...state.order, customer_email: null }
    await notifyOutdoorOrderStatus('o2', 'delivered')
    expect(state.sms).toEqual([['o1', 'delivered'], ['o2', 'delivered']])
    expect(state.sent).toHaveLength(1)
  })

  it('sends no SMS for the other order emails', async () => {
    for (const kind of ['shipped', 'tracking_updated', 'auto_cancelled', 'cancelled', 'refunded'] as const) {
      await notifyOutdoorOrderStatus('o1', kind)
    }
    await notifyOutdoorOrderStatus('o1', null)
    expect(state.sms).toEqual([])
    expect(state.sent).toHaveLength(5)
  })

  it('sends from SeraOutdoor to the checkout email', async () => {
    await notifyOutdoorOrderStatus('o1', 'delivered')
    expect(state.sent).toHaveLength(1)
    expect(state.sent[0]).toMatchObject({ to: 'aina@example.com', fromName: 'SeraOutdoor', fromEmail: 'outdoor@serapod.com' })
  })

  it('sends nothing without a kind, for /store orders, or without an email', async () => {
    await notifyOutdoorOrderStatus('o1', null)
    state.order = { ...state.order, sales_channel: 'store' }
    await notifyOutdoorOrderStatus('o1', 'shipped')
    state.order = { ...state.order, sales_channel: 'outdoor', customer_email: null }
    await notifyOutdoorOrderStatus('o1', 'shipped')
    expect(state.sent).toHaveLength(0)
  })

  it('never throws when the email provider fails', async () => {
    state.sendResult = new Error('SMTP down')
    await expect(notifyOutdoorOrderStatus('o1', 'shipped')).resolves.toBeUndefined()
    state.sendResult = { success: false, error: 'rejected' }
    await expect(notifyOutdoorOrderStatus('o1', 'shipped')).resolves.toBeUndefined()
  })
})
