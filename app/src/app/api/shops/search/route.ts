import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/shops/search?q=<term>&limit=<n>
 * Search active shops by name, branch, contact name, or contact phone.
 * Returns organizations with org_type_code = 'SHOP' and status = 'active'.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const searchTerm = searchParams.get('q') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 30)

    const supabase = await createClient()

    // Auth check
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data, error } = await supabase.rpc('search_shops' as any, {
      p_search_term: searchTerm.trim(),
      p_limit: limit
    })

    if (error) {
      console.error('Shop search error:', error)
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
    console.error('Shop search error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
