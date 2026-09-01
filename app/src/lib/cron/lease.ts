import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Database-backed distributed execution lease for internal cron workers.
 *
 * Why this exists: node-cron fires every 60s and does not wait for the previous
 * run to finish, so a single container can overlap a worker with itself. Any
 * additional container multiplies that. In-memory flags cannot protect against
 * either case, and `FOR UPDATE SKIP LOCKED` inside a PostgREST RPC releases its
 * row locks the moment that RPC's transaction commits - which is before the
 * worker performs any external side effect.
 *
 * The lease is held in Postgres (`public.cron_worker_leases`) and acquired with
 * a single atomic INSERT .. ON CONFLICT DO UPDATE .. WHERE lease_until < now().
 */

export const WORKER_NAMES = {
  qrReverse: 'qr-reverse-worker',
  qrGeneration: 'qr-generation-worker',
  manufacturerPacking: 'manufacturer-packing-worker',
  notificationOutbox: 'notification-outbox-worker',
} as const

export type WorkerName = (typeof WORKER_NAMES)[keyof typeof WORKER_NAMES]

/**
 * Lease TTL.
 *
 * Chosen against the workers' real bounds, not arbitrarily:
 *   - qr-generation-worker        maxDuration 60s (internal budget 45-50s)
 *   - manufacturer-packing-worker maxDuration 60s (internal budget 50s)
 *   - notification-outbox-worker  maxDuration 30s
 *   - qr-reverse-worker           no maxDuration export (see caveat below)
 *
 * 180s gives 3x headroom over the longest bounded worker while capping stale
 * lock recovery after a hard crash at three missed 60s ticks. The lease is
 * released in a `finally` on every normal completion, so the TTL only governs
 * crash recovery.
 *
 * Caveat: qr-reverse-worker is unbounded, so a pathological run exceeding 180s
 * could see its lease expire and a second run begin. That worker therefore also
 * carries a per-job `status = 'queued'` CAS claim, so an individual job still
 * cannot be processed twice even if two runs overlap.
 */
export const DEFAULT_LEASE_TTL_SECONDS = 180

/** Response marker for a harmless overlapping invocation. */
export const LEASE_SKIPPED = 'SKIPPED_ALREADY_RUNNING'

/** Minimal shape we need - avoids coupling to the generated Supabase types. */
export interface LeaseCapableClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/** Unique per execution: worker + process + random. */
export function newLeaseOwner(workerName: string): string {
  return `${workerName}:${process.pid}:${randomUUID()}`
}

/** Atomically try to take the lease. Throws if the lease infrastructure is unavailable. */
export async function tryAcquireWorkerLease(
  supabase: LeaseCapableClient,
  workerName: WorkerName | string,
  owner: string,
  ttlSeconds: number = DEFAULT_LEASE_TTL_SECONDS
): Promise<boolean> {
  const { data, error } = await supabase.rpc('try_acquire_worker_lease', {
    p_worker_name: workerName,
    p_owner: owner,
    p_ttl_seconds: ttlSeconds,
  })

  if (error) {
    throw new Error(`Worker lease acquisition failed for ${workerName}: ${error.message}`)
  }

  return data === true
}

/** Release, but only if we still own it. Never throws - releasing is best effort. */
export async function releaseWorkerLease(
  supabase: LeaseCapableClient,
  workerName: WorkerName | string,
  owner: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('release_worker_lease', {
      p_worker_name: workerName,
      p_owner: owner,
    })

    if (error) {
      console.warn(`[WorkerLease] ${workerName}: release failed (${error.message}); lease will expire on TTL`)
      return false
    }

    return data === true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[WorkerLease] ${workerName}: release threw (${message}); lease will expire on TTL`)
    return false
  }
}

export type LeaseOutcome<T> =
  | { status: 'skipped'; response: NextResponse }
  | { status: 'unavailable'; response: NextResponse }
  | { status: 'ran'; result: T }

/**
 * Run `fn` under the worker lease.
 *
 * - lease taken            -> runs `fn`, then always releases in `finally`
 * - lease already held     -> 200 with LEASE_SKIPPED (a normal overlap, not an error)
 * - lease infra unusable   -> 503, and `fn` is NOT run
 *
 * Failing closed on infrastructure errors is deliberate: sending a customer a
 * duplicate SMS is worse than skipping a tick, and a 503 is visible to monitoring
 * whereas a silent success would not be.
 */
export async function withWorkerLease<T>(
  supabase: LeaseCapableClient,
  workerName: WorkerName | string,
  fn: () => Promise<T>,
  ttlSeconds: number = DEFAULT_LEASE_TTL_SECONDS
): Promise<LeaseOutcome<T>> {
  const owner = newLeaseOwner(workerName)
  let acquired = false

  try {
    acquired = await tryAcquireWorkerLease(supabase, workerName, owner, ttlSeconds)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[WorkerLease] ${workerName}: ${message}`)
    return {
      status: 'unavailable',
      response: NextResponse.json(
        { status: 'LEASE_UNAVAILABLE', worker: workerName, message: 'Worker lease unavailable; run skipped' },
        { status: 503 }
      ),
    }
  }

  if (!acquired) {
    console.log(`[WorkerLease] ${workerName}: another execution holds the lease - skipping this run`)
    return {
      status: 'skipped',
      response: NextResponse.json({ status: LEASE_SKIPPED, worker: workerName, processed: 0 }),
    }
  }

  try {
    const result = await fn()
    return { status: 'ran', result }
  } finally {
    await releaseWorkerLease(supabase, workerName, owner)
  }
}
