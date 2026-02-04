import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('role_code')
      .eq('id', user.id)
      .single()

    if (userError || !userData || !['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { status, priority, assigned_admin_user_id } = body

    const updates: any = {}
    if (status) updates.status = status
    if (priority) updates.priority = priority
    if (assigned_admin_user_id !== undefined) updates.assigned_admin_user_id = assigned_admin_user_id

    const { error } = await supabaseAdmin
      .from('support_threads' as any)
      .update(updates)
      .eq('id', id)

    if (error) {
      console.error('Error updating thread:', error)
      return NextResponse.json({ error: 'Failed to update thread' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
