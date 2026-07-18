import { checkPermissionForUser } from '@/lib/server/permissions'
import { normalizeAndDedupeManualEmails } from '@/lib/notifications/manualEmailAddresses'
import {
    STOCK_COUNT_EVENT_CODE, STOCK_COUNT_POST_PERMISSION, isValidStockCountPostingNote,
    type StockCountVerificationErrorCode,
} from './stock-count-verification-errors'
import { normalizeBaseCost, sumStockCountImpacts } from './stock-count-costing'
import { stockCountRowsSignature } from './stock-count-snapshot'

export interface StockCountPreflightSuccess {
    ok: true
    organizationId: string
    session: any
    items: any[]
    recipients: string[]
    provider: any
    authoritativeBaseCosts: Record<string, number | null>
    // Signature of the *persisted* counted rows. The client computes the same
    // signature over the rows currently on screen; a mismatch means the draft
    // was saved from a different (stale) state than what the user is reviewing,
    // and posting must be blocked before a code is issued.
    persistedSignature: string
    summary: {
        totalVariantsCounted: number
        varianceItems: number
        netQuantityAdjustment: number
        estimatedAdjustmentValue: number
    }
}

export type StockCountPreflightResult = StockCountPreflightSuccess | { ok: false; code: StockCountVerificationErrorCode }

interface StockCountSessionItem {
    stock_config_id: string | null
    variant_id: string
    physical_quantity: number | null
    adjustment_quantity: number | null
    unit_cost: number | null
    note?: string | null
}

export interface StockCountPreflightDependencies {
    loadAccessibleSession: (sessionId: string) => Promise<any | null>
    loadVariantBaseCosts: (variantIds: string[]) => Promise<Array<{ id: string; base_cost: number | string | null }>>
    checkPermission: (userId: string, permission: string) => Promise<{ allowed: boolean; context: { organization_id: string | null } | null }>
    loadEvent: () => Promise<any | null>
    loadSetting: (orgId: string) => Promise<any | null>
    loadUsers: (ids: string[]) => Promise<any[]>
    loadProvider: (orgId: string) => Promise<any | null>
}

function providerLooksUsable(provider: any): boolean {
    if (!provider?.provider_name) return false
    const config = provider.config_public || {}
    const encrypted = provider.config_encrypted
    if (!encrypted) return false
    if (provider.provider_name === 'smtp') return Boolean(config.smtp_host && (config.from_email || config.username))
    if (provider.provider_name === 'gmail') return Boolean(config.gmail_email && config.oauth_client_id)
    if (provider.provider_name === 'mailgun') return Boolean(config.domain && config.from_email)
    return ['sendgrid', 'resend', 'postmark', 'aws_ses'].includes(provider.provider_name) && Boolean(config.from_email)
}

export async function evaluateStockCountPreflight(
    deps: StockCountPreflightDependencies,
    userId: string,
    sessionId: string,
): Promise<StockCountPreflightResult> {
    const session = await deps.loadAccessibleSession(sessionId)
    if (!session) return { ok: false, code: 'stock_count_access_denied' }
    if (session.status !== 'draft') return { ok: false, code: 'already_posted' }

    const permission = await deps.checkPermission(userId, STOCK_COUNT_POST_PERMISSION)
    if (!permission.allowed || !permission.context?.organization_id) return { ok: false, code: 'permission_denied' }

    const items: StockCountSessionItem[] = Array.isArray(session.stock_count_session_items)
        ? session.stock_count_session_items
        : []
    const counted = items.filter((item) => item.physical_quantity !== null)
    if (!counted.length) return { ok: false, code: 'invalid_count_data' }
    if (counted.some((item) => !item.stock_config_id)) return { ok: false, code: 'configuration_identity_missing' }
    const varianceItems = counted.filter((item) => Number(item.adjustment_quantity || 0) !== 0)
    if (varianceItems.length && !isValidStockCountPostingNote(session.notes)) return { ok: false, code: 'posting_note_required' }

    // Master-data Base Cost is authoritative for Stock Count. The draft's
    // unit_cost may be stale (or may have come from legacy average-cost logic),
    // so never use it to calculate the approval summary.
    const baseCostRows = await deps.loadVariantBaseCosts(Array.from(new Set(counted.map(item => item.variant_id))))
    const baseCosts = new Map(baseCostRows.map(row => [row.id, normalizeBaseCost(row.base_cost)]))
    if (varianceItems.some(item => baseCosts.get(item.variant_id) === null || !baseCosts.has(item.variant_id))) {
        return { ok: false, code: 'base_cost_missing' }
    }

    const event = await deps.loadEvent()
    if (!event) return { ok: false, code: 'notification_event_missing' }
    const setting = await deps.loadSetting(permission.context.organization_id)
    if (!setting) return { ok: false, code: 'notification_setting_missing' }
    if (!setting.enabled) return { ok: false, code: 'notification_event_disabled' }

    const config = setting.recipient_config || {}
    const manualEmails = normalizeAndDedupeManualEmails(config.manual_email_addresses)
    const userIds = config.recipient_targets?.users && Array.isArray(config.recipient_users) ? config.recipient_users : []
    const users = userIds.length ? await deps.loadUsers(userIds) : []
    const userEmails = normalizeAndDedupeManualEmails(users.map((user) => user.email).filter(Boolean))
    const recipients = Array.from(new Set([...manualEmails, ...userEmails]))
    if (!recipients.length) {
        return { ok: false, code: userIds.length || manualEmails.length ? 'recipient_emails_invalid' : 'no_authorized_recipients' }
    }

    const provider = await deps.loadProvider(permission.context.organization_id)
    if (!provider) return { ok: false, code: 'email_provider_missing' }
    if (!providerLooksUsable(provider)) return { ok: false, code: 'email_provider_unavailable' }

    return {
        ok: true,
        organizationId: permission.context.organization_id,
        session,
        items,
        recipients,
        provider,
        authoritativeBaseCosts: Object.fromEntries(baseCosts),
        persistedSignature: stockCountRowsSignature(items.map((item) => ({
            stockConfigId: item.stock_config_id ?? null,
            variantId: item.variant_id,
            physicalCount: item.physical_quantity === null || item.physical_quantity === undefined
                ? null
                : Number(item.physical_quantity),
            note: typeof item.note === 'string' ? item.note : '',
        }))),
        summary: {
            totalVariantsCounted: counted.length,
            varianceItems: varianceItems.length,
            netQuantityAdjustment: counted.reduce((sum, item) => sum + Number(item.adjustment_quantity || 0), 0),
            estimatedAdjustmentValue: sumStockCountImpacts(counted.map(item => ({
                quantityChange: Number(item.adjustment_quantity || 0),
                baseCost: baseCosts.get(item.variant_id),
            }))),
        },
    }
}

export function createStockCountPreflightDependencies(supabase: any, admin: any): StockCountPreflightDependencies {
    return {
        loadAccessibleSession: async (sessionId) => {
            const { data } = await supabase.from('stock_count_sessions').select(`
                id, warehouse_organization_id, count_date, count_type, reference_name, notes, status,
                stock_count_session_items(stock_config_id, variant_id, physical_quantity, adjustment_quantity, unit_cost, note)
            `).eq('id', sessionId).maybeSingle()
            return data || null
        },
        loadVariantBaseCosts: async (variantIds) => {
            if (!variantIds.length) return []
            const { data } = await admin.from('product_variants').select('id,base_cost').in('id', variantIds)
            return data || []
        },
        checkPermission: (userId, permission) => checkPermissionForUser(userId, permission) as any,
        loadEvent: async () => {
            const { data } = await admin.from('notification_types').select('event_code,available_channels').eq('event_code', STOCK_COUNT_EVENT_CODE).maybeSingle()
            return data || null
        },
        loadSetting: async (orgId) => {
            const { data } = await admin.from('notification_settings').select('enabled,channels_enabled,recipient_config').eq('org_id', orgId).eq('event_code', STOCK_COUNT_EVENT_CODE).maybeSingle()
            return data || null
        },
        loadUsers: async (ids) => {
            const { data } = await admin.from('users').select('id,email').in('id', ids).eq('is_active', true)
            return data || []
        },
        loadProvider: async (orgId) => {
            const { data } = await admin.from('notification_provider_configs').select('provider_name,config_public,config_encrypted,is_active')
                .eq('org_id', orgId).eq('channel', 'email').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
            return data || null
        },
    }
}
