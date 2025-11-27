export function getEnvironmentLabel() {
  // Only show badge on localhost (development mode)
  // This prevents hydration issues on staging/production
  const nodeEnv = process.env.NODE_ENV

  // Only show in local development
  if (nodeEnv === 'development') {
    return { badge: 'ENVIRONMENT: DEVELOPMENT', show: true }
  }

  // Hide badge for all deployed environments (staging, production)
  return { badge: '', show: false }
}
