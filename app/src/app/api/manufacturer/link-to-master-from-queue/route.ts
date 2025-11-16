import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      batch_id,
      order_id,
      master_code,
      manufacturer_org_id,
      user_id,
      target_units
    } = body

    // Validation
    if (!batch_id || !order_id || !master_code || !manufacturer_org_id) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: batch_id, order_id, master_code, manufacturer_org_id' },
        { status: 400 }
      )
    }

    console.log('🔗 Link from queue request:', { batch_id, order_id, master_code, target_units })

    // Verify user belongs to manufacturer org
    const { data: userProfile } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userProfile || userProfile.organization_id !== manufacturer_org_id) {
      return NextResponse.json(
        { success: false, error: 'User does not belong to manufacturer organization' },
        { status: 403 }
      )
    }

    // Get master code details
    const { data: masterCodeData, error: masterError } = await supabase
      .from('qr_master_codes')
      .select('*, qr_batches!inner(order_id, batch_code)')
      .eq('master_code', master_code)
      .single()

    if (masterError || !masterCodeData) {
      console.error('Master code query error:', masterError)
      return NextResponse.json(
        { success: false, error: 'Master code not found or not part of this batch' },
        { status: 404 }
      )
    }

    // Verify master belongs to this batch
    const batchData = Array.isArray(masterCodeData.qr_batches) 
      ? masterCodeData.qr_batches[0] 
      : masterCodeData.qr_batches

    if (!batchData || batchData.order_id !== order_id) {
      return NextResponse.json(
        { success: false, error: 'Master code does not belong to this order' },
        { status: 400 }
      )
    }

    // Determine target units
    const targetCount = target_units || masterCodeData.expected_unit_count || 100

    console.log(`📊 Target units: ${targetCount}`)

    // Fetch prepared codes from queue
    const { data: preparedCodes, error: preparedError } = await supabase
      .from('qr_prepared_codes')
      .select('id, code, sequence_number')
      .eq('order_id', order_id)
      .eq('batch_id', batch_id)
      .eq('status', 'prepared')
      .order('created_at', { ascending: true })
      .limit(targetCount)

    if (preparedError) {
      console.error('Error fetching prepared codes:', preparedError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch prepared codes: ' + preparedError.message },
        { status: 500 }
      )
    }

    if (!preparedCodes || preparedCodes.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No prepared codes available in queue. Please submit a reverse job first.' },
        { status: 400 }
      )
    }

    console.log(`✅ Found ${preparedCodes.length} prepared codes`)

    // Extract codes and IDs
    const codesToLink = preparedCodes.map(pc => pc.code)
    const preparedCodeIds = preparedCodes.map(pc => pc.id)

    // Link codes to master
    // Update qr_codes to link them to this master
    const { data: linkedCodes, error: linkError } = await supabase
      .from('qr_codes')
      .update({
        master_code_id: masterCodeData.id,
        status: 'packed',
        scanned_at: new Date().toISOString(),
        scanned_by: user_id
      })
      .in('code', codesToLink)
      .eq('batch_id', batch_id)
      .is('master_code_id', null) // Only unlinked codes
      .select('code')

    if (linkError) {
      console.error('Error linking codes:', linkError)
      return NextResponse.json(
        { success: false, error: 'Failed to link codes: ' + linkError.message },
        { status: 500 }
      )
    }

    const actualLinkedCodes = linkedCodes?.map(c => c.code) || []
    console.log(`✅ Linked ${actualLinkedCodes.length} codes to master`)

    // Mark consumed codes as consumed
    const consumedIds = preparedCodes
      .filter(pc => actualLinkedCodes.includes(pc.code))
      .map(pc => pc.id)

    if (consumedIds.length > 0) {
      const { error: updateError } = await supabase
        .from('qr_prepared_codes')
        .update({ 
          status: 'consumed', 
          consumed_at: new Date().toISOString() 
        })
        .in('id', consumedIds)

      if (updateError) {
        console.error('Error marking codes as consumed:', updateError)
        // Don't fail the request, codes are already linked
      } else {
        console.log(`✅ Marked ${consumedIds.length} codes as consumed`)
      }
    }

    // Update master code actual_unit_count
    const { error: masterUpdateError } = await supabase
      .from('qr_master_codes')
      .update({
        actual_unit_count: actualLinkedCodes.length,
        updated_at: new Date().toISOString()
      })
      .eq('id', masterCodeData.id)

    if (masterUpdateError) {
      console.error('Error updating master code count:', masterUpdateError)
    }

    // Calculate unused codes (prepared but not linked)
    const unusedCodes = codesToLink.filter(code => !actualLinkedCodes.includes(code))

    return NextResponse.json({
      success: true,
      master_code_info: {
        master_code: masterCodeData.master_code,
        case_number: masterCodeData.case_number,
        expected_units: targetCount,
        actual_units: actualLinkedCodes.length
      },
      linked_codes: actualLinkedCodes,
      linked_count: actualLinkedCodes.length,
      skipped_variant_codes: [], // Could implement variant filtering later
      unused_codes: unusedCodes,
      from_queue: true,
      consumed_count: consumedIds.length,
      message: `Successfully linked ${actualLinkedCodes.length} codes to Case #${masterCodeData.case_number}`
    })

  } catch (error: any) {
    console.error('Error in link-to-master-from-queue:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
