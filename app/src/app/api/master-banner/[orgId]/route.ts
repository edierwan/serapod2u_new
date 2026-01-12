import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET - Fetch master banner config for an organization (public endpoint for consumers)
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ orgId: string }> }
) {
    try {
        const { orgId } = await context.params

        if (!orgId) {
            return NextResponse.json(
                { success: false, error: 'Organization ID is required' },
                { status: 400 }
            )
        }

        const supabase = createAdminClient()

        // Fetch master banner config
        const { data: config, error: configError } = await (supabase as any)
            .from('master_banner_configs')
            .select('banner_config, is_active')
            .eq('org_id', orgId)
            .eq('is_active', true)
            .single()

        if (configError && configError.code !== 'PGRST116') {
            console.error('Error fetching master banner config:', configError)
            return NextResponse.json(
                { success: false, error: 'Failed to fetch banner config' },
                { status: 500 }
            )
        }

        // Return config or null if not found
        return NextResponse.json({
            success: true,
            data: config?.banner_config || null
        })
    } catch (error) {
        console.error('Unexpected error in master banner public endpoint:', error)
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        )
    }
}
