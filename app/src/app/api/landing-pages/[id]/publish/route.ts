import { NextResponse } from 'next/server'

import { requireLandingPageAdmin } from '@/lib/landing-pages/admin'
import { fetchLandingPageDetail, normalizeLandingPagePayload, validateLandingPagePublish } from '@/lib/landing-pages/admin-data'
import { countResolvableLandingPageProducts } from '@/lib/landing-pages/resolver'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { adminClient, organizationId, user } = await requireLandingPageAdmin()
        const existing = await fetchLandingPageDetail(adminClient, id, organizationId)
        if (!existing) return NextResponse.json({ success: false, error: 'Landing page not found.' }, { status: 404 })
        if (existing.status === 'archived') return NextResponse.json({ success: false, error: 'Archived landing pages cannot be published.' }, { status: 400 })

        const validProductCount = await countResolvableLandingPageProducts(id, organizationId)
        const payload = normalizeLandingPagePayload(existing, existing)
        const errors = validateLandingPagePublish(payload, validProductCount)
        if (errors.length > 0) return NextResponse.json({ success: false, error: errors[0], errors }, { status: 400 })

        const now = new Date().toISOString()
        const { error } = await adminClient
            .from('landing_pages')
            .update({ status: 'published', published_at: existing.published_at || now, updated_at: now, updated_by: user.id })
            .eq('id', id)
            .eq('organization_id', organizationId)

        if (error) throw error
        return NextResponse.json({ success: true, data: await fetchLandingPageDetail(adminClient, id, organizationId) })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: error.status || 500 })
    }
}