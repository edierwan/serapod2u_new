/**
 * getPostLoginRedirect.ts
 * ────────────────────────────────────────────────────────────────────
 * Single source of truth for post-login routing.
 *
 * Decision matrix:
 *   No session             → /login
 *   account_scope='portal' AND organization_id present → /dashboard
 *   account_scope='portal' AND organization_id NULL    → /store (misconfigured, audit logged)
 *   account_scope='store'  → /store
 *   Any unexpected state   → /store (fallback, logged)
 *
 * This function is called from:
 *   - GET /api/auth/post-login-redirect  (client calls after login)
 *   - OAuth callback route               (server-side redirect)
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureUserRow, type EnsuredUser } from './ensureUserRow'

export interface PostLoginRedirectResult {
  redirectTo: string
  accountScope: 'store' | 'portal' | null
  userId: string | null
  warnings: string[]
}

export async function getPostLoginRedirect(): Promise<PostLoginRedirectResult> {
  const warnings: string[] = []

  try {
    // 1. Get session from SSR server client
    const supabase = await createClient()
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !authUser) {
      return {
        redirectTo: '/login',
        accountScope: null,
        userId: null,
        warnings: authError ? [`Auth error: ${authError.message}`] : ['No session'],
      }
    }

    // 2. Ensure user row exists (centralized)
    const { user, wasCreated, warnings: ensureWarnings } = await ensureUserRow(
      authUser.id,
      authUser.email ?? '',
      {
        fullName: authUser.user_metadata?.full_name ?? authUser.user_metadata?.name,
        avatarUrl: authUser.user_metadata?.avatar_url ?? authUser.user_metadata?.picture,
        provider: authUser.app_metadata?.provider ?? 'email',
        phone: authUser.phone ?? undefined,
      }
    )
    warnings.push(...ensureWarnings)

    if (wasCreated) {
      console.log(`[getPostLoginRedirect] New user row created for ${user.email}`)
    }

    // 3. Route based on account_scope + organization_id
    return resolveRedirect(user, warnings)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[getPostLoginRedirect] Unexpected error:', message)
    return {
      redirectTo: '/store',
      accountScope: null,
      userId: null,
      warnings: [`Unexpected error: ${message}`],
    }
  }
}

/**
 * Pure routing logic — separated for testability.
 */
function resolveRedirect(
  user: EnsuredUser,
  warnings: string[]
): PostLoginRedirectResult {
  const base = {
    userId: user.id,
    warnings,
  }

  // Portal user with valid org → dashboard
  if (user.account_scope === 'portal' && user.organization_id) {
    return {
      ...base,
      redirectTo: '/dashboard',
      accountScope: 'portal',
    }
  }

  // Portal user WITHOUT org → misconfigured, audit + fallback to store
  if (user.account_scope === 'portal' && !user.organization_id) {
    warnings.push(
      `Portal user ${user.id} (${user.email}) has no organization_id — redirecting to /store`
    )
    console.warn(
      `[getPostLoginRedirect] MISCONFIGURED: portal user ${user.email} missing organization_id`
    )

    // Fire audit log asynchronously (don't block redirect)
    logAuditAsync(user.id, 'PORTAL_MISSING_ORG', {
      email: user.email,
      account_scope: user.account_scope,
    })

    return {
      ...base,
      redirectTo: '/store',
      accountScope: 'portal',
    }
  }

  // Store user → /store
  if (user.account_scope === 'store') {
    return {
      ...base,
      redirectTo: '/store',
      accountScope: 'store',
    }
  }

  // Unexpected state — fallback
  warnings.push(`Unexpected account_scope: ${user.account_scope}`)
  console.warn(`[getPostLoginRedirect] Unexpected scope for ${user.email}: ${user.account_scope}`)

  return {
    ...base,
    redirectTo: '/store',
    accountScope: null,
  }
}

/**
 * Async audit log — fire-and-forget, never blocks.
 */
async function logAuditAsync(
  userId: string,
  eventType: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    const admin = createAdminClient()
    // Note: account_scope_audit_log table added by migration, use (admin as any)
    await (admin as any).from('account_scope_audit_log').insert({
      user_id: userId,
      event_type: eventType,
      details,
    })
  } catch (err) {
    console.warn('[logAuditAsync] Failed:', err)
  }
}
