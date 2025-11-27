export function getEnvironmentLabel() {
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV
  const host = typeof window !== 'undefined' ? window.location.hostname : ''

  if (vercelEnv === 'development' || host === 'localhost') {
    return { badge: 'ENVIRONMENT: DEVELOPMENT', show: true }
  }

  if (vercelEnv === 'preview') {
    return { badge: 'ENVIRONMENT: STAGING', show: true }
  }

  if (vercelEnv === 'production') {
    return { badge: 'ENVIRONMENT: PRODUCTION', show: true }
  }

  return { badge: '', show: false }
}
