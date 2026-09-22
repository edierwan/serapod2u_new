import { NextRequest, NextResponse } from 'next/server'
import { getRegistrationPendingShopDisplayName } from '@/lib/engagement/registration-link-selection'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeShopRequestForm, validateShopRequestForm } from '@/lib/shop-requests/core'
import { assessShopIdentity, decideShopCreation } from '@/lib/shop-requests/shop-identity-guard'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    try {
        const rawBody = await request.json()
        const form = sanitizeShopRequestForm(rawBody)
        const validation = validateShopRequestForm(form)

        if (!validation.valid) {
            return NextResponse.json({ success: false, error: validation.errors[0] }, { status: 400 })
        }

        const adminClient = createAdminClient()
        // Advisory only — the shop is actually created later by registration, which
        // re-runs the same shared guard immediately before insert.
        const decision = decideShopCreation(await assessShopIdentity(adminClient, form), {
            confirmDifferentOutlet: rawBody.confirmDifferentOutlet === true,
            confirmSimilarName: rawBody.confirmCreate === true,
        })
        if (!decision.allowed) {
            return NextResponse.json(decision.body, { status: decision.status })
        }

        return NextResponse.json({
            success: true,
            shopRequest: form,
            displayName: getRegistrationPendingShopDisplayName(form),
        })
    } catch (error) {
        console.error('Shop registration prepare error:', error)
        return NextResponse.json({ success: false, error: 'Unable to prepare the new shop right now.' }, { status: 500 })
    }
}
