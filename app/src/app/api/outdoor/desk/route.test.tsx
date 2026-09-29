import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  staff: { userId: 'u1', orgId: 'o1' } as any,
  loads: 0,
}))

vi.mock('@/lib/outdoor/staff', () => ({ requireOutdoorStaff: async () => state.staff }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/outdoor/desk-server', () => ({
  loadOutdoorDesk: async () => {
    state.loads += 1
    return { subscribers: 1, summary: { toSend: 2 }, products: [] }
  },
}))

import { GET } from './route'

beforeEach(() => {
  state.staff = { userId: 'u1', orgId: 'o1' }
  state.loads = 0
})

describe('GET /api/outdoor/desk', () => {
  it('refuses non-staff without loading anything', async () => {
    state.staff = null
    const res = await GET()
    expect(res.status).toBe(401)
    expect(state.loads).toBe(0)
  })

  it('returns the desk to staff', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ subscribers: 1, summary: { toSend: 2 }, products: [] })
  })
})
