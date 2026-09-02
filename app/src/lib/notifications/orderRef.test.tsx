import { describe, expect, it } from 'vitest'
import { extractOrderRef, formatOrderRef } from './orderRef'

describe('extractOrderRef', () => {
    it('reads order_no and order_id from a notification payload', () => {
        expect(extractOrderRef({
            order_no: 'SO26-000123',
            order_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        })).toEqual({
            orderNo: 'SO26-000123',
            orderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        })
    })

    it('prefers display_doc_no when order_no is missing', () => {
        expect(extractOrderRef({ display_doc_no: 'PO26-9' })).toEqual({
            orderNo: 'PO26-9',
            orderId: null,
        })
    })

    it('merges later sources when the first has no order', () => {
        expect(extractOrderRef({ event: 'order_submitted' }, { order_no: 'SO26-1', order_id: 'ord-1' })).toEqual({
            orderNo: 'SO26-1',
            orderId: 'ord-1',
        })
    })

    it('formats the visible order label', () => {
        expect(formatOrderRef({ orderNo: 'SO26-1', orderId: 'uuid' })).toBe('SO26-1')
        expect(formatOrderRef({ orderNo: null, orderId: 'uuid-1' })).toBe('uuid-1')
        expect(formatOrderRef({ orderNo: null, orderId: null })).toBe('')
    })
})
