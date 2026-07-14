import { NextRequest, NextResponse } from 'next/server'
import { getReturnContext, RETURN_ORG_SELECT } from '@/lib/returns/server'
import { RETURN_SOURCE_ORG_TYPE_CODE, normalizeReturnSourceType } from '@/lib/returns/constants'

/**
 * GET /api/returns/organizations?type=shop|distributor&q=...&id=...
 *
 * Server-side, debounced-friendly search for the Return Product source selector.
 * Strictly filtered by the requested source org type (Shop -> SHOP,
 * Distributor -> DIST) so the picker can never surface the wrong type. Searches
 * name / code / branch / contact name / phone / email, capped to a small page.
 *
 * `id` may be passed to guarantee a specific (already-selected) organization is
 * present in the result even when it does not match the current query — so
 * reopening a draft always shows the selected org.
 */
const RESULT_LIMIT = 25

export async function GET(request: NextRequest) {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const sp = request.nextUrl.searchParams
    const sourceType = normalizeReturnSourceType(sp.get('type'))
    const orgTypeCode = RETURN_SOURCE_ORG_TYPE_CODE[sourceType]
    const q = (sp.get('q') || '').trim()
    const ensureId = (sp.get('id') || '').trim()

    // A shop self-service user is scoped to their own organization only.
    const scopeToSelf = !ctx.isManager

    let query = ctx.admin
        .from('organizations')
        .select(RETURN_ORG_SELECT)
        .eq('org_type_code', orgTypeCode)
        .eq('is_active', true)
        .order('org_name', { ascending: true })
        .limit(RESULT_LIMIT)

    if (scopeToSelf) {
        query = query.eq('id', ctx.orgId || '00000000-0000-0000-0000-000000000000')
    }

    if (q) {
        // Escape PostgREST `or` filter special characters (commas/parens) and
        // wildcards to prevent filter injection / unintended matches.
        const safe = q.replace(/[,()\\]/g, ' ').replace(/[%_]/g, (m) => `\\${m}`)
        const like = `%${safe}%`
        query = query.or(
            [
                `org_name.ilike.${like}`,
                `org_code.ilike.${like}`,
                `branch.ilike.${like}`,
                `contact_name.ilike.${like}`,
                `contact_phone.ilike.${like}`,
                `contact_email.ilike.${like}`,
            ].join(','),
        )
    }

    const { data, error } = await query
    if (error) {
        return NextResponse.json({ error: 'Unable to search organizations.' }, { status: 500 })
    }

    let organizations = data || []

    // Guarantee the already-selected org is present even if it fell outside the
    // current search page (managers only — self-service is already self-scoped).
    if (ensureId && !scopeToSelf && !organizations.some((o: any) => o.id === ensureId)) {
        const { data: selected } = await ctx.admin
            .from('organizations')
            .select(RETURN_ORG_SELECT)
            .eq('id', ensureId)
            .eq('org_type_code', orgTypeCode)
            .maybeSingle()
        if (selected) organizations = [selected, ...organizations]
    }

    return NextResponse.json({ organizations })
}
