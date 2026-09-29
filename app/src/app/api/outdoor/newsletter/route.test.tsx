import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  existing: null as any,
  settings: null as any,
  inserts: [] as any[],
  welcomes: [] as any[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'outdoor_customer_message_settings' ? state.settings : state.existing, error: null }),
        insert: async (row: any) => {
          state.inserts.push(row)
          return { error: null }
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/outdoor/notify-subscribers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/outdoor/notify-subscribers')>()),
  sendOutdoorSubscriberEmail: async (_admin: any, to: string, input: any) => {
    state.welcomes.push({ to, ...input })
    return { success: true }
  },
}))

import { POST } from './route'

const subscribe = (email: string) =>
  POST(new Request('http://x/api/outdoor/newsletter', { method: 'POST', body: JSON.stringify({ email }) }) as any)

describe('POST /api/outdoor/newsletter', () => {
  beforeEach(() => {
    state.existing = null
    state.settings = null
    state.inserts = []
    state.welcomes = []
  })

  it('saves the subscriber and sends one welcome email by default', async () => {
    const data = await (await subscribe('Aina@Example.com')).json()
    expect(data).toEqual({ ok: true, welcomed: true })
    expect(state.inserts[0]).toMatchObject({ email_normalized: 'aina@example.com', status: 'active' })
    expect(state.welcomes).toHaveLength(1)
    expect(state.welcomes[0].to).toBe('aina@example.com')
    expect(state.welcomes[0].text).toContain('new products, new colours and Outdoor events')
    expect(state.welcomes[0].text).not.toContain('added or updated')
    expect(state.welcomes[0].text).toContain('/outdoor/unsubscribe?token=')
  })

  it('still saves the subscriber but sends no welcome when staff switched it off', async () => {
    state.settings = { email_enabled: false, sms_enabled: false }
    const data = await (await subscribe('aina@example.com')).json()
    expect(data).toEqual({ ok: true, welcomed: false })
    expect(state.inserts).toHaveLength(1)
    expect(state.welcomes).toEqual([])
  })

  it('does not welcome someone who is already subscribed', async () => {
    state.existing = { id: 's1', status: 'active', unsubscribe_token: 't' }
    const data = await (await subscribe('aina@example.com')).json()
    expect(data).toEqual({ ok: true, already: true })
    expect(state.welcomes).toEqual([])
  })
})
