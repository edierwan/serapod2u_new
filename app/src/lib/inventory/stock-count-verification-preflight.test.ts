import { describe, expect, it } from 'vitest'
import { evaluateStockCountPreflight, type StockCountPreflightDependencies } from './stock-count-verification-preflight'
import { stockCountRowsSignature } from './stock-count-snapshot'
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
        loadClassificationLiveLegacy: async () => [],
        loadVariantLabels: async () => [],
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

    // ── Stale-draft regression (incident: Review showed the first import) ──────
    describe('persistedSignature (stale draft guard)', () => {
        const threeTargets = [
            { stock_config_id: '20NB', variant_id: 'v1', physical_quantity: 50, adjustment_quantity: 50, unit_cost: 14, note: '' },
            { stock_config_id: '50NB', variant_id: 'v1', physical_quantity: 50, adjustment_quantity: 50, unit_cost: 14, note: '' },
            { stock_config_id: '50OB', variant_id: 'v1', physical_quantity: 50, adjustment_quantity: 50, unit_cost: 14, note: '' },
        ]

        it('returns a signature of the persisted counted rows', async () => {
            const result = await evaluateStockCountPreflight(dependencies({
                loadAccessibleSession: async () => ({ ...session, stock_count_session_items: threeTargets }),
                loadVariantBaseCosts: async () => [{ id: 'v1', base_cost: '14.00' }],
            }), 'user-1', 'session-1')
            expect(result.ok).toBe(true)
            if (!result.ok) return
            // The server signature must equal the client signature over the same
            // on-screen rows — this is the equality Review & Post relies on.
            expect(result.persistedSignature).toBe(stockCountRowsSignature([
                { stockConfigId: '20NB', variantId: 'v1', physicalCount: 50, note: '' },
                { stockConfigId: '50NB', variantId: 'v1', physicalCount: 50, note: '' },
                { stockConfigId: '50OB', variantId: 'v1', physicalCount: 50, note: '' },
            ]))
        })

        it('a first-import draft (50/50/50) never matches the latest screen (50/40/20)', async () => {
            // The persisted draft still holds the FIRST import…
            const result = await evaluateStockCountPreflight(dependencies({
                loadAccessibleSession: async () => ({ ...session, stock_count_session_items: threeTargets }),
                loadVariantBaseCosts: async () => [{ id: 'v1', base_cost: '14.00' }],
            }), 'user-1', 'session-1')
            expect(result.ok).toBe(true)
            if (!result.ok) return
            // …but the user's latest import on screen is 50/40/20. The client
            // compares its signature to result.persistedSignature; they differ,
            // so Review & Post blocks instead of silently posting +150.
            const latestScreenSignature = stockCountRowsSignature([
                { stockConfigId: '20NB', variantId: 'v1', physicalCount: 50, note: '' },
                { stockConfigId: '50NB', variantId: 'v1', physicalCount: 40, note: '' },
                { stockConfigId: '50OB', variantId: 'v1', physicalCount: 20, note: '' },
            ])
            expect(result.persistedSignature).not.toBe(latestScreenSignature)
        })

        it('matches once the latest import has been saved to the draft', async () => {
            const savedSecondImport = [
                { stock_config_id: '20NB', variant_id: 'v1', physical_quantity: 50, adjustment_quantity: 50, unit_cost: 14, note: '' },
                { stock_config_id: '50NB', variant_id: 'v1', physical_quantity: 40, adjustment_quantity: 40, unit_cost: 14, note: '' },
                { stock_config_id: '50OB', variant_id: 'v1', physical_quantity: 20, adjustment_quantity: 20, unit_cost: 14, note: '' },
            ]
            const result = await evaluateStockCountPreflight(dependencies({
                loadAccessibleSession: async () => ({ ...session, stock_count_session_items: savedSecondImport }),
                loadVariantBaseCosts: async () => [{ id: 'v1', base_cost: '14.00' }],
            }), 'user-1', 'session-1')
            expect(result.ok).toBe(true)
            if (!result.ok) return
            expect(result.persistedSignature).toBe(stockCountRowsSignature([
                { stockConfigId: '20NB', variantId: 'v1', physicalCount: 50, note: '' },
                { stockConfigId: '50NB', variantId: 'v1', physicalCount: 40, note: '' },
                { stockConfigId: '50OB', variantId: 'v1', physicalCount: 20, note: '' },
            ]))
        })
    })

    describe('Initial Classification live Legacy guards', () => {
        const classificationSession = {
            id: 'session-cls',
            status: 'draft',
            notes: 'Initial classification',
            count_type: 'initial_configuration_classification',
            warehouse_organization_id: 'wh-1',
            stock_count_session_items: [
                {
                    stock_config_id: 'unc',
                    variant_id: 'v1',
                    physical_quantity: 0,
                    adjustment_quantity: -100,
                    unit_cost: 14,
                    note: '',
                    inventory_stock_configurations: { config_code: 'UNCLASSIFIED' },
                },
                {
                    stock_config_id: '20nb',
                    variant_id: 'v1',
                    physical_quantity: 40,
                    adjustment_quantity: 40,
                    unit_cost: 14,
                    note: '',
                    inventory_stock_configurations: { config_code: '20NB' },
                },
                {
                    stock_config_id: '50nb',
                    variant_id: 'v1',
                    physical_quantity: 35,
                    adjustment_quantity: 35,
                    unit_cost: 14,
                    note: '',
                    inventory_stock_configurations: { config_code: '50NB' },
                },
                {
                    stock_config_id: '50ob',
                    variant_id: 'v1',
                    physical_quantity: 25,
                    adjustment_quantity: 25,
                    unit_cost: 14,
                    note: '',
                    inventory_stock_configurations: { config_code: '50OB' },
                },
            ],
        }

        it('blocks when live Legacy still has allocated units', async () => {
            const result = await evaluateStockCountPreflight(dependencies({
                loadAccessibleSession: async () => classificationSession,
                loadVariantBaseCosts: async () => [{ id: 'v1', base_cost: '14.00' }],
                loadVariantLabels: async () => [{ id: 'v1', variant_name: 'Buttercake', product_name: 'Cellera Zero' }],
                loadClassificationLiveLegacy: async () => [{
                    variantId: 'v1',
                    productName: 'Cellera Zero',
                    variantName: 'Buttercake',
                    liveOnHand: 100,
                    liveAllocated: 1,
                }],
            }), 'user-1', 'session-cls')
            expect(result.ok).toBe(false)
            if (result.ok) return
            expect(result.code).toBe('classification_allocated_blocks_post')
            expect(result.message).toContain('Cellera Zero [Buttercake]')
            expect(result.message).toContain('1 allocated unit')
        })
    })
})
