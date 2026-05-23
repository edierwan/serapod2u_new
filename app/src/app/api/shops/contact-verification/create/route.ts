import { NextRequest, NextResponse } from 'next/server'

import { createShopOrganization, findShopDuplicateConflicts } from '@/lib/shop-requests/create-shop'
import { sanitizeShopRequestForm, validateShopRequestForm } from '@/lib/shop-requests/core'
import { createAdminClient } from '@/lib/supabase/admin'
import { logNotificationEvent, markCodeUsed } from '@/server/auth/registrationVerificationService'
import { findVerifiedShopContactCode } from '@/server/auth/shopContactVerificationService'

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

        const duplicates = await findShopDuplicateConflicts(admin, form)
        if (duplicates.exactMatches.length > 0) {
            await logNotificationEvent(admin, {
                eventType: 'shop_contact_create_blocked_duplicate',
                phone: verificationCode.phone_normalized,
                status: 'failed',
                meta: {
                    codeId: verificationCode.id,
                    duplicate_ids: duplicates.exactMatches.map((row) => row.org_id),
                },
                ip,
            })

            return NextResponse.json({
                success: false,
                duplicateBlocked: true,
                duplicates: duplicates.exactMatches,
                error: 'A shop with this phone number or name already exists. Please select it from the existing shop list.',
            }, { status: 409 })
        }

        try {
            const { organization } = await createShopOrganization(admin, {
                form,
                createdBy: null,
                userOrgId: verificationCode.meta?.org_id || null,
            })

            await markCodeUsed(admin, verificationCode.id)

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