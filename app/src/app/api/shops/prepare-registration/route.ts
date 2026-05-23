import { NextRequest, NextResponse } from 'next/server'
import { getRegistrationPendingShopDisplayName } from '@/lib/engagement/registration-link-selection'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeShopRequestForm, validateShopRequestForm } from '@/lib/shop-requests/core'
import { findSimilarShopSuggestions } from '@/lib/shop-requests/create-shop'

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
        const duplicates = await findSimilarShopSuggestions(adminClient, form.shopName)
        if (duplicates.length > 0 && !rawBody.confirmCreate) {
            return NextResponse.json({
                success: false,
                duplicateWarning: true,
                duplicates,
                error: 'Similar shops already exist. Please confirm creation.',
            }, { status: 409 })
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
