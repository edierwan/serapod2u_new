import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/notifications/recipients/preview
 * 
 * Preview who will receive a notification based on recipient config.
 * Does NOT require a sample order - resolves from org context.
 * 
 * Query params:
 *   - roles: comma-separated role codes (e.g. "admin,warehouse")
 *   - dynamicTarget: "manufacturer" | "distributor" | "warehouse"
 *   - userIds: comma-separated user IDs
 *   - consumer: "true" to include consumer placeholder
 */
export async function GET(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get caller's org
    const { data: profile } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single()

    if (!profile?.organization_id) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const orgId = profile.organization_id
    const searchParams = request.nextUrl.searchParams
    const rolesParam = searchParams.get('roles')
    const dynamicTarget = searchParams.get('dynamicTarget')
    const userIdsParam = searchParams.get('userIds')

    const recipients: Array<{
        user_id: string
        full_name: string
        email: string | null
        phone: string | null
        type: string
    }> = []

    try {
        // 1. Resolve by roles
        if (rolesParam) {
            const roles = rolesParam.split(',').map(r => r.trim()).filter(Boolean)
            if (roles.length > 0) {
                const { data: users } = await supabase
                    .from('users')
                    .select('id, full_name, email, phone, role_code')
                    .eq('organization_id', orgId)
                    .in('role_code', roles)
                    .order('full_name')

                if (users) {
                    recipients.push(...users.map(u => ({
                        user_id: u.id,
                        full_name: u.full_name || u.email || 'Unknown',
                        email: u.email,
                        phone: u.phone,
                        type: `Role: ${(u.role_code || '').replace('_', ' ')}`
                    })))
                }
            }
        }

        // 2. Resolve by dynamic target (related organization users)
        if (dynamicTarget) {
            // For dynamic, we show all users from the current org matching the target role concept
            // Since we don't have a specific order, we show org-level users whose role matches
            // or we show a helpful message that it's resolved at send time
            if (dynamicTarget === 'warehouse') {
                const { data: users } = await supabase
                    .from('users')
                    .select('id, full_name, email, phone, role_code')
                    .eq('organization_id', orgId)
                    .eq('role_code', 'warehouse')
                    .order('full_name')

                if (users) {
                    recipients.push(...users.map(u => ({
                        user_id: u.id,
                        full_name: u.full_name || u.email || 'Unknown',
                        email: u.email,
                        phone: u.phone,
                        type: 'Dynamic: Warehouse'
                    })))
                }
            } else if (dynamicTarget === 'manufacturer' || dynamicTarget === 'distributor') {
                // For manufacturer/distributor dynamic, recipients depend on the order context.
                // We cannot resolve specific users without a sample order.
                // Return a placeholder indicating it's resolved at delivery time.
                recipients.push({
                    user_id: `dynamic-${dynamicTarget}`,
                    full_name: `Resolved at send time`,
                    email: null,
                    phone: null,
                    type: `Dynamic: ${dynamicTarget.charAt(0).toUpperCase() + dynamicTarget.slice(1)}`
                })
            }
        }

        // 3. Resolve specific users by ID
        if (userIdsParam) {
            const ids = userIdsParam.split(',').map(id => id.trim()).filter(Boolean)
            if (ids.length > 0) {
                const { data: users } = await supabase
                    .from('users')
                    .select('id, full_name, email, phone')
                    .in('id', ids)
                    .order('full_name')

                if (users) {
                    recipients.push(...users.map(u => ({
                        user_id: u.id,
                        full_name: u.full_name || u.email || 'Unknown',
                        email: u.email,
                        phone: u.phone,
                        type: 'Specific User'
                    })))
                }
            }
        }

        // Deduplicate by user_id
        const unique = Array.from(
            new Map(recipients.map(r => [r.user_id, r])).values()
        )

        return NextResponse.json({
            success: true,
            recipients: unique,
            total: unique.length,
            hasPhone: unique.filter(r => !!r.phone).length,
            missingPhone: unique.filter(r => !r.phone).length,
        })
    } catch (error: any) {
        console.error('Recipients preview error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
