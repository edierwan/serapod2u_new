import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

export async function GET(
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
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    // Fetch messages
    const { data: messages, error, count } = await supabase
      .from('support_messages' as any)
      .select('*', { count: 'exact' })
      .eq('thread_id', id)
      .order('created_at', { ascending: false }) // Newest first for infinite scroll usually
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching messages:', error)
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    return NextResponse.json({ messages, total: count, page, limit })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(
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
    const body = await request.json()
    const { message, attachments } = body

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Verify thread ownership/access
    const { data: thread, error: threadCheckError } = await supabase
      .from('support_threads' as any)
      .select('id, status')
      .eq('id', id)
      .single()

    if (threadCheckError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
    }

    const threadData = thread as any

    // Insert message
    const { data: newMessage, error: messageError } = await supabase
      .from('support_messages' as any)
      .insert({
        thread_id: id,
        sender_type: 'user',
        sender_user_id: user.id,
        body: message,
        attachments: attachments || []
      })
      .select()
      .single()

    if (messageError) {
      console.error('Error sending message:', messageError)
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    }

    // Update thread status and last_message
    // If status was resolved/closed, reopen it? "When user replies → status becomes open (needs admin)."
    const updates: any = {
      last_message_at: new Date().toISOString(),
      last_message_preview: message.substring(0, 50),
      user_deleted_at: null // Un-delete if hidden
    }

    if (threadData.status === 'resolved' || threadData.status === 'closed') {
        updates.status = 'open'
    } else if (threadData.status === 'pending') {
        updates.status = 'open'
    }

    await supabaseAdmin
      .from('support_threads' as any)
      .update(updates)
      .eq('id', id)
      
    // Mark as read for user
    await supabase
        .from('support_thread_reads' as any)
        .upsert({
            thread_id: id,
            user_id: user.id,
            last_read_at: new Date().toISOString()
        })

    return NextResponse.json({ message: newMessage })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
