import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Type for user data query result
interface UserData {
    organization_id: string | null
    role_code: string | null
    is_super_admin: boolean | null
}

// GET /api/admin/whatsapp/admins - List all bot admins for org
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()

        // Get current user and verify admin
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

        // Check if user is admin
        if (!userData.is_super_admin && !['ADMIN', 'HQ', 'SUPER'].includes(userData.role_code || '')) {
            return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
        }

        // Fetch bot admins (use 'as any' since table may not be in generated types yet)
        const { data: admins, error } = await (supabase
            .from('whatsapp_bot_admins' as any)
            .select('*')
            .eq('org_id', userData.organization_id)
            .order('created_at', { ascending: false }) as any)

        if (error) throw error

        return NextResponse.json({
            ok: true,
            admins: admins || [],
            orgId: userData.organization_id
        })
    } catch (error: any) {
        console.error('Failed to fetch bot admins:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}

// POST /api/admin/whatsapp/admins - Add new bot admin
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const body = await request.json()

        const { phone, displayName } = body

        if (!phone) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
        }

        // Normalize phone to digits only
        const phoneDigits = phone.replace(/\D/g, '')

        if (phoneDigits.length < 10 || phoneDigits.length > 15) {
            return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 })
        }

        // Get current user
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

        // Check if user is admin
        if (!userData.is_super_admin && !['ADMIN', 'HQ', 'SUPER'].includes(userData.role_code || '')) {
            return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
        }

        // Enforce max 3 admins per org
        const { data: existingAdmins, error: countError } = await (supabase
            .from('whatsapp_bot_admins' as any)
            .select('id')
            .eq('org_id', userData.organization_id) as any)

        if (countError) throw countError

        if ((existingAdmins || []).length >= 3) {
            return NextResponse.json({ error: 'Maximum 3 bot admins allowed per organization. Remove an existing admin first.' }, { status: 400 })
        }

        // Insert new admin (use 'as any' since table may not be in generated types yet)
        const { data: newAdmin, error } = await (supabase
            .from('whatsapp_bot_admins' as any)
            .insert({
                org_id: userData.organization_id,
                phone_digits: phoneDigits,
                display_name: displayName || null,
                created_by: user.id
            })
            .select()
            .single() as any)

        if (error) {
            if (error.code === '23505') { // Unique constraint violation
                return NextResponse.json({ error: 'This phone number is already an admin' }, { status: 409 })
            }
            throw error
        }

        return NextResponse.json({ ok: true, admin: newAdmin })
    } catch (error: any) {
        console.error('Failed to add bot admin:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}
