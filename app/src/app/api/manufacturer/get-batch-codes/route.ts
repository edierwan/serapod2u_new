import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/manufacturer/get-batch-codes
 * Fetch all unique codes for a batch/order and optionally exclude specific codes
 * Used for Reverse Scan Mode (Mode B)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { batch_id, order_id, exclude_codes } = body

    console.log('🔍 Get batch codes request:', { 
      batch_id,
      order_id,
      exclude_codes_count: exclude_codes?.length || 0
    })

    // Must provide either batch_id or order_id
    if (!batch_id && !order_id) {
      return NextResponse.json(
        { error: 'Either batch_id or order_id is required' },
        { status: 400 }
      )
    }

    const allowableStatuses = ['pending', 'generated', 'printed']

    // Build query to fetch all unique codes for the batch/order
    let query = supabase
      .from('qr_codes')
      .select(`
        id,
        code,
        sequence_number,
        product_id,
        variant_id,
        master_code_id,
        status,
        product_variants (
          variant_name,
          variant_code
        ),
        products (
          product_code,
          product_name
        )
      `)
      .is('master_code_id', null) // Only fetch codes not yet linked to a master case
      .in('status', allowableStatuses)

    // Filter by batch_id or order_id
    if (batch_id) {
      query = query.eq('batch_id', batch_id)
    } else if (order_id) {
      query = query.eq('order_id', order_id)
    }

    // Note: manufacturer_org_id filtering is not needed here as the batch_id/order_id
    // already ensures we're getting codes from the correct manufacturer's batch

    const { data: allCodes, error: fetchError } = await query.order('sequence_number', { ascending: true })

    if (fetchError) {
      console.error('❌ Failed to fetch batch codes:', fetchError)
      throw fetchError
    }

    if (!allCodes || allCodes.length === 0) {
      return NextResponse.json(
        { 
          error: 'No available codes found for this batch/order. All codes may already be linked to master cases.',
          available_codes_count: 0
        },
        { status: 404 }
      )
    }

    console.log('📊 Found codes:', {
      total_available: allCodes.length,
      will_exclude: exclude_codes?.length || 0
    })

    // Filter out excluded codes if provided
    let finalCodes = allCodes
    let excludedCodes: typeof allCodes = []
    let notFoundExclusions: string[] = []

    if (exclude_codes && Array.isArray(exclude_codes) && exclude_codes.length > 0) {
      const excludeSet = new Set(exclude_codes.map(code => code.trim()))
      
      // Separate codes into excluded and included
      finalCodes = allCodes.filter(qr => !excludeSet.has(qr.code))
      excludedCodes = allCodes.filter(qr => excludeSet.has(qr.code))
      
      // Check if any excluded codes were not found in the batch
      const foundExcludedSet = new Set(excludedCodes.map(qr => qr.code))
      notFoundExclusions = Array.from(excludeSet).filter(code => !foundExcludedSet.has(code))
      
      console.log('📊 Exclusion results:', {
        requested_exclusions: exclude_codes.length,
        successfully_excluded: excludedCodes.length,
        not_found_in_batch: notFoundExclusions.length,
        remaining_codes: finalCodes.length
      })
    }

    // Format the response with detailed product info
    const formattedCodes = finalCodes.map(qr => {
      const product = Array.isArray(qr.products) ? qr.products[0] : qr.products
      const variant = Array.isArray(qr.product_variants) ? qr.product_variants[0] : qr.product_variants
      
      return {
        id: qr.id,
        code: qr.code,
        sequence_number: qr.sequence_number,
        product_code: product?.product_code || 'N/A',
        product_name: product?.product_name || 'Unknown Product',
        variant_code: variant?.variant_code || 'N/A',
        variant_name: variant?.variant_name || 'Unknown Variant',
        status: qr.status
      }
    })

    return NextResponse.json({
      success: true,
      codes: formattedCodes,
      summary: {
        total_available_in_batch: allCodes.length,
        excluded_count: excludedCodes.length,
        returned_count: finalCodes.length,
        not_found_exclusions: notFoundExclusions.length > 0 ? notFoundExclusions : undefined
      },
      excluded_codes: excludedCodes.length > 0 ? excludedCodes.map(qr => qr.code) : undefined,
      not_found_exclusions: notFoundExclusions.length > 0 ? notFoundExclusions : undefined
    })
  } catch (error: any) {
    console.error('Error fetching batch codes:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch batch codes' },
      { status: 500 }
    )
  }
}
