import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as any,
  allowed: true,
  upserts: [] as any[],
  upsertError: null as any,
  rows: [] as any[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
}))
vi.mock('@/lib/security-access/operation', () => ({ userAllowed: async () => state.allowed }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        const chain: any = { select: () => chain, eq: () => chain, single: async () => ({ data: { id: 'u1', organization_id: 'hq', organizations: { org_type_code: 'HQ' }, roles: { role_level: 10 } } }) }
        return chain
      }
      const listed = { data: state.rows, error: null }
      return {
        select: () => ({
          then: (ok: any) => Promise.resolve(listed).then(ok),
          limit: async () => ({ data: [], error: null }),
        }),
        upsert: async (row: any, options: any) => {
          state.upserts.push([row, options])
          if (!state.upsertError) state.rows = [row]
          return { error: state.upsertError }
        },
      }
    },
  }),
}))

import { GET, PUT } from './route'
import { defaultOutdoorSmsTemplate } from '@/lib/outdoor/customer-messages'

const put = (body: unknown) => PUT(new Request('http://x/api/admin/store/customer-messages', { method: 'PUT', body: JSON.stringify(body) }) as any)

describe('/api/admin/store/customer-messages', () => {
  beforeEach(() => {
    state.user = { id: 'u1' }
    state.allowed = true
    state.upserts = []
    state.upsertError = null
    state.rows = []
  })

  it('refuses anyone who cannot manage store orders', async () => {
    state.allowed = false
    expect((await GET()).status).toBe(401)
    expect((await put({ event: 'shipped', email: true, sms: true })).status).toBe(401)
    state.user = null
    expect((await GET()).status).toBe(401)
    expect(state.upserts).toEqual([])
  })

  it('lists every event with its channels', async () => {
    const data = await (await GET()).json()
    expect(data.ready).toBe(true)
    expect(data.events).toHaveLength(8)
  })

  it('saves one event and returns the new list', async () => {
    const res = await put({ event: 'shipped', email: false, sms: true })
    expect(res.status).toBe(200)
    expect(state.upserts[0][0]).toMatchObject({ event_code: 'shipped', email_enabled: false, sms_enabled: true, updated_by: 'u1' })
    expect(state.upserts[0][1]).toEqual({ onConflict: 'event_code' })
    const data = await res.json()
    expect(data.events.find((e: any) => e.event === 'shipped')).toMatchObject({ email: false, sms: true })
  })

  it('rejects unknown events and non-boolean switches', async () => {
    expect((await put({ event: 'processing', email: true, sms: true })).status).toBe(400)
    expect((await put({ event: 'shipped', email: 'yes', sms: true })).status).toBe(400)
    expect((await put({ event: 'shipped', email: true })).status).toBe(400)
    expect(state.upserts).toEqual([])
  })

  it('leaves the SMS text alone when only a switch changes', async () => {
    await put({ event: 'paid', email: true, sms: false })
    expect('sms_template' in state.upserts[0][0]).toBe(false)
  })

  it('saves SMS wording, and stores the built-in text as no custom text', async () => {
    await put({ event: 'delivered', email: true, sms: true, smsTemplate: '  Hi {{first_name}}, {{order_no}} arrived.  ' })
    expect(state.upserts[0][0]).toMatchObject({ event_code: 'delivered', sms_template: 'Hi {{first_name}}, {{order_no}} arrived.' })
    const res = await put({ event: 'delivered', email: true, sms: true, smsTemplate: defaultOutdoorSmsTemplate('delivered') })
    expect(state.upserts[1][0].sms_template).toBeNull()
    expect((await res.json()).events.find((e: any) => e.event === 'delivered').smsTemplate).toBeNull()
    await put({ event: 'delivered', email: true, sms: true, smsTemplate: '' })
    await put({ event: 'delivered', email: true, sms: true, smsTemplate: null })
    expect(state.upserts[2][0].sms_template).toBeNull()
    expect(state.upserts[3][0].sms_template).toBeNull()
  })

  it('refuses SMS wording with unknown placeholders, too long or not text', async () => {
    const bad = [{ smsTemplate: 'Hi {{name}}' }, { smsTemplate: 'x'.repeat(481) }, { smsTemplate: 5 }, { smsTemplate: 'Hi {{order_no}' }]
    for (const extra of bad) {
      const res = await put({ event: 'delivered', email: true, sms: true, ...extra })
      expect(res.status).toBe(400)
    }
    expect(state.upserts).toEqual([])
  })

  it('switches the welcome email, which has no SMS', async () => {
    expect((await put({ event: 'newsletter_welcome', email: false, sms: false })).status).toBe(200)
    expect(state.upserts[0][0]).toMatchObject({ event_code: 'newsletter_welcome', email_enabled: false, sms_enabled: false })
    expect((await put({ event: 'newsletter_welcome', email: true, sms: true })).status).toBe(400)
    expect((await put({ event: 'newsletter_welcome', email: true, sms: false, smsTemplate: 'Hi' })).status).toBe(400)
    expect(state.upserts).toHaveLength(1)
  })

  it('explains that saving waits for the migration', async () => {
    state.upsertError = { code: 'PGRST205', message: 'missing' }
    const res = await put({ event: 'shipped', email: true, sms: true })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('migration')
  })
})
