import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify thread belongs to user first
    const { data: thread, error: threadError } = await supabaseAdmin
      .from('support_threads')
      .select('id, created_by_user_id')
      .eq('id', id)
      .eq('created_by_user_id', user.id)
      .single()

    if (threadError || !thread) {
      console.error('Thread not found or not owned by user:', threadError)
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
    }

    // Soft delete the thread for the user using admin client
    const { error } = await supabaseAdmin
      .from('support_threads')
      .update({ user_deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('created_by_user_id', user.id)

    if (error) {
      console.error('Error deleting thread:', error)
      return NextResponse.json({ error: 'Failed to delete thread' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
