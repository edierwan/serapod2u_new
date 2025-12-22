import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/admin/feedback
 * Get all consumer feedback for admin's company
 */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Use service role client to bypass RLS
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

    // Create regular client for auth check
    const { createClient: createServerClient } = await import('@/lib/supabase/server')
    const supabase = await createServerClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Please log in to view feedback' },
        { status: 401 }
      )
    }

    // Get user's organization
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile || !userProfile.organization_id) {
      console.error('❌ User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

    // Get organization details
    const { data: organization, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, org_type_code, org_name')
      .eq('id', userProfile.organization_id)
      .single()

    if (orgError || !organization) {
      console.error('❌ Organization not found:', orgError)
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      )
    }

    const companyId = organization.id

    // Pagination parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const offset = (page - 1) * limit
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    console.log('💬 Loading feedback for company:', companyId, organization.org_name, `Page: ${page}, Limit: ${limit}`)

    // Build query
    let query = supabaseAdmin
      .from('consumer_feedback')
      .select('*', { count: 'exact' })
      .eq('org_id', companyId)
      .order('created_at', { ascending: false })

    // Apply filters
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,message.ilike.%${search}%,consumer_name.ilike.%${search}%,consumer_phone.ilike.%${search}%`)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: feedback, count, error: feedbackError } = await query

    if (feedbackError) {
      console.error('❌ Error fetching feedback:', feedbackError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch feedback' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      feedback: feedback || [],
      total: count || 0,
      page,
      totalPages: count ? Math.ceil(count / limit) : 1
    })

  } catch (error: any) {
    console.error('Error in feedback API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/admin/feedback
 * Update feedback status
 */
export async function PATCH(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const body = await request.json()
    const { id, status } = body

    if (!id || !status) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Use service role client
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

    // Create regular client for auth check
    const { createClient: createServerClient } = await import('@/lib/supabase/server')
    const supabase = await createServerClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify user belongs to the organization that owns the feedback
    // First get the feedback to check org_id
    const { data: feedback, error: fetchError } = await supabaseAdmin
      .from('consumer_feedback')
      .select('org_id')
      .eq('id', id)
      .single()

    if (fetchError || !feedback) {
      return NextResponse.json(
        { success: false, error: 'Feedback not found' },
        { status: 404 }
      )
    }

    // Get user's organization
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile || userProfile.organization_id !== feedback.org_id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized access to this feedback' },
        { status: 403 }
      )
    }

    // Update status
    const { error: updateError } = await supabaseAdmin
      .from('consumer_feedback')
      .update({ status })
      .eq('id', id)

    if (updateError) {
      console.error('Error updating feedback:', updateError)
      return NextResponse.json(
        { success: false, error: 'Failed to update feedback' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Error in feedback update API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
