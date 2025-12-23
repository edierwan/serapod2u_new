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

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
        
    if (userError || !userData || !['admin', 'super_admin', 'hq_admin'].includes(userData.role_code)) {
         return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = params
    const body = await request.json()
    const { message, attachments } = body

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Insert message
    const { data: newMessage, error: messageError } = await supabaseAdmin
      .from('support_messages' as any)
      .insert({
        thread_id: id,
        sender_type: 'admin',
        sender_user_id: user.id,
        body: message,
        attachments: attachments || []
      })
      .select()
      .single()

    if (messageError) {
      console.error('Error sending reply:', messageError)
      return NextResponse.json({ error: 'Failed to send reply' }, { status: 500 })
    }

    // Update thread status to pending (waiting for user)
    await supabaseAdmin
      .from('support_threads' as any)
      .update({
        status: 'pending',
        last_message_at: new Date().toISOString(),
        last_message_preview: message.substring(0, 50),
        assigned_admin_user_id: user.id // Auto assign to replier if not assigned? Or just keep it.
      })
      .eq('id', id)
      
    // Mark as read for admin
    await supabaseAdmin
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
