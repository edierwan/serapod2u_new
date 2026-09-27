import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const SECRET = 'test-cron-secret'
let rpcCalls: Array<{ fn: string; args: any }>
let purgeResults: Array<{ data: any; error: any }>

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: vi.fn(async (fn: string, args: any) => {
      rpcCalls.push({ fn, args })
      if (fn === 'try_acquire_worker_lease' || fn === 'release_worker_lease') return { data: true, error: null }
      return purgeResults.shift() ?? { data: { status: 'completed', deleted: 0, more_remaining: false }, error: null }
    }),
  }),
}))

const { GET } = await import('./route')
const call = (auth?: string) => GET(new NextRequest('https://app.test/api/cron/sa-decision-retention', { headers: auth ? { authorization: auth } : {} }))
const purges = () => rpcCalls.filter(c => c.fn === 'sa_purge_ordinary_shadow_decisions')

beforeEach(() => {
  rpcCalls = []
  purgeResults = []
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test')
})

describe('sa-decision-retention worker', () => {
  it('rejects anonymous and wrong-secret callers without touching the database', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer nope')).status).toBe(401)
    expect(rpcCalls).toEqual([])
  })

  it('runs the fixed, bounded service purge under the worker lease', async () => {
    purgeResults = [
      { data: { status: 'completed', deleted: 5000, more_remaining: true }, error: null },
      { data: { status: 'completed', deleted: 12, more_remaining: false }, error: null },
    ]
    const response = await call(`Bearer ${SECRET}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'OK', deleted: 5012, batches: 2 })
    expect(purges().map(c => c.args)).toEqual([{ p_batch_limit: 5000 }, { p_batch_limit: 5000 }])
    expect(rpcCalls[0].fn).toBe('try_acquire_worker_lease')
  })

  it('caps the batches per run', async () => {
    purgeResults = Array.from({ length: 20 }, () => ({ data: { status: 'completed', deleted: 5000, more_remaining: true }, error: null }))
    const body = await (await call(`Bearer ${SECRET}`)).json()
    expect(body).toMatchObject({ batches: 10, moreRemaining: true })
  })

  it('is a no-op where the readiness migration is not installed', async () => {
    purgeResults = [{ data: null, error: { code: 'PGRST202', message: 'not found' } }]
    const response = await call(`Bearer ${SECRET}`)
    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe('RETENTION_NOT_INSTALLED')
  })

  it('reports a purge failure as 500', async () => {
    purgeResults = [{ data: null, error: { code: '42501', message: 'denied' } }]
    expect((await call(`Bearer ${SECRET}`)).status).toBe(500)
  })
})
