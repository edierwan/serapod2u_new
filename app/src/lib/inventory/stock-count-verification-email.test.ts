import { describe, expect, it } from 'vitest'
import { buildStockCountEmail, type StockCountVerificationEmailInput } from './stock-count-verification-email'
import { getTemplatesForEvent } from '@/config/notificationTemplates'

const fixture: StockCountVerificationEmailInput = {
    warehouse_name: 'Serapod Warehouse Balakong',
    organization_name: 'Serapod2U',
    count_date: '2026-07-14',
    count_type: 'full_count',
    reference_name: null,
    requested_by: 'Admin User',
    requested_at: '2026-07-15T02:30:00.000Z',
    total_variants_counted: 4,
    variance_items: 4,
    net_quantity_adjustment: -5595,
    estimated_adjustment_value: -77361.21,
    notes: 'Warehouse reconciliation\nApproved by <Manager>',
    high_impact: true,
}

describe('Stock Count verification email', () => {
    it('is available as an email-only preset in the notification template library', () => {
        const templates = getTemplatesForEvent('stock_count_posting_verification', 'email')
        expect(templates).toHaveLength(1)
        expect(templates[0]).toMatchObject({
            name: 'Stock Count Security Code',
            subject: 'Serapod2U Stock Count Posting Verification Code',
            channel: 'email',
        })
        expect(getTemplatesForEvent('stock_count_posting_verification', 'whatsapp')).toEqual([])
        expect(getTemplatesForEvent('stock_count_posting_verification', 'sms')).toEqual([])
    })

    it('renders the subject, preview, prominent eight-digit code, details, and high-impact warning', () => {
        const email = buildStockCountEmail(fixture, '68361900')
        expect(email.subject).toBe('Serapod2U Stock Count Posting Verification Code')
        expect(email.previewText).toBe('A verification code was requested to approve a Stock Count inventory adjustment.')
        expect(email.html).toContain('68361900')
        expect(email.html).toContain('High-impact adjustment')
        expect(email.html).toContain('-5,595')
        expect(email.html).toContain('RM -77,361.21')
        expect(email.html).toContain('Serapod Warehouse Balakong')
        expect(email.html).toContain('15 Jul 2026')
    })

    it('escapes the Posting Note, preserves its line break, and includes it in plain text', () => {
        const email = buildStockCountEmail(fixture, '12345678')
        expect(email.html).not.toContain('<Manager>')
        expect(email.html).toContain('&lt;Manager&gt;')
        expect(email.html).toContain('reconciliation<br>Approved')
        expect(email.text).toContain('Warehouse reconciliation\nApproved by <Manager>')
        expect(email.text).toContain('Your verification code: 12345678')
    })

    it('uses an em dash for a missing reference and formats positive adjustments without warning-loss styling', () => {
        const email = buildStockCountEmail({
            ...fixture,
            reference_name: '',
            net_quantity_adjustment: 25,
            estimated_adjustment_value: 1250.5,
            high_impact: false,
        }, '87654321')
        expect(email.text).toContain('Reference / batch: —')
        expect(email.text).toContain('Net quantity adjustment: +25')
        expect(email.text).toContain('Estimated adjustment value: RM 1,250.50')
        expect(email.html).not.toContain('High-impact adjustment')
    })

    it('uses the reference subject variant and rejects malformed codes', () => {
        expect(buildStockCountEmail({ ...fixture, reference_name: 'MONTH-END-07' }, '12345678').subject)
            .toBe('Serapod2U Stock Count Verification Code — MONTH-END-07')
        expect(() => buildStockCountEmail(fixture, '1234')).toThrow(/eight digits/)
    })
})
