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
 * GET /api/support/conversations/[id]/messages
 * Get messages for a conversation (paginated)
 */
export async function GET(
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

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    // Fetch messages
    const { data: messages, error, count } = await supabaseAdmin
      .from('support_conversation_messages')
      .select('*', { count: 'exact' })
      .eq('conversation_id', id)
      .eq('is_deleted_by_user', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching messages:', error)
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    // Mark messages as read by user
    try {
      await supabaseAdmin.rpc('mark_conversation_read', {
        p_conversation_id: id,
        p_reader_type: 'user',
        p_reader_id: user.id
      })
    } catch (error) {
      // Fallback if RPC doesn't exist
      await supabaseAdmin
        .from('support_conversations')
        .update({ user_unread_count: 0 })
        .eq('id', id)
    }

    return NextResponse.json({
      messages: messages || [],
      total: count || 0,
      page,
      limit
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * POST /api/support/conversations/[id]/messages
 * Send a new message to conversation
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

    const body = await request.json()
    const { message, attachments } = body

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    if (message.length > 10000) {
      return NextResponse.json({ error: 'Message must be less than 10000 characters' }, { status: 400 })
    }

    // Verify conversation ownership
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('support_conversations')
      .select('id, status')
      .eq('id', id)
      .eq('created_by_user_id', user.id)
      .single()

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Try RPC first
    const { data: messageId, error: rpcError } = await supabaseAdmin.rpc(
      'send_support_message',
      {
        p_conversation_id: id,
        p_message: message,
        p_attachments: attachments || []
      }
    )

    if (rpcError) {
      // Fallback to direct insert
      const { data: newMessage, error: insertError } = await supabaseAdmin
        .from('support_conversation_messages')
        .insert({
          conversation_id: id,
          sender_type: 'user',
          sender_user_id: user.id,
          message_type: 'text',
          body_text: message,
          attachments: attachments || []
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('Error sending message:', insertError)
        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
      }

      // Update conversation (trigger should handle this, but fallback)
      await supabaseAdmin
        .from('support_conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: message.substring(0, 100),
          last_message_sender_type: 'user',
          admin_unread_count: (conversation as any).admin_unread_count + 1 || 1,
          status: conversation.status === 'pending_user' ? 'pending_admin' : conversation.status
        })
        .eq('id', id)

      return NextResponse.json({ messageId: newMessage.id })
    }

    return NextResponse.json({ messageId })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
