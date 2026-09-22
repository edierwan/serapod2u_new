import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
    sanitizeShopRequestForm,
    validateShopRequestForm,
} from '@/lib/shop-requests/core'
import { createShopOrganization } from '@/lib/shop-requests/create-shop'
import { isShopIdentityConflictError } from '@/lib/shop-requests/shop-identity-guard'
import { queueNotificationEvent } from '@/lib/notifications/supplyChainEventQueue'
import { upsertUserProgramMembership } from '@/lib/server/loyalty-memberships'
import { getShopOrgReassignmentBlockReason } from '@/lib/auth/employment-org-guard'

export const dynamic = 'force-dynamic'

/**
 * POST /api/shops/create
 * Directly create a new shop organization and optionally link the user.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const adminClient = createAdminClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { data: userRow } = await adminClient
            .from('users')
            .select(`
                id,
                organization_id,
                full_name,
                phone,
                email,
                role_code,
                account_scope,
                roles(role_level),
                organizations!fk_users_organization(id, org_name, branch, org_type_code)
            `)
            .eq('id', user.id)
            .single()

        if (!userRow) {
            return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 })
        }

        const rawBody = await request.json()
        const form = sanitizeShopRequestForm(rawBody)
        const validation = validateShopRequestForm(form)

        if (!validation.valid) {
            return NextResponse.json({ success: false, error: validation.errors[0] }, { status: 400 })
        }

        // --- Linking intent (checked BEFORE creating anything) ---
        // A user already linked to a SHOP must never be moved silently onto the new
        // shop. Only an explicit confirmSwitchLinkedShop=true may re-point
        // users.organization_id; otherwise nothing is created and the UI must ask.
        const shouldLinkUser = rawBody.linkUser === true
        const currentOrg = (userRow.organizations as any) || null
        if (
            shouldLinkUser &&
            currentOrg?.org_type_code === 'SHOP' &&
            userRow.organization_id &&
            rawBody.confirmSwitchLinkedShop !== true
        ) {
            return NextResponse.json({
                success: false,
                code: 'SHOP_LINK_SWITCH_CONFIRMATION_REQUIRED',
                requiresLinkSwitchConfirmation: true,
                currentShop: {
                    org_id: userRow.organization_id,
                    org_name: currentOrg.org_name || null,
                    branch: currentOrg.branch || null,
                },
                error: 'Your profile is already linked to a shop. Creating another outlet will not change your linked shop unless you explicitly confirm the switch.',
            }, { status: 409 })
        }

        let createdOrganization: { id: string; org_name: string; branch?: string | null }
        let parentOrgId: string
        try {
            // Shared identity guard runs inside createShopOrganization (same rules as QR path).
            const result = await createShopOrganization(adminClient, {
                form,
                createdBy: user.id,
                userOrgId: userRow.organization_id,
                identityConfirmations: {
                    confirmDifferentOutlet: rawBody.confirmDifferentOutlet === true,
                    confirmSimilarName: rawBody.confirmCreate === true,
                },
            })
            createdOrganization = result.organization
            parentOrgId = result.parentOrgId
        } catch (createError: any) {
            if (isShopIdentityConflictError(createError)) {
                return NextResponse.json(createError.decision.body, { status: createError.decision.status })
            }
            console.error('Shop create error:', createError)
            return NextResponse.json({
                success: false,
                error: createError?.message || 'Failed to create shop.',
            }, { status: 500 })
        }

        try {
            const payload = {
                shop_name: createdOrganization.org_name,
                shop_branch: createdOrganization.branch || '-',
                shop_state: form.state || '-',
                contact_name: form.contactName || '-',
                contact_phone: form.contactPhone || '-',
                contact_email: form.contactEmail || '-',
                creator_name: userRow.full_name || user.email || 'User',
                creator_email: user.email || userRow.email || '-',
                creator_phone: userRow.phone || '-',
                created_at: new Date().toLocaleString('en-GB'),
            }

            await queueNotificationEvent(adminClient, {
                orgId: parentOrgId,
                eventCode: 'user_created_shop',
                payload,
                dedupePayload: { shop_name: createdOrganization.org_name },
            })

            fetch(`${request.nextUrl.origin}/api/cron/notification-outbox-worker`).catch(() => { })
        } catch (notificationError) {
            console.warn('Failed to queue shop created notification (non-blocking):', notificationError)
        }

        // --- Link user to the new shop ---
        // Default is NO link. Explicit linkUser=true only, and never for portal employment accounts.
        // (Previous default linkUser!==false could move HQ Admin onto a SHOP and hide admin menus.)
        // Switching from an existing SHOP additionally required confirmSwitchLinkedShop above.
        if (shouldLinkUser) {
            const linkBlockReason = getShopOrgReassignmentBlockReason({
                currentOrgTypeCode: currentOrg?.org_type_code || null,
                currentRoleCode: userRow.role_code,
                currentRoleLevel: (userRow.roles as any)?.role_level ?? null,
                currentAccountScope: userRow.account_scope,
                nextOrgTypeCode: 'SHOP',
            })

            if (linkBlockReason) {
                return NextResponse.json({
                    success: true,
                    organization: createdOrganization,
                    linkError: linkBlockReason,
                })
            }

            const { error: linkError } = await adminClient
                .from('users')
                .update({
                    organization_id: createdOrganization.id,
                    shop_name: createdOrganization.org_name,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', user.id)

            if (linkError) {
                console.error('User link error:', linkError)
                // Shop was created but linking failed — still return success with warning
                return NextResponse.json({
                    success: true,
                    organization: createdOrganization,
                    linkError: 'Shop created but failed to link to your profile. Please update your shop in Profile.',
                })
            }

            try {
                await upsertUserProgramMembership(adminClient as any, 'cellera', user.id, 'organization_user', 'legacy_registration', {
                    memberOrganizationId: createdOrganization.id,
                    createdBy: user.id,
                })
            } catch (membershipError: any) {
                console.error('Cellera user membership upsert failed:', membershipError?.message || membershipError)
                return NextResponse.json({
                    success: true,
                    organization: createdOrganization,
                    membershipError: 'Shop created but failed to enroll your profile in Cellera Loyalty.',
                })
            }
        }

        return NextResponse.json({
            success: true,
            organization: createdOrganization,
        })
    } catch (err: any) {
        console.error('Shop create error:', err)
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
}
