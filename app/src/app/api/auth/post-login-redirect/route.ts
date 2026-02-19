/**
 * GET /api/auth/post-login-redirect
 * ────────────────────────────────────────────────────────────────────
 * Returns { redirectTo } based on the authenticated user's account_scope.
 * Called by the login page client after successful login.
 *
 * Response:
 *   200 → { redirectTo: '/dashboard' | '/store', accountScope }
 *   401 → { redirectTo: '/login' }
 */

import { NextResponse } from 'next/server'
import { getPostLoginRedirect } from '@/server/auth/getPostLoginRedirect'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await getPostLoginRedirect()

    // Log warnings server-side for observability
    if (result.warnings.length > 0) {
      console.warn('[api/post-login-redirect] Warnings:', result.warnings)
    }

    if (!result.userId) {
      return NextResponse.json(
        { redirectTo: result.redirectTo, accountScope: null },
        { status: 401 }
      )
    }

    return NextResponse.json({
      redirectTo: result.redirectTo,
      accountScope: result.accountScope,
    })
  } catch (err) {
    console.error('[api/post-login-redirect] Error:', err)
    return NextResponse.json(
      { redirectTo: '/store', accountScope: null },
      { status: 200 }
    )
  }
}
