import { NextRequest, NextResponse } from 'next/server'

import { createShopOrganization } from '@/lib/shop-requests/create-shop'
import { isShopIdentityConflictError } from '@/lib/shop-requests/shop-identity-guard'
import { sanitizeShopRequestForm, validateShopRequestForm } from '@/lib/shop-requests/core'
import { createAdminClient } from '@/lib/supabase/admin'
import { logNotificationEvent } from '@/server/auth/registrationVerificationService'
import {
    claimVerifiedShopContactCode,
    findVerifiedShopContactCode,
    readShopContactIdentityConfirmations,
    releaseShopContactCodeClaim,
} from '@/server/auth/shopContactVerificationService'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const verificationToken = String(body?.verificationToken || '').trim()

        if (!verificationToken) {
            return NextResponse.json({ success: false, error: 'Verification token is required.' }, { status: 400 })
        }

        const admin = createAdminClient()
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null

        const verificationCode = await findVerifiedShopContactCode(admin, verificationToken)
        if (!verificationCode) {
            return NextResponse.json({ success: false, error: 'This verification session has expired. Please request a new code.' }, { status: 400 })
        }

        const form = sanitizeShopRequestForm(verificationCode.meta?.shop_request || {})
        const validation = validateShopRequestForm(form)
        if (!validation.valid) {
            return NextResponse.json({ success: false, error: validation.errors[0] || 'Invalid shop details.' }, { status: 400 })
        }

        // Claim the code before creating so a double-submitted token cannot create two shops.
        const claimedAt = await claimVerifiedShopContactCode(admin, verificationCode)
        if (!claimedAt) {
            return NextResponse.json({
                success: false,
                code: 'SHOP_VERIFICATION_ALREADY_USED',
                error: 'This verification code has already been used. Please select your shop from the list or request a new code.',
            }, { status: 409 })
        }

        try {
            const { organization } = await createShopOrganization(admin, {
                form,
                createdBy: null,
                userOrgId: verificationCode.meta?.org_id || null,
                // Shared identity guard (same rules as /api/shops/create) runs inside.
                identityConfirmations: readShopContactIdentityConfirmations(verificationCode.meta),
            })

            await logNotificationEvent(admin, {
                eventType: 'shop_contact_shop_created',
                phone: verificationCode.phone_normalized,
                status: 'completed',
                meta: {
                    codeId: verificationCode.id,
                    organization_id: organization.id,
                    organization_name: organization.org_name,
                },
                ip,
            })

            return NextResponse.json({
                success: true,
                organization,
                shopRequest: form,
            })
        } catch (createError: any) {
            // Nothing was created: release our claim so a blocked attempt does not burn the
            // verification session (the user can still pick the existing shop / retry).
            await releaseShopContactCodeClaim(admin, verificationCode.id, claimedAt)

            if (isShopIdentityConflictError(createError)) {
                await logNotificationEvent(admin, {
                    eventType: 'shop_contact_create_blocked_duplicate',
                    phone: verificationCode.phone_normalized,
                    status: 'failed',
                    meta: {
                        codeId: verificationCode.id,
                        code: createError.decision.body.code,
                        duplicate_ids: createError.decision.body.duplicates.map((row) => row.org_id),
                    },
                    ip,
                })

                return NextResponse.json(createError.decision.body, { status: createError.decision.status })
            }

            await logNotificationEvent(admin, {
                eventType: 'shop_contact_create_failed',
                phone: verificationCode.phone_normalized,
                status: 'failed',
                errorMessage: createError?.message || 'Failed to create shop',
                meta: {
                    codeId: verificationCode.id,
                    shop_name: form.shopName,
                },
                ip,
            })

            return NextResponse.json({
                success: false,
                error: createError?.message || 'Failed to create shop.',
            }, { status: 500 })
        }
    } catch (error) {
        console.error('Shop contact create error:', error)
        return NextResponse.json(
            { success: false, error: 'Unable to create the shop right now. Please try again later.' },
            { status: 500 },
        )
    }
}