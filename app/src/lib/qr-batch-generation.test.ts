import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runQRBatchGeneration } from './qr-batch-generation'

vi.mock('@/lib/notifications/supplyChainEventQueue', () => ({ queueNotificationEvent: vi.fn() }))
vi.mock('@/lib/excel-generator', () => ({ generateQRExcel: vi.fn(), generateQRExcelFilename: vi.fn() }))

/** Records the filters applied to the qr_batches lookup and returns "no rows". */
function makeClient() {
  const filters: Array<[string, string, unknown]> = []
  const builder: any = {
    select: () => builder,
    in: (column: string, values: unknown) => (filters.push(['in', column, values]), builder),
    eq: (column: string, value: unknown) => (filters.push(['eq', column, value]), builder),
    order: () => builder,
    limit: () => builder,
    single: async () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } }),
  }
  return { filters, client: { from: vi.fn(() => builder) } as any }
}

describe('runQRBatchGeneration batch selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drains the global queue when no batch is given (cron)', async () => {
    const { client, filters } = makeClient()

    const res = await runQRBatchGeneration(client, { notificationBaseUrl: 'https://stg.serapod2u.com' })

    expect(filters).toEqual([['in', 'status', ['queued', 'processing']]])
    await expect(res.json()).resolves.toEqual({ message: 'No batches to process' })
  })

  it('is narrowed to the authorized batch and never falls back to another one', async () => {
    const { client, filters } = makeClient()

    const res = await runQRBatchGeneration(client, {
      notificationBaseUrl: 'https://stg.serapod2u.com',
      batchId: 'batch-owned-by-caller',
    })

    expect(filters).toContainEqual(['eq', 'id', 'batch-owned-by-caller'])
    await expect(res.json()).resolves.toEqual({ success: true, message: 'Batch is no longer queued', hasMore: false })
    expect(client.from).toHaveBeenCalledTimes(1)
  })
})
