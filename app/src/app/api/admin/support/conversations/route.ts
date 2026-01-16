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
 * GET /api/admin/support/conversations
 * Get all support conversations (admin view)
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getAdminClient()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    if (!await checkAdminRole(supabaseAdmin, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')
    const assigned = searchParams.get('assigned')
    const q = searchParams.get('q')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    // Build search user IDs if searching
    let matchingUserIds: string[] = []
    if (q) {
      const { data: matchingUsers } = await supabaseAdmin
        .from('users')
        .select('id')
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)

      if (matchingUsers) {
        matchingUserIds = matchingUsers.map(u => u.id)
      }
    }

    // Build query
    let query = supabaseAdmin
      .from('support_conversations')
      .select('*', { count: 'exact' })
      .is('admin_deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })

    // Apply filters
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (priority && priority !== 'all') {
      query = query.eq('priority', priority)
    }

    if (assigned === 'me') {
      query = query.eq('assigned_admin_id', user.id)
    } else if (assigned === 'unassigned') {
      query = query.is('assigned_admin_id', null)
    }

    // Search by subject OR by matching user IDs OR by case number
    if (q) {
      const searchConditions = [`subject.ilike.%${q}%`, `case_number.ilike.%${q}%`]
      if (matchingUserIds.length > 0) {
        searchConditions.push(`created_by_user_id.in.(${matchingUserIds.join(',')})`)
      }
      query = query.or(searchConditions.join(','))
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: conversations, error, count } = await query

    if (error) {
      console.error('Error fetching conversations:', error)
      return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
    }

    // Enrich with user and admin details
    const enrichedConversations = await Promise.all((conversations || []).map(async (conv: any) => {
      // Get user details
      let createdBy = { email: 'Unknown', full_name: 'Unknown User', phone: '' }
      if (conv.created_by_user_id) {
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('email, full_name, phone')
          .eq('id', conv.created_by_user_id)
          .single()

        if (userData) {
          createdBy = {
            email: userData.email || 'Unknown',
            full_name: userData.full_name || 'Unknown User',
            phone: userData.phone || ''
          }
        } else {
          // Try auth.users as fallback
          try {
            const { data: authUserData } = await supabaseAdmin.auth.admin.getUserById(conv.created_by_user_id)
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

      // Get assigned admin details
      let assignedTo = null
      if (conv.assigned_admin_id) {
        const { data: adminUser } = await supabaseAdmin
          .from('users')
          .select('email, full_name')
          .eq('id', conv.assigned_admin_id)
          .single()
        if (adminUser) {
          assignedTo = adminUser
        }
      }

      // Get tags
      const { data: tags } = await supabaseAdmin
        .from('support_conversation_tags')
        .select('tag_id, support_tags(id, name, color)')
        .eq('conversation_id', conv.id)

      return {
        ...conv,
        created_by: createdBy,
        assigned_to: assignedTo,
        tags: tags?.map((t: any) => t.support_tags) || [],
        is_unread: conv.admin_unread_count > 0
      }
    }))

    return NextResponse.json({
      conversations: enrichedConversations,
      total: count || 0,
      page,
      limit
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
