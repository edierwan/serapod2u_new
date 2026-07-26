import { afterEach, describe, expect, it } from 'vitest'
import {
    finalizeStockCountVerificationDelivery, generateStockCountCode, hashStockCountCode, maskEmail,
} from './stock-count-verification-server'

describe('stock count verification security helpers', () => {
    const originalSecret = process.env.STOCK_COUNT_VERIFICATION_SECRET
    afterEach(() => { process.env.STOCK_COUNT_VERIFICATION_SECRET = originalSecret })

    it('generates exactly eight numeric digits', () => {
        for (let index = 0; index < 50; index += 1) expect(generateStockCountCode()).toMatch(/^\d{8}$/)
    })

    it('binds the HMAC to organization, session, and requester', () => {
        process.env.STOCK_COUNT_VERIFICATION_SECRET = 'test-only-secret'
        const hash = hashStockCountCode('12345678', 'org-a', 'session-a', 'user-a')
        expect(hash).toMatch(/^[a-f0-9]{64}$/)
        expect(hashStockCountCode('12345678', 'org-a', 'session-a', 'user-b')).not.toBe(hash)
    })

    it('masks recipients', () => {
        expect(maskEmail('approver@example.com')).toBe('ap******@example.com')
    })

    it('invalidates the request when email delivery fails', async () => {
        const calls: any[] = []
        const supabase = { rpc: async (name: string, args: any) => { calls.push([name, args]); return { error: null } } }
        await finalizeStockCountVerificationDelivery(supabase, 'request-1', false)
        expect(calls).toEqual([['finalize_stock_count_verification_delivery', {
            p_request_id: 'request-1', p_success: false,
        }]])
    })
})
