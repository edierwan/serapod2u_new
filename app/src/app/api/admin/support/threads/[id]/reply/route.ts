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

    // Check admin role
    console.log('[Admin Reply] Checking role for user:', user.id, 'thread:', id)
    const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('role_code')
        .eq('id', user.id)
        .single()
    
    console.log('[Admin Reply] User role data:', userData, 'error:', userError)
        
    if (userError || !userData || !['SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin'].includes(userData.role_code)) {
         console.log('[Admin Reply] Role check failed. Role:', userData?.role_code)
         return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    
    console.log('[Admin Reply] Role check passed:', userData.role_code)

    const body = await request.json()
    const { message, attachments } = body

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Insert message
    console.log('[Admin Reply] Inserting message for thread:', id, 'user:', user.id)
    console.log('[Admin Reply] Message body:', message?.substring(0, 50))
    
    const messagePayload = {
      thread_id: id,
      sender_type: 'admin',
      sender_user_id: user.id,
      body: message,
      attachments: attachments || []
    }
    console.log('[Admin Reply] Payload:', JSON.stringify(messagePayload))
    
    const { data: newMessage, error: messageError } = await supabaseAdmin
      .from('support_messages' as any)
      .insert(messagePayload)
      .select()
      .single()

    if (messageError) {
      console.error('[Admin Reply] Error sending reply:', {
        code: messageError.code,
        message: messageError.message,
        details: messageError.details,
        hint: messageError.hint
      })
      return NextResponse.json({ 
        error: 'Failed to send reply', 
        details: messageError.message,
        code: messageError.code 
      }, { status: 500 })
    }
    
    console.log('[Admin Reply] Message inserted successfully:', newMessage?.id)

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
