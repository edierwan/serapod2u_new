import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Marketing host → internal App Router prefix.
 * Default app hosts (serapod2u, localhost app, etc.) are untouched:
 * their `/` still redirects to `/store` via app/src/app/page.tsx.
 */
export const MARKETING_HOST_PREFIX: Record<string, '/outdoor' | '/corporate'> = {
  'outdoor.serapod.com': '/outdoor',
  'www.outdoor.serapod.com': '/outdoor',
  'serapod.com': '/corporate',
  'www.serapod.com': '/corporate',
  // Local DNS / hosts-file previews (optional)
  'outdoor.localhost': '/outdoor',
  'corporate.localhost': '/corporate',
}

/** Paths that stay on the shared app surface even on marketing hosts. */
const SHARED_PREFIXES = [
  '/store',
  '/api/',
  '/auth',
  '/_next',
  '/outdoor',
  '/corporate',
  '/login',
  '/forgot-password',
  '/brand/',
  '/icons/',
]

export function getRequestHostname(request: NextRequest): string {
  const raw =
    request.headers.get('x-forwarded-host')
    || request.headers.get('host')
    || ''
  return raw.split(',')[0]?.trim().split(':')[0]?.toLowerCase() || ''
}

export function marketingPrefixForHost(hostname: string): '/outdoor' | '/corporate' | null {
  return MARKETING_HOST_PREFIX[hostname] || null
}

/**
 * Rewrite marketing-host URLs into isolated route trees.
 * Returns null when the request must keep the default app behaviour.
 */
export function resolveMarketingHostRewrite(request: NextRequest): NextResponse | null {
  const hostname = getRequestHostname(request)
  const prefix = marketingPrefixForHost(hostname)
  if (!prefix) return null

  const { pathname } = request.nextUrl
  if (SHARED_PREFIXES.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)))) {
    return null
  }

  const url = request.nextUrl.clone()
  url.pathname = pathname === '/' ? prefix : `${prefix}${pathname}`
  return NextResponse.rewrite(url)
}
