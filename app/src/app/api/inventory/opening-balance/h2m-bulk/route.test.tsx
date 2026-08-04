import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  adminRpc: vi.fn(),
  userRpc: vi.fn(),
}))

vi.mock('@/lib/server/stock-config-admin', () => ({
  getStockConfigAdminContext: mocks.getContext,
}))

const cutoffId = '10000000-0000-4000-8000-000000000001'
const categoryId = '20000000-0000-4000-8000-000000000001'
const orderId = '30000000-0000-4000-8000-000000000001'
const itemId = '40000000-0000-4000-8000-000000000001'

const canonical = {
  action: 'selected_not_incoming',
  cutoff_id: cutoffId,
  confirmation_fingerprint: 'scope-v2',
  product_category_id: categoryId,
  product_category_name: 'Vape',
  eligible_item_count: 1,
  affected_order_count: 1,
  resolved_item_count: 2,
  saved_incoming_count: 1,
  saved_not_incoming_count: 1,
  blocked_item_count: 0,
  eligible_order_ids: [orderId],
  eligible_item_ids: [itemId],
  blocked_item_ids: [],
}

const request = (
  body: Record<string, unknown>,
  correlationId = 'bulk-contract-test',
) => new Request('http://localhost/api/inventory/opening-balance/h2m-bulk', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Request-ID': correlationId,
  },
  body: JSON.stringify(body),
})

describe('H2M bulk route contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.getContext.mockReset()
    mocks.adminRpc.mockReset()
    mocks.userRpc.mockReset()
    mocks.getContext.mockResolvedValue({
      ok: true,
      admin: { rpc: mocks.adminRpc },
      supabase: { rpc: mocks.userRpc },
    })
  })

  it.each([
    ['direct JSONB object', canonical],
    ['single-row Supabase wrapper', [canonical]],
  ])('accepts a valid %s and preserves canonical snake_case mapping', async (_, data) => {
    mocks.adminRpc.mockResolvedValue({ data, error: null })
    const response = await POST(request({
      cutoffId,
      action: 'selected_not_incoming',
      orderIds: [orderId],
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(await response.json()).toEqual(canonical)
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      'inventory_cutoff_h2m_bulk_preflight',
      {
        p_cutoff_id: cutoffId,
        p_action: 'selected_not_incoming',
        p_order_ids: [orderId],
      },
    )
    expect(mocks.userRpc).not.toHaveBeenCalled()
  })

  it('logs the precise rejected field without logging the raw response', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.adminRpc.mockResolvedValue({
      data: { ...canonical, cutoff_id: null },
      error: null,
    })
    const response = await POST(request({
      cutoffId,
      action: 'selected_not_incoming',
      orderIds: [orderId],
    }, 'invalid-contract-test'))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      category: 'h2m_bulk_invalid_response',
      error: 'H2M bulk check returned an unexpected response. Refresh and retry. No decisions were changed.',
      correlationId: 'invalid-contract-test',
      savedDecisionsPreserved: true,
    })
    expect(errorLog).toHaveBeenCalledWith(
      'H2M bulk RPC response rejected',
      expect.objectContaining({
        rpcName: 'inventory_cutoff_h2m_bulk_preflight',
        responseType: 'object',
        rejectedField: 'cutoff_id',
        expectedType: 'a non-empty string',
        actualDescription: 'null',
        cutoffId,
        requestedAction: 'selected_not_incoming',
        correlationId: 'invalid-contract-test',
      }),
    )
    expect(mocks.userRpc).not.toHaveBeenCalled()
  })

  it('never treats an empty selected array as Mark All and makes no RPC call', async () => {
    const response = await POST(request({
      cutoffId,
      action: 'selected_not_incoming',
      orderIds: [],
    }))
    expect(response.status).toBe(400)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
    expect(mocks.userRpc).not.toHaveBeenCalled()
  })

  it('revalidates apply through the authenticated atomic RPC using the canonical fingerprint', async () => {
    mocks.userRpc.mockResolvedValue({
      data: {
        ...canonical,
        applied_item_count: 1,
        decision: 'history_only',
        idempotent_replay: false,
      },
      error: null,
    })
    const response = await POST(request({
      cutoffId,
      action: 'selected_not_incoming',
      orderIds: [orderId],
      confirmationFingerprint: 'scope-v2',
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      apply: true,
    }))
    expect(response.status).toBe(200)
    expect(mocks.userRpc).toHaveBeenCalledWith(
      'apply_inventory_cutoff_h2m_bulk',
      {
        p_cutoff_id: cutoffId,
        p_action: 'selected_not_incoming',
        p_order_ids: [orderId],
        p_expected_fingerprint: 'scope-v2',
        p_idempotency_key: '50000000-0000-4000-8000-000000000001',
      },
    )
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })
})
