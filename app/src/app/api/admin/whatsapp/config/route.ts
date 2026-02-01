import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const supabase = await createClient()

    // Check auth
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's organization
    const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

    if (!profile?.organization_id) {
        return NextResponse.json({ error: 'No organization' }, { status: 400 })
    }

    // Fetch WhatsApp config
    const { data: config, error } = await supabase
        .from('notification_provider_configs')
        .select('config_public, is_active')
        .eq('org_id', profile.organization_id)
        .eq('channel', 'whatsapp')
        .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found"
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
        ok: true,
        config: config || null
    })
}
