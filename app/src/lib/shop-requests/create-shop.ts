import {
    buildApprovedShopOrganization,
    sanitizeShopRequestForm,
    type ShopRequestFormInput,
} from './core'

export interface DuplicateShopSuggestion {
    org_id: string
    org_name: string
    branch: string | null
    state_name: string | null
}

/**
 * Resolve default parent distributor for a new shop.
 * Priority: fixed codes DH04/DT004 -> user's org chain -> any active DIST.
 */
export async function resolveParentDistributor(adminClient: any, userOrgId?: string | null): Promise<string | null> {
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

export async function resolveStateId(adminClient: any, stateName?: string | null): Promise<string | null> {
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

export async function findSimilarShopSuggestions(
    adminClient: any,
    shopName?: string | null,
): Promise<DuplicateShopSuggestion[]> {
    const normalizedShopName = String(shopName || '').trim()
    if (!normalizedShopName) return []

    const { data: duplicates } = await adminClient
        .from('organizations')
        .select('id, org_name, branch, states(state_name)')
        .eq('org_type_code', 'SHOP')
        .eq('is_active', true)
        .ilike('org_name', `${normalizedShopName}%`)
        .limit(5)

    return (duplicates || []).map((row: any) => ({
        org_id: row.id,
        org_name: row.org_name,
        branch: row.branch || null,
        state_name: row.states?.state_name || null,
    }))
}

export async function createShopOrganization(
    adminClient: any,
    input: {
        form: ShopRequestFormInput
        createdBy: string
        userOrgId?: string | null
    },
) {
    const form = sanitizeShopRequestForm(input.form)
    const parentOrgId = await resolveParentDistributor(adminClient, input.userOrgId)

    if (!parentOrgId) {
        throw new Error('Could not resolve parent distributor. Please contact support.')
    }

    const stateId = await resolveStateId(adminClient, form.state)
    const organizationInsert = buildApprovedShopOrganization({
        request: {
            id: 'pending-registration-shop',
            ...form,
        },
        parentOrgId,
        stateId,
        createdBy: input.createdBy,
    })

    const { data: createdOrganization, error: createError } = await adminClient
        .from('organizations')
        .insert(organizationInsert)
        .select('id, org_name, branch')
        .single()

    if (createError || !createdOrganization) {
        throw new Error(createError?.message || 'Failed to create shop.')
    }

    return {
        organization: {
            id: createdOrganization.id,
            org_name: createdOrganization.org_name,
            branch: createdOrganization.branch ?? form.branch ?? null,
        },
        parentOrgId,
    }
}
