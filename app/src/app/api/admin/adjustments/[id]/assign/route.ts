import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/adjustments/[id]/assign
 * Body: { manufacturer_org_id: uuid }
 * Only super admins (role_code === 'SA') can perform this operation
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

    if (!body.manufacturer_org_id) {
      return NextResponse.json({ error: 'Missing manufacturer_org_id' }, { status: 400 })
    }

    // Call RPC to assign
    const { data, error } = await supabase.rpc('assign_adjustment_to_manufacturer', { p_adjustment_id: id, p_manufacturer_org_id: body.manufacturer_org_id })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data })
  } catch (err: any) {
    console.error('POST admin assign adjustment', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}
