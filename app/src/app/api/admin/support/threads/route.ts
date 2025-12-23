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

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    // Assuming we have a way to check admin role. 
    // For now, I'll assume the RLS or a separate check handles it, 
    // but since we are using admin client for fetching all threads, we MUST check role here.
    
    // Let's check public.users role_code
    const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('role_code')
        .eq('id', user.id)
        .single()
        
    if (userError || !userData || !['admin', 'super_admin', 'hq_admin'].includes(userData.role_code)) {
         return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const q = searchParams.get('q')
    const assigned = searchParams.get('assigned')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    let query = supabaseAdmin
      .from('support_threads' as any)
      .select(`
        *,
        created_by:created_by_user_id(email, full_name, phone),
        assigned_to:assigned_admin_user_id(email, full_name),
        support_thread_reads(last_read_at)
      `, { count: 'exact' })
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (assigned === 'me') {
      query = query.eq('assigned_admin_user_id', user.id)
    } else if (assigned === 'unassigned') {
      query = query.is('assigned_admin_user_id', null)
    }

    if (q) {
      query = query.ilike('subject', `%${q}%`)
    }

    const { data: threads, error, count } = await query

    if (error) {
      console.error('Error fetching threads:', error)
      return NextResponse.json({ error: 'Failed to fetch threads' }, { status: 500 })
    }
    
    // Calculate admin unread status
    // Admin is unread if last message is from user AND (last_read_at < last_message_at OR no read record)
    // This is complex to do in one query without a view.
    // We'll do it in code for the page.
    
    const threadsWithDetails = await Promise.all((threads as any[] || []).map(async (thread: any) => {
        // Get last message to check sender
        const { data: lastMsg } = await supabaseAdmin
            .from('support_messages' as any)
            .select('sender_type, created_at')
            .eq('thread_id', thread.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()
            
        const lastRead = thread.support_thread_reads?.find((r: any) => r.user_id === user.id)
        const lastReadAt = lastRead ? lastRead.last_read_at : null
        
        const isUnread = lastMsg && lastMsg.sender_type === 'user' && (!lastReadAt || lastMsg.created_at > lastReadAt)
        
        return {
            ...thread,
            is_unread: isUnread
        }
    }))

    return NextResponse.json({ threads: threadsWithDetails, total: count, page, limit })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
