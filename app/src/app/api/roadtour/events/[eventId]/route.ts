import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isRoadtourCategorySelectable, type RoadtourProductCategory } from '@/lib/roadtour/experience-registry'
import { isMissingRoadtourProductCategorySchema } from '@/lib/roadtour/events'

const extractRoleLevel = (roleRelation: { role_level?: number | null } | Array<{ role_level?: number | null }> | null | undefined) => {
    if (Array.isArray(roleRelation)) {
        const nestedRoleLevel = roleRelation[0]?.role_level
        return typeof nestedRoleLevel === 'number' ? nestedRoleLevel : null
    }

    return typeof roleRelation?.role_level === 'number' ? roleRelation.role_level : null
}

const ALLOWED_DUPLICATE_POLICIES = new Set([
    'one_participant_once_per_event',
    'one_participant_once_per_campaign',
    'per_run',
    'per_campaign',
    'per_day',
    'none',
])

const ALLOWED_STATUSES = new Set(['draft', 'active', 'completed', 'cancelled'])
const ALLOWED_POINT_RELEASE_RULES = new Set(['immediate_after_roadtour_claim', 'product_qr_scan_target_once'])
const ALLOWED_PRODUCT_QR_COUNTING_PERIODS = new Set(['rolling_1_month', 'rolling_2_months', 'open_period'])

async function resolveAuthorizedEventAccess(eventId: string) {
    const supabase = await createClient()
    const {
        data: { user: authUser },
        error: authError,
    } = await supabase.auth.getUser()

    if (authError || !authUser) {
        return {
            response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
        }
    }

    const adminClient = createAdminClient() as any

    const { data: profile, error: profileError } = await adminClient
        .from('users')
        .select('id, organization_id, roles(role_level)')
        .eq('id', authUser.id)
        .single()

    if (profileError || !profile) {
        return {
            response: NextResponse.json({ success: false, error: 'User profile not found.' }, { status: 404 }),
        }
    }

    const roleLevel = extractRoleLevel(profile.roles)
    if (typeof roleLevel !== 'number' || roleLevel > 20) {
        return {
            response: NextResponse.json({ success: false, error: 'Insufficient permissions. HQ Admin required.' }, { status: 403 }),
        }
    }

    const { data: eventRow, error: eventError } = await adminClient
        .from('roadtour_runs')
        .select('id, org_id, name')
        .eq('id', eventId)
        .maybeSingle()

    if (eventError) {
        return {
            response: NextResponse.json({ success: false, error: eventError.message || 'Failed to load RoadTour Event.' }, { status: 500 }),
        }
    }

    if (!eventRow) {
        return {
            response: NextResponse.json({ success: false, error: 'RoadTour Event not found.' }, { status: 404 }),
        }
    }

    if (roleLevel !== 1 && eventRow.org_id !== profile.organization_id) {
        return {
            response: NextResponse.json({ success: false, error: 'Access denied for this RoadTour Event.' }, { status: 403 }),
        }
    }

    return { adminClient, profile, eventRow }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ eventId: string }> },
) {
    try {
        const { eventId } = await params
        if (!eventId?.trim()) {
            return NextResponse.json(
                { success: false, error: 'RoadTour Event id is required.' },
                { status: 400 },
            )
        }

        const body = await request.json()
        const name = String(body?.name || '').trim()
        const description = String(body?.description || '').trim()
        const startDate = String(body?.start_date || '').trim()
        const endDate = String(body?.end_date || '').trim()
        const status = String(body?.status || '').trim()
        const duplicatePolicy = String(body?.duplicate_policy || '').trim()
        const pointReleaseRule = String(body?.point_release_rule || 'immediate_after_roadtour_claim').trim()
        const hasProductCategory = Object.prototype.hasOwnProperty.call(body || {}, 'product_category_id')
        const productCategoryId = hasProductCategory ? String(body?.product_category_id || '').trim() : null

        if (!name) {
            return NextResponse.json({ success: false, error: 'Event name is required.' }, { status: 400 })
        }

        if (!startDate || !endDate) {
            return NextResponse.json({ success: false, error: 'Start and end dates are required.' }, { status: 400 })
        }

        if (endDate < startDate) {
            return NextResponse.json({ success: false, error: 'End date must be on or after start date.' }, { status: 400 })
        }

        if (!ALLOWED_STATUSES.has(status)) {
            return NextResponse.json({ success: false, error: 'Invalid RoadTour Event status.' }, { status: 400 })
        }

        if (!ALLOWED_DUPLICATE_POLICIES.has(duplicatePolicy)) {
            return NextResponse.json({ success: false, error: 'Invalid duplicate protection policy.' }, { status: 400 })
        }

        if (!ALLOWED_POINT_RELEASE_RULES.has(pointReleaseRule)) {
            return NextResponse.json({ success: false, error: 'Invalid point release rule.' }, { status: 400 })
        }

        let requiredProductQrScans: number | null = null
        let productQrCountingPeriod: string | null = null

        if (pointReleaseRule === 'product_qr_scan_target_once') {
            const scanCount = Number(body?.required_product_qr_scans)
            const countingPeriod = String(body?.product_qr_counting_period || '').trim()

            if (!Number.isInteger(scanCount) || scanCount < 1) {
                return NextResponse.json({ success: false, error: 'Required Product QR scans must be at least 1.' }, { status: 400 })
            }

            if (!ALLOWED_PRODUCT_QR_COUNTING_PERIODS.has(countingPeriod)) {
                return NextResponse.json({ success: false, error: 'Product QR counting period is required.' }, { status: 400 })
            }

            requiredProductQrScans = scanCount
            productQrCountingPeriod = countingPeriod
        }

        const access = await resolveAuthorizedEventAccess(eventId)
        if ('response' in access) return access.response

        if (hasProductCategory) {
            if (!productCategoryId) {
                return NextResponse.json({ success: false, error: 'Product category is required.' }, { status: 400 })
            }
            const { data: category, error: categoryError } = await access.adminClient
                .from('product_categories')
                .select('id, category_code, category_name, image_url, is_active, is_vape')
                .eq('id', productCategoryId)
                .maybeSingle()
            if (categoryError) return NextResponse.json({ success: false, error: 'Failed to validate product category.' }, { status: 500 })
            if (!category || !isRoadtourCategorySelectable(category as RoadtourProductCategory)) {
                return NextResponse.json({ success: false, error: 'This product category is not available for RoadTour yet.' }, { status: 400 })
            }
        }

        const baseUpdate = {
            name,
            description: description || null,
            start_date: startDate,
            end_date: endDate,
            status,
            duplicate_policy: duplicatePolicy,
            point_release_rule: pointReleaseRule,
            required_product_qr_scans: requiredProductQrScans,
            product_qr_counting_period: productQrCountingPeriod,
            unique_product_qr_only: true,
            updated_by: access.profile.id,
            updated_at: new Date().toISOString(),
        }

        const runUpdate = (payload: Record<string, unknown>) =>
            access.adminClient
                .from('roadtour_runs')
                .update(payload)
                .eq('id', eventId)
                .eq('org_id', access.eventRow.org_id)
                .select('*')
                .maybeSingle()

        let { data: updatedEvent, error: updateError } = await runUpdate({
            ...baseUpdate,
            ...(hasProductCategory ? { product_category_id: productCategoryId } : {}),
        })

        // Backward-compatible fallback when the additive column is not migrated.
        if (updateError && hasProductCategory && isMissingRoadtourProductCategorySchema(updateError)) {
            const legacy = await runUpdate(baseUpdate)
            updatedEvent = legacy.data ? { ...legacy.data, product_category_id: null } : legacy.data
            updateError = legacy.error
        }

        if (updateError) {
            return NextResponse.json(
                { success: false, error: updateError.message || 'Failed to update RoadTour Event.' },
                { status: 500 },
            )
        }

        if (!updatedEvent) {
            return NextResponse.json({ success: false, error: 'RoadTour Event not found.' }, { status: 404 })
        }

        return NextResponse.json({ success: true, data: updatedEvent })
    } catch (error: any) {
        console.error('RoadTour Event update API error:', error)
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 },
        )
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ eventId: string }> },
) {
    try {
        const { eventId } = await params
        if (!eventId?.trim()) {
            return NextResponse.json(
                { success: false, error: 'RoadTour Event id is required.' },
                { status: 400 },
            )
        }

        const supabase = await createClient()
        const {
            data: { user: authUser },
            error: authError,
        } = await supabase.auth.getUser()

        if (authError || !authUser) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized' },
                { status: 401 },
            )
        }

        const adminClient = createAdminClient() as any

        const { data: profile, error: profileError } = await adminClient
            .from('users')
            .select('id, organization_id, roles(role_level)')
            .eq('id', authUser.id)
            .single()

        if (profileError || !profile) {
            return NextResponse.json(
                { success: false, error: 'User profile not found.' },
                { status: 404 },
            )
        }

        const roleLevel = extractRoleLevel(profile.roles)
        if (typeof roleLevel !== 'number' || roleLevel > 20) {
            return NextResponse.json(
                { success: false, error: 'Insufficient permissions. HQ Admin required.' },
                { status: 403 },
            )
        }

        const { data: eventRow, error: eventError } = await adminClient
            .from('roadtour_runs')
            .select('id, org_id, name')
            .eq('id', eventId)
            .maybeSingle()

        if (eventError) {
            return NextResponse.json(
                { success: false, error: eventError.message || 'Failed to load RoadTour Event.' },
                { status: 500 },
            )
        }

        if (!eventRow) {
            return NextResponse.json(
                { success: false, error: 'RoadTour Event not found.' },
                { status: 404 },
            )
        }

        if (roleLevel !== 1 && eventRow.org_id !== profile.organization_id) {
            return NextResponse.json(
                { success: false, error: 'Access denied for this RoadTour Event.' },
                { status: 403 },
            )
        }

        const { count: campaignCount, error: campaignCountError } = await adminClient
            .from('roadtour_campaigns')
            .select('id', { count: 'exact', head: true })
            .eq('roadtour_run_id', eventId)

        if (campaignCountError) {
            return NextResponse.json(
                { success: false, error: campaignCountError.message || 'Failed to check RoadTour Event campaigns.' },
                { status: 500 },
            )
        }

        if ((campaignCount || 0) > 0) {
            return NextResponse.json(
                { success: false, error: 'Cannot delete RoadTour Event with existing campaigns.' },
                { status: 409 },
            )
        }

        const { data: deletedEvent, error: deleteError } = await adminClient
            .from('roadtour_runs')
            .delete()
            .eq('id', eventId)
            .eq('org_id', eventRow.org_id)
            .select('id, name')
            .maybeSingle()

        if (deleteError) {
            return NextResponse.json(
                { success: false, error: deleteError.message || 'Failed to delete RoadTour Event.' },
                { status: 500 },
            )
        }

        if (!deletedEvent) {
            return NextResponse.json(
                { success: false, error: 'RoadTour Event not found.' },
                { status: 404 },
            )
        }

        return NextResponse.json({
            success: true,
            data: deletedEvent,
            message: `RoadTour Event "${deletedEvent.name}" deleted successfully.`,
        })
    } catch (error: any) {
        console.error('RoadTour Event delete API error:', error)
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 },
        )
    }
}
