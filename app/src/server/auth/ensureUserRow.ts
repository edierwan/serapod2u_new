/**
 * ensureUserRow.ts
 * ────────────────────────────────────────────────────────────────────
 * Centralized server-side function that guarantees a public.users row
 * exists for every authenticated session.
 *
 * Called from:
 *   - getPostLoginRedirect (post-login flow)
 *   - OAuth callback (auth/callback/route.ts)
 *
 * Logic:
 *   1. If row exists → return it (no mutation)
 *   2. If row missing → create with deterministic account_scope:
 *      - @serapod.com / @serapod2u.com email → 'portal'
 *      - everything else → 'store'
 *   3. Log anomalies to account_scope_audit_log
 */

import { createAdminClient } from '@/lib/supabase/admin'

// ── Types ────────────────────────────────────────────────────────

export interface EnsuredUser {
  id: string
  email: string
  full_name: string | null
  account_scope: 'store' | 'portal'
  organization_id: string | null
  is_active: boolean
  auth_provider: string | null
}

export interface EnsureUserResult {
  user: EnsuredUser
  wasCreated: boolean
  warnings: string[]
}

// ── Domain email list for portal scope ──────────────────────────

const PORTAL_EMAIL_DOMAINS = ['serapod.com', 'serapod2u.com']

function isPortalEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return PORTAL_EMAIL_DOMAINS.includes(domain ?? '')
}

// ── Main function ───────────────────────────────────────────────

export async function ensureUserRow(
  authUserId: string,
  authEmail: string,
  meta?: {
    fullName?: string
    avatarUrl?: string
    provider?: string
    phone?: string
  }
): Promise<EnsureUserResult> {
  const admin = createAdminClient()
  const warnings: string[] = []

  // 1. Check if user row already exists
  // Note: account_scope column added by migration, cast through unknown for type safety
  const { data: existing, error: fetchError } = await admin
    .from('users')
    .select('id, email, full_name, account_scope, organization_id, is_active, auth_provider' as any)
    .eq('id', authUserId)
    .maybeSingle()

  if (fetchError) {
    console.error('[ensureUserRow] Failed to fetch user:', fetchError.message)
    // Return a safe fallback — do NOT break login
    return {
      user: {
        id: authUserId,
        email: authEmail,
        full_name: null,
        account_scope: 'store',
        organization_id: null,
        is_active: true,
        auth_provider: meta?.provider ?? null,
      },
      wasCreated: false,
      warnings: [`DB fetch error: ${fetchError.message}`],
    }
  }

  if (existing) {
    // Row exists — return as-is
    return {
      user: existing as unknown as EnsuredUser,
      wasCreated: false,
      warnings,
    }
  }

  // 2. Row missing — create it
  const accountScope: 'store' | 'portal' = isPortalEmail(authEmail) ? 'portal' : 'store'
  const fullName = meta?.fullName || authEmail.split('@')[0]

  // Resolve default role (Guest / role_level 70)
  const { data: guestRole } = await admin
    .from('roles')
    .select('role_code')
    .eq('role_level', 70)
    .maybeSingle()

  // For portal users, try to find the HQ org; for store users, find END_USER org
  let organizationId: string | null = null

  if (accountScope === 'portal') {
    // Portal users from known domains get HQ org by default
    const { data: hqOrg } = await admin
      .from('organizations')
      .select('id')
      .eq('org_type_code', 'HQ')
      .maybeSingle()
    organizationId = hqOrg?.id ?? null

    if (!organizationId) {
      warnings.push('Portal user created without organization_id — HQ org not found')
    }
  } else {
    // Store users get mapped to END_USER org if it exists
    const { data: endUserOrg } = await admin
      .from('organizations')
      .select('id')
      .eq('org_type_code', 'END_USER')
      .maybeSingle()
    organizationId = endUserOrg?.id ?? null
  }

  const newUser = {
    id: authUserId,
    email: authEmail,
    full_name: fullName,
    account_scope: accountScope,
    organization_id: organizationId,
    role_code: guestRole?.role_code ?? 'GUEST',
    is_active: true,
    auth_provider: meta?.provider ?? 'email',
    avatar_url: meta?.avatarUrl ?? null,
    phone: meta?.phone ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }

  const { error: insertError } = await admin.from('users').insert(newUser as any)

  if (insertError) {
    console.error('[ensureUserRow] Failed to create user:', insertError.message)
    warnings.push(`Insert error: ${insertError.message}`)

    // Attempt re-fetch in case of race condition (another request created it)
    const { data: reFetch } = await admin
      .from('users')
      .select('id, email, full_name, account_scope, organization_id, is_active, auth_provider' as any)
      .eq('id', authUserId)
      .maybeSingle()

    if (reFetch) {
      return { user: reFetch as unknown as EnsuredUser, wasCreated: false, warnings }
    }

    // Truly failed — return safe fallback
    return {
      user: {
        id: authUserId,
        email: authEmail,
        full_name: fullName,
        account_scope: accountScope,
        organization_id: organizationId,
        is_active: true,
        auth_provider: meta?.provider ?? null,
      },
      wasCreated: true,
      warnings,
    }
  }

  // 3. Log the auto-creation
  // Note: account_scope_audit_log table added by migration, use (admin as any)
  await (admin as any).from('account_scope_audit_log').insert({
    user_id: authUserId,
    event_type: 'USER_AUTO_CREATED',
    details: {
      email: authEmail,
      account_scope: accountScope,
      provider: meta?.provider ?? 'email',
      organization_id: organizationId,
    },
  }).then(null, (err: unknown) => {
    console.warn('[ensureUserRow] Audit log insert failed:', err)
  })

  console.log(`[ensureUserRow] Created user row: ${authEmail} → scope=${accountScope}`)

  return {
    user: {
      id: authUserId,
      email: authEmail,
      full_name: fullName,
      account_scope: accountScope,
      organization_id: organizationId,
      is_active: true,
      auth_provider: meta?.provider ?? null,
    },
    wasCreated: true,
    warnings,
  }
}
