import { getShopOrgReassignmentBlockReason } from '@/lib/auth/employment-org-guard'

/**
 * Consumer shop affiliation (QR / Premium Loyalty "my shop").
 *
 * A consumer (store account) may link their profile to an active SHOP so shop
 * lane points and rewards work. This is consumer affiliation, not enterprise
 * authorization: it never changes role_code or account_scope, and it is never
 * available to portal / staff / business identities. Self-service profile
 * updates still cannot touch organization_id (Phase 0); this dedicated,
 * narrowly checked operation is the only self-service path that can.
 */

export const CONSUMER_ROLE_CODES = ['GUEST', 'CONSUMER'] as const

export interface ShopLinkActor {
    id: string
    is_active: boolean | null
    account_scope: string | null
    role_code: string | null
    role_level: number | null
    organization_id: string | null
}

export interface ShopLinkOrganization {
    id: string
    org_name: string | null
    branch: string | null
    org_type_code: string | null
    is_active: boolean | null
}

export type ShopLinkDecision =
    | { ok: true; unchanged: boolean; switching: boolean }
    | {
        ok: false
        status: number
        code: string
        error: string
        currentShop?: { org_id: string; org_name: string | null; branch: string | null }
        requestedShop?: { org_id: string; org_name: string | null; branch: string | null }
    }

export function isConsumerShopLinkIdentity(actor: Pick<ShopLinkActor, 'account_scope' | 'role_code'>): boolean {
    return String(actor.account_scope || '').toLowerCase() === 'store'
        && (CONSUMER_ROLE_CODES as readonly string[]).includes(String(actor.role_code || '').toUpperCase())
}

/**
 * Pure decision. Every rule is re-evaluated on each request; the explicit
 * switch confirmation only acknowledges intent and never authorizes anything
 * the other rules would refuse.
 */
export function decideConsumerShopLink(input: {
    actor: ShopLinkActor | null
    currentOrganization: ShopLinkOrganization | null
    target: ShopLinkOrganization | null
    confirmShopSwitch: boolean
}): ShopLinkDecision {
    const { actor, currentOrganization, target, confirmShopSwitch } = input

    if (!actor) {
        return { ok: false, status: 404, code: 'PROFILE_NOT_FOUND', error: 'Your profile could not be found.' }
    }
    if (actor.is_active !== true) {
        return { ok: false, status: 403, code: 'ACCOUNT_INACTIVE', error: 'Your account is not active.' }
    }
    if (!isConsumerShopLinkIdentity(actor)) {
        return {
            ok: false,
            status: 403,
            code: 'NOT_CONSUMER_ACCOUNT',
            error: 'Only consumer accounts can link a shop here. Staff and business accounts are managed in User Management.',
        }
    }
    if (!target) {
        return { ok: false, status: 400, code: 'SHOP_NOT_FOUND', error: 'Selected shop could not be found.' }
    }
    if (target.org_type_code !== 'SHOP') {
        return { ok: false, status: 400, code: 'NOT_A_SHOP', error: 'Please select a shop.' }
    }
    if (target.is_active !== true) {
        return { ok: false, status: 400, code: 'SHOP_INACTIVE', error: 'Selected shop is not active.' }
    }
    if (actor.organization_id && (!currentOrganization || currentOrganization.org_type_code !== 'SHOP')) {
        return {
            ok: false,
            status: 403,
            code: 'CURRENT_ORGANIZATION_NOT_SHOP',
            error: 'This profile belongs to an organization that cannot be changed here.',
        }
    }

    const blockReason = getShopOrgReassignmentBlockReason({
        currentOrgTypeCode: currentOrganization?.org_type_code ?? null,
        currentRoleCode: actor.role_code,
        currentRoleLevel: actor.role_level,
        currentAccountScope: actor.account_scope,
        nextOrgTypeCode: 'SHOP',
    })
    if (blockReason) {
        return { ok: false, status: 403, code: 'SHOP_REASSIGNMENT_BLOCKED', error: blockReason }
    }

    if (actor.organization_id === target.id) {
        return { ok: true, unchanged: true, switching: false }
    }

    const switching = Boolean(actor.organization_id)
    if (switching && !confirmShopSwitch) {
        return {
            ok: false,
            status: 409,
            code: 'SHOP_SWITCH_CONFIRMATION_REQUIRED',
            error: 'This profile is already linked to another shop. Please confirm that you want to switch shops.',
            currentShop: {
                org_id: currentOrganization!.id,
                org_name: currentOrganization!.org_name,
                branch: currentOrganization!.branch,
            },
            requestedShop: { org_id: target.id, org_name: target.org_name, branch: target.branch },
        }
    }

    return { ok: true, unchanged: false, switching }
}

const ORG_COLUMNS = 'id, org_name, branch, org_type_code, is_active'

async function loadOrganization(admin: any, id: string | null): Promise<ShopLinkOrganization | null> {
    if (!id) return null
    const { data } = await admin.from('organizations').select(ORG_COLUMNS).eq('id', id).maybeSingle()
    return data ?? null
}

/**
 * Loads trusted state with the service role, decides, and only then writes
 * users.organization_id — conditionally on the state that was checked, so a
 * concurrent change (org, scope, role or activation) makes the write a no-op.
 */
export async function linkConsumerShop(admin: any, input: {
    actorId: string
    targetOrganizationId: string
    confirmShopSwitch: boolean
}): Promise<ShopLinkDecision & { shop?: ShopLinkOrganization }> {
    const { data: row } = await admin
        .from('users')
        .select('id, is_active, account_scope, role_code, organization_id')
        .eq('id', input.actorId)
        .maybeSingle()

    let actor: ShopLinkActor | null = null
    if (row) {
        let roleLevel: number | null = null
        if (row.role_code) {
            const { data: role } = await admin.from('roles').select('role_level').eq('role_code', row.role_code).maybeSingle()
            roleLevel = typeof role?.role_level === 'number' ? role.role_level : null
        }
        actor = { ...row, role_level: roleLevel }
    }

    const [currentOrganization, target] = await Promise.all([
        loadOrganization(admin, actor?.organization_id ?? null),
        loadOrganization(admin, input.targetOrganizationId),
    ])

    const decision = decideConsumerShopLink({
        actor,
        currentOrganization,
        target,
        confirmShopSwitch: input.confirmShopSwitch,
    })
    if (!decision.ok || decision.unchanged) return { ...decision, shop: target ?? undefined }

    let update = admin
        .from('users')
        .update({ organization_id: target!.id, updated_at: new Date().toISOString() })
        .eq('id', actor!.id)
        .eq('is_active', true)
        .eq('account_scope', actor!.account_scope)
        .eq('role_code', actor!.role_code)
    update = actor!.organization_id ? update.eq('organization_id', actor!.organization_id) : update.is('organization_id', null)
    const { data: updated, error } = await update.select('id')

    if (error) {
        console.error('[consumer/link-shop] update failed', { code: error.code })
        return { ok: false, status: 500, code: 'LINK_FAILED', error: 'Failed to link the shop. Please try again.' }
    }
    if (!updated || updated.length !== 1) {
        return { ok: false, status: 409, code: 'PROFILE_CHANGED', error: 'Your profile changed while saving. Please try again.' }
    }
    return { ...decision, shop: target! }
}
