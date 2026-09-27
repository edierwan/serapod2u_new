import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { linkConsumerShop } from '@/lib/consumer/shop-link'

const ACCEPTED_FIELDS = new Set(['organization_id', 'confirmShopSwitch'])

/**
 * POST /api/consumer/link-shop
 * Links the signed-in consumer's profile to an active shop (first link, or a
 * confirmed switch between shops). The actor always comes from the session.
 *
 * Body:
 *   organization_id: string     - the target SHOP organization
 *   confirmShopSwitch?: boolean - required (true) to move from one shop to another
 *
 * Nothing else is accepted: role, account scope and employment fields can
 * never be changed through this operation. See lib/consumer/shop-link.ts.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized - Please log in' }, { status: 401 })
        }

        const body = await request.json().catch(() => null)
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return NextResponse.json({ success: false, code: 'INVALID_REQUEST', error: 'Invalid request.' }, { status: 400 })
        }
        const unexpected = Object.keys(body).filter((key) => !ACCEPTED_FIELDS.has(key))
        if (unexpected.length > 0) {
            return NextResponse.json(
                { success: false, code: 'UNSUPPORTED_FIELD', error: `Shop linking does not accept: ${unexpected.join(', ')}` },
                { status: 400 },
            )
        }
        const organizationId = typeof body.organization_id === 'string' ? body.organization_id.trim() : ''
        if (!organizationId) {
            return NextResponse.json({ success: false, code: 'SHOP_REQUIRED', error: 'Please select a shop.' }, { status: 400 })
        }

        const result = await linkConsumerShop(createAdminClient(), {
            actorId: user.id,
            targetOrganizationId: organizationId,
            confirmShopSwitch: body.confirmShopSwitch === true,
        })

        if (!result.ok) {
            const { ok: _ok, status, shop: _shop, ...payload } = result as any
            return NextResponse.json({
                success: false,
                ...payload,
                ...(payload.code === 'SHOP_SWITCH_CONFIRMATION_REQUIRED' ? { requiresShopSwitchConfirmation: true } : {}),
            }, { status })
        }

        return NextResponse.json({
            success: true,
            changed: !result.unchanged,
            switched: result.switching,
            shop: result.shop ? { org_id: result.shop.id, org_name: result.shop.org_name, branch: result.shop.branch } : null,
        })
    } catch (error) {
        console.error('[consumer/link-shop] failed', error)
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
}
