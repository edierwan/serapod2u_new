import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/shops/search?q=<term>&limit=<n>
 * Search active shops by name prefix.
 * Returns organizations with org_type_code = 'SHOP' and is_active = true.
 */
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const searchTerm = searchParams.get('q')?.trim() || ''
        const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 30)

        const supabase = createAdminClient()

        if (!searchTerm) {
            return NextResponse.json({ success: true, results: [] })
        }

        const { data, error } = await supabase
            .from('organizations')
            .select(`
                id,
                org_name,
                branch,
                contact_name,
                contact_phone,
                states(state_name)
            `)
            .eq('org_type_code', 'SHOP')
            .eq('is_active', true)
            .ilike('org_name', `${searchTerm}%`)
            .order('org_name', { ascending: true })
            .order('branch', { ascending: true, nullsFirst: false })
            .limit(limit)

        if (error) {
            console.error('Shop search error:', error)
            return NextResponse.json(
                { success: false, error: 'Search failed' },
                { status: 500 }
            )
        }

        const results = (data || []).map((shop: any) => ({
            org_id: shop.id,
            org_name: shop.org_name,
            branch: shop.branch,
            contact_name: shop.contact_name,
            contact_phone: shop.contact_phone,
            state_name: shop.states?.state_name || null,
            display_label: shop.branch && shop.branch.trim()
                ? `${shop.org_name} (${shop.branch})`
                : shop.org_name,
        }))

        return NextResponse.json({
            success: true,
            results
        })
    } catch (err) {
        console.error('Shop search error:', err)
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        )
    }
}
