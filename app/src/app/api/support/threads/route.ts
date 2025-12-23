import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Initialize admin client for operations that might need to bypass RLS or complex joins
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

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch threads for the user
    // We use the admin client to ensure we can get unread counts efficiently if needed,
    // but standard RLS should work. Let's stick to user client for security where possible.
    // However, for unread counts, we might need a join or a separate query.
    
    const { data: threads, error } = await supabase
      .from('support_threads' as any)
      .select(`
        *,
        support_thread_reads(last_read_at)
      `)
      .eq('created_by_user_id', user.id)
      .is('user_deleted_at', null)
      .order('last_message_at', { ascending: false })

    if (error) {
      console.error('Error fetching threads:', error)
      return NextResponse.json({ error: 'Failed to fetch threads' }, { status: 500 })
    }

    // Calculate unread counts
    // This is a bit tricky with just one query. We need to count messages created after last_read_at.
    // For now, let's just return the threads and handle unread count in a separate call or loop if needed.
    // Or better, let's use a more complex query or a view.
    // Given the requirement "unread_count = messages created after last_read_at by other party",
    // we can do this in the application layer for now since thread count per user is low.
    
    const threadsWithUnread = await Promise.all((threads as any[] || []).map(async (thread: any) => {
      const lastReadAt = thread.support_thread_reads?.[0]?.last_read_at || thread.created_at
      
      const { count, error: countError } = await supabaseAdmin
        .from('support_messages' as any)
        .select('*', { count: 'exact', head: true })
        .eq('thread_id', thread.id)
        .gt('created_at', lastReadAt)
        .neq('sender_user_id', user.id) // Messages not from me (i.e. from admin/system)
        .neq('sender_type', 'user') // Double check sender type

      return {
        ...thread,
        unread_count: count || 0
      }
    }))

    return NextResponse.json({ threads: threadsWithUnread })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

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

    // Create thread and first message atomically? 
    // Supabase doesn't support multi-table transactions via client easily without RPC.
    // We'll do it in sequence. If message fails, we have an empty thread.
    // Better to use the admin client to ensure consistency or handle cleanup.

    const { data: threadData, error: threadError } = await supabase
      .from('support_threads' as any)
      .insert({
        created_by_user_id: user.id,
        subject,
        status: 'open',
        last_message_preview: message.substring(0, 50),
        last_message_at: new Date().toISOString()
      })
      .select()
      .single()

    if (threadError) {
      console.error('Error creating thread:', threadError)
      return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 })
    }

    const thread = threadData as any

    const { error: messageError } = await supabase
      .from('support_messages' as any)
      .insert({
        thread_id: thread.id,
        sender_type: 'user',
        sender_user_id: user.id,
        body: message,
        attachments: attachments || []
      })

    if (messageError) {
      console.error('Error creating message:', messageError)
      // Rollback thread creation (best effort)
      await supabaseAdmin.from('support_threads' as any).delete().eq('id', thread.id)
      return NextResponse.json({ error: 'Failed to create message' }, { status: 500 })
    }
    
    // Mark as read for the user immediately
    await supabase
        .from('support_thread_reads' as any)
        .upsert({
            thread_id: thread.id,
            user_id: user.id,
            last_read_at: new Date().toISOString()
        })

    return NextResponse.json({ threadId: thread.id })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
