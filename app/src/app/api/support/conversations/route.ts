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
 * GET /api/support/conversations
 * Get user's support conversations list
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    // Fetch conversations for the user
    const { data: conversations, error, count } = await supabaseAdmin
      .from('support_conversations')
      .select('*', { count: 'exact' })
      .eq('created_by_user_id', user.id)
      .is('user_deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching conversations:', error)
      return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
    }

    return NextResponse.json({ 
      conversations: conversations || [],
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
 * POST /api/support/conversations
 * Create a new support conversation with first message
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { subject, message, attachments } = body

    if (!subject || !message) {
      return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 })
    }

    // Validate lengths
    if (subject.length > 200) {
      return NextResponse.json({ error: 'Subject must be less than 200 characters' }, { status: 400 })
    }
    if (message.length > 10000) {
      return NextResponse.json({ error: 'Message must be less than 10000 characters' }, { status: 400 })
    }

    // Use RPC function for atomic creation
    const { data: conversationId, error: createError } = await supabaseAdmin.rpc(
      'create_support_conversation',
      {
        p_subject: subject,
        p_message: message,
        p_attachments: attachments || []
      }
    )

    if (createError) {
      console.error('Error creating conversation:', createError)
      
      // Fallback to manual creation if RPC doesn't exist yet
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('support_conversations')
        .insert({
          created_by_user_id: user.id,
          subject,
          status: 'open',
          last_message_at: new Date().toISOString(),
          last_message_preview: message.substring(0, 100),
          last_message_sender_type: 'user',
          admin_unread_count: 1
        })
        .select()
        .single()

      if (convError) {
        console.error('Fallback conversation creation error:', convError)
        return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
      }

      // Create first message
      const { error: msgError } = await supabaseAdmin
        .from('support_conversation_messages')
        .insert({
          conversation_id: conversation.id,
          sender_type: 'user',
          sender_user_id: user.id,
          message_type: 'text',
          body_text: message,
          attachments: attachments || []
        })

      if (msgError) {
        console.error('Message creation error:', msgError)
        // Rollback conversation
        await supabaseAdmin.from('support_conversations').delete().eq('id', conversation.id)
        return NextResponse.json({ error: 'Failed to create message' }, { status: 500 })
      }

      console.log('Support conversation created (fallback):', conversation.id, 'by user:', user.id)
      return NextResponse.json({ conversationId: conversation.id, caseNumber: conversation.case_number })
    }

    // Get conversation details
    const { data: conversation } = await supabaseAdmin
      .from('support_conversations')
      .select('case_number')
      .eq('id', conversationId)
      .single()

    console.log('Support conversation created:', conversationId, 'by user:', user.id)
    return NextResponse.json({ 
      conversationId, 
      caseNumber: conversation?.case_number 
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
