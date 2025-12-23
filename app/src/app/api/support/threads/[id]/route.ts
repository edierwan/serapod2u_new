import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = params

    // Soft delete the thread for the user
    const { error } = await supabase
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
