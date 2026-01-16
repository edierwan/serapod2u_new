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
 * GET /api/admin/support/conversations/[id]
 * Get conversation details with messages
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

    // Get conversation
    const { data: conversation, error } = await supabaseAdmin
      .from('support_conversations')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Get user details
    let createdBy = { email: 'Unknown', full_name: 'Unknown User', phone: '' }
    if (conversation.created_by_user_id) {
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('email, full_name, phone')
        .eq('id', conversation.created_by_user_id)
        .single()

      if (userData) {
        createdBy = {
          email: userData.email || 'Unknown',
          full_name: userData.full_name || 'Unknown User',
          phone: userData.phone || ''
        }
      }
    }

    // Get assigned admin
    let assignedTo = null
    if (conversation.assigned_admin_id) {
      const { data: adminUser } = await supabaseAdmin
        .from('users')
        .select('id, email, full_name')
        .eq('id', conversation.assigned_admin_id)
        .single()
      if (adminUser) {
        assignedTo = adminUser
      }
    }

    // Get tags
    const { data: tags } = await supabaseAdmin
      .from('support_conversation_tags')
      .select('tag_id, support_tags(id, name, color)')
      .eq('conversation_id', id)

    // Get internal notes
    const { data: notes } = await supabaseAdmin
      .from('support_conversation_notes')
      .select('*, admin:admin_id(full_name)')
      .eq('conversation_id', id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    // Get events (last 20)
    const { data: events } = await supabaseAdmin
      .from('support_conversation_events')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      conversation: {
        ...conversation,
        created_by: createdBy,
        assigned_to: assignedTo,
        tags: tags?.map((t: any) => t.support_tags) || [],
        notes: notes || [],
        events: events || []
      }
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/support/conversations/[id]
 * Update conversation (status, priority, assignment)
 */
export async function PATCH(
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
    const { status, priority, assigned_admin_id } = body

    // Get current state for logging
    const { data: currentConv } = await supabaseAdmin
      .from('support_conversations')
      .select('status, priority, assigned_admin_id')
      .eq('id', id)
      .single()

    if (!currentConv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const updates: any = { updated_at: new Date().toISOString() }
    const events: any[] = []

    // Handle status change
    if (status && status !== currentConv.status) {
      updates.status = status
      events.push({
        conversation_id: id,
        actor_type: 'admin',
        actor_admin_id: user.id,
        event_type: 'status_changed',
        old_value: { status: currentConv.status },
        new_value: { status }
      })
    }

    // Handle priority change
    if (priority && priority !== currentConv.priority) {
      updates.priority = priority
      events.push({
        conversation_id: id,
        actor_type: 'admin',
        actor_admin_id: user.id,
        event_type: 'priority_changed',
        old_value: { priority: currentConv.priority },
        new_value: { priority }
      })
    }

    // Handle assignment change
    if (assigned_admin_id !== undefined && assigned_admin_id !== currentConv.assigned_admin_id) {
      updates.assigned_admin_id = assigned_admin_id || null
      events.push({
        conversation_id: id,
        actor_type: 'admin',
        actor_admin_id: user.id,
        event_type: assigned_admin_id ? 'assigned' : 'unassigned',
        old_value: { admin_id: currentConv.assigned_admin_id },
        new_value: { admin_id: assigned_admin_id }
      })
    }

    // Apply updates
    if (Object.keys(updates).length > 1) {
      const { error: updateError } = await supabaseAdmin
        .from('support_conversations')
        .update(updates)
        .eq('id', id)

      if (updateError) {
        console.error('Error updating conversation:', updateError)
        return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
      }

      // Log events
      if (events.length > 0) {
        await supabaseAdmin.from('support_conversation_events').insert(events)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/support/conversations/[id]
 * Soft delete conversation for admin
 */
export async function DELETE(
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

    const { error } = await supabaseAdmin
      .from('support_conversations')
      .update({ admin_deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      console.error('Error deleting conversation:', error)
      return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
