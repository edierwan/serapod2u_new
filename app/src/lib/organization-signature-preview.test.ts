import { beforeEach, afterEach, describe, expect, it } from 'vitest'

const SUPABASE_URL = 'https://supabase-stg-serapod.getouch.cloud'
const ANON_KEY = 'anon-test-key'

let getStorageUrl: typeof import('@/lib/utils')['getStorageUrl']

describe('organization signature preview URL resolution', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY
    ;({ getStorageUrl } = await import('@/lib/utils'))
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  })

  it('adds the apikey a self-hosted gateway requires to a stored public signature URL', () => {
    const stored = `${SUPABASE_URL}/storage/v1/object/public/avatars/sig-org-1.png?v=1782149174413`

    const resolved = new URL(getStorageUrl(stored))

    expect(resolved.pathname).toBe('/storage/v1/object/public/avatars/sig-org-1.png')
    expect(resolved.searchParams.get('apikey')).toBe(ANON_KEY)
    expect(resolved.searchParams.get('v')).toBe('1782149174413')
  })

  it('resolves a bare storage path signature reference to a browsable URL', () => {
    const resolved = new URL(getStorageUrl('avatars/org-1/sig.png'))

    expect(resolved.origin).toBe(SUPABASE_URL)
    expect(resolved.pathname).toBe('/storage/v1/object/public/avatars/org-1/sig.png')
    expect(resolved.searchParams.get('apikey')).toBe(ANON_KEY)
  })

  it('returns an empty string when no signature is stored', () => {
    expect(getStorageUrl(null)).toBe('')
  })

  it('leaves an inline data-URL preview of a freshly selected file untouched', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='

    expect(getStorageUrl(dataUrl)).toBe(dataUrl)
  })
})
