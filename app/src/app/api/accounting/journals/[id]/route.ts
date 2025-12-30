import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/journals/[id]
 * Get journal details with lines
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get journal header (using 'any' since view not in generated types yet)
    const { data: journal, error: journalError } = await (supabase as any)
      .from('v_gl_journals')
      .select('*')
      .eq('id', id)
      .single()

    if (journalError) {
      console.error('Error fetching journal:', journalError)
      return NextResponse.json({ error: journalError.message }, { status: 500 })
    }

    if (!journal) {
      return NextResponse.json({ error: 'Journal not found' }, { status: 404 })
    }

    // Get journal lines (using 'any' since view not in generated types yet)
    const { data: lines, error: linesError } = await (supabase as any)
      .from('v_gl_journal_lines')
      .select('*')
      .eq('journal_id', id)
      .order('line_number')

    if (linesError) {
      console.error('Error fetching journal lines:', linesError)
      return NextResponse.json({ error: linesError.message }, { status: 500 })
    }

    // Get linked document posting (using 'any' since table not in generated types yet)
    const { data: posting, error: postingError } = await (supabase as any)
      .from('gl_document_postings')
      .select('*')
      .eq('journal_id', id)
      .single()

    return NextResponse.json({
      journal,
      lines: lines || [],
      posting: posting || null
    })
  } catch (error) {
    console.error('Error in journal detail API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
