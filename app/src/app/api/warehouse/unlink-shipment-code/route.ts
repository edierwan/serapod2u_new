import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { code, session_id, code_type, user_id } = await request.json()

    if (!code || !session_id || !user_id) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get the session
    const { data: session, error: sessionError } = await supabase
      .from('qr_validation_reports')
      .select('*')
      .eq('id', session_id)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Shipment session not found' },
        { status: 404 }
      )
    }

    if (session.validation_status !== 'pending') {
      return NextResponse.json(
        { error: 'Can only unlink from pending shipments' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    if (code_type === 'master') {
      // Unlink master case
      const { data: masterCode, error: getMasterError } = await supabase
        .from('qr_master_codes')
        .select('id, master_code, case_number, company_id')
        .eq('master_code', code)
        .eq('status', 'warehouse_packed')
        .single()

      if (getMasterError || !masterCode) {
        return NextResponse.json(
          { error: 'Master case not found or not in packed status' },
          { status: 404 }
        )
      }

      // Revert master code status
      const { error: updateMasterError } = await supabase
        .from('qr_master_codes')
        .update({
          status: 'received_warehouse',
          shipped_to_distributor_id: null,
          updated_at: now
        })
        .eq('id', masterCode.id)

      if (updateMasterError) {
        console.error('Error reverting master code:', updateMasterError)
        return NextResponse.json(
          { error: 'Failed to unlink master case' },
          { status: 500 }
        )
      }

      // Revert all unique codes in this master case
      const { error: updateUniqueError } = await supabase
        .from('qr_codes')
        .update({
          status: 'received_warehouse',
          current_location_org_id: session.warehouse_org_id,
          updated_at: now
        })
        .eq('master_code_id', masterCode.id)
        .eq('status', 'warehouse_packed')

      if (updateUniqueError) {
        console.warn('Warning reverting unique codes:', updateUniqueError)
      }

      // Log the unlink movement
      await supabase
        .from('qr_movements')
        .insert({
          company_id: masterCode.company_id,
          qr_master_code_id: masterCode.id,
          movement_type: 'warehouse_unlink',
          from_org_id: session.warehouse_org_id,
          to_org_id: session.warehouse_org_id,
          current_status: 'received_warehouse',
          scanned_at: now,
          scanned_by: user_id,
          notes: `Warehouse unlinked master ${masterCode.master_code} from shipment`
        })

      // Remove from session master_codes_scanned array
      const masterList = (session.master_codes_scanned || []).filter((c: string) => c !== code)
      
      // Recalculate scanned_quantities by querying remaining codes
      let remainingMasters: any[] = []
      if (masterList.length > 0) {
        const { data } = await supabase
          .from('qr_master_codes')
          .select('master_code, id')
          .in('master_code', masterList)
          .eq('status', 'warehouse_packed')
        remainingMasters = data || []
      }

      const uniqueCodes = session.unique_codes_scanned || []
      let remainingUniques: any[] = []
      if (uniqueCodes.length > 0) {
        const { data } = await supabase
          .from('qr_codes')
          .select('code, variant_id, product_variants(variant_name, products(product_name))')
          .in('code', uniqueCodes)
          .eq('status', 'warehouse_packed')
        remainingUniques = data || []
      }

      // Calculate new quantities
      const newScannedQuantities: any = {
        total_units: remainingUniques.length,
        total_cases: remainingMasters.length,
        per_variant: {}
      }

      // Aggregate by variant
      remainingUniques.forEach((qr: any) => {
        const variant = Array.isArray(qr.product_variants) ? qr.product_variants[0] : qr.product_variants
        const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
        const variantKey = qr.variant_id || 'unknown'
        
        if (!newScannedQuantities.per_variant[variantKey]) {
          newScannedQuantities.per_variant[variantKey] = {
            variant_id: qr.variant_id,
            variant_name: variant?.variant_name || 'Unknown',
            product_name: product?.product_name || 'Unknown',
            scanned_qty: 0
          }
        }
        newScannedQuantities.per_variant[variantKey].scanned_qty++
      })

      const { error: updateSessionError } = await supabase
        .from('qr_validation_reports')
        .update({
          master_codes_scanned: masterList,
          scanned_quantities: newScannedQuantities,
          updated_at: now
        })
        .eq('id', session_id)

      if (updateSessionError) {
        console.error('❌ Failed to update session after unlinking master:', updateSessionError)
        throw new Error('Failed to update shipment session')
      }

      console.log('✅ Session updated successfully:', {
        session_id,
        remaining_masters: masterList.length,
        remaining_uniques: uniqueCodes.length,
        new_quantities: newScannedQuantities
      })

      return NextResponse.json({
        success: true,
        message: `Master case #${masterCode.case_number} unlinked successfully`,
        code_type: 'master',
        session_update: {
          master_codes_scanned: masterList,
          unique_codes_scanned: uniqueCodes,
          scanned_quantities: newScannedQuantities
        }
      })

    } else {
      // Unlink unique code
      const { data: uniqueCode, error: getUniqueError } = await supabase
        .from('qr_codes')
        .select('id, code, company_id')
        .eq('code', code)
        .eq('status', 'warehouse_packed')
        .single()

      if (getUniqueError || !uniqueCode) {
        return NextResponse.json(
          { error: 'Unique code not found or not in packed status' },
          { status: 404 }
        )
      }

      // Revert unique code status
      const { error: updateError } = await supabase
        .from('qr_codes')
        .update({
          status: 'received_warehouse',
          current_location_org_id: session.warehouse_org_id,
          updated_at: now
        })
        .eq('id', uniqueCode.id)

      if (updateError) {
        console.error('Error reverting unique code:', updateError)
        return NextResponse.json(
          { error: 'Failed to unlink unique code' },
          { status: 500 }
        )
      }

      // Log the unlink movement
      await supabase
        .from('qr_movements')
        .insert({
          company_id: uniqueCode.company_id,
          qr_code_id: uniqueCode.id,
          movement_type: 'warehouse_unlink',
          from_org_id: session.warehouse_org_id,
          to_org_id: session.warehouse_org_id,
          current_status: 'received_warehouse',
          scanned_at: now,
          scanned_by: user_id,
          notes: `Warehouse unlinked unique code ${uniqueCode.code} from shipment`
        })

      // Remove from session unique_codes_scanned array
      const uniqueList = (session.unique_codes_scanned || []).filter((c: string) => c !== code)
      
      // Recalculate scanned_quantities by querying remaining codes
      const masterCodes = session.master_codes_scanned || []
      let remainingMasters: any[] = []
      if (masterCodes.length > 0) {
        const { data } = await supabase
          .from('qr_master_codes')
          .select('master_code, id')
          .in('master_code', masterCodes)
          .eq('status', 'warehouse_packed')
        remainingMasters = data || []
      }

      let remainingUniques: any[] = []
      if (uniqueList.length > 0) {
        const { data } = await supabase
          .from('qr_codes')
          .select('code, variant_id, product_variants(variant_name, products(product_name))')
          .in('code', uniqueList)
          .eq('status', 'warehouse_packed')
        remainingUniques = data || []
      }

      // Calculate new quantities
      const newScannedQuantities: any = {
        total_units: remainingUniques.length,
        total_cases: remainingMasters.length,
        per_variant: {}
      }

      // Aggregate by variant
      remainingUniques.forEach((qr: any) => {
        const variant = Array.isArray(qr.product_variants) ? qr.product_variants[0] : qr.product_variants
        const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
        const variantKey = qr.variant_id || 'unknown'
        
        if (!newScannedQuantities.per_variant[variantKey]) {
          newScannedQuantities.per_variant[variantKey] = {
            variant_id: qr.variant_id,
            variant_name: variant?.variant_name || 'Unknown',
            product_name: product?.product_name || 'Unknown',
            scanned_qty: 0
          }
        }
        newScannedQuantities.per_variant[variantKey].scanned_qty++
      })

      const { error: updateSessionError } = await supabase
        .from('qr_validation_reports')
        .update({
          unique_codes_scanned: uniqueList,
          scanned_quantities: newScannedQuantities,
          updated_at: now
        })
        .eq('id', session_id)

      if (updateSessionError) {
        console.error('❌ Failed to update session after unlinking unique code:', updateSessionError)
        throw new Error('Failed to update shipment session')
      }

      console.log('✅ Session updated successfully:', {
        session_id,
        remaining_masters: masterCodes.length,
        remaining_uniques: uniqueList.length,
        new_quantities: newScannedQuantities
      })

      return NextResponse.json({
        success: true,
        message: 'Unique code unlinked successfully',
        code_type: 'unique',
        session_update: {
          master_codes_scanned: masterCodes,
          unique_codes_scanned: uniqueList,
          scanned_quantities: newScannedQuantities
        }
      })
    }

  } catch (error: any) {
    console.error('Error unlinking code:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
