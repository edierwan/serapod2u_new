import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Type for user data query result
interface UserData {
    organization_id: string | null
    role_code: string | null
    is_super_admin: boolean | null
}

// GET /api/admin/whatsapp/settings - Get bot settings for org
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user's org
        const { data: userData } = await supabase
            .from('users')
            .select('organization_id, role_code, is_super_admin')
            .eq('id', user.id)
            .single() as { data: UserData | null, error: any }

        if (!userData?.organization_id) {
            return NextResponse.json({ error: 'No organization found' }, { status: 400 })
        }

        if (!userData.is_super_admin && !['ADMIN', 'HQ', 'SUPER'].includes(userData.role_code || '')) {
            return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
        }

        // Get settings (use 'as any' since table may not be in generated types yet)
        let { data: settings, error } = await (supabase
            .from('whatsapp_bot_settings' as any)
            .select('*')
            .eq('org_id', userData.organization_id)
            .single() as any)

        // Create default settings if not exists
        if (!settings) {
            const { data: newSettings, error: insertError } = await (supabase
                .from('whatsapp_bot_settings' as any)
                .insert({ org_id: userData.organization_id })
                .select()
                .single() as any)

            if (insertError) throw insertError
            settings = newSettings
        }

        // Mask sensitive fields
        if (settings) {
            settings = {
                ...settings,
                gateway_api_key: settings.gateway_api_key ? '••••••••' : null,
                webhook_secret: settings.webhook_secret ? '••••••••' : null
            }
        }

        return NextResponse.json({ ok: true, settings })
    } catch (error: any) {
        console.error('Failed to fetch bot settings:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}

// PATCH /api/admin/whatsapp/settings - Update bot settings
export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient()
        const body = await request.json()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user's org
        const { data: userData } = await supabase
            .from('users')
            .select('organization_id, role_code, is_super_admin')
            .eq('id', user.id)
            .single() as { data: UserData | null, error: any }

        if (!userData?.organization_id) {
            return NextResponse.json({ error: 'No organization found' }, { status: 400 })
        }

        if (!userData.is_super_admin && !['ADMIN', 'HQ', 'SUPER'].includes(userData.role_code || '')) {
            return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
        }

        // Build update object (only allowed fields)
        const allowedFields = [
            'auto_reply_enabled', 'tool_calling_enabled', 'safe_mode',
            'llm_provider', 'llm_model', 'llm_temperature', 'llm_max_tokens',
            'takeover_auto_revert_ms', 'greeting_enabled', 'bot_name', 'bot_language',
            'gateway_api_key', 'webhook_secret'
        ]

        const updates: Record<string, any> = {}
        for (const field of allowedFields) {
            // Convert camelCase to snake_case for some fields
            const camelField = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
            if (body[field] !== undefined) {
                updates[field] = body[field]
            } else if (body[camelField] !== undefined) {
                updates[field] = body[camelField]
            }
        }

        // Don't update secrets if masked value sent
        if (updates.gateway_api_key === '••••••••') delete updates.gateway_api_key
        if (updates.webhook_secret === '••••••••') delete updates.webhook_secret

        // Use 'as any' since table may not be in generated types yet
        const { data: settings, error } = await (supabase
            .from('whatsapp_bot_settings' as any)
            .update(updates)
            .eq('org_id', userData.organization_id)
            .select()
            .single() as any)

        if (error) throw error

        // Mask sensitive fields in response
        const maskedSettings = settings ? {
            ...settings,
            gateway_api_key: settings.gateway_api_key ? '••••••••' : null,
            webhook_secret: settings.webhook_secret ? '••••••••' : null
        } : null

        return NextResponse.json({ ok: true, settings: maskedSettings })
    } catch (error: any) {
        console.error('Failed to update bot settings:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}
