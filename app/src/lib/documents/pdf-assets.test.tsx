import { afterEach, describe, expect, it } from 'vitest'
import {
  resolvePdfAuditActor,
  resolvePdfImageSource,
  resolvePdfOrganizationLogoSource
} from './pdf-assets'

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

afterEach(() => {
  if (originalSupabaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl
  }
})

describe('PDF asset resolution', () => {
  it('resolves the Organization Information logo relative path through avatars storage', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example.test'

    const resolved = new URL(resolvePdfOrganizationLogoSource('avatars/org-1/logo.jpg')!)

    expect(resolved.origin).toBe('https://storage.example.test')
    expect(resolved.pathname).toBe('/storage/v1/object/public/avatars/org-1/logo.jpg')
  })

  it('keeps the stored organization public URL as the same storage object', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example.test'
    const stored = 'https://storage.example.test/storage/v1/object/public/avatars/org-1/logo.jpg?v=123'

    const resolved = new URL(resolvePdfOrganizationLogoSource(stored)!)

    expect(resolved.pathname).toBe('/storage/v1/object/public/avatars/org-1/logo.jpg')
    expect(resolved.searchParams.get('v')).toBe('123')
  })

  it('resolves relative user signature paths for server-side fetching', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example.test'

    expect(new URL(resolvePdfImageSource('avatars/user-1/signature.png')!).pathname)
      .toBe('/storage/v1/object/public/avatars/user-1/signature.png')
  })
})

describe('PDF audit actors', () => {
  it('pairs a creator or approver full name and signature from the same users row', () => {
    expect(resolvePdfAuditActor({
      full_name: 'Nur Hidayah Binti Salamat',
      signature_url: 'avatars/user-1/signature.png',
      role_code: 'USER_LEVEL'
    })).toEqual({
      full_name: 'Nur Hidayah Binti Salamat',
      signature_url: 'avatars/user-1/signature.png'
    })
  })

  it('does not substitute a role when optional profile name data is missing', () => {
    expect(resolvePdfAuditActor({
      full_name: '  ',
      signature_url: 'avatars/user-1/signature.png',
      role_name: 'HQ Admin'
    })).toBeNull()
  })
})
