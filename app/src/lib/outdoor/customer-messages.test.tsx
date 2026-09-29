import { describe, expect, it } from 'vitest'
import {
  defaultOutdoorMessageChannels,
  defaultOutdoorSmsTemplate,
  isOutdoorMessageEvent,
  listOutdoorMessageSettings,
  outdoorMessageChannels,
  outdoorMessageSettings,
  outdoorSmsParts,
  outdoorSmsSampleValues,
  outdoorSmsTemplateProblem,
  renderOutdoorSms,
} from './customer-messages'

type Result = { data?: any; error?: any } | Error

function fakeAdmin(result: Result, probe: Result = { data: [] }) {
  return {
    from: () => {
      const run = (r: Result) => async () => {
        if (r instanceof Error) throw r
        return { data: r.data ?? null, error: r.error ?? null }
      }
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: run(result),
        limit: () => ({ then: (ok: any, fail: any) => run(probe)().then(ok, fail) }),
        then: (ok: any, fail: any) => run(result)().then(ok, fail),
      }
      return chain
    },
  }
}

describe('defaultOutdoorMessageChannels', () => {
  it('matches what customers got before the settings existed', () => {
    expect(defaultOutdoorMessageChannels('paid')).toEqual({ email: true, sms: true })
    expect(defaultOutdoorMessageChannels('delivered')).toEqual({ email: true, sms: true })
    for (const event of ['shipped', 'tracking_updated', 'auto_cancelled', 'cancelled', 'refunded'] as const) {
      expect(defaultOutdoorMessageChannels(event)).toEqual({ email: true, sms: false })
    }
  })

  it('only knows the listed events', () => {
    expect(isOutdoorMessageEvent('shipped')).toBe(true)
    expect(isOutdoorMessageEvent('processing')).toBe(false)
    expect(isOutdoorMessageEvent(undefined)).toBe(false)
  })
})

describe('outdoorMessageSettings', () => {
  it('uses what staff saved', async () => {
    const admin = fakeAdmin({ data: { email_enabled: false, sms_enabled: true, sms_template: ' Hi {{first_name}} ' } })
    expect(await outdoorMessageSettings(admin, 'shipped')).toEqual({ email: false, sms: true, smsTemplate: 'Hi {{first_name}}' })
    expect(await outdoorMessageChannels(admin, 'shipped')).toEqual({ email: false, sms: true })
  })

  it('falls back to the defaults without a row, on an error or a broken read', async () => {
    expect(await outdoorMessageChannels(fakeAdmin({ data: null }), 'paid')).toEqual({ email: true, sms: true })
    expect(await outdoorMessageChannels(fakeAdmin({ error: { code: 'PGRST205' } }), 'shipped')).toEqual({ email: true, sms: false })
    expect(await outdoorMessageChannels(fakeAdmin(new Error('network')), 'delivered')).toEqual({ email: true, sms: true })
    expect(await outdoorMessageSettings(fakeAdmin({ data: { email_enabled: 'no', sms_template: '   ' } }), 'refunded')).toEqual({ email: true, sms: false, smsTemplate: null })
  })

  it('keeps the saved switches while the SMS text column does not exist yet', async () => {
    const admin = fakeAdmin({ data: { event_code: 'paid', email_enabled: false, sms_enabled: false } })
    expect(await outdoorMessageSettings(admin, 'paid')).toEqual({ email: false, sms: false, smsTemplate: null })
  })
})

describe('renderOutdoorSms', () => {
  const values = outdoorSmsSampleValues('https://stg.serapod2u.com')

  it('fills every placeholder', () => {
    expect(renderOutdoorSms('Hi {{first_name}}, {{ order_no }} {{amount}}', values)).toBe('Hi Aina, ORD-MUM5I5DE-OAZ2 RM 189.00')
  })

  it('leaves out unknown or empty values instead of showing braces', () => {
    expect(renderOutdoorSms('Order {{order_no}} {{nope}} {{tracking_no}} done', { order_no: 'A1', tracking_no: '' })).toBe('Order A1 done')
  })

  it('gives the built-in text for every event', () => {
    expect(renderOutdoorSms(defaultOutdoorSmsTemplate('delivered'), values)).toBe(
      '[SeraOutdoor] Order ORD-MUM5I5DE-OAZ2 has been delivered. Enjoy! Any problem? Report it from your order: https://stg.serapod2u.com/outdoor/account',
    )
  })
})

describe('outdoorSmsTemplateProblem', () => {
  it('accepts the built-in texts and the listed placeholders', () => {
    for (const event of ['paid', 'shipped', 'tracking_updated', 'delivered', 'auto_cancelled', 'cancelled', 'refunded'] as const) {
      expect(outdoorSmsTemplateProblem(defaultOutdoorSmsTemplate(event))).toBeNull()
    }
    expect(outdoorSmsTemplateProblem('Hi {{first_name}}, {{courier}} {{tracking_no}} {{shop_url}}')).toBeNull()
  })

  it('refuses unknown or unclosed placeholders and very long texts', () => {
    expect(outdoorSmsTemplateProblem('Hi {{name}}')).toContain('{{name}}')
    expect(outdoorSmsTemplateProblem('Hi {{order_no}')).toContain('not closed')
    expect(outdoorSmsTemplateProblem('x'.repeat(481))).toContain('480')
  })
})

describe('outdoorSmsParts', () => {
  it('counts plain and non-Latin SMS the way the gateway splits them', () => {
    expect(outdoorSmsParts('')).toEqual({ plain: true, parts: 0 })
    expect(outdoorSmsParts('a'.repeat(160))).toEqual({ plain: true, parts: 1 })
    expect(outdoorSmsParts('a'.repeat(161))).toEqual({ plain: true, parts: 2 })
    expect(outdoorSmsParts('مرحبا'.repeat(14))).toEqual({ plain: false, parts: 1 })
    expect(outdoorSmsParts('مرحبا'.repeat(15))).toEqual({ plain: false, parts: 2 })
  })
})

describe('listOutdoorMessageSettings', () => {
  it('lists every event, saved choices over defaults', async () => {
    const list = await listOutdoorMessageSettings(fakeAdmin({ data: [{ event_code: 'shipped', email_enabled: false, sms_enabled: true, sms_template: 'Hi', updated_at: 't' }] }))
    expect(list).toMatchObject({ ready: true, templatesReady: true })
    expect(list.events.map((e) => e.event)).toEqual(['paid', 'shipped', 'tracking_updated', 'delivered', 'auto_cancelled', 'cancelled', 'refunded'])
    expect(list.events[1]).toMatchObject({ email: false, sms: true, smsTemplate: 'Hi', defaults: { email: true, sms: false }, updated_at: 't' })
    expect(list.events[0]).toMatchObject({ email: true, sms: true, smsTemplate: null, updated_at: null })
    expect(list.events[0].defaults.smsTemplate).toBe(defaultOutdoorSmsTemplate('paid'))
  })

  it('shows the defaults as not ready while the table is missing', async () => {
    const list = await listOutdoorMessageSettings(fakeAdmin({ error: { code: '42P01' } }))
    expect(list).toMatchObject({ ready: false, templatesReady: false })
    expect(list.events[3]).toMatchObject({ event: 'delivered', email: true, sms: true })
  })

  it('keeps the switches usable while only the SMS text column is missing', async () => {
    const list = await listOutdoorMessageSettings(fakeAdmin({ data: [] }, { error: { code: '42703' } }))
    expect(list).toMatchObject({ ready: true, templatesReady: false })
  })

  it('reports any other database error', async () => {
    await expect(listOutdoorMessageSettings(fakeAdmin({ error: { code: '500' } }))).rejects.toEqual({ code: '500' })
  })
})
