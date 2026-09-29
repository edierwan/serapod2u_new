import { describe, expect, it } from 'vitest'
import {
  defaultOutdoorMessageChannels,
  isOutdoorMessageEvent,
  listOutdoorMessageSettings,
  outdoorMessageChannels,
} from './customer-messages'

function fakeAdmin(result: { data?: any; error?: any } | Error) {
  return {
    from: () => {
      const run = async () => {
        if (result instanceof Error) throw result
        return { data: result.data ?? null, error: result.error ?? null }
      }
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: run, then: (ok: any, fail: any) => run().then(ok, fail) }
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

describe('outdoorMessageChannels', () => {
  it('uses what staff saved', async () => {
    const admin = fakeAdmin({ data: { email_enabled: false, sms_enabled: true } })
    expect(await outdoorMessageChannels(admin, 'shipped')).toEqual({ email: false, sms: true })
  })

  it('falls back to the default without a row, on an error or a broken read', async () => {
    expect(await outdoorMessageChannels(fakeAdmin({ data: null }), 'paid')).toEqual({ email: true, sms: true })
    expect(await outdoorMessageChannels(fakeAdmin({ error: { code: 'PGRST205' } }), 'shipped')).toEqual({ email: true, sms: false })
    expect(await outdoorMessageChannels(fakeAdmin(new Error('network')), 'delivered')).toEqual({ email: true, sms: true })
    expect(await outdoorMessageChannels(fakeAdmin({ data: { email_enabled: 'no' } }), 'refunded')).toEqual({ email: true, sms: false })
  })
})

describe('listOutdoorMessageSettings', () => {
  it('lists every event, saved choices over defaults', async () => {
    const list = await listOutdoorMessageSettings(fakeAdmin({ data: [{ event_code: 'shipped', email_enabled: false, sms_enabled: true, updated_at: 't' }] }))
    expect(list.ready).toBe(true)
    expect(list.events.map((e) => e.event)).toEqual(['paid', 'shipped', 'tracking_updated', 'delivered', 'auto_cancelled', 'cancelled', 'refunded'])
    expect(list.events[1]).toMatchObject({ email: false, sms: true, defaults: { email: true, sms: false }, updated_at: 't' })
    expect(list.events[0]).toMatchObject({ email: true, sms: true, updated_at: null })
  })

  it('shows the defaults as not ready while the table is missing', async () => {
    const list = await listOutdoorMessageSettings(fakeAdmin({ error: { code: '42P01' } }))
    expect(list.ready).toBe(false)
    expect(list.events[3]).toMatchObject({ event: 'delivered', email: true, sms: true })
  })

  it('reports any other database error', async () => {
    await expect(listOutdoorMessageSettings(fakeAdmin({ error: { code: '500' } }))).rejects.toEqual({ code: '500' })
  })
})
