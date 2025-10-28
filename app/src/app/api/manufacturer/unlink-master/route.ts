import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { master_code_id, user_id } = body

    if (!master_code_id) {
      return NextResponse.json(
        { error: 'Master code ID is required' },
        { status: 400 }
      )
    }

    // Get user for authorization
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get master code record
    const { data: masterCodeRecord, error: masterError } = await supabase
      .from('qr_master_codes')
      .select('*')
      .eq('id', master_code_id)
      .single()

    if (masterError || !masterCodeRecord) {
      return NextResponse.json(
        { error: 'Master code not found' },
        { status: 404 }
      )
    }

    const lockedStatuses = ['received_warehouse', 'shipped_distributor', 'opened']
    if (lockedStatuses.includes(masterCodeRecord.status)) {
      return NextResponse.json(
        {
          error: `Cannot unlink. Master case already processed by warehouse (${masterCodeRecord.status}).`
        },
        { status: 400 }
      )
    }

    // Get all unique codes linked to this master
    const { data: linkedCodes, error: linkedError } = await supabase
      .from('qr_codes')
      .select('id, code')
      .eq('master_code_id', master_code_id)

    if (linkedError) {
      throw linkedError
    }

    const linkedCount = linkedCodes?.length || 0

    // Unlink QR codes - reset to pending status
    const { error: updateError } = await supabase
      .from('qr_codes')
      .update({
        master_code_id: null,
        status: 'pending',
        last_scanned_at: new Date().toISOString(),
        last_scanned_by: user_id || user.id,
        updated_at: new Date().toISOString()
      })
      .eq('master_code_id', master_code_id)

    if (updateError) {
      throw updateError
    }

    // Reset master code to generated status with zero units
    const { error: masterUpdateError } = await supabase
      .from('qr_master_codes')
      .update({
        actual_unit_count: 0,
        status: 'generated',
        manufacturer_scanned_at: null,
        manufacturer_scanned_by: null,
        manufacturer_org_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', master_code_id)

    if (masterUpdateError) {
      throw masterUpdateError
    }

    return NextResponse.json({
      success: true,
      message: `Successfully unlinked ${linkedCount} codes from master case #${masterCodeRecord.case_number}`,
      unlinked_count: linkedCount,
      master_case_number: masterCodeRecord.case_number
    })
  } catch (error: any) {
    console.error('Error unlinking master:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to unlink master case' },
      { status: 500 }
    )
  }
}
