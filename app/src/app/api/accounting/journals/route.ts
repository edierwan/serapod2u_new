import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/journals
 * List GL journals with filters
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const journalType = searchParams.get('type')
    const fromDate = searchParams.get('from')
    const toDate = searchParams.get('to')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Use the view for journals (using 'any' since view not in generated types yet)
    let query = (supabase as any)
      .from('v_gl_journals')
      .select('*', { count: 'exact' })
      .order('journal_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    if (journalType) {
      query = query.eq('journal_type', journalType)
    }

    if (fromDate) {
      query = query.gte('journal_date', fromDate)
    }

    if (toDate) {
      query = query.lte('journal_date', toDate)
    }

    const { data: journals, error, count } = await query

    if (error) {
      console.error('Error fetching journals:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      journals: journals || [],
      total: count || 0,
      limit,
      offset
    })
  } catch (error) {
    console.error('Error in journals API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
