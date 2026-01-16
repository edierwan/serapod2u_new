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
 * GET /api/admin/support/admins
 * Get list of admins for assignment dropdown
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

    // Get all admin users
    const { data: admins, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, role_code')
      .in('role_code', ['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'])
      .order('full_name')

    if (error) {
      console.error('Error fetching admins:', error)
      return NextResponse.json({ error: 'Failed to fetch admins' }, { status: 500 })
    }

    return NextResponse.json({ admins: admins || [] })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
