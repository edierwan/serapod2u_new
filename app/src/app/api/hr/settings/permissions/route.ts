import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { seedPermissionsCatalog, seedTemplateGroups } from '@/lib/server/hr/seedPermissions'

async function getCompanyContext(supabase: any) {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { error: 'Unauthorized', status: 401 }

    const { data: userData } = await supabase
        .from('users')
        .select('organization_id, roles!inner(role_level)')
        .eq('id', user.id)
        .single()

    if (!userData) return { error: 'User not found', status: 404 }

    return { user, userData, orgId: userData.organization_id, roleLevel: userData.roles.role_level }
}

/**
 * GET /api/hr/settings/permissions
 * Fetch all permissions, access groups with members and permissions
 */
export async function GET() {
    try {
        const supabase = await createClient() as any
        const ctx = await getCompanyContext(supabase)
        if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

        // Fetch all available permissions
        const { data: permissions } = await supabase
            .from('hr_permissions')
            .select('*')
            .order('module')
            .order('code')

        // Fetch access groups for this organization
        const { data: groups } = await supabase
            .from('hr_access_groups')
            .select(`
        *,
        hr_access_group_permissions (
          id, permission_id,
          hr_permissions ( id, code, module, name )
        ),
        hr_access_group_members (
          id, user_id, scope_type, scope_value, granted_by
        )
      `)
            .eq('organization_id', ctx.orgId)
            .order('name')

        // Fetch potential members (users in org)
        const { data: orgUsers } = await supabase
            .from('users')
            .select('id, full_name, email')
            .eq('organization_id', ctx.orgId)
            .eq('is_active', true)
            .order('full_name')

        return NextResponse.json({
            permissions: permissions || [],
            groups: groups || [],
            users: orgUsers || [],
            isAdmin: ctx.roleLevel <= 20,
        })
    } catch (error) {
        console.error('Error fetching HR permissions:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * POST /api/hr/settings/permissions
 * Create an access group, or add members/permissions to a group
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient() as any
        const ctx = await getCompanyContext(supabase)
        if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
        if (ctx.roleLevel > 20) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

        const body = await request.json()
        const { action } = body

        if (action === 'create_group') {
            const { data: group, error } = await supabase
                .from('hr_access_groups')
                .insert({
                    organization_id: ctx.orgId,
                    name: body.name,
                    description: body.description || '',
                })
                .select()
                .single()
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            return NextResponse.json({ success: true, group })
        }

        if (action === 'add_member') {
            const { data: member, error } = await supabase
                .from('hr_access_group_members')
                .insert({
                    group_id: body.group_id,
                    user_id: body.user_id,
                    scope_type: body.scope_type || 'global',
                    scope_value: body.scope_value || null,
                    granted_by: ctx.user.id,
                })
                .select()
                .single()
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            return NextResponse.json({ success: true, member })
        }

        if (action === 'set_permissions') {
            // Replace all permissions for a group
            const { group_id, permission_ids } = body

            // Delete existing
            await supabase
                .from('hr_access_group_permissions')
                .delete()
                .eq('group_id', group_id)

            // Insert new
            if (permission_ids && permission_ids.length > 0) {
                const rows = permission_ids.map((pid: string) => ({
                    group_id,
                    permission_id: pid,
                }))
                const { error } = await supabase
                    .from('hr_access_group_permissions')
                    .insert(rows)
                if (error) return NextResponse.json({ error: error.message }, { status: 400 })
            }

            return NextResponse.json({ success: true })
        }

        if (action === 'seed_permissions_catalog') {
            // Canonical permission catalog seeding (shared logic).
            const added = await seedPermissionsCatalog(supabase)
            return NextResponse.json({ success: true, message: `${added} permissions seeded in catalog` })
        }

        if (action === 'seed_template_groups') {
            // Canonical template-group seeding (shared logic).
            const created = await seedTemplateGroups(supabase, ctx.orgId)
            return NextResponse.json({ success: true, message: `${created} template access groups created with permissions` })
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    } catch (error) {
        console.error('Error in HR permissions POST:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * DELETE /api/hr/settings/permissions
 * Remove a group, member, or permission mapping
 */
export async function DELETE(request: Request) {
    try {
        const supabase = await createClient() as any
        const ctx = await getCompanyContext(supabase)
        if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
        if (ctx.roleLevel > 20) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

        const { searchParams } = new URL(request.url)
        const type = searchParams.get('type')
        const id = searchParams.get('id')

        if (!type || !id) return NextResponse.json({ error: 'Missing type/id' }, { status: 400 })

        if (type === 'group') {
            // Check system group
            const { data: group } = await supabase
                .from('hr_access_groups')
                .select('is_system')
                .eq('id', id)
                .single()
            if (group?.is_system) {
                return NextResponse.json({ error: 'Cannot delete system group' }, { status: 400 })
            }
            const { error } = await supabase.from('hr_access_groups').delete().eq('id', id)
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        } else if (type === 'member') {
            const { error } = await supabase.from('hr_access_group_members').delete().eq('id', id)
            if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        } else {
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error in HR permissions DELETE:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
