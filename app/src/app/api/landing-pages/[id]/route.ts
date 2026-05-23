import { NextRequest, NextResponse } from 'next/server'

import { requireLandingPageAdmin } from '@/lib/landing-pages/admin'
import {
    ensureUniqueLandingPageSlug,
    fetchLandingPageDetail,
    normalizeLandingPagePayload,
    replaceLandingPageProducts,
    validateLandingPageDraft,
} from '@/lib/landing-pages/admin-data'

function errorResponse(error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: error.status || 500 })
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { adminClient, organizationId } = await requireLandingPageAdmin()
        const detail = await fetchLandingPageDetail(adminClient, id, organizationId)
        if (!detail) return NextResponse.json({ success: false, error: 'Landing page not found.' }, { status: 404 })
        return NextResponse.json({ success: true, data: detail })
    } catch (error: any) {
        return errorResponse(error)
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { adminClient, organizationId, user } = await requireLandingPageAdmin()
        const existing = await fetchLandingPageDetail(adminClient, id, organizationId)
        if (!existing) return NextResponse.json({ success: false, error: 'Landing page not found.' }, { status: 404 })

        const payload = normalizeLandingPagePayload(await request.json(), existing)
        const errors = validateLandingPageDraft(payload)
        if (errors.length > 0) return NextResponse.json({ success: false, error: errors[0], errors }, { status: 400 })
        await ensureUniqueLandingPageSlug(adminClient, payload.slug, id)

        const { error } = await adminClient
            .from('landing_pages')
            .update({
                internal_name: payload.internal_name,
                public_title: payload.public_title,
                slug: payload.slug,
                description: payload.description || null,
                source_mode: payload.source_mode,
                category_id: payload.category_id,
                max_products: payload.max_products,
                hero: payload.hero,
                display_settings: payload.display_settings,
                tracking_defaults: payload.tracking_defaults,
                publish_start_at: payload.publish_start_at,
                publish_end_at: payload.publish_end_at,
                updated_by: user.id,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('organization_id', organizationId)

        if (error) throw error
        await replaceLandingPageProducts(adminClient, id, payload.source_mode === 'manual' ? payload.selected_product_ids : [])
        const detail = await fetchLandingPageDetail(adminClient, id, organizationId)
        return NextResponse.json({ success: true, data: detail })
    } catch (error: any) {
        return errorResponse(error)
    }
}