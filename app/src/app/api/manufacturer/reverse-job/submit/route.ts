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
      exclude_codes = [],
      manufacturer_org_id,
      user_id,
      filter_variant_id,
      filter_case_numbers
    } = body

    console.log('📝 Reverse job submit request:', {
      batch_id,
      order_id,
      manufacturer_org_id,
      exclude_codes_count: exclude_codes.length,
      filter_variant_id,
      filter_case_numbers
    })

    // Validation
    if (!batch_id || !order_id || !manufacturer_org_id) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: batch_id, order_id, manufacturer_org_id' },
        { status: 400 }
      )
    }

    // Verify user belongs to manufacturer org
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

    if (userProfile.organization_id !== manufacturer_org_id) {
      return NextResponse.json(
        { success: false, error: 'User does not belong to manufacturer organization' },
        { status: 403 }
      )
    }

    // Verify batch belongs to order and manufacturer
    const { data: batch, error: batchError } = await supabase
      .from('qr_batches')
      .select(`
        id,
        order_id,
        orders!inner (
          id,
          seller_org_id
        )
      `)
      .eq('id', batch_id)
      .single()

    if (batchError || !batch) {
      console.error('Batch query error:', batchError)
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      )
    }

    const order = Array.isArray(batch.orders) ? batch.orders[0] : batch.orders
    if (!order || order.id !== order_id || order.seller_org_id !== manufacturer_org_id) {
      return NextResponse.json(
        { success: false, error: 'Batch does not belong to this order or manufacturer' },
        { status: 403 }
      )
    }

    // Normalize exclude_codes: extract plain codes from URLs
    const normalizedExcludeCodes = exclude_codes
      .map((code: string) => {
        const trimmed = code.trim()
        if (!trimmed) return null
        
        // If it's a URL, extract the last segment
        if (trimmed.includes('/')) {
          const segments = trimmed.split('/')
          return segments[segments.length - 1]
        }
        return trimmed
      })
      .filter((code: string | null): code is string => code !== null && code.length > 0)

    // Remove duplicates
    const uniqueExcludeCodes = Array.from(new Set(normalizedExcludeCodes))

    console.log('📝 Normalized exclude codes:', {
      original_count: exclude_codes.length,
      normalized_count: uniqueExcludeCodes.length,
      sample: uniqueExcludeCodes.slice(0, 3)
    })

    // Create job record with optional filters
    const { data: job, error: jobError } = await supabase
      .from('qr_reverse_jobs')
      .insert({
        batch_id,
        order_id,
        manufacturer_org_id,
        exclude_codes: uniqueExcludeCodes as string[],
        filter_variant_id: filter_variant_id || null,
        filter_case_numbers: filter_case_numbers && filter_case_numbers.length > 0 ? filter_case_numbers : null,
        status: 'queued' as const,
        progress: 0,
        prepared_count: 0
      })
      .select()
      .single()

    if (jobError) {
      console.error('Error creating reverse job:', jobError)
      return NextResponse.json(
        { success: false, error: 'Failed to create job: ' + jobError.message },
        { status: 500 }
      )
    }

    console.log('✅ Reverse job created:', job.id)

    return NextResponse.json({
      success: true,
      job_id: job.id,
      status: 'queued',
      exclude_count: uniqueExcludeCodes.length,
      message: `Job created with ${uniqueExcludeCodes.length} codes to exclude`
    })

  } catch (error: any) {
    console.error('Error in reverse-job/submit:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
