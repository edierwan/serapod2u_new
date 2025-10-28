import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      console.error('Debug profile lookup failed:', profileError)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (!profile.organization_id) {
      console.warn('Debug user missing organization assignment')
      return NextResponse.json({ error: 'Organization not assigned' }, { status: 400 })
    }

    console.log('🔍 User ID:', user.id)
    console.log('🔍 Org ID:', profile.organization_id)

    // Query 1: All master codes
    const { data: allMasters } = await supabase
      .from('qr_master_codes')
      .select('id, master_code, status, manufacturer_org_id, case_number')
      .order('created_at', { ascending: false })
      .limit(10)

    // Query 2: By org ID only
    const { data: orgMasters } = await supabase
      .from('qr_master_codes')
      .select('id, master_code, status, manufacturer_org_id, case_number')
      .eq('manufacturer_org_id', profile.organization_id)
      .limit(10)

    // Query 3: Packed only
    const { data: packedMasters } = await supabase
      .from('qr_master_codes')
      .select('id, master_code, status, manufacturer_org_id, case_number')
      .eq('status', 'packed')
      .limit(10)

    // Query 4: Both filters
    const { data: scanHistory } = await supabase
      .from('qr_master_codes')
      .select('id, master_code, case_number, status, manufacturer_org_id, batch_id, qr_batches ( order_id, orders ( id, order_no ) )')
      .eq('manufacturer_org_id', profile.organization_id)
      .eq('status', 'packed')
      .limit(10)

    return NextResponse.json({
      success: true,
      user_id: user.id,
      organization_id: profile.organization_id,
      all_masters_count: allMasters?.length || 0,
      org_masters_count: orgMasters?.length || 0,
      packed_masters_count: packedMasters?.length || 0,
      scan_history_count: scanHistory?.length || 0,
      all_masters: allMasters,
      org_masters: orgMasters,
      packed_masters: packedMasters,
      scan_history: scanHistory
    })
  } catch (error: any) {
    console.error('Debug error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
