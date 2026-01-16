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
 * POST /api/admin/support/conversations/[id]/tags
 * Add tag to conversation
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
    const { tag_id } = body

    if (!tag_id) {
      return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 })
    }

    // Add tag
    const { error } = await supabaseAdmin
      .from('support_conversation_tags')
      .insert({
        conversation_id: id,
        tag_id,
        added_by_admin_id: user.id
      })

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Tag already added' }, { status: 400 })
      }
      console.error('Error adding tag:', error)
      return NextResponse.json({ error: 'Failed to add tag' }, { status: 500 })
    }

    // Log event
    await supabaseAdmin.from('support_conversation_events').insert({
      conversation_id: id,
      actor_type: 'admin',
      actor_admin_id: user.id,
      event_type: 'tagged',
      new_value: { tag_id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/support/conversations/[id]/tags
 * Remove tag from conversation
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

    const { searchParams } = new URL(request.url)
    const tag_id = searchParams.get('tag_id')

    if (!tag_id) {
      return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 })
    }

    // Remove tag
    const { error } = await supabaseAdmin
      .from('support_conversation_tags')
      .delete()
      .eq('conversation_id', id)
      .eq('tag_id', tag_id)

    if (error) {
      console.error('Error removing tag:', error)
      return NextResponse.json({ error: 'Failed to remove tag' }, { status: 500 })
    }

    // Log event
    await supabaseAdmin.from('support_conversation_events').insert({
      conversation_id: id,
      actor_type: 'admin',
      actor_admin_id: user.id,
      event_type: 'untagged',
      old_value: { tag_id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
