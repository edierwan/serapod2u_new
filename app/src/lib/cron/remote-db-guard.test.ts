import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteDbWorkerBlockReason, remoteDbWorkerBlockedResponse } from './remote-db-guard'

const STAGING_DB = 'https://supabase-stg-serapod.getouch.cloud'
const PROD_DB = 'https://supabase-prd-serapod.getouch.cloud'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('remoteDbWorkerBlockReason', () => {
  it('blocks next dev (localhost app) connected to the staging database', () => {
    expect(
      remoteDbWorkerBlockReason({ nodeEnv: 'development', supabaseUrl: STAGING_DB, appUrl: 'http://localhost:3000' })
    ).toContain('supabase-stg-serapod.getouch.cloud')
  })

  it('blocks a local production build whose app URL is loopback', () => {
    expect(
      remoteDbWorkerBlockReason({ nodeEnv: 'production', supabaseUrl: STAGING_DB, appUrl: 'http://127.0.0.1:3000' })
    ).toContain('app URL host 127.0.0.1')
  })

  it('allows the deployed staging runtime', () => {
    expect(
      remoteDbWorkerBlockReason({ nodeEnv: 'production', supabaseUrl: STAGING_DB, appUrl: 'https://stg.serapod2u.com' })
    ).toBeNull()
  })

  it('allows the deployed production runtime', () => {
    expect(
      remoteDbWorkerBlockReason({ nodeEnv: 'production', supabaseUrl: PROD_DB, appUrl: 'https://www.serapod2u.com' })
    ).toBeNull()
  })

  it('allows a production runtime with no app URL configured', () => {
    expect(remoteDbWorkerBlockReason({ nodeEnv: 'production', supabaseUrl: PROD_DB, appUrl: undefined })).toBeNull()
  })

  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://host.docker.internal:54321'])(
    'never blocks local development against a local Supabase (%s)',
    (supabaseUrl) => {
      expect(remoteDbWorkerBlockReason({ nodeEnv: 'development', supabaseUrl, appUrl: 'http://localhost:3000' })).toBeNull()
    }
  )

  it('does nothing when no database is configured (unit tests)', () => {
    expect(remoteDbWorkerBlockReason({ nodeEnv: 'test', supabaseUrl: undefined })).toBeNull()
  })

  it.each(['true', '1', 'yes', 'TRUE'])('honours ALLOW_REMOTE_DB_WORKERS_FROM_LOCAL=%s', (override) => {
    expect(
      remoteDbWorkerBlockReason({ nodeEnv: 'development', supabaseUrl: STAGING_DB, appUrl: 'http://localhost:3000', override })
    ).toBeNull()
  })

  it.each(['false', '0', 'off', '', undefined])('does not treat %s as an override', (override) => {
    expect(
      remoteDbWorkerBlockReason({ nodeEnv: 'development', supabaseUrl: STAGING_DB, appUrl: 'http://localhost:3000', override })
    ).not.toBeNull()
  })

  it('reads the process environment by default', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STAGING_DB)
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    expect(remoteDbWorkerBlockReason()).not.toBeNull()

    vi.stubEnv('ALLOW_REMOTE_DB_WORKERS_FROM_LOCAL', 'true')
    expect(remoteDbWorkerBlockReason()).toBeNull()
  })
})

describe('remoteDbWorkerBlockedResponse', () => {
  it('returns a 409 that names the override and the database host', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = remoteDbWorkerBlockedResponse('qr-generation-worker', {
      nodeEnv: 'development',
      supabaseUrl: STAGING_DB,
      appUrl: 'http://localhost:3000',
    })

    expect(res?.status).toBe(409)
    const body = await res!.json()
    expect(body.status).toBe('REMOTE_DB_WORKER_BLOCKED')
    expect(body.details).toContain('ALLOW_REMOTE_DB_WORKERS_FROM_LOCAL=true')
  })

  it('returns null when the worker may run', () => {
    expect(
      remoteDbWorkerBlockedResponse('qr-generation-worker', { nodeEnv: 'production', supabaseUrl: STAGING_DB, appUrl: 'https://stg.serapod2u.com' })
    ).toBeNull()
  })
})
