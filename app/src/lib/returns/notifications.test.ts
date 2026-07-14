import { describe, it, expect } from 'vitest'
import { queueReturnNotification, RETURN_STATUS_EVENT } from './notifications'

/**
 * Minimal chainable Supabase stub. Filter methods are no-ops that return the
 * builder; terminal reads resolve from `responses[table]`, and `insert` records
 * the row. Enough to exercise the queue's routing / idempotency / skip logic.
 */
function makeAdmin(responses: Record<string, any>) {
    const inserted: Array<{ table: string; row: any }> = []
    const from = (table: string) => {
        const builder: any = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
            contains: () => builder,
            order: () => builder,
            limit: () => builder,
            maybeSingle: async () => ({ data: responses[`${table}:single`] ?? null, error: null }),
            insert: async (row: any) => { inserted.push({ table, row }); return { error: null } },
            then: (resolve: any) => resolve({ data: responses[`${table}:list`] ?? [], error: null }),
        }
        return builder
    }
    return { admin: { from } as any, inserted }
}

const RC = {
    id: 'ret-1',
    return_no: 'RET26-000009',
    return_source_type: 'shop',
    return_source_organization_id: 'shop-1',
    shop_org_id: 'shop-1',
    status: 'return_submitted',
    reported_date: '2026-07-12',
    updated_at: '2026-07-12T00:00:00.000Z',
    contact_person: null,
}

const SOURCE_ORG = {
    id: 'shop-1', org_name: 'Shop Five', org_code: 'SH005', org_type_code: 'SHOP',
    contact_name: 'Alice', contact_phone: '60123456789', contact_email: 'alice@shop.test',
}

function baseResponses(overrides: Record<string, any> = {}) {
    return {
        'organizations:single': { id: 'hq' },        // HQ config org lookup
        'organizations:list': [SOURCE_ORG],           // source org resolution
        'return_cases:single': RC,
        'return_case_items:list': [],
        'notifications_outbox:list': [],              // no existing → not duplicate
        'notification_settings:single': { enabled: true, recipient_config: { routing: { preset: 'email_only' } } },
        ...overrides,
    }
}

describe('queueReturnNotification', () => {
    it('maps each return status to its event code', () => {
        expect(RETURN_STATUS_EVENT.return_draft).toBe('return_draft_created')
        expect(RETURN_STATUS_EVENT.return_submitted).toBe('return_submitted')
        expect(RETURN_STATUS_EVENT.return_completed).toBe('return_completed')
    })

    it('queues an email to the source org contact email', async () => {
        const { admin, inserted } = makeAdmin(baseResponses())
        const res = await queueReturnNotification(admin, { returnCaseId: 'ret-1', eventCode: 'return_submitted' })
        expect(res.queued).toBe(1)
        expect(inserted).toHaveLength(1)
        expect(inserted[0].row).toMatchObject({ channel: 'email', to_email: 'alice@shop.test', status: 'queued' })
    })

    it('skips silently when the event is disabled', async () => {
        const { admin, inserted } = makeAdmin(baseResponses({
            'notification_settings:single': { enabled: false, recipient_config: {} },
        }))
        const res = await queueReturnNotification(admin, { returnCaseId: 'ret-1', eventCode: 'return_submitted' })
        expect(res.skippedReason).toBe('disabled')
        expect(res.queued).toBe(0)
        expect(inserted).toHaveLength(0)
    })

    it('is idempotent — skips when an outbox row already exists', async () => {
        const { admin, inserted } = makeAdmin(baseResponses({
            'notifications_outbox:list': [{ id: 'existing' }],
        }))
        const res = await queueReturnNotification(admin, { returnCaseId: 'ret-1', eventCode: 'return_submitted' })
        expect(res.skippedReason).toBe('duplicate')
        expect(inserted).toHaveLength(0)
    })

    it('warns non-blockingly and logs a failed row when the required contact is missing', async () => {
        const { admin, inserted } = makeAdmin(baseResponses({
            'organizations:list': [{ ...SOURCE_ORG, contact_phone: '' }],
            'notification_settings:single': { enabled: true, recipient_config: { routing: { preset: 'whatsapp_only' } } },
        }))
        const res = await queueReturnNotification(admin, { returnCaseId: 'ret-1', eventCode: 'return_submitted' })
        expect(res.queued).toBe(0)
        expect(res.warnings[0]).toMatch(/no contact phone/i)
        expect(inserted[0].row).toMatchObject({ channel: 'whatsapp', status: 'failed' })
    })

    it('routes WhatsApp to the source org contact phone', async () => {
        const { admin, inserted } = makeAdmin(baseResponses({
            'notification_settings:single': { enabled: true, recipient_config: { routing: { preset: 'whatsapp_only' } } },
        }))
        const res = await queueReturnNotification(admin, { returnCaseId: 'ret-1', eventCode: 'return_submitted' })
        expect(res.queued).toBe(1)
        expect(inserted[0].row).toMatchObject({ channel: 'whatsapp', to_phone: '60123456789' })
    })
})
