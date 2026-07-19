import { describe, expect, it } from 'vitest'
import {
    mapStockCountDatabaseError,
    stockCountVerificationError,
} from './stock-count-verification-errors'

describe('stock count verification errors', () => {
    it('keeps request/verify/post unexpected errors stage-specific and referenced', () => {
        const request = stockCountVerificationError('unexpected_error', { stage: 'request', reference: 'SC-TEST-1' })
        const post = stockCountVerificationError('unexpected_error', { stage: 'post', reference: 'SC-TEST-2' })
        expect(request.message).toContain('request the verification code')
        expect(request.message).toContain('SC-TEST-1')
        expect(post.message).toContain('post the Stock Count')
        expect(post.message).toContain('Inventory was not changed')
        expect(post.message).toContain('SC-TEST-2')
        expect(request.message).not.toContain('database')
        expect(post.message).not.toMatch(/stack|password|service_role|token/i)
    })

    it('uses the required email-delivery wording', () => {
        expect(stockCountVerificationError('email_delivery_failed').message).toBe(
            'Verification code was generated, but the email could not be sent. Please resend or contact your administrator.',
        )
    })

    it('distinguishes incorrect, expired, and already-used codes', () => {
        expect(stockCountVerificationError('invalid_code').message).toBe(
            'The verification code is incorrect. Please check the code and try again.',
        )
        expect(stockCountVerificationError('expired_code').message).toBe(
            'The verification code has expired. Please request a new code.',
        )
        expect(stockCountVerificationError('code_already_used').message).toBe(
            'This verification code has already been used. Please request a new code.',
        )
    })

    it('maps classification posting permission/schema failures instead of a false request error', () => {
        const denied = mapStockCountDatabaseError(
            'permission denied for function verify_and_post_stock_classification',
            'post',
        )
        expect(denied.code).toBe('posting_function_unavailable')
        expect(denied.message).not.toContain('request the verification code')

        const missing = mapStockCountDatabaseError(
            'Could not find the function public.verify_and_post_stock_classification without parameters in the schema cache',
            'post',
        )
        expect(missing.code).toBe('posting_function_unavailable')
    })

    it('maps OTP and classification validation needles to actionable codes', () => {
        expect(mapStockCountDatabaseError('verification_code_expired', 'post').code).toBe('expired_code')
        expect(mapStockCountDatabaseError('verification_code_already_used', 'post').code).toBe('code_already_used')
        expect(mapStockCountDatabaseError('invalid_verification_code', 'post').code).toBe('invalid_code')
        expect(mapStockCountDatabaseError('stock_count_classification_incomplete', 'post').code).toBe('classification_incomplete')
        expect(mapStockCountDatabaseError('stock_count_already_posted', 'post').code).toBe('already_posted')
    })
})
