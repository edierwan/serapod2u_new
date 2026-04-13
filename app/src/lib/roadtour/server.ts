import { createAdminClient } from '@/lib/supabase/admin'
import { buildRoadTourPath, extractRoadTourShortCode } from '@/lib/roadtour/url'

export interface ResolvedRoadtourQrRecord {
    id: string
    token: string
    canonical_path: string | null
    route_year: number | null
    campaign_slug: string | null
    reference_slug: string | null
    short_code: string | null
    campaign_name: string
    account_manager_name: string
    org_id: string
    default_points: number
}

async function fetchRoadtourQr(query: any) {
    const { data, error } = await query
        .select(`
            id,
            token,
            canonical_path,
            route_year,
            campaign_slug,
            reference_slug,
            short_code,
            roadtour_campaigns!inner(name, org_id, default_points),
            users:account_manager_user_id(full_name)
        `)
        .maybeSingle()

    if (error || !data) return null

    const canonicalPath = data.canonical_path || buildRoadTourPath({
        year: data.route_year,
        campaignSlug: data.campaign_slug,
        referenceSlug: data.reference_slug,
        shortCode: data.short_code,
        routeBase: 'roadtour',
    })

    return {
        id: data.id,
        token: data.token,
        canonical_path: canonicalPath,
        route_year: data.route_year,
        campaign_slug: data.campaign_slug,
        reference_slug: data.reference_slug,
        short_code: data.short_code,
        campaign_name: data.roadtour_campaigns?.name || 'RoadTour',
        account_manager_name: data.users?.full_name || '',
        org_id: data.roadtour_campaigns?.org_id || '',
        default_points: data.roadtour_campaigns?.default_points || 0,
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
    const qr = await fetchRoadtourQr(
        (supabase as any)
            .from('roadtour_qr_codes')
            .eq('short_code', shortCode)
    )

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
    return fetchRoadtourQr(
        (supabase as any)
            .from('roadtour_qr_codes')
            .eq('token', token)
    )
}

export function buildRoadtourContextFromValidation(token: string, data: any) {
    return {
        token,
        campaign_name: data.campaign_name || 'RoadTour',
        account_manager_name: data.account_manager_name || '',
        default_points: data.default_points || 0,
        org_id: data.org_id || '',
    }
}