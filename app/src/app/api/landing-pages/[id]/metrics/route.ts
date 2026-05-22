import { NextResponse } from 'next/server'

import { requireLandingPageAdmin } from '@/lib/landing-pages/admin'
import { fetchLandingPageDetail } from '@/lib/landing-pages/admin-data'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { adminClient, organizationId } = await requireLandingPageAdmin()
    const detail = await fetchLandingPageDetail(adminClient, id, organizationId)
    if (!detail) return NextResponse.json({ success: false, error: 'Landing page not found.' }, { status: 404 })
    return NextResponse.json({ success: true, data: detail.metrics })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: error.status || 500 })
  }
}