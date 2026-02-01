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

        // Get user's organization from users table (consistent with Dashboard)
        const { data: userRecord } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (!userRecord?.organization_id) {
            return NextResponse.json({ ok: false, error: 'No organization' }, { status: 400 })
        }

        // Get AI mode from org settings
        const { data: settings } = await (supabase as any)
            .from('organization_settings')
            .select('setting_value')
            .eq('organization_id', userRecord.organization_id)
            .eq('setting_key', 'whatsapp_ai_mode')
            .single()

        // Default to 'auto' if not set
        const mode = settings?.setting_value || 'auto'

        return NextResponse.json({
            ok: true,
            mode,
            enabled: mode === 'auto'
        })

    } catch (error: any) {
        console.error('Error fetching AI mode:', error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
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

        // Upsert the setting
        const { error: upsertError } = await (supabase as any)
            .from('organization_settings')
            .upsert({
                organization_id: userRecord.organization_id,
                setting_key: 'whatsapp_ai_mode',
                setting_value: mode,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'organization_id,setting_key'
            })

        if (upsertError) {
            // If upsert fails due to missing table or constraint, try insert/update separately
            const { data: existing } = await (supabase as any)
                .from('organization_settings')
                .select('id')
                .eq('organization_id', userRecord.organization_id)
                .eq('setting_key', 'whatsapp_ai_mode')
                .single()

            if (existing) {
                await (supabase as any)
                    .from('organization_settings')
                    .update({ setting_value: mode, updated_at: new Date().toISOString() })
                    .eq('organization_id', userRecord.organization_id)
                    .eq('setting_key', 'whatsapp_ai_mode')
            } else {
                await (supabase as any)
                    .from('organization_settings')
                    .insert({
                        organization_id: userRecord.organization_id,
                        setting_key: 'whatsapp_ai_mode',
                        setting_value: mode
                    })
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
