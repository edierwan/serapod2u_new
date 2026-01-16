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

/**
 * GET /api/support/unread-count
 * Get user's total unread message count
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Try RPC first
    const { data: count, error: rpcError } = await supabaseAdmin.rpc('get_user_support_unread_count')

    if (rpcError) {
      // Fallback: direct query
      const { data: conversations } = await supabaseAdmin
        .from('support_conversations')
        .select('user_unread_count')
        .eq('created_by_user_id', user.id)
        .is('user_deleted_at', null)

      const totalUnread = conversations?.reduce((sum, c) => sum + (c.user_unread_count || 0), 0) || 0
      return NextResponse.json({ count: totalUnread })
    }

    return NextResponse.json({ count: count || 0 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
