import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LEASE_TTL_SECONDS,
  LEASE_SKIPPED,
  newLeaseOwner,
  releaseWorkerLease,
  tryAcquireWorkerLease,
  withWorkerLease,
} from './lease'

/**
 * In-memory stand-in for public.cron_worker_leases with the same semantics the
 * SQL implements: acquire only when absent or expired, release only by owner.
 * (The SQL itself is exercised separately against a real Postgres.)
 */
function makeLeaseClient(now: () => number = () => Date.now()) {
  const store = new Map<string, { owner: string; until: number }>()

  const client = {
    store,
    rpc: vi.fn(async (fn: string, args: Record<string, any>) => {
      if (fn === 'try_acquire_worker_lease') {
        const current = store.get(args.p_worker_name)
        if (current && current.until > now()) return { data: false, error: null }
        store.set(args.p_worker_name, {
          owner: args.p_owner,
          until: now() + args.p_ttl_seconds * 1000,
        })
        return { data: true, error: null }
      }
      if (fn === 'release_worker_lease') {
        const current = store.get(args.p_worker_name)
        if (current && current.owner === args.p_owner) {
          store.delete(args.p_worker_name)
          return { data: true, error: null }
        }
        return { data: false, error: null }
      }
      return { data: null, error: null }
    }),
  }

  return client
}

describe('worker lease', () => {
  it('4. first caller acquires the lease', async () => {
    const c = makeLeaseClient()
    await expect(tryAcquireWorkerLease(c, 'w', 'a')).resolves.toBe(true)
  })

  it('5. a concurrent second caller cannot acquire the same lease', async () => {
    const c = makeLeaseClient()
    await tryAcquireWorkerLease(c, 'w', 'a')
    await expect(tryAcquireWorkerLease(c, 'w', 'b')).resolves.toBe(false)
  })

  it('6. different worker names acquire independently', async () => {
    const c = makeLeaseClient()
    await expect(tryAcquireWorkerLease(c, 'w1', 'a')).resolves.toBe(true)
    await expect(tryAcquireWorkerLease(c, 'w2', 'b')).resolves.toBe(true)
  })

  it('7. an owner can release its own lease', async () => {
    const c = makeLeaseClient()
    await tryAcquireWorkerLease(c, 'w', 'a')
    await expect(releaseWorkerLease(c, 'w', 'a')).resolves.toBe(true)
    await expect(tryAcquireWorkerLease(c, 'w', 'b')).resolves.toBe(true)
  })

  it('8. a different owner cannot release someone else’s lease', async () => {
    const c = makeLeaseClient()
    await tryAcquireWorkerLease(c, 'w', 'a')
    await expect(releaseWorkerLease(c, 'w', 'b')).resolves.toBe(false)
    await expect(tryAcquireWorkerLease(c, 'w', 'b')).resolves.toBe(false)
  })

  it('9. an expired lease can be reclaimed (crash recovery)', async () => {
    let clock = 1_000_000
    const c = makeLeaseClient(() => clock)
    await expect(tryAcquireWorkerLease(c, 'w', 'crashed', 10)).resolves.toBe(true)
    clock += 11_000
    await expect(tryAcquireWorkerLease(c, 'w', 'fresh', 10)).resolves.toBe(true)
    expect(c.store.get('w')?.owner).toBe('fresh')
  })

  it('10. an active lease cannot be stolen', async () => {
    let clock = 1_000_000
    const c = makeLeaseClient(() => clock)
    await tryAcquireWorkerLease(c, 'w', 'a', 60)
    clock += 59_000
    await expect(tryAcquireWorkerLease(c, 'w', 'thief', 60)).resolves.toBe(false)
  })

  it('generates a unique owner per execution', () => {
    expect(newLeaseOwner('w')).not.toBe(newLeaseOwner('w'))
  })

  it('uses a TTL that outlives the longest bounded worker (maxDuration 60s)', () => {
    expect(DEFAULT_LEASE_TTL_SECONDS).toBeGreaterThan(60)
  })
})

describe('withWorkerLease', () => {
  it('runs the body and releases the lease afterwards', async () => {
    const c = makeLeaseClient()
    const outcome = await withWorkerLease(c, 'w', async () => 'done')
    expect(outcome.status).toBe('ran')
    expect(c.store.has('w')).toBe(false)
  })

  it('releases the lease even when the body throws', async () => {
    const c = makeLeaseClient()
    await expect(
      withWorkerLease(c, 'w', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(c.store.has('w')).toBe(false)
  })

  it('15. an overlapping invocation returns a clean skip, not an error', async () => {
    const c = makeLeaseClient()
    await tryAcquireWorkerLease(c, 'w', 'someone-else')

    const ran = vi.fn()
    const outcome = await withWorkerLease(c, 'w', async () => ran())

    expect(outcome.status).toBe('skipped')
    expect(ran).not.toHaveBeenCalled()
    if (outcome.status === 'skipped') {
      expect(outcome.response.status).toBe(200)
      await expect(outcome.response.json()).resolves.toMatchObject({ status: LEASE_SKIPPED })
    }
  })

  it('fails CLOSED with 503 when the lease infrastructure errors', async () => {
    const c = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'relation does not exist' } })),
    }
    const ran = vi.fn()
    const outcome = await withWorkerLease(c, 'w', async () => ran())

    expect(outcome.status).toBe('unavailable')
    expect(ran).not.toHaveBeenCalled()
    if (outcome.status === 'unavailable') expect(outcome.response.status).toBe(503)
  })

  it('does not let a stale run release a lease already reclaimed by a newer run', async () => {
    let clock = 1_000_000
    const c = makeLeaseClient(() => clock)

    let staleOwner = ''
    c.rpc.mockClear()
    const stalePromise = withWorkerLease(
      c,
      'w',
      async () => {
        staleOwner = c.store.get('w')!.owner
        clock += 20_000 // its lease expires mid-run
        await tryAcquireWorkerLease(c, 'w', 'newer-run', 10) // another run reclaims it
        return 'stale-finished'
      },
      10
    )

    await stalePromise
    expect(staleOwner).not.toBe('newer-run')
    // the newer run must STILL hold the lease - the stale run's release was a no-op
    expect(c.store.get('w')?.owner).toBe('newer-run')
  })
})
