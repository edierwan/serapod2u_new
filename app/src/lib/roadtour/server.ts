import { createAdminClient } from '@/lib/supabase/admin'
import { buildRoadTourPath, extractRoadTourShortCode } from '@/lib/roadtour/url'
import type { RoadtourProductCategory } from '@/lib/roadtour/experience-registry'
import { isMissingRoadtourProductCategorySchema } from '@/lib/roadtour/events'

export interface ResolvedRoadtourQrRecord {
    id: string
    token: string
    canonical_path: string | null
    route_year: number | null
    campaign_slug: string | null
    reference_slug: string | null
    short_code: string | null
    campaign_name: string
    account_manager_user_id: string
    account_manager_name: string
    account_manager_email: string
    account_manager_phone: string
    org_id: string
    default_points: number
    product_category: RoadtourProductCategory | null
}

async function fetchRoadtourQr(supabase: any, applyFilters: (query: any) => any) {
    const categoryResult = await applyFilters(
        supabase
            .from('roadtour_qr_codes')
            .select(`
            id,
            token,
            canonical_path,
            route_year,
            campaign_slug,
            reference_slug,
            short_code,
            roadtour_campaigns!inner(
                name,
                org_id,
                default_points,
                roadtour_runs!roadtour_campaigns_roadtour_run_id_fkey(
                    product_category_id,
                    product_categories!roadtour_runs_product_category_id_fkey(id, category_code, category_name, image_url, is_active, is_vape)
                )
            ),
            users:account_manager_user_id(id, full_name, email, phone)
        `)
    ).maybeSingle()

    let data = categoryResult.data
    let error = categoryResult.error

    if (error && isMissingRoadtourProductCategorySchema(error)) {
        const legacyResult = await applyFilters(
            supabase
                .from('roadtour_qr_codes')
                .select(`
                    id,
                    token,
                    canonical_path,
                    route_year,
                    campaign_slug,
                    reference_slug,
                    short_code,
                    roadtour_campaigns!inner(name, org_id, default_points),
                    users:account_manager_user_id(id, full_name, email, phone)
                `)
        ).maybeSingle()
        data = legacyResult.data
        error = legacyResult.error
    }

    if (error || !data) return null

    const canonicalPath = data.canonical_path || buildRoadTourPath({
        year: data.route_year,
        campaignSlug: data.campaign_slug,
        referenceSlug: data.reference_slug,
        shortCode: data.short_code,
        routeBase: 'roadtour',
    })

    const run = Array.isArray(data.roadtour_campaigns?.roadtour_runs)
        ? data.roadtour_campaigns.roadtour_runs[0]
        : data.roadtour_campaigns?.roadtour_runs
    const productCategory = Array.isArray(run?.product_categories)
        ? run.product_categories[0]
        : run?.product_categories

    return {
        id: data.id,
        token: data.token,
        canonical_path: canonicalPath,
        route_year: data.route_year,
        campaign_slug: data.campaign_slug,
        reference_slug: data.reference_slug,
        short_code: data.short_code,
        campaign_name: data.roadtour_campaigns?.name || 'RoadTour',
        account_manager_user_id: data.users?.id || '',
        account_manager_name: data.users?.full_name || '',
        account_manager_email: data.users?.email || '',
        account_manager_phone: data.users?.phone || '',
        org_id: data.roadtour_campaigns?.org_id || '',
        default_points: data.roadtour_campaigns?.default_points || 0,
        product_category: productCategory || null,
    } as ResolvedRoadtourQrRecord
}

export async function validateRoadtourToken(token: string) {
    try {
        const supabase = createAdminClient()
        const { data, error } = await (supabase as any).rpc('validate_roadtour_qr_token', { p_token: token })
        if (error || !data || data.valid === false) {
            return { valid: false, error: data?.message || error?.message || 'Invalid QR code.' }
        }
        return { valid: true, data }
    } catch (err: any) {
        return { valid: false, error: err.message || 'Failed to validate QR code.' }
    }
}

export async function resolveRoadTourByFriendlyPath(params: {
    year: string
    campaignSlug: string
    referenceSlugWithCode: string
}) {
    const shortCode = extractRoadTourShortCode(params.referenceSlugWithCode)
    if (!shortCode) return null

    const supabase = createAdminClient()
    const qr = await fetchRoadtourQr(supabase, (query) => query.eq('short_code', shortCode))

    if (!qr) return null

    const canonicalPath = qr.canonical_path

    const currentPath = `/${['roadtour', params.year, params.campaignSlug, params.referenceSlugWithCode].join('/')}`

    return {
        qr,
        canonicalPath,
        isCanonical: canonicalPath === currentPath,
    }
}

export async function resolveRoadtourByToken(token: string) {
    const supabase = createAdminClient()
    return fetchRoadtourQr(supabase, (query) => query.eq('token', token))
}

export function buildRoadtourContextFromValidation(token: string, data: any) {
    return {
        token,
        campaign_name: data.campaign_name || 'RoadTour',
        account_manager_name: data.account_manager_name || '',
        default_points: data.default_points || 0,
        org_id: data.org_id || '',
        qr_code_id: data.qr_code_id || null,
        campaign_id: data.campaign_id || null,
        account_manager_user_id: data.account_manager_user_id || null,
        reward_mode: data.reward_mode || null,
        survey_template_id: data.survey_template_id || null,
        require_geolocation: data.require_geolocation === true,
    }
}
