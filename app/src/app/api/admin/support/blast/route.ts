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
        
    if (userError || !userData || !['admin', 'super_admin', 'hq_admin'].includes(userData.role_code)) {
         return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { subject, message, attachments } = body

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Call the database function to send blast
    const { error } = await supabaseAdmin.rpc('send_announcement_blast', {
      announcement_subject: subject || 'Announcement',
      announcement_message: message,
      announcement_attachments: attachments || []
    })

    if (error) {
      console.error('Error sending blast:', error)
      return NextResponse.json({ error: 'Failed to send blast' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
