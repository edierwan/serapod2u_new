import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const extractRoleLevel = (roleRelation: { role_level?: number | null } | Array<{ role_level?: number | null }> | null | undefined) => {
    if (Array.isArray(roleRelation)) {
        const nestedRoleLevel = roleRelation[0]?.role_level
        return typeof nestedRoleLevel === 'number' ? nestedRoleLevel : null
    }

    return typeof roleRelation?.role_level === 'number' ? roleRelation.role_level : null
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