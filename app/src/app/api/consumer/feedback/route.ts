import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/consumer/feedback
 * Submit consumer feedback from the product journey page
 * 
 * Body:
 *   title: string - Feedback title
 *   message: string - Feedback message
 *   qr_code?: string - Optional QR code that was scanned
 *   org_id: string - Organization ID (journey owner)
 *   consumer_name?: string - Optional consumer name
 *   consumer_phone?: string - Optional consumer phone
 *   consumer_email?: string - Optional consumer email
 *   product_name?: string - Optional product name
 *   variant_name?: string - Optional variant name
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Service role client for data operations (bypasses RLS for public feedback submission)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const body = await request.json()
    const { 
      title, 
      message, 
      qr_code, 
      org_id,
      consumer_name,
      consumer_phone,
      consumer_email,
      product_name,
      variant_name
    } = body

    // Validate required fields
    if (!title || !title.trim()) {
      return NextResponse.json(
        { success: false, error: 'Title is required' },
        { status: 400 }
      )
    }

    if (!message || !message.trim()) {
      return NextResponse.json(
        { success: false, error: 'Message is required' },
        { status: 400 }
      )
    }

    if (!org_id) {
      return NextResponse.json(
        { success: false, error: 'Organization ID is required' },
        { status: 400 }
      )
    }

    // Resolve QR code ID if provided
    let qrCodeId = null
    if (qr_code) {
      // Try to find the QR code record
      const { data: qrData } = await supabaseAdmin
        .from('qr_codes')
        .select('id')
        .or(`qr_code.eq.${qr_code},qr_code.ilike.${qr_code}%`)
        .limit(1)
        .maybeSingle()
      
      if (qrData) {
        qrCodeId = qrData.id
      }
    }

    // Insert feedback
    const { data: feedback, error: insertError } = await supabaseAdmin
      .from('consumer_feedback')
      .insert({
        qr_code_id: qrCodeId,
        org_id,
        consumer_name: consumer_name?.trim() || null,
        consumer_phone: consumer_phone?.trim() || null,
        consumer_email: consumer_email?.trim() || null,
        title: title.trim(),
        message: message.trim(),
        product_name: product_name || null,
        variant_name: variant_name || null,
        status: 'pending'
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error inserting feedback:', insertError)
      return NextResponse.json(
        { success: false, error: 'Failed to submit feedback. Please try again.' },
        { status: 500 }
      )
    }

    console.log('✅ Feedback submitted:', feedback.id)

    return NextResponse.json({
      success: true,
      message: 'Thank you for your feedback! We appreciate you taking the time to share your thoughts with us.',
      feedback_id: feedback.id
    })

  } catch (error) {
    console.error('Error in consumer/feedback:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/consumer/feedback
 * Get feedback list for admin view
 * 
 * Query params:
 *   org_id?: string - Filter by organization
 *   status?: string - Filter by status (pending, reviewed, resolved, archived)
 *   limit?: number - Limit results (default 50)
 *   offset?: number - Offset for pagination
 */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const orgId = searchParams.get('org_id')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build query
    let query = supabaseAdmin
      .from('consumer_feedback')
      .select(`
        id,
        qr_code_id,
        org_id,
        consumer_name,
        consumer_phone,
        consumer_email,
        title,
        message,
        product_name,
        variant_name,
        status,
        reviewed_by,
        reviewed_at,
        admin_notes,
        created_at,
        updated_at
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (orgId) {
      query = query.eq('org_id', orgId)
    }
    if (status) {
      query = query.eq('status', status)
    }

    const { data: feedbacks, error: fetchError, count } = await query

    if (fetchError) {
      console.error('Error fetching feedback:', fetchError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch feedback' },
        { status: 500 }
      )
    }

    // Get summary counts
    const { data: summaryData } = await supabaseAdmin
      .from('consumer_feedback')
      .select('status')
      .eq('org_id', orgId || '')

    const summary = {
      total: count || 0,
      pending: summaryData?.filter(f => f.status === 'pending').length || 0,
      reviewed: summaryData?.filter(f => f.status === 'reviewed').length || 0,
      resolved: summaryData?.filter(f => f.status === 'resolved').length || 0
    }

    return NextResponse.json({
      success: true,
      feedbacks: feedbacks || [],
      summary,
      pagination: {
        limit,
        offset,
        total: count || 0,
        has_more: (feedbacks?.length || 0) === limit
      }
    })

  } catch (error) {
    console.error('Error in consumer/feedback GET:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/consumer/feedback
 * Update feedback status (for admin)
 * 
 * Body:
 *   feedback_id: string - Feedback ID to update
 *   status: string - New status (pending, reviewed, resolved, archived)
 *   admin_notes?: string - Optional admin notes
 */
export async function PATCH(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { feedback_id, status, admin_notes } = await request.json()

    if (!feedback_id) {
      return NextResponse.json(
        { success: false, error: 'Feedback ID is required' },
        { status: 400 }
      )
    }

    const validStatuses = ['pending', 'reviewed', 'resolved', 'archived']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (status) {
      updateData.status = status
      updateData.reviewed_at = new Date().toISOString()
    }
    if (admin_notes !== undefined) {
      updateData.admin_notes = admin_notes
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('consumer_feedback')
      .update(updateData)
      .eq('id', feedback_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating feedback:', updateError)
      return NextResponse.json(
        { success: false, error: 'Failed to update feedback' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Feedback marked as ${status}`,
      feedback: updated
    })

  } catch (error) {
    console.error('Error in consumer/feedback PATCH:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
