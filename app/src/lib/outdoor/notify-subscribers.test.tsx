import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  subscribers: [] as Array<{ id: string; email_normalized: string; unsubscribe_token: string }>,
  failPageFrom: -1,
  ranges: [] as Array<[number, number]>,
  sent: [] as string[],
}))

vi.mock('@/server/auth/passwordResetService', () => ({ resolveOrgForEmail: async () => 'hq' }))
vi.mock('@/lib/email/transactional-html-email', () => ({
  sendTransactionalHtmlEmail: async (_admin: any, _org: string, input: any) => {
    state.sent.push(input.to)
    return { success: true }
  },
}))

import { emailOutdoorSubscribers } from './notify-subscribers'

function fakeAdmin() {
  return {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: async (from: number, to: number) => {
          state.ranges.push([from, to])
          if (from === state.failPageFrom) return { data: null, error: { message: 'timeout' } }
          return { data: state.subscribers.slice(from, to + 1), error: null }
        },
      }
      return chain
    },
  }
}

const people = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `s${i}`, email_normalized: `p${i}@example.com`, unsubscribe_token: `t${i}` }))

const update = { subject: 'SeraOutdoor: New colour', text: 'Hi {{unsubscribe_url}}', html: '<p>Hi {{unsubscribe_url}}</p>' }

describe('emailOutdoorSubscribers', () => {
  beforeEach(() => {
    state.subscribers = []
    state.failPageFrom = -1
    state.ranges = []
    state.sent = []
  })

  it('reaches every active subscriber, not just the first 500', async () => {
    state.subscribers = people(1203)
    const result = await emailOutdoorSubscribers(fakeAdmin(), update)
    expect(result).toEqual({ ok: true, emailed: 1203, subscribers: 1203 })
    expect(new Set(state.sent).size).toBe(1203)
    expect(state.ranges).toEqual([[0, 499], [500, 999], [1000, 1499]])
  })

  it('stops after a short page', async () => {
    state.subscribers = people(500)
    await emailOutdoorSubscribers(fakeAdmin(), update)
    expect(state.ranges).toEqual([[0, 499], [500, 999]])
    expect(state.sent).toHaveLength(500)
  })

  it('sends nothing when a page cannot be loaded, so nobody is silently skipped', async () => {
    state.subscribers = people(900)
    state.failPageFrom = 500
    const result = await emailOutdoorSubscribers(fakeAdmin(), update)
    expect(result.ok).toBe(false)
    expect(state.sent).toEqual([])
  })

  it('emails each address once', async () => {
    state.subscribers = [...people(3), { id: 'dup', email_normalized: 'p1@example.com', unsubscribe_token: 'x' }]
    const result = await emailOutdoorSubscribers(fakeAdmin(), update)
    expect(state.sent).toEqual(['p0@example.com', 'p1@example.com', 'p2@example.com'])
    expect(result).toEqual({ ok: true, emailed: 3, subscribers: 3 })
  })
})
