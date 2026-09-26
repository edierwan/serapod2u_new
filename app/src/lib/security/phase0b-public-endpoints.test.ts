import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { checkRateLimit, resetRateLimitsForTests } from './rate-limit'

const rpc = vi.fn()
const qrLookup = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    rpc,
    from: () => {
      const chain: any = { select: () => chain, like: () => chain, maybeSingle: qrLookup }
      return chain
    },
  })),
}))

const repoFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

const get = (url: string, ip = '203.0.113.7') => {
  const request = new Request(url, { headers: { 'x-forwarded-for': ip } }) as any
  request.nextUrl = new URL(url)
  return request
}

describe('rate limiter', () => {
  beforeEach(() => resetRateLimitsForTests())

  it('allows up to the limit within a window and then blocks', () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit('k', 3, 1000, 0).allowed).toBe(true)
    const blocked = checkRateLimit('k', 3, 1000, 10)
    expect(blocked.allowed).toBe(false)
    expect(checkRateLimit('k', 3, 1000, 1001).allowed).toBe(true)
  })
})

describe('GET /api/reference/search (public, minimised)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimitsForTests()
  })

  it('does not list references for empty or short terms', async () => {
    const { GET } = await import('@/app/api/reference/search/route')
    for (const q of ['', 'a', 'ab', '  ab  ']) {
      const response = await GET(get(`http://localhost/api/reference/search?q=${encodeURIComponent(q)}`))
      expect(await response.json()).toEqual({ success: true, results: [] })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns only the fields the picker needs (never email) and caps the limit', async () => {
    rpc.mockResolvedValue({
      data: [{ user_id: 'u1', full_name: 'Ref One', phone: '+60123', email: 'leak@example.com', organization_name: 'HQ' }],
      error: null,
    })
    const { GET } = await import('@/app/api/reference/search/route')
    const response = await GET(get('http://localhost/api/reference/search?q=Ref&limit=500'))
    const payload = await response.json()
    expect(payload.results).toEqual([{ user_id: 'u1', full_name: 'Ref One', phone: '+60123', organization_name: 'HQ' }])
    expect(rpc).toHaveBeenCalledWith('search_eligible_references', { p_search_term: 'Ref', p_limit: 10 })
  })

  it('rate limits bulk enumeration per client', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const { GET } = await import('@/app/api/reference/search/route')
    let lastStatus = 200
    for (let i = 0; i < 31; i++) {
      lastStatus = (await GET(get(`http://localhost/api/reference/search?q=abc${i}`))).status
    }
    expect(lastStatus).toBe(429)
  })
})

describe('POST /api/qr/verify-security-code', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimitsForTests()
  })

  const post = (body: Record<string, unknown>) => new NextRequest('http://localhost/api/qr/verify-security-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.9' },
    body: JSON.stringify(body),
  })

  it('rejects LIKE wildcards in the token before any lookup', async () => {
    const { POST } = await import('@/app/api/qr/verify-security-code/route')
    for (const publicToken of ['%', 'abc_', 'a%b', 'x'.repeat(65)]) {
      const response = await POST(post({ publicToken, code: '12' }))
      expect(response.status).toBe(400)
    }
    expect(qrLookup).not.toHaveBeenCalled()
  })

  it('throttles guessing of the 2-digit code', async () => {
    qrLookup.mockResolvedValue({ data: { code: 'PROD-X-abcdefZZ' } })
    const { POST } = await import('@/app/api/qr/verify-security-code/route')
    const statuses: number[] = []
    for (let i = 0; i < 16; i++) {
      statuses.push((await POST(post({ publicToken: 'abcdef', code: String(i).padStart(2, '0') }))).status)
    }
    // Wrong guesses are 401 until the limit, then 429.
    expect(statuses.slice(0, 15).every((status) => status === 401)).toBe(true)
    expect(statuses[15]).toBe(429)
  })
})

describe('Phase 0B commit C: public QR contract', () => {
  it('middleware resolves the security requirement through the narrow RPC only', () => {
    const middleware = repoFile('app/middleware.ts')
    expect(middleware).toContain('get_qr_security_requirement')
    expect(middleware).not.toContain('.from("qr_codes")')
    expect(middleware).not.toContain('.from("journey_order_links")')
    expect(middleware).not.toContain('.from("journey_configurations")')
  })

  it('public QR routes resolve codes server-side instead of via anon/consumer sessions', () => {
    for (const route of ['app/src/app/api/games/spin/route.ts', 'app/src/app/api/games/daily-quiz/submit/route.ts', 'app/src/app/api/scratch-card/play/route.ts']) {
      expect(repoFile(route), route).toMatch(/await createAdminClient\(\)\s*\n\s*\.from\('qr_codes'\)/)
    }
    const verify = repoFile('app/src/app/api/qr/verify-security-code/route.ts')
    expect(verify).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  it('migration removes anonymous QR/storefront access and unconditional write policies', () => {
    const migration = repoFile('supabase/migrations/20260927120000_phase0b_public_pii_ecommerce_qr.sql')
    expect(migration).toContain("'Allow public read access to ' || t")
    expect(migration).toContain('CREATE POLICY sa_staff_read ON public.%I FOR SELECT TO authenticated USING (public.sa_actor_is_staff(40))')
    expect(migration).toContain('FOR ALL TO service_role USING (true) WITH CHECK (true);')
    expect(migration).toContain('REVOKE ALL ON TABLE public.storefront_orders FROM anon, authenticated;')
    expect(migration).toContain('DROP POLICY IF EXISTS "Authenticated variants access" ON public.product_variants;')
    expect(migration).toContain('unconditional write policies remain')
    expect(migration).toContain('NULL::text AS email')
  })
})
