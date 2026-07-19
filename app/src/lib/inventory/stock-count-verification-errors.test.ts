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

    it('maps a statement-timeout cancellation (SQLSTATE 57014) to a retry-safe posting_timeout', () => {
        const byState = mapStockCountDatabaseError('canceling statement due to statement timeout', 'post', '57014')
        expect(byState.code).toBe('posting_timeout')
        expect(byState.recoverable).toBe(true)
        expect(byState.message).toContain('no inventory was changed')
        expect(byState.message).toContain('code is still valid')
        // Falls back to message text when the driver does not surface a SQLSTATE.
        expect(mapStockCountDatabaseError('canceling statement due to statement timeout', 'post').code).toBe('posting_timeout')
    })

    it('maps lock timeout / deadlock / serialization to a retry-safe posting_conflict', () => {
        expect(mapStockCountDatabaseError('canceling statement due to lock timeout', 'post', '55P03').code).toBe('posting_conflict')
        expect(mapStockCountDatabaseError('deadlock detected', 'post', '40P01').code).toBe('posting_conflict')
        expect(mapStockCountDatabaseError('could not serialize access', 'post', '40001').code).toBe('posting_conflict')
        expect(mapStockCountDatabaseError('canceling statement due to lock timeout', 'post').code).toBe('posting_conflict')
    })

    it('does not misclassify a normal error string that merely contains a SQLSTATE-like number', () => {
        expect(mapStockCountDatabaseError('invalid_verification_code', 'post', '22P02').code).toBe('invalid_code')
    })

    it('surfaces Postgres DETAIL for allocation / already-classified / exceeds-legacy raises', () => {
        const allocated = mapStockCountDatabaseError(
            'stock_count_allocated_blocks_post: This Legacy inventory for Cellera Zero [Buttercake] still has 1 allocated unit and cannot be fully classified. Release or resolve the allocation before posting.',
            'post',
        )
        expect(allocated.code).toBe('classification_allocated_blocks_post')
        expect(allocated.message).toContain('Cellera Zero [Buttercake]')
        expect(allocated.message).toContain('1 allocated unit')

        const fully = mapStockCountDatabaseError(
            'stock_count_already_fully_classified: This product has already been fully classified (P [V]). Download a new Initial Classification template or use Full Count to update its quantity.',
            'preflight',
        )
        expect(fully.code).toBe('classification_already_fully_classified')
        expect(fully.message).toContain('Download a new Initial Classification template')

        const exceeds = mapStockCountDatabaseError(
            'stock_count_classification_exceeds_legacy: Classification for P [V] requests 150 units but only 100 remain in Legacy/Unclassified. Reduce the target counts or refresh the template.',
            'post',
        )
        expect(exceeds.code).toBe('classification_exceeds_legacy')
        expect(exceeds.message).toContain('requests 150')
    })

    it('maps the pre-migration valid_quantities failure to the allocation block message', () => {
        const mapped = mapStockCountDatabaseError(
            'new row for relation "product_inventory" violates check constraint "valid_quantities"',
            'post',
            '23514',
        )
        expect(mapped.code).toBe('classification_allocated_blocks_post')
    })
})
