import { NextRequest, NextResponse } from 'next/server'

import { isRoadtourCategorySelectable, type RoadtourProductCategory } from '@/lib/roadtour/experience-registry'
import { isMissingRoadtourProductCategorySchema } from '@/lib/roadtour/events'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_DUPLICATE_POLICIES = new Set([
    'one_participant_once_per_event', 'one_participant_once_per_campaign',
    'per_run', 'per_campaign', 'per_day', 'none',
])
const ALLOWED_STATUSES = new Set(['draft', 'active'])
const ALLOWED_POINT_RELEASE_RULES = new Set(['immediate_after_roadtour_claim', 'product_qr_scan_target_once'])
const ALLOWED_PRODUCT_QR_COUNTING_PERIODS = new Set(['rolling_1_month', 'rolling_2_months', 'open_period'])

const roleLevel = (relation: any) => Number(Array.isArray(relation) ? relation[0]?.role_level : relation?.role_level)

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

        const admin = createAdminClient() as any
        const { data: profile, error: profileError } = await admin
            .from('users')
            .select('id, organization_id, roles(role_level)')
            .eq('id', user.id)
            .single()
        if (profileError || !profile) return NextResponse.json({ success: false, error: 'User profile not found.' }, { status: 404 })
        if (!Number.isFinite(roleLevel(profile.roles)) || roleLevel(profile.roles) > 20) {
            return NextResponse.json({ success: false, error: 'Insufficient permissions. HQ Admin required.' }, { status: 403 })
        }

        const body = await request.json()
        const orgId = String(body?.org_id || '').trim()
        const name = String(body?.name || '').trim()
        const startDate = String(body?.start_date || '').trim()
        const endDate = String(body?.end_date || '').trim()
        const status = String(body?.status || 'active').trim()
        const duplicatePolicy = String(body?.duplicate_policy || 'one_participant_once_per_event').trim()
        const pointReleaseRule = String(body?.point_release_rule || 'immediate_after_roadtour_claim').trim()
        const productCategoryId = String(body?.product_category_id || '').trim()

        if (!orgId || !name || !startDate || !endDate) {
            return NextResponse.json({ success: false, error: 'Organization, event name, start date, and end date are required.' }, { status: 400 })
        }
        if (endDate < startDate) return NextResponse.json({ success: false, error: 'End date must be on or after start date.' }, { status: 400 })
        if (!ALLOWED_STATUSES.has(status) || !ALLOWED_DUPLICATE_POLICIES.has(duplicatePolicy) || !ALLOWED_POINT_RELEASE_RULES.has(pointReleaseRule)) {
            return NextResponse.json({ success: false, error: 'Invalid RoadTour Event configuration.' }, { status: 400 })
        }
        if (roleLevel(profile.roles) !== 1 && orgId !== profile.organization_id) {
            return NextResponse.json({ success: false, error: 'Access denied for this organization.' }, { status: 403 })
        }
        if (!productCategoryId) return NextResponse.json({ success: false, error: 'Product category is required.' }, { status: 400 })

        const { data: category, error: categoryError } = await admin
            .from('product_categories')
            .select('id, category_code, category_name, image_url, is_active, is_vape')
            .eq('id', productCategoryId)
            .maybeSingle()
        if (categoryError) return NextResponse.json({ success: false, error: 'Failed to validate product category.' }, { status: 500 })
        if (!category || !isRoadtourCategorySelectable(category as RoadtourProductCategory)) {
            return NextResponse.json({ success: false, error: 'This product category is not available for RoadTour yet.' }, { status: 400 })
        }

        let requiredProductQrScans: number | null = null
        let productQrCountingPeriod: string | null = null
        if (pointReleaseRule === 'product_qr_scan_target_once') {
            requiredProductQrScans = Number(body?.required_product_qr_scans)
            productQrCountingPeriod = String(body?.product_qr_counting_period || '').trim()
            if (!Number.isInteger(requiredProductQrScans) || requiredProductQrScans < 1 || !ALLOWED_PRODUCT_QR_COUNTING_PERIODS.has(productQrCountingPeriod)) {
                return NextResponse.json({ success: false, error: 'Invalid Product QR reward release configuration.' }, { status: 400 })
            }
        }

        const baseInsert = {
            org_id: orgId,
            name,
            description: String(body?.description || '').trim() || null,
            start_date: startDate,
            end_date: endDate,
            status,
            duplicate_policy: duplicatePolicy,
            point_release_rule: pointReleaseRule,
            required_product_qr_scans: requiredProductQrScans,
            product_qr_counting_period: productQrCountingPeriod,
            unique_product_qr_only: true,
            created_by: profile.id,
            updated_by: profile.id,
        }

        let { data, error } = await admin
            .from('roadtour_runs')
            .insert({ ...baseInsert, product_category_id: productCategoryId })
            .select('*')
            .single()

        // Backward-compatible fallback for environments where the additive
        // product_category_id column has not been migrated yet: the Event is
        // still created and serves the existing Vape/Premium experience.
        if (error && isMissingRoadtourProductCategorySchema(error)) {
            const legacy = await admin.from('roadtour_runs').insert(baseInsert).select('*').single()
            data = legacy.data ? { ...legacy.data, product_category_id: null } : legacy.data
            error = legacy.error
        }

        if (error) return NextResponse.json({ success: false, error: error.message || 'Failed to create RoadTour Event.' }, { status: 500 })
        return NextResponse.json({ success: true, data }, { status: 201 })
    } catch (error: any) {
        console.error('RoadTour Event create API error:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
    }
}
