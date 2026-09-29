import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

let actor: any
const rpc = vi.fn()
const modes: Record<string, string> = { 'finance.journal.post': 'NEW_ENFORCED', 'customer.crm.view': 'SHADOW' }
vi.mock('@/lib/security-access/admin-api', () => ({ requireSelfServiceActor: async () => actor }))
vi.mock('@/lib/security-access/authorization', () => ({ currentMigrationMode: async (p: string) => modes[p] ?? 'LEGACY_ENFORCED' }))

const get = async (query: string) => {
  const { GET } = await import('./route')
  const url = `http://localhost/api/security-access/me/capabilities?${query}`
  return GET({ nextUrl: new URL(url) } as any)
}

describe('GET /api/security-access/me/capabilities', () => {
  beforeEach(() => {
    rpc.mockReset()
    actor = { userId: 'u-1', organizationId: 'org-a', admin: { rpc } }
  })

  it('requires a signed-in active account', async () => {
    actor = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    expect((await get('permissions=finance.journal.post')).status).toBe(401)
  })

  it('answers only for the caller, in their organization by default, without authorizing anything', async () => {
    rpc.mockImplementation(async (_fn: string, args: any) => ({ data: { decision: args.p_permission === 'finance.journal.post' ? 'ALLOW' : 'DENY' }, error: null }))
    const res = await get('permissions=finance.journal.post,customer.crm.view')
    const body = await res.json()
    expect(body.capabilities).toEqual({
      'finance.journal.post': { allowed: true, enforced: true },
      'customer.crm.view': { allowed: false, enforced: false },
    })
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('sa_evaluate_permission')
      expect(call[1].p_actor).toBe('u-1')
      expect(call[1].p_context).toEqual({ organization_id: 'org-a' })
    }
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects malformed input', async () => {
    expect((await get('permissions=DROP TABLE')).status).toBe(400)
    expect((await get('permissions=')).status).toBe(400)
    expect((await get('permissions=finance.journal.post&organizationId=not-a-uuid')).status).toBe(400)
  })

  it('reports not allowed when the evaluator fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'X' } })
    const body = await (await get('permissions=finance.journal.post')).json()
    expect(body.capabilities['finance.journal.post']).toEqual({ allowed: false, enforced: true })
  })
})
