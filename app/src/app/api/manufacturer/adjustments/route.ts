import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/manufacturer/adjustments
 * Returns a list of quality & return-to-supplier adjustments visible to the current manufacturer user
 * - Super admin sees all entries
 * - Manufacturer users see entries assigned to their manufacturer org (target_manufacturer_org_id)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch user's profile
    const { data: userProfile, error: profileErr } = await supabase
      .from('users')
      .select('organization_id, role_code')
      .eq('id', user.id)
      .single()

    if (profileErr) {
      return NextResponse.json({ error: 'Unable to fetch user profile' }, { status: 500 })
    }

    const reasonCodes = ['quality_issue', 'return_to_supplier']

    // get reason ids
    const { data: reasons } = await supabase
      .from('stock_adjustment_reasons')
      .select('id, reason_code')
      .in('reason_code', reasonCodes)

    const reasonIds = (reasons || []).map((r: any) => r.id)

    let query = supabase
      .from('stock_adjustments')
      .select(
        `id, organization_id, reason_id, notes, proof_images, status, created_at, created_by, target_manufacturer_org_id, manufacturer_status, manufacturer_acknowledged_at, manufacturer_acknowledged_by, manufacturer_notes, stock_adjustment_items (*), stock_adjustment_reasons (reason_code, reason_name)`
      )
      .in('reason_id', reasonIds)
      .order('created_at', { ascending: false })

    if (userProfile.role_code !== 'SA') {
      // limit to adjustments assigned to the manufacturer organization
      query = query.eq('target_manufacturer_org_id', userProfile.organization_id)
    }

    const { data: adjustments, error } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Manually fetch created_by_user since the foreign key relationship is missing or misconfigured
    const userIds = Array.from(new Set((adjustments || []).map((a: any) => a.created_by).filter(Boolean))) as string[]
    
    let usersMap: Record<string, any> = {}
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', userIds)
      
      if (users) {
        users.forEach((u: any) => {
          usersMap[u.id] = u
        })
      }
    }

    const data = (adjustments || []).map((a: any) => ({
      ...a,
      created_by_user: usersMap[a.created_by] || null
    }))

    return NextResponse.json({ data })
  } catch (err: any) {
    console.error('GET /api/manufacturer/adjustments error', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}
