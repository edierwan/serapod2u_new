import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const SECRET = 'qr-worker-cron-secret-value'

const authGetUser = vi.fn()
const profileSingle = vi.fn()
const createServerClientMock = vi.fn()
const withWorkerLeaseMock = vi.fn()

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

vi.mock('@/lib/notifications/supplyChainEventQueue', () => ({ queueNotificationEvent: vi.fn() }))
vi.mock('@/lib/qr-generator', () => ({ generateQRBatch: vi.fn() }))
vi.mock('@/lib/excel-generator', () => ({ generateQRExcel: vi.fn(), generateQRExcelFilename: vi.fn() }))

function req(authorization?: string): NextRequest {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  return new NextRequest('https://stg.serapod2u.com/api/cron/qr-generation-worker', { headers })
}

function signedInAs(orgType: string | null, isActive = true) {
  authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  profileSingle.mockResolvedValue({
    data: { is_active: isActive, organizations: orgType ? { org_type_code: orgType } : null },
    error: null,
  })
}

const originalEnv = { ...process.env }

describe('GET /api/cron/qr-generation-worker authorization', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
    process.env.CRON_SECRET = SECRET
    delete process.env.WORKER_SECRET

    authGetUser.mockResolvedValue({ data: { user: null }, error: null })
    createServerClientMock.mockResolvedValue({
      auth: { getUser: authGetUser },
      from: (table: string) => {
        if (table !== 'users') throw new Error(`unexpected table ${table}`)
        return { select: () => ({ eq: () => ({ single: profileSingle }) }) }
      },
    })
    withWorkerLeaseMock.mockResolvedValue({
      status: 'ran',
      result: NextResponse.json({ message: 'No batches to process' }),
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.env = { ...originalEnv }
  })

  async function callWorker(request: NextRequest) {
    const { GET } = await import('./route')
    return GET(request)
  }

  it('runs for the scheduler with a valid CRON_SECRET, without consulting a session', async () => {
    const res = await callWorker(req(`Bearer ${SECRET}`))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ message: 'No batches to process' })
    expect(withWorkerLeaseMock).toHaveBeenCalledTimes(1)
    expect(createServerClientMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid cron credential with 401 and does not run', async () => {
    const res = await callWorker(req('Bearer not-the-secret'))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(withWorkerLeaseMock).not.toHaveBeenCalled()
  })

  it('rejects an anonymous request with 401 and does not run', async () => {
    const res = await callWorker(req())

    expect(res.status).toBe(401)
    expect(withWorkerLeaseMock).not.toHaveBeenCalled()
  })

  it('rejects anonymous requests even when no CRON_SECRET is configured', async () => {
    delete process.env.CRON_SECRET
    vi.stubEnv('NODE_ENV', 'development')

    const res = await callWorker(req())

    expect(res.status).toBe(401)
    expect(withWorkerLeaseMock).not.toHaveBeenCalled()
  })

  it.each(['MFG', 'HQ', 'mfg'])('runs for a signed-in %s user session (browser trigger, no secret)', async (orgType) => {
    signedInAs(orgType)

    const res = await callWorker(req())

    expect(res.status).toBe(200)
    expect(withWorkerLeaseMock).toHaveBeenCalledTimes(1)
  })

  it('still accepts a valid session when the browser request carries no cron header at all', async () => {
    signedInAs('MFG')

    const res = await callWorker(req('Bearer wrong-but-session-is-valid'))

    expect(res.status).toBe(200)
    expect(withWorkerLeaseMock).toHaveBeenCalledTimes(1)
  })

  it.each(['SHOP', 'DIST', 'WH', null])('forbids a signed-in user from org type %s', async (orgType) => {
    signedInAs(orgType)

    const res = await callWorker(req())

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(withWorkerLeaseMock).not.toHaveBeenCalled()
  })

  it('forbids an inactive manufacturer user', async () => {
    signedInAs('MFG', false)

    const res = await callWorker(req())

    expect(res.status).toBe(403)
    expect(withWorkerLeaseMock).not.toHaveBeenCalled()
  })

  it('forbids a session whose profile cannot be loaded', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    profileSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })

    const res = await callWorker(req())

    expect(res.status).toBe(403)
    expect(withWorkerLeaseMock).not.toHaveBeenCalled()
  })

  it('never echoes the configured or supplied credential', async () => {
    const res = await callWorker(req('Bearer leaked-token-value'))
    const text = await res.text()

    expect(text).not.toContain('leaked-token-value')
    expect(text).not.toContain(SECRET)
  })
})
