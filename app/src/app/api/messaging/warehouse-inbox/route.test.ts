import { beforeEach, describe, expect, it, vi } from 'vitest'

// The messaging fulfilment migrations are not installed in every environment.
// Where they are absent the inbox table does not exist and PostgREST answers
// the read with Postgres 42P01, which used to surface as a red "Unable to load
// warehouse inbox." banner on the Orders page. That one condition now degrades
// to an empty inbox; every other database failure still has to be a 500.

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  authError: null as unknown,
  requester: {
    id: 'user-1',
    organization_id: 'hq-1',
    organizations: { id: 'hq-1', org_type_code: 'HQ', parent_org_id: null },
  } as unknown,
  requesterError: null as unknown,
  inboxRows: [] as unknown[],
  inboxError: null as unknown,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.user }, error: mocks.authError }),
    },
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({ data: mocks.requester, error: mocks.requesterError }),
      }
      return builder
    },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const result = () => ({ data: mocks.inboxRows, error: mocks.inboxError })
      const builder: any = {
        select: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: () => builder,
        then: (resolve: (value: any) => void) => resolve(result()),
      }
      return builder
    },
  }),
}))

import { GET } from './route'

const INBOX_ROW = {
  id: 'inbox-1',
  order_id: 'order-1',
  order_no: 'ORD-DH-0926-11',
  source_channel: 'telegram',
  status: 'pending_preparation',
  receipt_status: null,
  created_at: '2026-09-07T00:00:00.000Z',
}

describe('GET /api/messaging/warehouse-inbox', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.user = { id: 'user-1' }
    mocks.authError = null
    mocks.requester = {
      id: 'user-1',
      organization_id: 'hq-1',
      organizations: { id: 'hq-1', org_type_code: 'HQ', parent_org_id: null },
    }
    mocks.requesterError = null
    mocks.inboxRows = []
    mocks.inboxError = null
  })

  it('returns the inbox rows for an HQ user when the messaging schema is installed', async () => {
    mocks.inboxRows = [INBOX_ROW]

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].order_no).toBe('ORD-DH-0926-11')
    expect(payload.messagingAvailable).toBe(true)
    expect(payload.actor).toEqual({ orgType: 'HQ', organizationId: 'hq-1' })
  })

  it('serves a warehouse user the same way', async () => {
    mocks.requester = {
      id: 'user-1',
      organization_id: 'wh-1',
      organizations: { id: 'wh-1', org_type_code: 'WH', parent_org_id: 'hq-1' },
    }
    mocks.inboxRows = [INBOX_ROW]

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.messagingAvailable).toBe(true)
    expect(payload.actor.orgType).toBe('WH')
  })

  it('degrades to an empty inbox when messaging_warehouse_inbox does not exist', async () => {
    // Exactly what production returns while the messaging migrations are unapplied.
    mocks.inboxError = {
      code: '42P01',
      details: null,
      hint: null,
      message: 'relation "public.messaging_warehouse_inbox" does not exist',
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.items).toEqual([])
    expect(payload.messagingAvailable).toBe(false)
    expect(payload.actor).toEqual({ orgType: 'HQ', organizationId: 'hq-1' })
    expect(payload.error).toBeUndefined()
    // A missing optional feature is not an incident - it must not log as one.
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('also degrades when PostgREST reports the table missing from its schema cache', async () => {
    mocks.inboxError = {
      code: 'PGRST205',
      details: null,
      hint: null,
      message: "Could not find the table 'public.messaging_warehouse_inbox' in the schema cache",
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.items).toEqual([])
    expect(payload.messagingAvailable).toBe(false)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('does not swallow a PGRST205 naming some other table', async () => {
    mocks.inboxError = {
      code: 'PGRST205',
      details: null,
      hint: null,
      message: "Could not find the table 'public.orders' in the schema cache",
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect((await GET()).status).toBe(500)
  })

  it('still fails loudly for an unrelated database error', async () => {
    mocks.inboxError = {
      code: '42703',
      details: null,
      hint: null,
      message: 'column messaging_warehouse_inbox.receipt_status does not exist',
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.items).toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
  })

  it('does not swallow a 42P01 raised by some other relation', async () => {
    mocks.inboxError = {
      code: '42P01',
      details: null,
      hint: null,
      message: 'relation "public.orders" does not exist',
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET()

    expect(response.status).toBe(500)
  })

  it('returns 401 when the caller is not authenticated', async () => {
    mocks.user = null
    mocks.authError = { message: 'Auth session missing!' }

    const response = await GET()

    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe('Unauthorized')
  })

  it('returns 403 for an organization that is neither HQ nor WH', async () => {
    mocks.requester = {
      id: 'user-1',
      organization_id: 'dist-1',
      organizations: { id: 'dist-1', org_type_code: 'DIST', parent_org_id: 'hq-1' },
    }
    mocks.inboxRows = [INBOX_ROW]

    const response = await GET()

    expect(response.status).toBe(403)
  })

  it('returns 403 when the user has no organization', async () => {
    mocks.requester = { id: 'user-1', organization_id: null, organizations: null }

    const response = await GET()

    expect(response.status).toBe(403)
  })
})
