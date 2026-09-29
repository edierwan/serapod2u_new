import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  staff: { userId: 'u1', orgId: 'o1' } as any,
  staffEmail: 'staff@serapod.com' as string | null,
  recent: [] as any[],
  inserts: [] as any[],
  insertError: null as any,
  broadcasts: [] as any[],
  tests: [] as any[],
  updates: [] as any[],
}))

vi.mock('@/lib/outdoor/staff', () => ({ requireOutdoorStaff: async () => state.staff }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        limit: async () => ({ data: state.recent, error: null }),
        maybeSingle: async () => ({ data: table === 'users' ? { email: state.staffEmail } : null, error: null }),
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              state.inserts.push(row)
              if (state.insertError && row.kind !== 'other') return { data: null, error: state.insertError }
              return { data: { id: `upd-${state.inserts.length}` }, error: null }
            },
          }),
        }),
        update: (values: any) => ({
          eq: async (_col: string, id: string) => {
            state.updates.push({ id, ...values })
            return { error: null }
          },
        }),
      }
      return chain
    },
  }),
}))

vi.mock('@/lib/outdoor/notify-subscribers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/outdoor/notify-subscribers')>()),
  emailOutdoorSubscribers: async (_admin: any, input: any) => {
    state.broadcasts.push(input)
    return { ok: true, emailed: 3, subscribers: 3 }
  },
  sendOutdoorSubscriberEmail: async (_admin: any, to: string, input: any) => {
    state.tests.push({ to, ...input })
    return { success: true }
  },
}))

import { POST } from './route'

const post = (body: any) =>
  POST(new Request('http://x/api/outdoor/updates', { method: 'POST', body: JSON.stringify(body) }) as any)

const offer = { kind: 'offer', title: 'Free shipping weekend', body: 'All orders ship free until Sunday.' }

describe('POST /api/outdoor/updates', () => {
  beforeEach(() => {
    state.staff = { userId: 'u1', orgId: 'o1' }
    state.staffEmail = 'staff@serapod.com'
    state.recent = []
    state.inserts = []
    state.insertError = null
    state.broadcasts = []
    state.tests = []
    state.updates = []
  })

  it('refuses people who are not Outdoor staff', async () => {
    state.staff = null
    const res = await post(offer)
    expect(res.status).toBe(401)
    expect(state.broadcasts).toEqual([])
  })

  it('sends a branded email with an unsubscribe placeholder to every subscriber and records the count', async () => {
    const res = await post({ ...offer, link: '/outdoor/shop/abc' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, emailed: 3, subscribers: 3 })
    expect(state.inserts[0]).toMatchObject({ kind: 'offer', title: 'Free shipping weekend', created_by: 'u1' })
    const email = state.broadcasts[0]
    expect(email.subject).toBe('SeraOutdoor: Free shipping weekend')
    expect(email.html).toContain('Special offer')
    expect(email.html).toContain('{{unsubscribe_url}}')
    expect(email.text).toContain('{{unsubscribe_url}}')
    expect(email.html).toMatch(/href="https?:\/\/[^"]+\/outdoor\/shop\/abc"/)
    expect(state.updates).toEqual([{ id: 'upd-1', emailed_count: 3 }])
  })

  it('escapes what staff type so it cannot break the email', async () => {
    await post({ kind: 'event', title: '<b>Camp</b>', body: 'Join us <script>x</script>' })
    expect(state.broadcasts[0].html).not.toContain('<script>')
    expect(state.broadcasts[0].html).toContain('&lt;b&gt;Camp&lt;/b&gt;')
  })

  it('sends a test only to the staff member and saves nothing', async () => {
    const res = await post({ ...offer, test: true })
    expect(await res.json()).toEqual({ ok: true, test: true, to: 'staff@serapod.com' })
    expect(state.tests).toHaveLength(1)
    expect(state.tests[0].subject).toBe('[Test] SeraOutdoor: Free shipping weekend')
    expect(state.tests[0].html).not.toContain('{{unsubscribe_url}}')
    expect(state.inserts).toEqual([])
    expect(state.broadcasts).toEqual([])
  })

  it('does not send a test when the staff account has no email', async () => {
    state.staffEmail = null
    const res = await post({ ...offer, test: true })
    expect(res.status).toBe(400)
    expect(state.tests).toEqual([])
  })

  it('blocks sending the same title again within a few minutes', async () => {
    state.recent = [{ id: 'old' }]
    const res = await post(offer)
    expect(res.status).toBe(409)
    expect(state.inserts).toEqual([])
    expect(state.broadcasts).toEqual([])
  })

  it('still sends a new-type update as "other" before the migration is applied', async () => {
    state.insertError = { code: '23514', message: 'violates check constraint' }
    const res = await post(offer)
    expect(res.status).toBe(200)
    expect(state.inserts.map((row) => row.kind)).toEqual(['offer', 'other'])
    expect(state.broadcasts[0].html).toContain('Special offer')
  })

  it('rejects a missing title, an unknown type and a bad link', async () => {
    expect((await post({ ...offer, title: '' })).status).toBe(400)
    expect((await post({ ...offer, kind: 'spam' })).status).toBe(400)
    expect((await post({ ...offer, link: 'javascript:alert(1)' })).status).toBe(400)
    expect(state.broadcasts).toEqual([])
  })
})
