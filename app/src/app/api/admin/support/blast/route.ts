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

export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('role_code')
        .eq('id', user.id)
        .single()
        
    if (userError || !userData || !['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)) {
         return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { subject, message, attachments, targetType, states, roles } = body

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Get target users based on filters
    let targetUserIds: string[] = []
    
    if (targetType === 'all' || !targetType) {
      // Get all active users
      const { data: allUsers, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id')
        .not('email', 'is', null)

      if (usersError) {
        console.error('Error fetching users:', usersError)
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
      }
      
      targetUserIds = (allUsers || []).map(u => u.id)
    } else if (targetType === 'state' && states && states.length > 0) {
      // Get users from organizations in selected states
      const { data: orgs, error: orgsError } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .in('state', states)

      if (orgsError) {
        console.error('Error fetching orgs:', orgsError)
        return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 })
      }

      if (orgs && orgs.length > 0) {
        const orgIds = orgs.map(o => o.id)
        const { data: users, error: usersError } = await supabaseAdmin
          .from('users')
          .select('id')
          .in('company_id', orgIds)
          .not('email', 'is', null)

        if (usersError) {
          console.error('Error fetching users:', usersError)
          return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
        }
        
        targetUserIds = (users || []).map(u => u.id)
      }
    } else if (targetType === 'role' && roles && roles.length > 0) {
      // Map friendly role names to actual role codes
      const roleMapping: Record<string, string[]> = {
        'consumer': ['consumer', 'CONSUMER'],
        'shop': ['shop', 'SHOP', 'shop_owner'],
        'SA': ['SA', 'SALES_AGENT'],
        'HQ': ['HQ', 'HQ_ADMIN', 'POWER_USER', 'admin', 'super_admin']
      }
      
      const actualRoles = roles.flatMap((r: string) => roleMapping[r] || [r])
      
      const { data: users, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id')
        .in('role_code', actualRoles)
        .not('email', 'is', null)

      if (usersError) {
        console.error('Error fetching users:', usersError)
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
      }
      
      targetUserIds = (users || []).map(u => u.id)
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json({ error: 'No users found matching the criteria' }, { status: 400 })
    }

    console.log(`Sending blast to ${targetUserIds.length} users`)

    // Create threads and messages for each user
    let sentCount = 0
    const announcementSubject = subject || 'Announcement'
    
    for (const userId of targetUserIds) {
      try {
        // Check if user already has an Announcement thread
        const { data: existingThread } = await supabaseAdmin
          .from('support_threads')
          .select('id')
          .eq('created_by_user_id', userId)
          .eq('subject', 'Announcements')
          .is('user_deleted_at', null)
          .single()

        let threadId: string

        if (existingThread) {
          threadId = existingThread.id
          // Update thread's last message
          await supabaseAdmin
            .from('support_threads')
            .update({
              last_message_at: new Date().toISOString(),
              last_message_preview: message.substring(0, 50),
              status: 'open'
            })
            .eq('id', threadId)
        } else {
          // Create new Announcement thread
          const { data: newThread, error: threadError } = await supabaseAdmin
            .from('support_threads')
            .insert({
              created_by_user_id: userId,
              subject: 'Announcements',
              status: 'open',
              last_message_at: new Date().toISOString(),
              last_message_preview: message.substring(0, 50)
            })
            .select('id')
            .single()

          if (threadError || !newThread) {
            console.error(`Failed to create thread for user ${userId}:`, threadError)
            continue
          }
          threadId = newThread.id
        }

        // Insert the announcement message
        const { error: messageError } = await supabaseAdmin
          .from('support_messages')
          .insert({
            thread_id: threadId,
            sender_type: 'admin',
            sender_user_id: user.id,
            body: message,
            attachments: attachments || []
          })

        if (messageError) {
          console.error(`Failed to create message for thread ${threadId}:`, messageError)
          continue
        }

        sentCount++
      } catch (err) {
        console.error(`Error processing user ${userId}:`, err)
      }
    }

    console.log(`Blast sent to ${sentCount} users successfully`)

    return NextResponse.json({ success: true, sentCount })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
