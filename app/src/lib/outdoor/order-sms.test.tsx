import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  order: null as any,
  smsOrg: 'hq' as string | null,
  sent: [] as Array<{ orgId: string; to: string; text: string }>,
  logged: [] as any[],
  sendResult: { success: true, messageId: 'm1' } as any,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: state.order }) }
      return chain
    },
  }),
}))
vi.mock('@/server/auth/passwordResetService', () => ({ resolveOrgForSms: async () => state.smsOrg }))
vi.mock('@/lib/outdoor/auth-return', () => ({ outdoorPublicOrigin: () => 'https://stg.serapod2u.com' }))
vi.mock('@/lib/notifications/sms-send', () => ({
  sendSmsWithActiveProvider: async (_admin: any, orgId: string, to: string, text: string) => {
    state.sent.push({ orgId, to, text })
    if (state.sendResult instanceof Error) throw state.sendResult
    return state.sendResult
  },
  recordSmsDelivery: async (_admin: any, input: any) => { state.logged.push(input) },
}))

import { buildOutdoorOrderSms, notifyOutdoorOrderSms, outdoorSmsPhone } from './order-sms'

describe('outdoorSmsPhone', () => {
  it('accepts Malaysian mobiles in any common format', () => {
    expect(outdoorSmsPhone('012-345 6789')).toBe('+60123456789')
    expect(outdoorSmsPhone('0112345 6789')).toBe('+601123456789')
    expect(outdoorSmsPhone('+60 12-345 6789')).toBe('+60123456789')
    expect(outdoorSmsPhone('60123456789')).toBe('+60123456789')
  })

  it('refuses landlines, foreign and broken numbers', () => {
    expect(outdoorSmsPhone('03-1234 5678')).toBeNull()
    expect(outdoorSmsPhone('04-123 4567')).toBeNull()
    expect(outdoorSmsPhone('+6591234567')).toBeNull()
    expect(outdoorSmsPhone('012345')).toBeNull()
    expect(outdoorSmsPhone('0123456789012')).toBeNull()
    expect(outdoorSmsPhone('abc')).toBeNull()
    expect(outdoorSmsPhone('')).toBeNull()
    expect(outdoorSmsPhone(null)).toBeNull()
  })
})

describe('buildOutdoorOrderSms', () => {
  const ref = 'ORD-MFX3K2AB-XY12'
  const origin = 'https://stg.serapod2u.com'

  it('fits each message in a single plain-text SMS', () => {
    for (const kind of ['paid', 'delivered'] as const) {
      const text = buildOutdoorOrderSms(kind, ref, origin)
      expect(text.length).toBeLessThanOrEqual(160)
      expect(/^[\x20-\x7E]+$/.test(text)).toBe(true)
    }
  })

  it('confirms the payment with a tracking link', () => {
    const text = buildOutdoorOrderSms('paid', ref, origin)
    expect(text).toContain('Payment received for order ORD-MFX3K2AB-XY12')
    expect(text).toContain('https://stg.serapod2u.com/outdoor/track?order=ORD-MFX3K2AB-XY12')
  })

  it('says the order arrived and where to report a problem', () => {
    const text = buildOutdoorOrderSms('delivered', ref, origin)
    expect(text).toContain('Order ORD-MFX3K2AB-XY12 has been delivered')
    expect(text).toContain('https://stg.serapod2u.com/outdoor/account')
  })
})

describe('notifyOutdoorOrderSms', () => {
  beforeEach(() => {
    state.order = { order_ref: 'ORD-1', sales_channel: 'outdoor', customer_phone: '012-345 6789' }
    state.smsOrg = 'hq'
    state.sent = []
    state.logged = []
    state.sendResult = { success: true, messageId: 'm1' }
  })

  it('texts the checkout mobile and logs it in SMS activity', async () => {
    await notifyOutdoorOrderSms('o1', 'paid')
    expect(state.sent).toEqual([{ orgId: 'hq', to: '+60123456789', text: expect.stringContaining('ORD-1') }])
    expect(state.logged).toEqual([{ orgId: 'hq', to: '+60123456789', eventCode: 'outdoor_order_paid', result: state.sendResult }])
  })

  it('uses its own event code for deliveries', async () => {
    await notifyOutdoorOrderSms('o1', 'delivered')
    expect(state.logged[0].eventCode).toBe('outdoor_order_delivered')
  })

  it('sends nothing for /store orders, landlines, missing orders or without an SMS provider', async () => {
    state.order = { ...state.order, sales_channel: 'store' }
    await notifyOutdoorOrderSms('o1', 'paid')
    state.order = { ...state.order, sales_channel: 'outdoor', customer_phone: '03-1234 5678' }
    await notifyOutdoorOrderSms('o1', 'paid')
    state.order = null
    await notifyOutdoorOrderSms('o1', 'paid')
    state.order = { order_ref: 'ORD-1', sales_channel: 'outdoor', customer_phone: '0123456789' }
    state.smsOrg = null
    await notifyOutdoorOrderSms('o1', 'paid')
    expect(state.sent).toEqual([])
    expect(state.logged).toEqual([])
  })

  it('logs a failed SMS and never throws', async () => {
    state.sendResult = { success: false, error: 'gateway down' }
    await expect(notifyOutdoorOrderSms('o1', 'delivered')).resolves.toBeUndefined()
    expect(state.logged[0].result).toEqual({ success: false, error: 'gateway down' })
    state.sendResult = new Error('network')
    await expect(notifyOutdoorOrderSms('o1', 'delivered')).resolves.toBeUndefined()
  })
})
