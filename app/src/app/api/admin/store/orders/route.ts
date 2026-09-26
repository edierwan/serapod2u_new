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
    if (orgType !== 'HQ' || roleLevel == null || roleLevel > 30 || !profile.organization_id) return null

    return { userId: user.id, orgId: profile.organization_id as string }
}

// Storefront orders an HQ admin may see or change: their own organization's
// orders plus legacy orders created before organization_id existed (NULL),
// which belong to the single platform storefront. Applied to every read AND
// write so an order id alone can never bypass tenant filtering.
const orgScopeFilter = (orgId: string) => `organization_id.eq.${orgId},organization_id.is.null`

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PostgREST or() filters are comma/parenthesis delimited; keep search text literal.
const sanitizeSearch = (value: string) => value.replace(/[,()\\*%]/g, ' ').trim().slice(0, 100)

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
        const salesChannel = searchParams.get('salesChannel')
        const page = parseInt(searchParams.get('page') || '1', 10)
        const limit = parseInt(searchParams.get('limit') || '25', 10)
        const offset = (page - 1) * limit

        const adminClient: any = createAdminClient()

        // Build query
        let query = adminClient
            .from('storefront_orders')
            .select('*, storefront_order_items(*)', { count: 'exact' })

        // Tenant scope (same filter as PUT)
        query = query.or(orgScopeFilter(admin.orgId))

        if (salesChannel === 'outdoor' || salesChannel === 'store') {
            query = query.eq('sales_channel', salesChannel)
        }

        // Status filter
        if (status && status !== 'all') {
            query = query.eq('status', status)
        }

        // Search by order ref, customer name, or email
        const safeSearch = search ? sanitizeSearch(search) : ''
        if (safeSearch) {
            query = query.or(
                `order_ref.ilike.%${safeSearch}%,customer_name.ilike.%${safeSearch}%,customer_email.ilike.%${safeSearch}%`
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

        if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
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

        // The tenant scope is part of the UPDATE itself, so an order outside the
        // admin's scope is indistinguishable from a non-existent one.
        const { data, error } = await adminClient
            .from('storefront_orders')
            .update(updateData)
            .eq('id', id)
            .or(orgScopeFilter(admin.orgId))
            .select('*')
            .maybeSingle()

        if (error) {
            console.error('[admin/store/orders] PUT error:', error)
            throw error
        }

        if (!data) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }

        return NextResponse.json({ order: data })
    } catch (err) {
        console.error('[admin/store/orders] PUT error:', err)
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
    }
}
