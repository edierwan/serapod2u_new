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

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
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
        
    if (userError || !userData || !['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)) {
         return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const q = searchParams.get('q')
    const assigned = searchParams.get('assigned')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    // First, fetch threads without user joins (FK relationship may not exist for consumer users)
    let query = supabaseAdmin
      .from('support_threads' as any)
      .select(`
        *,
        support_thread_reads(last_read_at, user_id)
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
    
    // Calculate admin unread status and fetch user details
    // Admin is unread if last message is from user AND (last_read_at < last_message_at OR no read record)
    
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
        
        // Fetch user details separately (works for both public.users and auth.users)
        let createdBy = { email: 'Unknown', full_name: 'Unknown User', phone: '' }
        let assignedTo = null
        
        if (thread.created_by_user_id) {
            // Try public.users first
            const { data: publicUser } = await supabaseAdmin
                .from('users')
                .select('email, full_name, phone')
                .eq('id', thread.created_by_user_id)
                .single()
            
            if (publicUser) {
                createdBy = {
                    email: publicUser.email || 'Unknown',
                    full_name: publicUser.full_name || 'Unknown User',
                    phone: publicUser.phone || ''
                }
            } else {
                // Fallback: try auth.users via admin API
                try {
                    const { data: authUserData } = await supabaseAdmin.auth.admin.getUserById(thread.created_by_user_id)
                    if (authUserData?.user) {
                        createdBy = {
                            email: authUserData.user.email || 'Unknown',
                            full_name: authUserData.user.user_metadata?.full_name || authUserData.user.email?.split('@')[0] || 'Unknown User',
                            phone: authUserData.user.phone || authUserData.user.user_metadata?.phone || ''
                        }
                    }
                } catch (e) {
                    console.error('Error fetching auth user:', e)
                }
            }
        }
        
        // Fetch assigned admin if exists
        if (thread.assigned_admin_user_id) {
            const { data: adminUser } = await supabaseAdmin
                .from('users')
                .select('email, full_name')
                .eq('id', thread.assigned_admin_user_id)
                .single()
            if (adminUser) {
                assignedTo = adminUser
            }
        }
        
        return {
            ...thread,
            created_by: createdBy,
            assigned_to: assignedTo,
            is_unread: isUnread
        }
    }))

    return NextResponse.json({ threads: threadsWithDetails, total: count, page, limit })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
