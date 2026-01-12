import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET - Fetch master banner config for the user's organization
export async function GET() {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json(
            { success: false, error: 'Unauthorized' },
            { status: 401 }
        )
    }

    // Get user's organization
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single()

    if (userError || !userData || !userData.organization_id) {
        return NextResponse.json(
            { success: false, error: 'User not found' },
            { status: 404 }
        )
    }

    // Fetch master banner config (using type assertion as table is new)
    const { data: config, error: configError } = await (supabase as any)
        .from('master_banner_configs')
        .select('*')
        .eq('org_id', userData.organization_id)
        .single()

    if (configError && configError.code !== 'PGRST116') {
        // PGRST116 is "no rows returned" - that's okay, we'll return default
        return NextResponse.json(
            { success: false, error: configError.message },
            { status: 500 }
        )
    }

    // Return config or default if not found
    return NextResponse.json({
        success: true,
        data: config || {
            org_id: userData.organization_id,
            banner_config: {
                enabled: false,
                template: 'grid',
                items: []
            },
            is_active: false,
            is_new: true // Flag to indicate this is a new config
        }
    })
}

// POST - Create new master banner config
export async function POST(request: NextRequest) {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json(
            { success: false, error: 'Unauthorized' },
            { status: 401 }
        )
    }

    // Get user's organization and role
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select(`
            organization_id,
            organizations:organization_id (org_type_code),
            roles:role_code (role_level)
        `)
        .eq('id', user.id)
        .single()

    if (userError || !userData) {
        return NextResponse.json(
            { success: false, error: 'User not found' },
            { status: 404 }
        )
    }

    // Check permissions (HQ admin only)
    const org = Array.isArray(userData.organizations) ? userData.organizations[0] : userData.organizations
    const role = Array.isArray(userData.roles) ? userData.roles[0] : userData.roles

    if (org?.org_type_code !== 'HQ' || (role?.role_level && role.role_level > 30)) {
        return NextResponse.json(
            { success: false, error: 'Only HQ administrators can manage master banner config' },
            { status: 403 }
        )
    }

    if (!userData.organization_id) {
        return NextResponse.json(
            { success: false, error: 'Organization not found' },
            { status: 404 }
        )
    }

    const body = await request.json()
    const { banner_config } = body

    // Create master banner config (using type assertion as table is new)
    const { data: config, error: insertError } = await (supabase as any)
        .from('master_banner_configs')
        .insert({
            org_id: userData.organization_id,
            banner_config: banner_config || {
                enabled: false,
                template: 'grid',
                items: []
            },
            is_active: true,
            created_by: user.id,
            updated_by: user.id
        })
        .select()
        .single()

    if (insertError) {
        return NextResponse.json(
            { success: false, error: insertError.message },
            { status: 500 }
        )
    }

    return NextResponse.json({
        success: true,
        data: config
    })
}

// PUT - Update master banner config
export async function PUT(request: NextRequest) {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json(
            { success: false, error: 'Unauthorized' },
            { status: 401 }
        )
    }

    // Get user's organization and role
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select(`
            organization_id,
            organizations:organization_id (org_type_code),
            roles:role_code (role_level)
        `)
        .eq('id', user.id)
        .single()

    if (userError || !userData || !userData.organization_id) {
        return NextResponse.json(
            { success: false, error: 'User not found' },
            { status: 404 }
        )
    }

    // Check permissions (HQ admin only)
    const org = Array.isArray(userData.organizations) ? userData.organizations[0] : userData.organizations
    const role = Array.isArray(userData.roles) ? userData.roles[0] : userData.roles

    if (org?.org_type_code !== 'HQ' || (role?.role_level && role.role_level > 30)) {
        return NextResponse.json(
            { success: false, error: 'Only HQ administrators can manage master banner config' },
            { status: 403 }
        )
    }

    const body = await request.json()
    const { banner_config, is_active } = body

    // Update master banner config (upsert) - using type assertion as table is new
    const { data: config, error: updateError } = await (supabase as any)
        .from('master_banner_configs')
        .upsert({
            org_id: userData.organization_id,
            banner_config: banner_config,
            is_active: is_active ?? true,
            updated_by: user.id,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'org_id'
        })
        .select()
        .single()

    if (updateError) {
        return NextResponse.json(
            { success: false, error: updateError.message },
            { status: 500 }
        )
    }

    return NextResponse.json({
        success: true,
        data: config
    })
}
