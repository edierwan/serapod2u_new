import { NextRequest, NextResponse } from 'next/server'

import { requireLandingPageAdmin } from '@/lib/landing-pages/admin'
import {
    ensureUniqueLandingPageSlug,
    fetchLandingPageDetail,
    listLandingPages,
    normalizeLandingPagePayload,
    replaceLandingPageProducts,
    validateLandingPageDraft,
} from '@/lib/landing-pages/admin-data'

function errorResponse(error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: error.status || 500 })
}

export async function GET() {
    try {
        const { adminClient, organizationId } = await requireLandingPageAdmin()
        const data = await listLandingPages(adminClient, organizationId)
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        return errorResponse(error)
    }
}

export async function POST(request: NextRequest) {
    try {
        const { adminClient, organizationId, user } = await requireLandingPageAdmin()
        const payload = normalizeLandingPagePayload(await request.json())
        const errors = validateLandingPageDraft(payload)
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0], errors }, { status: 400 })
        }

        await ensureUniqueLandingPageSlug(adminClient, payload.slug)

        const { data: page, error } = await adminClient
            .from('landing_pages')
            .insert({
                organization_id: organizationId,
                internal_name: payload.internal_name,
                public_title: payload.public_title,
                slug: payload.slug,
                description: payload.description || null,
                status: 'draft',
                source_mode: payload.source_mode,
                category_id: payload.category_id,
                max_products: payload.max_products,
                hero: payload.hero,
                display_settings: payload.display_settings,
                tracking_defaults: payload.tracking_defaults,
                publish_start_at: payload.publish_start_at,
                publish_end_at: payload.publish_end_at,
                created_by: user.id,
                updated_by: user.id,
            })
            .select('id')
            .single()

        if (error || !page) throw error || new Error('Landing page was not created.')
        await replaceLandingPageProducts(adminClient, page.id, payload.source_mode === 'manual' ? payload.selected_product_ids : [])

        const detail = await fetchLandingPageDetail(adminClient, page.id, organizationId)
        return NextResponse.json({ success: true, data: detail }, { status: 201 })
    } catch (error: any) {
        return errorResponse(error)
    }
}