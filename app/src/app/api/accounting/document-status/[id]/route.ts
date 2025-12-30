import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/document-status/[id]
 * Get GL posting status for a document
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

    // Call the RPC function (using 'any' since RPC not in generated types yet)
    const { data, error } = await (supabase as any).rpc('get_document_gl_status', {
      p_document_id: id
    })

    if (error) {
      console.error('Error getting document GL status:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in document status API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
