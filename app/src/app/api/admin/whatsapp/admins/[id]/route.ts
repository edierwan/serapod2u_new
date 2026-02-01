import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Type for user data query result
interface UserData {
    organization_id: string | null
    role_code: string | null
    is_super_admin: boolean | null
}

// GET /api/admin/whatsapp/admins/[id] - Get single admin
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient()
        const { id: adminId } = await params

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Use 'as any' since table may not be in generated types yet
        const { data: admin, error } = await (supabase
            .from('whatsapp_bot_admins' as any)
            .select('*')
            .eq('id', adminId)
            .single() as any)

        if (error || !admin) {
            return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
        }

        return NextResponse.json({ ok: true, admin })
    } catch (error: any) {
        console.error('Failed to fetch admin:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}

// PATCH /api/admin/whatsapp/admins/[id] - Update admin
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient()
        const { id: adminId } = await params
        const body = await request.json()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user's org for RLS check
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

        // Build update object
        const updates: Record<string, any> = {}
        if (body.displayName !== undefined) updates.display_name = body.displayName
        if (body.isActive !== undefined) updates.is_active = body.isActive
        if (body.phone) updates.phone_digits = body.phone.replace(/\D/g, '')

        // Use 'as any' since table may not be in generated types yet
        const { data: updated, error } = await (supabase
            .from('whatsapp_bot_admins' as any)
            .update(updates)
            .eq('id', adminId)
            .eq('org_id', userData.organization_id)
            .select()
            .single() as any)

        if (error) throw error

        if (!updated) {
            return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
        }

        return NextResponse.json({ ok: true, admin: updated })
    } catch (error: any) {
        console.error('Failed to update admin:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}

// DELETE /api/admin/whatsapp/admins/[id] - Delete admin
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient()
        const { id: adminId } = await params

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

        // Use 'as any' since table may not be in generated types yet
        const { error } = await (supabase
            .from('whatsapp_bot_admins' as any)
            .delete()
            .eq('id', adminId)
            .eq('org_id', userData.organization_id) as any)

        if (error) throw error

        return NextResponse.json({ ok: true })
    } catch (error: any) {
        console.error('Failed to delete admin:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}
