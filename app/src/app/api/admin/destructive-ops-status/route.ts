import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/destructive-ops-status
 * Returns whether destructive operations are allowed in this environment.
 * Used by the UI to hide/show the Danger Zone tab.
 */
export async function GET() {
  const allowed =
    process.env.ALLOW_DESTRUCTIVE_DB_OPS === 'true' ||
    process.env.NODE_ENV !== 'production'

  return NextResponse.json({ allowed })
}
