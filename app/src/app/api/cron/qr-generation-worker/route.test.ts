import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const SECRET = 'qr-worker-cron-secret-value'

const createServerClientMock = vi.fn()
const withWorkerLeaseMock = vi.fn()
const runQRBatchGenerationMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc: vi.fn() })),
}))

vi.mock('@/lib/cron/lease', () => ({
  WORKER_NAMES: { qrGeneration: 'qr-generation-worker' },
  withWorkerLease: withWorkerLeaseMock,
}))

vi.mock('@/lib/qr-batch-generation', () => ({
  runQRBatchGeneration: runQRBatchGenerationMock,
}))

function req(authorization?: string, cookie?: string): NextRequest {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  if (cookie !== undefined) headers.set('cookie', cookie)
  return new NextRequest('https://stg.serapod2u.com/api/cron/qr-generation-worker', { headers })
}

const originalEnv = { ...process.env }

describe('GET /api/cron/qr-generation-worker authorization (cron-only, global queue)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
    process.env.CRON_SECRET = SECRET
    delete process.env.WORKER_SECRET

    runQRBatchGenerationMock.mockResolvedValue(NextResponse.json({ message: 'No batches to process' }))
    withWorkerLeaseMock.mockImplementation(async (_client, _name, fn) => ({ status: 'ran', result: await fn() }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.env = { ...originalEnv }
  })

  async function callWorker(request: NextRequest) {
    const { GET } = await import('./route')
    return GET(request)
  }

  it('runs the global queue for the scheduler with a valid CRON_SECRET', async () => {
    const res = await callWorker(req(`Bearer ${SECRET}`))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: 'No batches to process' })
    expect(withWorkerLeaseMock).toHaveBeenCalledWith(expect.anything(), 'qr-generation-worker', expect.any(Function))
    expect(runQRBatchGenerationMock).toHaveBeenCalledTimes(1)
    expect(runQRBatchGenerationMock.mock.calls[0][1]).toEqual({ notificationBaseUrl: 'https://stg.serapod2u.com' })
  })

  it('rejects an invalid cron credential with 401 and does not run', async () => {
    const res = await callWorker(req('Bearer not-the-secret'))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(withWorkerLeaseMock).not.toHaveBeenCalled()
    expect(runQRBatchGenerationMock).not.toHaveBeenCalled()
  })

  it('rejects an anonymous request with 401 and does not run', async () => {
    const res = await callWorker(req())

    expect(res.status).toBe(401)
    expect(withWorkerLeaseMock).not.toHaveBeenCalled()
  })

  it('rejects a signed-in browser session: sessions cannot drive the global queue', async () => {
    const res = await callWorker(req(undefined, 'sb-access-token=a-real-looking-session'))

    expect(res.status).toBe(401)
    expect(createServerClientMock).not.toHaveBeenCalled()
    expect(withWorkerLeaseMock).not.toHaveBeenCalled()
  })

  it('never echoes the configured or supplied credential', async () => {
    const res = await callWorker(req('Bearer leaked-token-value'))
    const text = await res.text()

    expect(text).not.toContain('leaked-token-value')
    expect(text).not.toContain(SECRET)
  })
})
