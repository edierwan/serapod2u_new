import { describe, expect, it } from 'vitest'
import {
    extractEmailBody,
    extractEmailReceiver,
    extractEmailSubject,
    formatNotificationAction,
    overlayEmailStatusForFailedProvider,
    toEmailMonitorStatus,
} from './emailActivity'

describe('emailActivity', () => {
    it('maps provider statuses to monitor statuses', () => {
        expect(toEmailMonitorStatus('queued')).toBe('pending')
        expect(toEmailMonitorStatus('processing')).toBe('pending')
        expect(toEmailMonitorStatus('sent')).toBe('sent')
        expect(toEmailMonitorStatus('delivered')).toBe('delivered')
        expect(toEmailMonitorStatus('failed')).toBe('failed')
        expect(toEmailMonitorStatus('bounced')).toBe('failed')
        expect(toEmailMonitorStatus('cancelled')).toBe('failed')
    })

    it('formats the action that generated the email', () => {
        expect(formatNotificationAction('order_rejected')).toBe('Order rejected')
        expect(formatNotificationAction('delete_user_otp')).toBe('User deletion OTP')
        expect(formatNotificationAction('custom_event_code')).toBe('custom event code')
        expect(formatNotificationAction(null)).toBe('-')
    })

    it('reads receiver from outbox and log fields', () => {
        expect(extractEmailReceiver({ to_email: 'owner@shop.test' })).toBe('owner@shop.test')
        expect(extractEmailReceiver({ recipient_value: 'log@shop.test' })).toBe('log@shop.test')
        expect(extractEmailReceiver('direct@shop.test', { to_email: 'ignored@shop.test' })).toBe('direct@shop.test')
        expect(extractEmailReceiver({ created_by_email: 'creator@shop.test' })).toBe('creator@shop.test')
    })

    it('reads subject and body from payload', () => {
        expect(extractEmailSubject({ subject: 'Order rejected' }, 'order_rejected')).toBe('Order rejected')
        expect(extractEmailSubject({}, 'order_approved')).toBe('Serapod2U notification: Order approved')
        expect(extractEmailBody({ _email_body: 'Hello', message: 'ignored' })).toBe('Hello')
    })

    it('shows failed when the provider UI test failed around send time', () => {
        expect(overlayEmailStatusForFailedProvider({
            status: 'sent',
            sentAt: '2026-08-31T03:42:01.000Z',
            lastTestAt: '2026-08-31T03:43:55.000Z',
            providerBlockError: 'Email provider last test failed: self-signed certificate',
        })).toEqual({
            status: 'failed',
            errorMessage: 'Email provider last test failed: self-signed certificate',
        })
        expect(overlayEmailStatusForFailedProvider({
            status: 'sent',
            sentAt: '2026-07-14T04:40:03.000Z',
            lastTestAt: '2026-08-31T03:43:55.000Z',
            providerBlockError: 'Email provider last test failed: self-signed certificate',
        }).status).toBe('sent')
    })
})
