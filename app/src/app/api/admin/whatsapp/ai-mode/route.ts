import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/whatsapp/ai-mode - Get global AI mode
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()

        // Get current user
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Get user's organization from users table
        const { data: userRecord } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (!userRecord?.organization_id) {
            return NextResponse.json({ ok: false, error: 'No organization' }, { status: 400 })
        }

        // Get AI mode from org_notification_settings table
        const { data: settings, error: settingsError } = await supabase
            .from('org_notification_settings')
            .select('ai_mode')
            .eq('org_id', userRecord.organization_id)
            .single()

        // Default to 'auto' if not set or column doesn't exist yet
        const mode = (settings as any)?.ai_mode || 'auto'

        return NextResponse.json({
            ok: true,
            mode,
            enabled: mode === 'auto'
        })

    } catch (error: any) {
        console.error('Error fetching AI mode:', error)
        // Return default 'auto' on error to maintain backwards compatibility
        return NextResponse.json({
            ok: true,
            mode: 'auto',
            enabled: true
        })
    }
}

// POST /api/admin/whatsapp/ai-mode - Set global AI mode
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()

        // Get current user
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Get user's organization from users table
        const { data: userRecord } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (!userRecord?.organization_id) {
            return NextResponse.json({ ok: false, error: 'No organization' }, { status: 400 })
        }

        const body = await request.json()
        const mode = body.mode === 'auto' ? 'auto' : 'takeover'

        // Upsert into org_notification_settings table
        const { error: upsertError } = await (supabase as any)
            .from('org_notification_settings')
            .upsert({
                org_id: userRecord.organization_id,
                ai_mode: mode,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'org_id'
            })

        if (upsertError) {
            console.error('Upsert error:', upsertError)

            // If upsert fails, try update then insert
            const { error: updateError } = await (supabase as any)
                .from('org_notification_settings')
                .update({
                    ai_mode: mode,
                    updated_at: new Date().toISOString()
                })
                .eq('org_id', userRecord.organization_id)

            if (updateError) {
                // Try insert if update also fails (row doesn't exist)
                const { error: insertError } = await (supabase as any)
                    .from('org_notification_settings')
                    .insert({
                        org_id: userRecord.organization_id,
                        ai_mode: mode,
                        otp_enabled: false,
                        otp_channel: 'whatsapp',
                        whatsapp_enabled: true
                    })

                if (insertError) {
                    console.error('Insert error:', insertError)
                    return NextResponse.json({
                        ok: false,
                        error: 'Failed to save AI mode setting'
                    }, { status: 500 })
                }
            }
        }

        return NextResponse.json({
            ok: true,
            mode,
            enabled: mode === 'auto',
            message: mode === 'auto' ? 'AI Auto-Reply enabled' : 'AI Auto-Reply disabled'
        })

    } catch (error: any) {
        console.error('Error setting AI mode:', error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
}
