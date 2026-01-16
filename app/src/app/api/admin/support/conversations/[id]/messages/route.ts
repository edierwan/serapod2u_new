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

async function checkAdminRole(supabaseAdmin: any, userId: string): Promise<boolean> {
  const { data: userData, error } = await supabaseAdmin
    .from('users')
    .select('role_code')
    .eq('id', userId)
    .single()

  if (error || !userData) return false
  return ['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)
}

/**
 * GET /api/admin/support/conversations/[id]/messages
 * Get messages for admin view
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

    if (!await checkAdminRole(supabaseAdmin, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
      .eq('is_deleted_by_admin', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching messages:', error)
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    // Mark as read by admin
    try {
      await supabaseAdmin.rpc('mark_conversation_read', {
        p_conversation_id: id,
        p_reader_type: 'admin',
        p_reader_id: user.id
      })
    } catch (error) {
      // Fallback
      await supabaseAdmin
        .from('support_conversations')
        .update({ admin_unread_count: 0 })
        .eq('id', id)

      await supabaseAdmin
        .from('support_conversation_messages')
        .update({ read_by_admin_at: new Date().toISOString() })
        .eq('conversation_id', id)
        .eq('sender_type', 'user')
        .is('read_by_admin_at', null)
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
 * POST /api/admin/support/conversations/[id]/messages
 * Send admin reply (with auto-assignment)
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

    if (!await checkAdminRole(supabaseAdmin, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { message, attachments } = body

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    if (message.length > 10000) {
      return NextResponse.json({ error: 'Message must be less than 10000 characters' }, { status: 400 })
    }

    // Get conversation to check current assignment
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('support_conversations')
      .select('id, assigned_admin_id, user_unread_count')
      .eq('id', id)
      .single()

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Try RPC first
    const { data: messageId, error: rpcError } = await supabaseAdmin.rpc(
      'send_admin_support_message',
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
          sender_type: 'admin',
          sender_admin_id: user.id,
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
      const updates: any = {
        last_message_at: new Date().toISOString(),
        last_message_preview: message.substring(0, 100),
        last_message_sender_type: 'admin',
        user_unread_count: (conversation.user_unread_count || 0) + 1,
        status: 'pending_user'
      }

      // Auto-assign if not assigned
      if (!conversation.assigned_admin_id) {
        updates.assigned_admin_id = user.id

        // Log assignment event
        await supabaseAdmin.from('support_conversation_events').insert({
          conversation_id: id,
          actor_type: 'system',
          event_type: 'assigned',
          old_value: null,
          new_value: { admin_id: user.id },
          payload_json: { reason: 'auto_assigned_on_first_reply' }
        })
      }

      await supabaseAdmin
        .from('support_conversations')
        .update(updates)
        .eq('id', id)

      return NextResponse.json({ messageId: newMessage.id })
    }

    return NextResponse.json({ messageId })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
