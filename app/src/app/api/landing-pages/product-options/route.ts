import { NextResponse } from 'next/server'

import { requireLandingPageAdmin } from '@/lib/landing-pages/admin'
import { listLandingPageProductOptions } from '@/lib/landing-pages/admin-data'

export async function GET() {
    try {
        const { adminClient } = await requireLandingPageAdmin()
        const data = await listLandingPageProductOptions(adminClient)
        return NextResponse.json({ success: true, data })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: error.status || 500 })
    }
}