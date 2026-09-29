import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  order: null as any,
  settings: null as any,
  settingsError: null as any,
  smsOrg: 'hq' as string | null,
  sent: [] as Array<{ orgId: string; to: string; text: string }>,
  logged: [] as any[],
  sendResult: { success: true, messageId: 'm1' } as any,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = () => (table === 'outdoor_customer_message_settings'
        ? { data: state.settingsError ? null : state.settings, error: state.settingsError }
        : { data: state.order })
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => result() }
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
    const kinds = ['paid', 'shipped', 'tracking_updated', 'delivered', 'auto_cancelled', 'cancelled', 'refunded'] as const
    for (const kind of kinds) {
      for (const moneyReturned of [false, true]) {
        const text = buildOutdoorOrderSms(kind, ref, 'https://www.serapod2u.com', { moneyReturned })
        expect(text.length).toBeLessThanOrEqual(160)
        expect(/^[\x20-\x7E]+$/.test(text)).toBe(true)
        expect(text).toContain(ref)
      }
    }
  })

  it('keeps the exact texts customers received before', () => {
    expect(buildOutdoorOrderSms('paid', ref, origin)).toBe(`[SeraOutdoor] Payment received for order ${ref}. Thank you! Track it here: ${origin}/outdoor/track?order=${ref}`)
    expect(buildOutdoorOrderSms('delivered', ref, origin)).toBe(`[SeraOutdoor] Order ${ref} has been delivered. Enjoy! Any problem? Report it from your order: ${origin}/outdoor/account`)
    expect(buildOutdoorOrderSms('cancelled', ref, origin)).toBe(`[SeraOutdoor] Order ${ref} has been cancelled. You have not been charged. Questions? ${origin}/outdoor/contact`)
  })

  it('tells a cancelled customer whether money is coming back', () => {
    expect(buildOutdoorOrderSms('cancelled', ref, origin)).toContain('You have not been charged.')
    expect(buildOutdoorOrderSms('cancelled', ref, origin, { moneyReturned: true })).toContain('Your refund is on its way.')
    expect(buildOutdoorOrderSms('auto_cancelled', ref, origin)).toContain('within 24 hours')
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
    state.settings = null
    state.settingsError = null
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

  it('only texts payment and delivery while nobody has changed the settings', async () => {
    for (const kind of ['shipped', 'tracking_updated', 'auto_cancelled', 'cancelled', 'refunded'] as const) {
      await notifyOutdoorOrderSms('o1', kind)
    }
    expect(state.sent).toEqual([])
    await notifyOutdoorOrderSms('o1', 'paid')
    await notifyOutdoorOrderSms('o1', 'delivered')
    expect(state.sent).toHaveLength(2)
  })

  it('follows the staff switch for each event', async () => {
    state.settings = { email_enabled: true, sms_enabled: true }
    await notifyOutdoorOrderSms('o1', 'shipped')
    expect(state.logged[0].eventCode).toBe('outdoor_order_shipped')
    state.settings = { email_enabled: true, sms_enabled: false }
    await notifyOutdoorOrderSms('o1', 'paid')
    expect(state.sent).toHaveLength(1)
  })

  it('sends the wording staff saved, filled with the order details', async () => {
    state.order = { ...state.order, customer_name: 'Aina Rahman', total_amount: 189, currency: 'MYR', shipping_courier_name: 'J&T Express', shipping_tracking_no: 'JT9' }
    state.settings = { email_enabled: true, sms_enabled: true, sms_template: 'Hi {{first_name}}, {{order_no}} ({{amount}}) is with {{courier}}: {{tracking_no}}' }
    await notifyOutdoorOrderSms('o1', 'shipped')
    expect(state.sent[0].text).toBe('Hi Aina, ORD-1 (RM 189.00) is with J&T Express: JT9')
  })

  it('falls back to the built-in text when the saved wording is empty', async () => {
    state.settings = { email_enabled: true, sms_enabled: true, sms_template: '   ' }
    await notifyOutdoorOrderSms('o1', 'delivered')
    state.settings = { email_enabled: true, sms_enabled: true, sms_template: '{{nope}}' }
    await notifyOutdoorOrderSms('o1', 'delivered')
    expect(state.sent.map((s) => s.text)).toEqual([
      buildOutdoorOrderSms('delivered', 'ORD-1', 'https://stg.serapod2u.com'),
      buildOutdoorOrderSms('delivered', 'ORD-1', 'https://stg.serapod2u.com'),
    ])
  })

  it('keeps the default when the settings cannot be read', async () => {
    state.settingsError = { code: 'PGRST205', message: 'missing table' }
    await notifyOutdoorOrderSms('o1', 'paid')
    await notifyOutdoorOrderSms('o1', 'shipped')
    expect(state.sent).toHaveLength(1)
  })

  it('logs a failed SMS and never throws', async () => {
    state.sendResult = { success: false, error: 'gateway down' }
    await expect(notifyOutdoorOrderSms('o1', 'delivered')).resolves.toBeUndefined()
    expect(state.logged[0].result).toEqual({ success: false, error: 'gateway down' })
    state.sendResult = new Error('network')
    await expect(notifyOutdoorOrderSms('o1', 'delivered')).resolves.toBeUndefined()
  })
})
