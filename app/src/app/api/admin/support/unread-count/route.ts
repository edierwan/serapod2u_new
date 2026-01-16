import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

async function checkAdminRole(supabaseAdmin: any, userId: string): Promise<boolean> {
  const { data: userData, error } = await supabaseAdmin
    .from('users')
    .select('role_code')
    .eq('id', userId)
    .single()

  if (error || !userData) return false
  return ['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)
}

/**
 * GET /api/admin/support/unread-count
 * Get admin's total unread conversation count
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!await checkAdminRole(supabaseAdmin, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Try RPC first
    const { data: count, error: rpcError } = await supabaseAdmin.rpc('get_admin_support_unread_count')

    if (rpcError) {
      // Fallback: direct query
      const { data: conversations } = await supabaseAdmin
        .from('support_conversations')
        .select('admin_unread_count')
        .is('admin_deleted_at', null)
        .not('status', 'in', '(closed,spam,resolved)')

      const totalUnread = conversations?.reduce((sum, c) => sum + (c.admin_unread_count || 0), 0) || 0
      return NextResponse.json({ count: totalUnread })
    }

    return NextResponse.json({ count: count || 0 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
