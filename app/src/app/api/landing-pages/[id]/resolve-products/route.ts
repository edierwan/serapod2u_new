import { NextResponse } from 'next/server'

import { requireLandingPageAdmin } from '@/lib/landing-pages/admin'
import { resolveLandingPagePreview } from '@/lib/landing-pages/resolver'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { organizationId } = await requireLandingPageAdmin()
    const data = await resolveLandingPagePreview(id, organizationId)
    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: error.status || 500 })
  }
}