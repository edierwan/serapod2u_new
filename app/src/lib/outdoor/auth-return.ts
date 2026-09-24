export const OUTDOOR_OAUTH_NEXT_COOKIE = 'outdoor_oauth_next'
export const OUTDOOR_AUTH_NEXT_STORAGE = 'outdoor_auth_next'
export const OUTDOOR_HOME = '/outdoor'

function pathnameOf(path: string) {
  return path.split('?')[0] || path
}

function isAuthOrCallbackPath(path: string) {
  const pathname = pathnameOf(path)
  return (
    pathname === '/outdoor/login' ||
    pathname === '/outdoor/register' ||
    pathname === '/outdoor/forgot-password' ||
    pathname === '/auth/callback'
  )
}

export function sanitizeOutdoorReturnPath(
  raw: string | null | undefined,
  fallback = OUTDOOR_HOME,
): string {
  if (!raw) return fallback
  const path = raw.trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/api/')) return fallback
  if (!path.startsWith('/outdoor')) return fallback
  if (isAuthOrCallbackPath(path)) return fallback
  return path
}

export function outdoorReturnPathFromLocation(pathname: string, search = ''): string {
  const query = search.startsWith('?') ? search.slice(1) : search
  if (
    pathname.startsWith('/outdoor/login') ||
    pathname.startsWith('/outdoor/register') ||
    pathname.startsWith('/outdoor/forgot-password')
  ) {
    return sanitizeOutdoorReturnPath(new URLSearchParams(query).get('next'))
  }
  return sanitizeOutdoorReturnPath(`${pathname}${search}`)
}

export function outdoorAuthHref(kind: 'login' | 'register', pathname: string, search = '') {
  const next = outdoorReturnPathFromLocation(pathname, search)
  return `/outdoor/${kind}?next=${encodeURIComponent(next)}`
}

export function persistOutdoorReturnPath(path: string) {
  const safe = sanitizeOutdoorReturnPath(path)
  try {
    sessionStorage.setItem(OUTDOOR_AUTH_NEXT_STORAGE, safe)
  } catch {
    // Private mode / SSR
  }
  if (typeof document !== 'undefined') {
    document.cookie = `${OUTDOOR_OAUTH_NEXT_COOKIE}=${encodeURIComponent(safe)}; Path=/; Max-Age=600; SameSite=Lax`
  }
  return safe
}

export function readPersistedOutdoorReturnPath(): string | null {
  try {
    const stored = sessionStorage.getItem(OUTDOOR_AUTH_NEXT_STORAGE)
    if (stored) return sanitizeOutdoorReturnPath(stored)
  } catch {
    // ignore
  }
  return null
}

export function outdoorReturnFromReferrer(referrer: string, origin: string): string | null {
  try {
    if (!referrer) return null
    const url = new URL(referrer)
    if (url.origin !== origin) return null
    const path = sanitizeOutdoorReturnPath(`${url.pathname}${url.search}`, '')
    return path || null
  } catch {
    return null
  }
}

export function resolveOutdoorReturnPath(nextParam: string | null, redirectParam?: string | null) {
  const fromQuery = sanitizeOutdoorReturnPath(nextParam || redirectParam || null, '')
  if (fromQuery) return persistOutdoorReturnPath(fromQuery)

  const fromStorage = readPersistedOutdoorReturnPath()
  if (fromStorage && fromStorage !== OUTDOOR_HOME) return persistOutdoorReturnPath(fromStorage)

  if (typeof window !== 'undefined') {
    const fromReferrer = outdoorReturnFromReferrer(document.referrer, window.location.origin)
    if (fromReferrer) return persistOutdoorReturnPath(fromReferrer)
  }

  return persistOutdoorReturnPath(fromStorage || OUTDOOR_HOME)
}

export function outdoorPublicOrigin() {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (env && !/0\.0\.0\.0|127\.0\.0\.1/i.test(env)) return env
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location
    if (hostname && !/^(0\.0\.0\.0)$/i.test(hostname)) return origin
  }
  return 'https://stg.serapod2u.com'
}
