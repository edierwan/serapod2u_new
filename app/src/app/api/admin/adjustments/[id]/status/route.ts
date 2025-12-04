import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/adjustments/[id]/status
 * Body: { status: 'resolved' | 'rejected', notes?: string }
 * Only super admins (role_code === 'SA') allowed
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id } = await params

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userProfile } = await supabase.from('users').select('role_code').eq('id', user.id).single()
    if (!userProfile || userProfile.role_code !== 'SA') {
      return NextResponse.json({ error: 'Forbidden - super admin only' }, { status: 403 })
    }

    const allowed = ['resolved', 'rejected']
    if (!body.status || !allowed.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const { data, error } = await supabase.rpc('admin_update_adjustment_status', { p_adjustment_id: id, p_status: body.status, p_notes: body.notes || null })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data })
  } catch (err: any) {
    console.error('POST admin change adjustment status', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}
