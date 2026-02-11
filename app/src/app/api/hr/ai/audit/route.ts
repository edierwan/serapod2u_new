/**
 * GET /api/hr/ai/audit
 *
 * Returns the HR configuration readiness audit for the caller's organization.
 * Requires: authenticated user with Super Admin or HR Admin role.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getHrAuthContext, canManageHr } from '@/lib/server/hrAccess'
import { runHrAudit } from '@/lib/ai/hrAudit'

export async function GET(_request: NextRequest) {
  try {
    const supabase = (await createClient()) as any

    // Auth + RBAC
    const authResult = await getHrAuthContext(supabase)
    if (!authResult.success || !authResult.data) {
      return NextResponse.json(
        { success: false, error: authResult.error ?? 'Unauthorized' },
        { status: 401 },
      )
    }

    const ctx = authResult.data
    const allowed = await canManageHr(ctx)
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Insufficient permissions' },
        { status: 403 },
      )
    }

    if (!ctx.organizationId) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 400 },
      )
    }

    // Run audit
    const audit = await runHrAudit(supabase, ctx.organizationId)

    return NextResponse.json({ success: true, data: audit })
  } catch (err: any) {
    console.error('[HR AI Audit] Error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    )
  }
}
