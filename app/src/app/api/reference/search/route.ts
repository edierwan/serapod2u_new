import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientIpFromHeaders } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'

const MIN_SEARCH_LENGTH = 3
const MAX_RESULTS = 10

/**
 * GET /api/reference/search?q=<term>&limit=<n>
 * Search eligible reference users by name, phone, or exact email.
 * Only returns users where can_be_reference = true and is_active = true.
 *
 * Public by design (consumer sign-up uses it before login), so the response is
 * minimised to what the reference picker stores and displays: id, name, phone
 * (saved as referral_phone) and organization name. Email is never returned,
 * empty/short terms return nothing and requests are rate limited per client.
 */
export async function GET(request: NextRequest) {
    try {
        const limitResult = checkRateLimit(`reference-search:${clientIpFromHeaders(request.headers)}`, 30, 60 * 1000)
        if (!limitResult.allowed) {
            return NextResponse.json(
                { success: false, error: 'Too many requests' },
                { status: 429, headers: { 'Retry-After': String(limitResult.retryAfterSeconds) } }
            )
        }

        const searchParams = request.nextUrl.searchParams
        const searchTerm = (searchParams.get('q') || '').trim()
        const requestedLimit = parseInt(searchParams.get('limit') || '10', 10)
        const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 10, 1), MAX_RESULTS)

        if (searchTerm.length < MIN_SEARCH_LENGTH) {
            return NextResponse.json({ success: true, results: [] })
        }

        const supabase = createAdminClient()

        const { data, error } = await supabase.rpc('search_eligible_references' as any, {
            p_search_term: searchTerm,
            p_limit: limit
        })

        if (error) {
            console.error('Reference search error:', error)
            return NextResponse.json(
                { success: false, error: 'Search failed' },
                { status: 500 }
            )
        }

        const results = ((data as any[]) || []).map((row) => ({
            user_id: row.user_id,
            full_name: row.full_name,
            phone: row.phone,
            organization_name: row.organization_name ?? null,
        }))

        return NextResponse.json({
            success: true,
            results
        })
    } catch (err) {
        console.error('Reference search error:', err)
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        )
    }
}
