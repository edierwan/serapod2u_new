import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/pending-postings
 * List receipts ready for GL posting
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Get user's company ID
    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userData?.organization_id) {
      return NextResponse.json({ error: 'User has no organization' }, { status: 400 })
    }

    // Use the pending postings view (using 'any' since view not in generated types yet)
    const { data: pendingPostings, error, count } = await (supabase as any)
      .from('v_pending_gl_postings')
      .select('*', { count: 'exact' })
      .eq('company_id', userData.organization_id) // Filter by user's company
      .order('document_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching pending postings:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      pendingPostings: pendingPostings || [],
      total: count || 0,
      limit,
      offset
    })
  } catch (error) {
    console.error('Error in pending postings API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
