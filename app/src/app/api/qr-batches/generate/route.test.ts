import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// S&A in legacy mode: this suite tests the route's own rules.
vi.mock('@/lib/security-access/operation', async () => (await import('@/test-support/sa-legacy-mode')).operationModule)
vi.mock('@/lib/security-access/resource-context', async () => (await import('@/test-support/sa-legacy-mode')).resourceContextModule)

const MFG_A = 'org-mfg-a'
const MFG_B = 'org-mfg-b'
const HQ = 'org-hq'
const OTHER_HQ = 'org-hq-other'

const authGetUser = vi.fn()
const profileSingle = vi.fn()
const orderMaybeSingle = vi.fn()
const orderFilters = vi.fn()
const existingBatchMaybeSingle = vi.fn()
const batchInsert = vi.fn()
const batchInsertSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
    from: (table: string) => {
      if (table !== 'users') throw new Error(`session client must not read ${table}`)
      return { select: () => ({ eq: () => ({ single: profileSingle }) }) }
    },
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({
            eq: (c1: string, v1: string) => ({
              eq: (c2: string, v2: string) => ({
                in: (c3: string, v3: string[]) => {
                  orderFilters({ [c1]: v1, [c2]: v2, [c3]: v3 })
                  return { maybeSingle: orderMaybeSingle }
                },
              }),
            }),
          }),
        }
      }
      if (table === 'qr_batches') {
        return {
          select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: existingBatchMaybeSingle }) }) }),
          insert: (payload: unknown) => {
            batchInsert(payload)
            return { select: () => ({ single: batchInsertSingle }) }
          },
        }
      }
      throw new Error(`unexpected admin table ${table}`)
    },
  })),
}))

vi.mock('@/lib/qr-generator', () => ({
  generateQRBatch: vi.fn(() => ({ totalMasterCodes: 2, totalUniqueCodes: 220, bufferPercent: 10 })),
}))

function post(body: unknown): NextRequest {
  return new NextRequest('https://stg.serapod2u.com/api/qr-batches/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function signedInAs(orgType: string | null, orgId: string | null, isActive = true) {
  authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  profileSingle.mockResolvedValue({
    data: { is_active: isActive, organization_id: orgId, organizations: orgType ? { org_type_code: orgType } : null },
    error: null,
  })
}

const H2M_ORDER = {
  id: 'order-1',
  order_no: 'ORD-HM-1026-02',
  company_id: HQ,
  buyer_org_id: HQ,
  seller_org_id: MFG_A,
  qr_buffer_percent: 10,
  units_per_case: 100,
  seller_org: { id: MFG_A, org_name: 'Manufacturer A', org_code: 'MF001' },
  buyer_org: { id: HQ, org_name: 'HQ', org_code: 'HQ001' },
  order_items: [
    {
      id: 'item-1',
      qty: 200,
      product_id: 'product-1',
      variant_id: 'variant-1',
      units_per_case: null,
      product: { id: 'product-1', product_code: 'CELVA9464', product_name: 'Cellera' },
      variant: { id: 'variant-1', variant_code: 'FRU-279689', variant_name: 'Mango' },
    },
  ],
}

async function call(body: unknown = { order_id: 'order-1' }) {
  const { POST } = await import('./route')
  return POST(post(body))
}

describe('POST /api/qr-batches/generate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({ data: { user: null }, error: null })
    orderMaybeSingle.mockResolvedValue({ data: H2M_ORDER, error: null })
    existingBatchMaybeSingle.mockResolvedValue({ data: null, error: null })
    batchInsertSingle.mockResolvedValue({ data: { id: 'batch-1', status: 'queued' }, error: null })
  })

  it('requires an order_id', async () => {
    signedInAs('MFG', MFG_A)
    expect((await call({})).status).toBe(400)
    expect(batchInsert).not.toHaveBeenCalled()
  })

  it('rejects anonymous callers with 401', async () => {
    expect((await call()).status).toBe(401)
    expect(orderMaybeSingle).not.toHaveBeenCalled()
    expect(batchInsert).not.toHaveBeenCalled()
  })

  it.each([['SHOP'], ['DIST'], ['WH'], [null]])('forbids org type %s', async (orgType) => {
    signedInAs(orgType, MFG_A)

    expect((await call()).status).toBe(403)
    expect(orderMaybeSingle).not.toHaveBeenCalled()
    expect(batchInsert).not.toHaveBeenCalled()
  })

  it('forbids an inactive manufacturer user', async () => {
    signedInAs('MFG', MFG_A, false)

    expect((await call()).status).toBe(403)
    expect(batchInsert).not.toHaveBeenCalled()
  })

  it('queues the batch with the service role for the manufacturer that sells the order', async () => {
    signedInAs('MFG', MFG_A)

    const res = await call()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true, batch_id: 'batch-1', status: 'queued' })
    expect(orderFilters).toHaveBeenCalledWith({ id: 'order-1', order_type: 'H2M', status: ['approved', 'closed'] })
    expect(batchInsert).toHaveBeenCalledWith(expect.objectContaining({
      order_id: 'order-1',
      company_id: HQ,
      created_by: 'user-1',
      status: 'queued',
      total_master_codes: 2,
      total_unique_codes: 220,
    }))
  })

  it('does not let manufacturer B generate for manufacturer A’s order, and hides that it exists', async () => {
    signedInAs('MFG', MFG_B)

    const res = await call()

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Order not found or not eligible for QR generation' })
    expect(existingBatchMaybeSingle).not.toHaveBeenCalled()
    expect(batchInsert).not.toHaveBeenCalled()
  })

  it('lets the owning HQ generate but not a different HQ', async () => {
    signedInAs('HQ', HQ)
    expect((await call()).status).toBe(200)
    expect(batchInsert).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    signedInAs('HQ', OTHER_HQ)
    expect((await call()).status).toBe(404)
    expect(batchInsert).not.toHaveBeenCalled()
  })

  it('returns 404 for an order that is unknown, not H2M or not approved/closed', async () => {
    signedInAs('MFG', MFG_A)
    orderMaybeSingle.mockResolvedValue({ data: null, error: null })

    expect((await call()).status).toBe(404)
    expect(batchInsert).not.toHaveBeenCalled()
  })

  it('returns the existing batch instead of creating a duplicate', async () => {
    signedInAs('MFG', MFG_A)
    existingBatchMaybeSingle.mockResolvedValue({
      data: { id: 'batch-0', status: 'generated', total_unique_codes: 220, total_master_codes: 2 },
      error: null,
    })

    const res = await call()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ batch: { id: 'batch-0' }, status: 'generated' })
    expect(batchInsert).not.toHaveBeenCalled()
  })

  it('reports a failed insert with its database message', async () => {
    signedInAs('MFG', MFG_A)
    batchInsertSingle.mockResolvedValue({ data: null, error: { message: 'insert failed' } })

    const res = await call()

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Failed to create batch record', details: 'insert failed' })
  })
})
