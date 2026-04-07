import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reference/search?q=<term>&limit=<n>
 * Search eligible reference users by name, phone, or email.
 * Only returns users where can_be_reference = true and is_active = true.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const searchTerm = searchParams.get('q') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 20)

    const supabase = await createClient()

    // Auth check
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data, error } = await supabase.rpc('search_eligible_references' as any, {
      p_search_term: searchTerm.trim(),
      p_limit: limit
    })

    if (error) {
      console.error('Reference search error:', error)
      return NextResponse.json(
        { success: false, error: 'Search failed' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      results: data || []
    })
  } catch (err) {
    console.error('Reference search error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
