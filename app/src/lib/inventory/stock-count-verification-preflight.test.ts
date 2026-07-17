import { describe, expect, it } from 'vitest'
import { evaluateStockCountPreflight, type StockCountPreflightDependencies } from './stock-count-verification-preflight'
import {
    isValidStockCountPostingNote,
    normalizeStockCountPostingNote,
    stockCountPermissionGate,
    stockCountVerificationError,
} from './stock-count-verification-errors'

const session = {
    id: 'session-1', status: 'draft', notes: 'Approved count',
    stock_count_session_items: [{ stock_config_id: 'config-1', variant_id: 'variant-1', physical_quantity: 8, adjustment_quantity: -2, unit_cost: 13.86 }],
}

function dependencies(overrides: Partial<StockCountPreflightDependencies> = {}): StockCountPreflightDependencies {
    return {
        loadAccessibleSession: async () => session,
        loadVariantBaseCosts: async () => [{ id: 'variant-1', base_cost: '14.00' }],
        checkPermission: async () => ({ allowed: true, context: { organization_id: 'org-1' } }),
        loadEvent: async () => ({ event_code: 'stock_count_posting_verification', available_channels: ['email'] }),
        loadSetting: async () => ({
            enabled: true, channels_enabled: ['email'],
            recipient_config: { recipient_targets: { users: true }, recipient_users: ['user-2'], manual_email_addresses: [] },
        }),
        loadUsers: async () => [{ id: 'user-2', email: 'approver@example.com' }],
        loadProvider: async (): Promise<any | null> => ({ provider_name: 'resend', config_public: { from_email: 'security@example.com' }, config_encrypted: { api_key: 'encrypted' } }),
        ...overrides,
    }
}

describe('Stock Count verification preflight', () => {
    it('allows an authorized user only after every preflight dependency succeeds', async () => {
        const result = await evaluateStockCountPreflight(dependencies(), 'user-1', 'session-1')
        expect(result).toMatchObject({
            ok: true,
            organizationId: 'org-1',
            recipients: ['approver@example.com'],
            authoritativeBaseCosts: { 'variant-1': 14 },
        })
        if (result.ok) expect(result.summary).toMatchObject({ totalVariantsCounted: 1, varianceItems: 1, netQuantityAdjustment: -2, estimatedAdjustmentValue: -28 })
    })

    it('uses current Variant Base Cost instead of a draft average-cost snapshot', async () => {
        const result = await evaluateStockCountPreflight(dependencies(), 'user-1', 'session-1')
        expect(result.ok && result.summary.estimatedAdjustmentValue).toBe(-28)
    })

    it('blocks a variance item when master data has no Base Cost', async () => {
        const result = await evaluateStockCountPreflight(dependencies({
            loadVariantBaseCosts: async () => [{ id: 'variant-1', base_cost: null }],
        }), 'user-1', 'session-1')
        expect(result).toEqual({ ok: false, code: 'base_cost_missing' })
    })

    it('rejects a legacy variant-only draft instead of guessing a configuration', async () => {
        const result = await evaluateStockCountPreflight(dependencies({
            loadAccessibleSession: async () => ({
                ...session,
                stock_count_session_items: [{ ...session.stock_count_session_items[0], stock_config_id: null }],
            }),
        }), 'user-1', 'session-1')
        expect(result).toEqual({ ok: false, code: 'configuration_identity_missing' })
    })

    it('returns the dedicated permission error for an unauthorized user', async () => {
        const result = await evaluateStockCountPreflight(dependencies({
            checkPermission: async () => ({ allowed: false, context: { organization_id: 'org-1' } }),
        }), 'user-1', 'session-1')
        expect(result).toEqual({ ok: false, code: 'permission_denied' })
    })

    it('does not show a temporary denial while permission state is loading', () => {
        expect(stockCountPermissionGate(true, false)).toBe('checking')
        expect(stockCountPermissionGate(false, false)).toBe('denied')
        expect(stockCountPermissionGate(false, true)).toBe('allowed')
    })

    it('accepts a trimmed non-empty Posting Note and rejects whitespace-only input', async () => {
        expect(normalizeStockCountPostingNote('  approved count  ')).toBe('approved count')
        expect(isValidStockCountPostingNote('  approved count  ')).toBe(true)
        expect(isValidStockCountPostingNote('   \n  ')).toBe(false)

        const invalid = await evaluateStockCountPreflight(dependencies({
            loadAccessibleSession: async () => ({ ...session, notes: '   ' }),
        }), 'user-1', 'session-1')
        expect(invalid).toEqual({ ok: false, code: 'posting_note_required' })
    })

    it.each([
        ['missing event', { loadEvent: async () => null }, 'notification_event_missing'],
        ['disabled event', { loadSetting: async () => ({ enabled: false }) }, 'notification_event_disabled'],
        ['no configured recipients', { loadSetting: async () => ({ enabled: true, recipient_config: {} }) }, 'no_authorized_recipients'],
        ['selected users without emails', { loadUsers: async () => [{ id: 'user-2', email: null }] }, 'recipient_emails_invalid'],
        ['missing provider', { loadProvider: async (): Promise<any | null> => null }, 'email_provider_missing'],
        ['unusable provider', { loadProvider: async (): Promise<any | null> => ({ provider_name: 'resend', config_public: {}, config_encrypted: null }) }, 'email_provider_unavailable'],
    ] as const)('reports %s accurately', async (_label, overrides, code) => {
        const result = await evaluateStockCountPreflight(dependencies(overrides as any), 'user-1', 'session-1')
        expect(result).toEqual({ ok: false, code })
    })

    it('maps every API code to a safe user-facing message', () => {
        expect(stockCountVerificationError('notification_event_disabled').message).toContain('disabled')
        expect(stockCountVerificationError('email_provider_missing').message).toContain('No active email provider')
        expect(stockCountVerificationError('unexpected_error').message).not.toContain('database')
    })
})
