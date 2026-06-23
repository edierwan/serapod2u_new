import {
    buildApprovedShopOrganization,
    sanitizeShopRequestForm,
    type ShopRequestFormInput,
} from './core'
import { samePhone } from '@/utils/phone'
import { upsertOrganizationProgramMembership, type LoyaltyProgramCode } from '@/lib/server/loyalty-memberships'

export interface DuplicateShopSuggestion {
    org_id: string
    org_name: string
    branch: string | null
    state_name: string | null
}

export interface ShopDuplicateCheckResult {
    exactMatches: DuplicateShopSuggestion[]
    fuzzyMatches: DuplicateShopSuggestion[]
    hasExactPhoneMatch: boolean
    hasExactIdentityMatch: boolean
}

function normalizeComparisonValue(value?: string | null) {
    return String(value || '').trim().toLowerCase()
}

function mapDuplicateRow(row: any): DuplicateShopSuggestion {
    return {
        org_id: row.id,
        org_name: row.org_name,
        branch: row.branch || null,
        state_name: row.states?.state_name || null,
    }
}

function uniqueDuplicates(rows: DuplicateShopSuggestion[]) {
    const seen = new Set<string>()
    return rows.filter((row) => {
        if (seen.has(row.org_id)) return false
        seen.add(row.org_id)
        return true
    })
}

async function findExactPhoneMatches(adminClient: any, contactPhone?: string | null) {
    const normalizedPhone = String(contactPhone || '').trim()
    if (!normalizedPhone) return []

    const { data } = await adminClient
        .from('organizations')
        .select('id, org_name, branch, contact_phone, states(state_name)')
        .eq('org_type_code', 'SHOP')
        .eq('is_active', true)
        .eq('contact_phone', normalizedPhone)
        .limit(5)

    return (data || []).filter((row: any) => samePhone(row.contact_phone || '', normalizedPhone)).map(mapDuplicateRow)
}

async function findExactIdentityMatches(adminClient: any, form: ShopRequestFormInput) {
    const normalizedShopName = normalizeComparisonValue(form.shopName)
    const hasLocationQualifier = Boolean(form.branch || form.state || form.address)
    if (!normalizedShopName || !hasLocationQualifier) return []

    const { data } = await adminClient
        .from('organizations')
        .select('id, org_name, branch, address, states(state_name)')
        .eq('org_type_code', 'SHOP')
        .eq('is_active', true)
        .ilike('org_name', form.shopName || '')
        .limit(20)

    return (data || [])
        .filter((row: any) => {
            if (normalizeComparisonValue(row.org_name) !== normalizedShopName) {
                return false
            }
            if (form.branch && normalizeComparisonValue(row.branch) !== normalizeComparisonValue(form.branch)) {
                return false
            }
            if (form.state && normalizeComparisonValue(row.states?.state_name) !== normalizeComparisonValue(form.state)) {
                return false
            }
            if (form.address && normalizeComparisonValue(row.address) !== normalizeComparisonValue(form.address)) {
                return false
            }
            return true
        })
        .map(mapDuplicateRow)
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

    return (duplicates || []).map(mapDuplicateRow)
}

export async function findShopDuplicateConflicts(
    adminClient: any,
    input: ShopRequestFormInput,
): Promise<ShopDuplicateCheckResult> {
    const form = sanitizeShopRequestForm(input)
    const [exactPhoneMatches, exactIdentityMatches, fuzzyMatches] = await Promise.all([
        findExactPhoneMatches(adminClient, form.contactPhone),
        findExactIdentityMatches(adminClient, form),
        findSimilarShopSuggestions(adminClient, form.shopName),
    ])

    const exactMatches = uniqueDuplicates([...exactPhoneMatches, ...exactIdentityMatches])
    const exactMatchIds = new Set(exactMatches.map((row) => row.org_id))

    return {
        exactMatches,
        fuzzyMatches: fuzzyMatches.filter((row) => !exactMatchIds.has(row.org_id)),
        hasExactPhoneMatch: exactPhoneMatches.length > 0,
        hasExactIdentityMatch: exactIdentityMatches.length > 0,
    }
}

export async function createShopOrganization(
    adminClient: any,
    input: {
        form: ShopRequestFormInput
        createdBy?: string | null
        userOrgId?: string | null
        loyaltyProgramCode?: LoyaltyProgramCode
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

    await upsertOrganizationProgramMembership(
        adminClient,
        input.loyaltyProgramCode || 'cellera',
        createdOrganization.id,
        input.loyaltyProgramCode === 'ellbow' ? 'roadtour' : 'legacy_registration',
        {
            createdBy: input.createdBy || null,
        },
    )

    return {
        organization: {
            id: createdOrganization.id,
            org_name: createdOrganization.org_name,
            branch: createdOrganization.branch ?? form.branch ?? null,
        },
        parentOrgId,
    }
}
