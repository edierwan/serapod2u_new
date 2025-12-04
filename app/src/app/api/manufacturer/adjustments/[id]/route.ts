import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/manufacturer/adjustments/[id]
 * POST /api/manufacturer/adjustments/[id] (manufacture acknowledges -> set acknowledged fields via RPC)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { id } = await params

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // fetch user profile
    const { data: userProfile } = await supabase.from('users').select('organization_id, role_code').eq('id', user.id).single()

    // find the adjustment
    const { data: adjustment, error } = await supabase
      .from('stock_adjustments')
      .select('*, stock_adjustment_items (*), stock_adjustment_reasons (reason_code, reason_name)')
      .eq('id', id)
      .single()

    if (error || !adjustment) return NextResponse.json({ error: 'Adjustment not found' }, { status: 404 })

    // authorization: manufacturers see assigned to their org OR SA can see all
    if (userProfile.role_code !== 'SA') {
      if (adjustment.target_manufacturer_org_id !== userProfile.organization_id) {
        return NextResponse.json({ error: 'Not allowed to view this adjustment' }, { status: 403 })
      }
    }

    return NextResponse.json({ data: adjustment })
  } catch (err: any) {
    console.error('GET adjustment detail error', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id } = await params

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userProfile } = await supabase.from('users').select('organization_id, role_code').eq('id', user.id).single()
    if (!userProfile) return NextResponse.json({ error: 'User profile not found' }, { status: 400 })

    // Call RPC to acknowledge as manufacturer
    const { data, error } = await supabase.rpc('manufacturer_acknowledge_adjustment', { p_adjustment_id: id, p_notes: body.notes || null })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data })
  } catch (err: any) {
    console.error('POST acknowledge adjustment error', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}
