import type { NextRequest } from 'next/server'

export function publicOriginFromRequest(request?: NextRequest) {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (env && !/0\.0\.0\.0|127\.0\.0\.1/i.test(env)) return env
  if (request) {
    const xfHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    const xfProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
    if (xfHost && !/0\.0\.0\.0|127\.0\.0\.1/i.test(xfHost)) return `${xfProto}://${xfHost}`
    try {
      const url = new URL(request.url)
      if (!/0\.0\.0\.0|127\.0\.0\.1/i.test(url.hostname)) return url.origin
    } catch {
      // ignore
    }
  }
  return 'https://stg.serapod2u.com'
}
