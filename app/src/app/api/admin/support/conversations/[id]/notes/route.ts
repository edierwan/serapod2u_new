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
 * POST /api/admin/support/conversations/[id]/notes
 * Add internal note to conversation
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
    const { note_text } = body

    if (!note_text?.trim()) {
      return NextResponse.json({ error: 'Note text is required' }, { status: 400 })
    }

    // Insert note
    const { data: note, error } = await supabaseAdmin
      .from('support_conversation_notes')
      .insert({
        conversation_id: id,
        admin_id: user.id,
        note_text: note_text.trim()
      })
      .select('*')
      .single()

    if (error) {
      console.error('Error adding note:', error)
      return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })
    }

    // Log event
    await supabaseAdmin.from('support_conversation_events').insert({
      conversation_id: id,
      actor_type: 'admin',
      actor_admin_id: user.id,
      event_type: 'note_added',
      new_value: { note_id: note.id }
    })

    return NextResponse.json({ note })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * GET /api/admin/support/conversations/[id]/notes
 * Get internal notes for conversation
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

    const { data: notes, error } = await supabaseAdmin
      .from('support_conversation_notes')
      .select('*, admin:admin_id(full_name, email)')
      .eq('conversation_id', id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching notes:', error)
      return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
    }

    return NextResponse.json({ notes: notes || [] })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
