'use client'

import { useEffect, useState } from 'react'

type CapabilityAnswer = { allowed: boolean; enforced: boolean }

/**
 * Whether to show an action the server will decide through Security & Access.
 *
 * Asks /api/security-access/me/capabilities for the caller's own S&A answer.
 * Once the permission is enforced the S&A answer decides; until then (or if
 * the lookup fails) the screen's historical rule (`legacyAllowed`) is used, so
 * nothing changes before cut-over. While loading, the action is hidden. The
 * server always decides the operation itself; this only avoids showing
 * controls that would be refused (or hiding ones that would be allowed).
 */
export function useSaCapability(permission: string, legacyAllowed: boolean, organizationId?: string | null): boolean {
  const [answer, setAnswer] = useState<CapabilityAnswer | null | 'failed'>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ permissions: permission })
    if (organizationId) params.set('organizationId', organizationId)
    fetch(`/api/security-access/me/capabilities?${params.toString()}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (cancelled) return
        const value = body?.capabilities?.[permission]
        setAnswer(value && typeof value.allowed === 'boolean' ? value : 'failed')
      })
      .catch(() => { if (!cancelled) setAnswer('failed') })
    return () => { cancelled = true }
  }, [permission, organizationId])

  if (answer === null) return false
  if (answer === 'failed' || !answer.enforced) return legacyAllowed
  return answer.allowed
}
