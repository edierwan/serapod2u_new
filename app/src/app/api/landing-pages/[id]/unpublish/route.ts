import { NextResponse } from 'next/server'

import { requireLandingPageAdmin } from '@/lib/landing-pages/admin'
import { fetchLandingPageDetail } from '@/lib/landing-pages/admin-data'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { adminClient, organizationId, user } = await requireLandingPageAdmin()
        const existing = await fetchLandingPageDetail(adminClient, id, organizationId)
        if (!existing) return NextResponse.json({ success: false, error: 'Landing page not found.' }, { status: 404 })

        const { error } = await adminClient
            .from('landing_pages')
            .update({ status: 'draft', updated_at: new Date().toISOString(), updated_by: user.id })
            .eq('id', id)
            .eq('organization_id', organizationId)

        if (error) throw error
        return NextResponse.json({ success: true, data: await fetchLandingPageDetail(adminClient, id, organizationId) })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: error.status || 500 })
    }
}