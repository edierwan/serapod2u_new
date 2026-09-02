import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for the confirmed cron double-fire root cause.
 *
 * The Next.js standalone production runtime evaluates `cron-scheduler` TWICE in
 * the same Node process. Each evaluation used to get its own module-scoped
 * `started` flag and registered its own four node-cron tasks, so every worker
 * ran ~2x/minute.
 *
 * The decisive test is "a second MODULE EVALUATION registers nothing".
 * `vi.resetModules()` + re-import reproduces exactly that: the module registry
 * is cleared and the module body is evaluated again, while `globalThis` (where
 * ownership now lives) survives - which is precisely the production condition.
 */

const scheduleMock = vi.fn()
vi.mock('node-cron', () => ({
  default: { schedule: (...args: unknown[]) => scheduleMock(...args) },
}))

const REGISTRY_KEY = Symbol.for('serapod2u.cron.scheduler.registry')
const originalEnv = { ...process.env }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  scheduleMock.mockReset()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any)[REGISTRY_KEY]
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  process.env.INTERNAL_CRON_BASE_URL = 'http://127.0.0.1:3000'
  process.env.CRON_SECRET = 'test-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any)[REGISTRY_KEY]
  process.env = { ...originalEnv }
})

const flush = () => new Promise((r) => setTimeout(r, 0))
const WORKERS = [
  '/api/cron/qr-reverse-worker',
  '/api/cron/qr-generation-worker',
  '/api/cron/manufacturer-packing-worker',
  '/api/cron/notification-outbox-worker',
]

describe('single-start guarantee', () => {
  it('1. first initialization registers the scheduler', async () => {
    const mod = await import('./cron-scheduler')
    mod.startCronScheduler()
    expect(scheduleMock).toHaveBeenCalledTimes(4)
    expect(mod.__getCronRegistryForTests().started).toBe(true)
  })

  it('2. a second call within the SAME module instance registers nothing more', async () => {
    const mod = await import('./cron-scheduler')
    mod.startCronScheduler()
    mod.startCronScheduler()
    mod.startCronScheduler()
    expect(scheduleMock).toHaveBeenCalledTimes(4)
  })

  it('3. a second MODULE EVALUATION registers nothing (the actual root cause)', async () => {
    // --- module evaluation A ---
    const modA = await import('./cron-scheduler')
    modA.startCronScheduler()
    expect(scheduleMock).toHaveBeenCalledTimes(4)
    const ownerA = modA.__getCronRegistryForTests().schedulerInstanceId

    // --- module evaluation B: fresh module body, same process, same globalThis ---
    vi.resetModules()
    const modB = await import('./cron-scheduler')
    expect(modB).not.toBe(modA) // genuinely a different module instance
    modB.startCronScheduler()

    // still four - B must not add its own tasks
    expect(scheduleMock).toHaveBeenCalledTimes(4)
    // and B sees the SAME shared registry, not a fresh one
    expect(modB.__getCronRegistryForTests().schedulerInstanceId).toBe(ownerA)
  })

  it('3b. BEHAVIOUR ONLY: two module evaluations yield 4 registrations, not 8', async () => {
    // Deliberately uses no new exports, so it fails against the OLD
    // module-scoped implementation for the right reason: 8 tasks instead of 4.
    const modA = await import('./cron-scheduler')
    modA.startCronScheduler()

    vi.resetModules()
    const modB = await import('./cron-scheduler')
    modB.startCronScheduler()

    expect(scheduleMock).toHaveBeenCalledTimes(4)
  })

  it('4. exactly four routes are registered, one per worker', async () => {
    const mod = await import('./cron-scheduler')
    mod.startCronScheduler()
    const registered = [...mod.__getCronRegistryForTests().registeredPaths]
    expect(registered).toHaveLength(4)
    expect(new Set(registered)).toEqual(new Set(WORKERS))
  })

  it('5. no route is ever registered twice across three module evaluations', async () => {
    for (let i = 0; i < 3; i++) {
      vi.resetModules()
      const mod = await import('./cron-scheduler')
      mod.startCronScheduler()
    }
    expect(scheduleMock).toHaveBeenCalledTimes(4)

    const mod = await import('./cron-scheduler')
    expect(mod.__getCronRegistryForTests().registeredPaths.size).toBe(4)
  })

  it('logs the duplicate suppression once per extra evaluation, not per tick', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const modA = await import('./cron-scheduler')
    modA.startCronScheduler()

    vi.resetModules()
    const modB = await import('./cron-scheduler')
    modB.startCronScheduler()

    const suppressed = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('Duplicate scheduler initialization suppressed'))
    expect(suppressed).toHaveLength(1)
    warn.mockRestore()
  })
})

describe('dispatch behaviour', () => {
  it('6. one minute tick produces one dispatch per route', async () => {
    const mod = await import('./cron-scheduler')
    mod.startCronScheduler()

    for (const call of scheduleMock.mock.calls) {
      ;(call[1] as () => void)()
    }
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(new Set(urls).size).toBe(4)
  })

  it('7. the global dispatch guard holds ACROSS module evaluations', async () => {
    const modA = await import('./cron-scheduler')
    expect(modA.claimDispatchSlot('/api/cron/x', '*/1 * * * *', 60_000)).toBe(true)

    // a second module evaluation must NOT get a fresh dispatch map
    vi.resetModules()
    const modB = await import('./cron-scheduler')
    expect(modB.claimDispatchSlot('/api/cron/x', '*/1 * * * *', 60_100)).toBe(false)

    // next minute is allowed again
    expect(modB.claimDispatchSlot('/api/cron/x', '*/1 * * * *', 120_000)).toBe(true)
  })

  it('a double-fired callback still results in a single HTTP request', async () => {
    const mod = await import('./cron-scheduler')
    mod.startCronScheduler()
    const callback = scheduleMock.mock.calls[0][1] as () => void

    callback()
    callback()
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('8. six-field (sub-minute) schedules are never suppressed', async () => {
    const mod = await import('./cron-scheduler')
    expect(mod.isMinuteGranular('*/1 * * * *')).toBe(true)
    expect(mod.isMinuteGranular('*/20 * * * * *')).toBe(false)
    expect(mod.claimDispatchSlot('/api/cron/y', '*/20 * * * * *', 60_000)).toBe(true)
    expect(mod.claimDispatchSlot('/api/cron/y', '*/20 * * * * *', 60_100)).toBe(true)
  })

  it('sends the cron credential and no diagnostic headers remain', async () => {
    const mod = await import('./cron-scheduler')
    mod.startCronScheduler()
    ;(scheduleMock.mock.calls[0][1] as () => void)()
    await flush()

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-secret')
    expect(Object.keys(headers).some((h) => h.toLowerCase().startsWith('x-serapod-cron'))).toBe(false)
    expect(init.redirect).toBe('manual')
  })

  it('a 3xx follows exactly once, no unbounded retry', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response(null, { status: 307, headers: { location: '/api/cron/qr-reverse-worker' } })
    )
    const mod = await import('./cron-scheduler')
    mod.startCronScheduler()
    ;(scheduleMock.mock.calls[0][1] as () => void)()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
