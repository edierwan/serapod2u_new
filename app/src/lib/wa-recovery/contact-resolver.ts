import type { SupabaseClient } from '@supabase/supabase-js'

import { normalizePhoneE164, samePhone, toProviderPhone } from '@/utils/phone'

export interface RecoveryContactLookupInput {
    key: string
    phone: string
    userId?: string | null
}

export interface RecoveryContactResolution {
    normalizedPhone: string
    displayName: string
    sourceLabel: string
    userId: string | null
    organizationId: string | null
    matchedBy: 'user_id' | 'user_phone' | 'organization_contact' | 'none'
}

interface UserRow {
    id: string
    full_name?: string | null
    call_name?: string | null
    phone?: string | null
    organization_id?: string | null
    role_code?: string | null
    is_active?: boolean | null
    phone_verified_at?: string | null
    last_login_at?: string | null
    shop_name?: string | null
}

interface OrganizationRow {
    id: string
    org_name: string
    org_type_code?: string | null
    contact_name?: string | null
    contact_phone?: string | null
}

export function getPhoneVariants(phone: string): string[] {
    const normalized = normalizePhoneE164(phone)
    if (!normalized) return []

    const digits = normalized.replace(/^\+/, '')
    const providerPhone = toProviderPhone(normalized)
    const local = providerPhone?.startsWith('60') ? `0${providerPhone.slice(2)}` : ''

    return Array.from(new Set([normalized, digits, providerPhone || '', local].filter(Boolean)))
}

function mapOrgTypeToSource(orgTypeCode?: string | null) {
    switch (String(orgTypeCode || '').toUpperCase()) {
        case 'SHOP':
            return 'Shop'
        case 'MFG':
            return 'Manufacturer'
        case 'DIST':
            return 'Distributor'
        case 'HQ':
        case 'WH':
            return 'Employee'
        default:
            return 'Organization'
    }
}

function preferredUserName(user: UserRow, org?: OrganizationRow | null) {
    const candidate = [user.call_name, user.full_name, user.shop_name, org?.contact_name, org?.org_name]
        .map(value => String(value || '').trim())
        .find(Boolean)
    return candidate || null
}

function resolveUserSource(user: UserRow, org?: OrganizationRow | null) {
    const roleCode = String(user.role_code || '').toLowerCase()
    const orgTypeCode = String(org?.org_type_code || '').toUpperCase()

    if (orgTypeCode === 'SHOP') return 'Shop'
    if (orgTypeCode === 'MFG') return 'Manufacturer'
    if (orgTypeCode === 'DIST') return 'Distributor'
    if (
        orgTypeCode === 'HQ' ||
        orgTypeCode === 'WH' ||
        roleCode.includes('admin') ||
        roleCode.includes('manager') ||
        roleCode.includes('staff') ||
        roleCode.includes('employee')
    ) {
        return 'Employee'
    }

    if (roleCode.includes('consumer') || roleCode.includes('customer') || roleCode.includes('end_user')) {
        return 'Customer'
    }

    return 'User'
}

function scoreUserCandidate(user: UserRow) {
    let score = 0
    if (user.phone_verified_at) score += 100
    if (user.is_active) score += 50
    if (user.call_name || user.full_name) score += 25
    if (user.last_login_at) score += 10
    return score
}

function pickBestUser(users: UserRow[]) {
    return [...users].sort((left, right) => scoreUserCandidate(right) - scoreUserCandidate(left))[0] || null
}

function buildUnknownResolution(phone: string): RecoveryContactResolution {
    return {
        normalizedPhone: normalizePhoneE164(phone) || phone,
        displayName: 'Unknown contact',
        sourceLabel: 'Unknown',
        userId: null,
        organizationId: null,
        matchedBy: 'none',
    }
}

export async function resolveRecoveryContacts(
    supabaseAdmin: SupabaseClient,
    inputs: RecoveryContactLookupInput[],
): Promise<Record<string, RecoveryContactResolution>> {
    const uniqueInputs = Array.from(new Map(inputs.map(input => [input.key, input])).values())
    const userIds = Array.from(new Set(uniqueInputs.map(input => input.userId).filter(Boolean) as string[]))
    const phoneVariants = Array.from(new Set(uniqueInputs.flatMap(input => getPhoneVariants(input.phone))))

    const [usersByIdRes, usersByPhoneRes, orgsByPhoneRes] = await Promise.all([
        userIds.length > 0
            ? (supabaseAdmin as any)
                .from('users')
                .select('id, full_name, call_name, phone, organization_id, role_code, is_active, phone_verified_at, last_login_at, shop_name')
                .in('id', userIds)
            : Promise.resolve({ data: [], error: null }),
        phoneVariants.length > 0
            ? (supabaseAdmin as any)
                .from('users')
                .select('id, full_name, call_name, phone, organization_id, role_code, is_active, phone_verified_at, last_login_at, shop_name')
                .in('phone', phoneVariants)
            : Promise.resolve({ data: [], error: null }),
        phoneVariants.length > 0
            ? (supabaseAdmin as any)
                .from('organizations')
                .select('id, org_name, org_type_code, contact_name, contact_phone')
                .in('contact_phone', phoneVariants)
            : Promise.resolve({ data: [], error: null }),
    ])

    if (usersByIdRes.error) {
        console.warn('[wa-recovery/contact-resolver] users-by-id lookup failed', usersByIdRes.error)
    }
    if (usersByPhoneRes.error) {
        console.warn('[wa-recovery/contact-resolver] users-by-phone lookup failed', usersByPhoneRes.error)
    }
    if (orgsByPhoneRes.error) {
        console.warn('[wa-recovery/contact-resolver] organizations-by-phone lookup failed', orgsByPhoneRes.error)
    }

    const usersById = new Map<string, UserRow>(((usersByIdRes.data || []) as UserRow[]).map(user => [user.id, user]))
    const phoneUsers = (usersByPhoneRes.data || []) as UserRow[]
    const phoneOrganizations = (orgsByPhoneRes.data || []) as OrganizationRow[]

    const orgIds = Array.from(new Set([
        ...phoneUsers.map(user => user.organization_id).filter(Boolean),
        ...((usersByIdRes.data || []) as UserRow[]).map(user => user.organization_id).filter(Boolean),
        ...phoneOrganizations.map(org => org.id),
    ] as string[]))

    const organizationsByIdRes = orgIds.length > 0
        ? await (supabaseAdmin as any)
            .from('organizations')
            .select('id, org_name, org_type_code, contact_name, contact_phone')
            .in('id', orgIds)
        : { data: [], error: null }

    if (organizationsByIdRes.error) {
        console.warn('[wa-recovery/contact-resolver] organizations-by-id lookup failed', organizationsByIdRes.error)
    }

    const organizationsById = new Map<string, OrganizationRow>(((organizationsByIdRes.data || []) as OrganizationRow[]).map(org => [org.id, org]))

    const resolved: Record<string, RecoveryContactResolution> = {}

    for (const input of uniqueInputs) {
        const unknown = buildUnknownResolution(input.phone)
        const exactUser = input.userId ? usersById.get(input.userId) || null : null

        if (exactUser) {
            const organization = exactUser.organization_id ? organizationsById.get(exactUser.organization_id) || null : null
            resolved[input.key] = {
                normalizedPhone: normalizePhoneE164(input.phone) || exactUser.phone || unknown.normalizedPhone,
                displayName: preferredUserName(exactUser, organization) || unknown.displayName,
                sourceLabel: resolveUserSource(exactUser, organization),
                userId: exactUser.id,
                organizationId: exactUser.organization_id || null,
                matchedBy: 'user_id',
            }
            continue
        }

        const matchedUsers = phoneUsers.filter(user => samePhone(user.phone || '', input.phone))
        const matchedUser = pickBestUser(matchedUsers)
        if (matchedUser) {
            const organization = matchedUser.organization_id ? organizationsById.get(matchedUser.organization_id) || null : null
            resolved[input.key] = {
                normalizedPhone: normalizePhoneE164(input.phone) || matchedUser.phone || unknown.normalizedPhone,
                displayName: preferredUserName(matchedUser, organization) || unknown.displayName,
                sourceLabel: resolveUserSource(matchedUser, organization),
                userId: matchedUser.id,
                organizationId: matchedUser.organization_id || null,
                matchedBy: 'user_phone',
            }
            continue
        }

        const matchedOrg = phoneOrganizations.find(org => samePhone(org.contact_phone || '', input.phone)) || null
        if (matchedOrg) {
            resolved[input.key] = {
                normalizedPhone: normalizePhoneE164(input.phone) || matchedOrg.contact_phone || unknown.normalizedPhone,
                displayName: String(matchedOrg.contact_name || matchedOrg.org_name || '').trim() || unknown.displayName,
                sourceLabel: mapOrgTypeToSource(matchedOrg.org_type_code),
                userId: null,
                organizationId: matchedOrg.id,
                matchedBy: 'organization_contact',
            }
            continue
        }

        resolved[input.key] = unknown
    }

    return resolved
}