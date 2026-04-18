import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
    sanitizeShopRequestForm,
    validateShopRequestForm,
    buildShopOrgCode,
} from '@/lib/shop-requests/core'

export const dynamic = 'force-dynamic'

/**
 * Resolve default parent distributor for a new shop.
 * Priority: fixed codes DH04/DT004 → user's org chain → any active DIST.
 */
async function resolveParentDistributor(adminClient: any, userOrgId?: string | null): Promise<string | null> {
    const fixedCodes = ['DH04', 'DT004']

    const { data: fixedDist } = await adminClient
        .from('organizations')
        .select('id')
        .eq('org_type_code', 'DIST')
        .in('org_code', fixedCodes)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

    if (fixedDist?.id) return fixedDist.id

    if (userOrgId) {
        const { data: currentOrg } = await adminClient
            .from('organizations')
            .select('id, parent_org_id, org_type_code')
            .eq('id', userOrgId)
            .maybeSingle()

        if (currentOrg?.org_type_code === 'DIST') return currentOrg.id

        if (currentOrg?.parent_org_id) {
            const { data: parentOrg } = await adminClient
                .from('organizations')
                .select('id, org_type_code')
                .eq('id', currentOrg.parent_org_id)
                .maybeSingle()

            if (parentOrg?.org_type_code === 'DIST') return parentOrg.id
        }
    }

    const { data: fallback } = await adminClient
        .from('organizations')
        .select('id')
        .eq('org_type_code', 'DIST')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

    return fallback?.id || null
}

async function resolveStateId(adminClient: any, stateName?: string | null): Promise<string | null> {
    const normalized = String(stateName || '').trim()
    if (!normalized) return null

    const { data } = await adminClient
        .from('states')
        .select('id')
        .ilike('state_name', normalized)
        .limit(1)
        .maybeSingle()

    return data?.id || null
}

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
            .select('id, organization_id')
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

        // --- Duplicate check ---
        const dupTerm = (form.shopName || '').trim()
        if (dupTerm) {
            const { data: dupes } = await adminClient
                .from('organizations')
                .select('id, org_name, branch, states(state_name)')
                .eq('org_type_code', 'SHOP')
                .eq('is_active', true)
                .ilike('org_name', `${dupTerm}%`)
                .limit(5)

            if (dupes && dupes.length > 0) {
                const duplicates = dupes.map((d: any) => ({
                    org_id: d.id,
                    org_name: d.org_name,
                    branch: d.branch,
                    state_name: d.states?.state_name || null,
                }))

                // If caller explicitly confirms, skip duplicate block
                if (!rawBody.confirmCreate) {
                    return NextResponse.json({
                        success: false,
                        duplicateWarning: true,
                        duplicates,
                        error: 'Similar shops already exist. Please confirm creation.',
                    }, { status: 409 })
                }
            }
        }

        // --- Resolve parent distributor ---
        const parentOrgId = await resolveParentDistributor(adminClient, userRow.organization_id)
        if (!parentOrgId) {
            return NextResponse.json({
                success: false,
                error: 'Could not resolve parent distributor. Please contact support.',
            }, { status: 500 })
        }

        // --- Resolve state_id ---
        const stateId = await resolveStateId(adminClient, form.state)

        // --- Build organization record ---
        const orgInsert = {
            org_code: buildShopOrgCode(),
            org_name: form.shopName,
            org_type_code: 'SHOP',
            parent_org_id: parentOrgId,
            branch: form.branch || null,
            contact_name: form.contactName || null,
            contact_phone: form.contactPhone || null,
            contact_email: form.contactEmail || null,
            address: form.address || null,
            state_id: stateId,
            hot_flavour_brands: form.hotFlavourBrands || null,
            sells_serapod_flavour: form.sellsSerapodFlavour ?? false,
            sells_sbox: form.sellsSbox ?? false,
            sells_sbox_special_edition: form.sellsSboxSpecialEdition ?? false,
            is_active: true,
            created_by: user.id,
            updated_by: user.id,
        }

        const { data: createdOrg, error: createError } = await adminClient
            .from('organizations')
            .insert(orgInsert)
            .select('id, org_name, branch')
            .single()

        if (createError || !createdOrg) {
            console.error('Shop create error:', createError)
            return NextResponse.json({
                success: false,
                error: createError?.message || 'Failed to create shop.',
            }, { status: 500 })
        }

        // --- Link user to the new shop ---
        if (rawBody.linkUser !== false) {
            const { error: linkError } = await adminClient
                .from('users')
                .update({
                    organization_id: createdOrg.id,
                    shop_name: createdOrg.org_name,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', user.id)

            if (linkError) {
                console.error('User link error:', linkError)
                // Shop was created but linking failed — still return success with warning
                return NextResponse.json({
                    success: true,
                    organization: createdOrg,
                    linkError: 'Shop created but failed to link to your profile. Please update your shop in Profile.',
                })
            }
        }

        return NextResponse.json({
            success: true,
            organization: createdOrg,
        })
    } catch (err: any) {
        console.error('Shop create error:', err)
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
}
