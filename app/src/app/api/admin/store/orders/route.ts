import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ── Helpers ─────────────────────────────────────────────────────────

async function getAuthenticatedAdmin(supabase: any) {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
        .from('users')
        .select('id, organization_id, role_code, organizations!fk_users_organization(id, org_type_code), roles(role_level)')
        .eq('id', user.id)
        .single()

    if (!profile) return null
    const orgType = (profile.organizations as any)?.org_type_code
    const roleLevel = (profile.roles as any)?.role_level
    // HQ users with role level ≤ 30 (Admin/Manager)
    if (orgType !== 'HQ' || roleLevel > 30) return null

    return { userId: user.id, orgId: profile.organization_id }
}

// ── GET /api/admin/store/orders ─────────────────────────────────────
// List storefront orders for the admin's organization

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const admin = await getAuthenticatedAdmin(supabase)
        if (!admin) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status')
        const search = searchParams.get('search')
        const page = parseInt(searchParams.get('page') || '1', 10)
        const limit = parseInt(searchParams.get('limit') || '25', 10)
        const offset = (page - 1) * limit

        const adminClient: any = createAdminClient()

        // Build query
        let query = adminClient
            .from('storefront_orders')
            .select('*, storefront_order_items(*)', { count: 'exact' })

        // Filter by org if the column exists (multi-tenant)
        if (admin.orgId) {
            query = query.or(`organization_id.eq.${admin.orgId},organization_id.is.null`)
        }

        // Status filter
        if (status && status !== 'all') {
            query = query.eq('status', status)
        }

        // Search by order ref, customer name, or email
        if (search) {
            query = query.or(
                `order_ref.ilike.%${search}%,customer_name.ilike.%${search}%,customer_email.ilike.%${search}%`
            )
        }

        // Pagination & ordering
        query = query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        const { data, error, count } = await query

        if (error) {
            console.error('[admin/store/orders] GET error:', error)
            throw error
        }

        return NextResponse.json({
            orders: data ?? [],
            total: count ?? 0,
            page,
            limit,
            totalPages: Math.ceil((count ?? 0) / limit),
        })
    } catch (err) {
        console.error('[admin/store/orders] GET error:', err)
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
    }
}

// ── PUT /api/admin/store/orders ─────────────────────────────────────
// Update order status

export async function PUT(request: NextRequest) {
    try {
        const supabase = await createClient()
        const admin = await getAuthenticatedAdmin(supabase)
        if (!admin) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { id, status, notes } = body

        if (!id || !status) {
            return NextResponse.json({ error: 'Missing order id or status' }, { status: 400 })
        }

        // Validate status transition
        const validStatuses = [
            'pending_payment', 'paid', 'payment_failed',
            'processing', 'shipped', 'delivered', 'cancelled', 'refunded',
        ]
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        }

        const adminClient: any = createAdminClient()

        const updateData: Record<string, any> = { status }
        if (notes !== undefined) updateData.admin_notes = notes

        const { data, error } = await adminClient
            .from('storefront_orders')
            .update(updateData)
            .eq('id', id)
            .select('*')
            .single()

        if (error) {
            console.error('[admin/store/orders] PUT error:', error)
            throw error
        }

        return NextResponse.json({ order: data })
    } catch (err) {
        console.error('[admin/store/orders] PUT error:', err)
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
    }
}
