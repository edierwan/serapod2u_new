import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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

/**
 * POST /api/support/conversations/[id]/read
 * Mark conversation as read by user
 */
export async function POST(
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

    // Verify conversation ownership
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('support_conversations')
      .select('id')
      .eq('id', id)
      .eq('created_by_user_id', user.id)
      .single()

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Try RPC first
    const { error: rpcError } = await supabaseAdmin.rpc('mark_conversation_read', {
      p_conversation_id: id,
      p_reader_type: 'user',
      p_reader_id: user.id
    })

    if (rpcError) {
      // Fallback: just reset the unread count
      await supabaseAdmin
        .from('support_conversations')
        .update({ user_unread_count: 0 })
        .eq('id', id)

      // Mark messages as read
      await supabaseAdmin
        .from('support_conversation_messages')
        .update({ read_by_user_at: new Date().toISOString() })
        .eq('conversation_id', id)
        .neq('sender_type', 'user')
        .is('read_by_user_at', null)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
