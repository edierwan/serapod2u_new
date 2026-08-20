/**
 * Centralized server-side guard for destructive database operations.
 *
 * Defense-in-depth:
 * 1. Environment gate – in production, only the per-record operations listed
 *    in PRODUCTION_ALLOWED_OPERATIONS run by default; everything else (bulk
 *    wipes, schema/RLS changes) needs ALLOW_DESTRUCTIVE_DB_OPS="true".
 *    Outside production every operation is allowed.
 * 2. Super-Admin role check – caller must have role_level === 1.
 * 3. Audit log – every attempt (allowed or blocked) is logged to the
 *    `destructive_ops_audit_log` table **and** to stdout so it shows in
 *    container / Vercel logs.
 *
 * Usage in an API route:
 *
 *   import { assertDestructiveOpsAllowed } from '@/lib/server/destructive-ops-guard'
 *
 *   export async function POST(request: NextRequest) {
 *     const guard = await assertDestructiveOpsAllowed(request, 'delete-transactions-v2')
 *     if (guard.blocked) return guard.response   // already a NextResponse
 *     // ... proceed with the destructive work
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuardResult {
  blocked: boolean
  response: NextResponse
  userId?: string
  userEmail?: string
}

interface AuditEntry {
  operation: string
  user_id: string | null
  user_email: string | null
  allowed: boolean
  reason: string
  ip: string | null
  user_agent: string | null
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/**
 * Operations that stay available in production without the env opt-in.
 * These act on a single record that a Super Admin removes as part of normal
 * day-to-day work, and they still have to clear the authentication and
 * role_level === 1 gates below. Bulk deletions, data resets and schema/RLS
 * changes are deliberately absent: those need ALLOW_DESTRUCTIVE_DB_OPS=true.
 */
const PRODUCTION_ALLOWED_OPERATIONS = new Set<string>(['hard-delete-order'])

function isDestructiveOpsEnvAllowed(operation: string): boolean {
  // Explicit opt-in via env var unlocks every operation
  if (process.env.ALLOW_DESTRUCTIVE_DB_OPS === 'true') return true

  // In production, only the per-record operations above are allowed
  if (process.env.NODE_ENV === 'production') {
    return PRODUCTION_ALLOWED_OPERATIONS.has(operation)
  }

  // In development / test, allow by default so local dev isn't hindered
  return true
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

async function writeAuditLog(entry: AuditEntry): Promise<void> {
  // Always log to stdout (visible in container / Vercel logs)
  const prefix = entry.allowed ? '✅ DESTRUCTIVE-OP ALLOWED' : '🚫 DESTRUCTIVE-OP BLOCKED'
  console.log(
    `${prefix} | op=${entry.operation} | user=${entry.user_email ?? entry.user_id ?? 'unknown'} | reason=${entry.reason} | ip=${entry.ip ?? 'unknown'}`
  )

  // Best-effort write to DB audit table (non-blocking, never throws)
  try {
    const admin = createAdminClient()
    await (admin as any).from('destructive_ops_audit_log').insert({
      operation: entry.operation,
      user_id: entry.user_id,
      user_email: entry.user_email,
      allowed: entry.allowed,
      reason: entry.reason,
      ip_address: entry.ip,
      user_agent: entry.user_agent,
      created_at: new Date().toISOString(),
    })
  } catch {
    // If audit table doesn't exist yet, the stdout log above is the fallback.
  }
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

export async function assertDestructiveOpsAllowed(
  request: NextRequest,
  operation: string
): Promise<GuardResult> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  const userAgent = request.headers.get('user-agent') ?? null

  // --- Gate 1: environment check ---
  if (!isDestructiveOpsEnvAllowed(operation)) {
    const entry: AuditEntry = {
      operation,
      user_id: null,
      user_email: null,
      allowed: false,
      reason: `Environment blocked (production, '${operation}' needs ALLOW_DESTRUCTIVE_DB_OPS=true)`,
      ip,
      user_agent: userAgent,
    }
    await writeAuditLog(entry)
    return {
      blocked: true,
      response: NextResponse.json(
        { error: 'Destructive operations are disabled in this environment.' },
        { status: 403 }
      ),
    }
  }

  // --- Gate 2: authentication ---
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const entry: AuditEntry = {
      operation,
      user_id: null,
      user_email: null,
      allowed: false,
      reason: 'Unauthenticated',
      ip,
      user_agent: userAgent,
    }
    await writeAuditLog(entry)
    return {
      blocked: true,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  // --- Gate 3: Super-Admin role_level === 1 ---
  const { data: profile } = await supabase
    .from('users')
    .select('role_code, roles(role_level)')
    .eq('id', user.id)
    .single()

  const roleLevel = (profile as any)?.roles?.role_level
  if (roleLevel !== 1) {
    const entry: AuditEntry = {
      operation,
      user_id: user.id,
      user_email: user.email ?? null,
      allowed: false,
      reason: `Insufficient role (role_level=${roleLevel})`,
      ip,
      user_agent: userAgent,
    }
    await writeAuditLog(entry)
    return {
      blocked: true,
      response: NextResponse.json(
        { error: 'Access denied. Super Admin only.' },
        { status: 403 }
      ),
    }
  }

  // --- All gates passed ---
  const entry: AuditEntry = {
    operation,
    user_id: user.id,
    user_email: user.email ?? null,
    allowed: true,
    reason: 'All checks passed',
    ip,
    user_agent: userAgent,
  }
  await writeAuditLog(entry)

  return {
    blocked: false,
    response: NextResponse.json({ ok: true }), // not used when blocked=false
    userId: user.id,
    userEmail: user.email ?? undefined,
  }
}
