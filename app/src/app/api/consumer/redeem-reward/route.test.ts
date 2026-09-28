import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUser = vi.fn()
const sessionFrom = vi.fn()
const userSingle = vi.fn()
const rewardMaybeSingle = vi.fn()
const bankMaybeSingle = vi.fn()
const rpc = vi.fn()
const adminFrom = vi.fn()
const createServerClientMock = vi.fn()
const createSupabaseClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createSupabaseClientMock,
}))

const REWARD_ID = '11111111-1111-4111-8111-111111111111'

function post(body: Record<string, unknown>) {
  return new Request('http://localhost/api/consumer/redeem-reward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

async function callRoute(body: Record<string, unknown>) {
  const { POST } = await import('./route')
  const response = await POST(post(body))
  return { response, payload: await response.json() }
}

describe('POST /api/consumer/redeem-reward', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

    createServerClientMock.mockResolvedValue({
      auth: { getUser: authGetUser },
      from: sessionFrom,
    })

    adminFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ single: userSingle }) }) }
      }
      if (table === 'redeem_items') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: rewardMaybeSingle }) }) }) }
      }
      if (table === 'msia_banks') {
        return { select: () => ({ eq: () => ({ maybeSingle: bankMaybeSingle }) }) }
      }
      throw new Error(`Unexpected admin table: ${table}`)
    })

    createSupabaseClientMock.mockReturnValue({ from: adminFrom, rpc })

    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    userSingle.mockResolvedValue({
      data: { id: 'user-1', bank_id: 'bank-1', bank_account_number: '557175482611' },
      error: null,
    })
    bankMaybeSingle.mockResolvedValue({
      data: {
        id: 'bank-1',
        short_name: 'Maybank',
        min_account_length: 12,
        max_account_length: 12,
        is_numeric_only: true,
        is_active: true,
      },
      error: null,
    })
    rewardMaybeSingle.mockResolvedValue({
      data: {
        id: REWARD_ID,
        item_name: 'RM100 CASH',
        item_code: 'cashback-rm100',
        category: 'cash',
        collection_mode: 'always',
        per_user_limit: false,
        reward_message: null,
      },
      error: null,
    })
    rpc.mockResolvedValue({
      data: {
        success: true,
        status: 200,
        replayed: false,
        transaction_id: 'txn-1',
        is_bonus_points: false,
        points_change: -1500,
        required_points: 1500,
        previous_balance: 2000,
        new_balance: 500,
        redemption_code: 'RED-TXN1',
        wallet_scope: 'consumer',
        wallet_owner_user_id: 'user-1',
        wallet_owner_org_id: null,
        reporting_shop_id: 'shop-1',
      },
      error: null,
    })
  })

  it('records a redemption through the service-only ledger RPC, never through the session client', async () => {
    const { response, payload } = await callRoute({ reward_id: REWARD_ID, request_key: 'a1b2c3d4-e5f6' })

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      points_deducted: 1500,
      new_balance: 500,
      redemption_code: 'RED-TXN1',
      wallet_scope: 'consumer',
      wallet_owner_user_id: 'user-1',
      reporting_shop_id: 'shop-1',
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('consumer_reward_claim', {
      p_user_id: 'user-1',
      p_reward_id: REWARD_ID,
      p_request_key: 'a1b2c3d4-e5f6',
    })
    // No table access at all through the consumer session.
    expect(sessionFrom).not.toHaveBeenCalled()
  })

  it('ignores client-supplied amounts, balances, wallets and user ids', async () => {
    await callRoute({
      reward_id: REWARD_ID,
      points_amount: 999999,
      new_balance: 999999,
      wallet_owner_user_id: 'victim-user',
      user_id: 'victim-user',
      organization_id: 'other-org',
      consumer_phone: '+60100000000',
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    const [, args] = rpc.mock.calls[0]
    expect(Object.keys(args).sort()).toEqual(['p_request_key', 'p_reward_id', 'p_user_id'])
    expect(args.p_user_id).toBe('user-1')
  })

  it('returns the bonus response for an eligible daily bonus', async () => {
    rewardMaybeSingle.mockResolvedValue({
      data: {
        id: REWARD_ID,
        item_name: 'Collect Daily Point',
        item_code: 'daily-point',
        category: 'point',
        collection_mode: 'daily',
        per_user_limit: false,
        reward_message: null,
      },
      error: null,
    })
    rpc.mockResolvedValue({
      data: {
        success: true,
        status: 200,
        transaction_id: 'txn-2',
        is_bonus_points: true,
        points_change: 1,
        required_points: 0,
        new_balance: 2001,
        redemption_code: 'BONUS-TXN2',
        wallet_scope: 'consumer',
        wallet_owner_user_id: 'user-1',
        wallet_owner_org_id: null,
        reporting_shop_id: null,
      },
      error: null,
    })

    const { response, payload } = await callRoute({ reward_id: REWARD_ID })

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      is_bonus_points: true,
      points_earned: 1,
      new_balance: 2001,
      redemption_code: 'BONUS-TXN2',
      collection_mode: 'daily',
    })
    expect(rpc).toHaveBeenCalledWith('consumer_reward_claim', {
      p_user_id: 'user-1',
      p_reward_id: REWARD_ID,
      p_request_key: null,
    })
  })

  it('passes a same-day repeat bonus denial through cleanly', async () => {
    rpc.mockResolvedValue({
      data: {
        success: false,
        status: 400,
        code: 'ALREADY_COLLECTED_TODAY',
        error: 'You have already collected today! Come back tomorrow to collect again.',
      },
      error: null,
    })

    const { response, payload } = await callRoute({ reward_id: REWARD_ID })

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ success: false, code: 'ALREADY_COLLECTED_TODAY' })
  })

  it('returns balance details on insufficient points so the UI can show them', async () => {
    rpc.mockResolvedValue({
      data: {
        success: false,
        status: 400,
        code: 'INSUFFICIENT_POINTS',
        error: 'Insufficient points. You need 1500 points but have 200.',
        current_balance: 200,
        required: 1500,
      },
      error: null,
    })

    const { response, payload } = await callRoute({ reward_id: REWARD_ID })

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ success: false, current_balance: 200, required: 1500 })
  })

  it('reports a replayed request as success without a second claim', async () => {
    rpc.mockResolvedValue({
      data: {
        success: true,
        status: 200,
        replayed: true,
        transaction_id: 'txn-1',
        is_bonus_points: false,
        points_change: -1500,
        required_points: 1500,
        new_balance: 500,
        redemption_code: 'RED-TXN1',
        wallet_scope: 'consumer',
        wallet_owner_user_id: 'user-1',
        wallet_owner_org_id: null,
        reporting_shop_id: 'shop-1',
      },
      error: null,
    })

    const { response, payload } = await callRoute({ reward_id: REWARD_ID, request_key: 'a1b2c3d4-e5f6' })

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, replayed: true, transaction_id: 'txn-1', points_deducted: 1500 })
  })

  it('requires a signed-in consumer', async () => {
    authGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const { response } = await callRoute({ reward_id: REWARD_ID })

    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a malformed request key', async () => {
    const { response } = await callRoute({ reward_id: REWARD_ID, request_key: 'x; drop' })

    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not leak database errors from the ledger RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy for table "points_transactions"' } })

    const { response, payload } = await callRoute({ reward_id: REWARD_ID })

    expect(response.status).toBe(500)
    expect(payload.error).not.toContain('row-level security')
  })

  it('rejects cashback redemption when the personal bank_id is missing even if the account number exists', async () => {
    userSingle.mockResolvedValue({
      data: { id: 'user-1', bank_id: null, bank_account_number: '557175482611' },
      error: null,
    })

    const { response, payload } = await callRoute({ reward_id: REWARD_ID })

    expect(response.status).toBe(400)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Please save a valid personal bank account before redeeming cashback.')
    expect(rpc).not.toHaveBeenCalled()
  })
})
