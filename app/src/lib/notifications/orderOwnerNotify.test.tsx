import { describe, expect, it } from 'vitest'
import {
    isSingleCreatorSource,
    ownerEmailFromPayload,
    ownerPhoneFromPayload,
    resolveRecipientTargets,
} from './orderOwnerNotify'

describe('recipient targets from notification settings', () => {
    it('defaults reject/approve/close to order creator only when the flag was never saved', () => {
        expect(resolveRecipientTargets('order_rejected', { recipient_targets: { roles: true } })).toEqual({
            order_creator: true,
            roles: false,
            dynamic_org: false,
            users: false,
            consumer: false,
        })
        expect(isSingleCreatorSource('order_rejected', {})).toBe(true)
    })

    it('honors the UI when Order creator and roles are saved explicitly', () => {
        expect(resolveRecipientTargets('order_rejected', {
            recipient_targets: { order_creator: true, roles: true },
        })).toEqual({
            order_creator: true,
            roles: true,
            dynamic_org: false,
            users: false,
            consumer: false,
        })
        expect(isSingleCreatorSource('order_rejected', {
            recipient_targets: { order_creator: true, roles: true },
        })).toBe(false)
    })

    it('does not force a creator on order submitted', () => {
        expect(resolveRecipientTargets('order_submitted', { recipient_targets: { roles: true } })).toEqual({
            order_creator: false,
            roles: true,
            dynamic_org: false,
            users: false,
            consumer: false,
        })
    })

    it('reads creator contact from payload only', () => {
        expect(ownerPhoneFromPayload({
            created_by_phone: '60192277233',
            customer_phone: '60111111111',
        })).toBe('60192277233')
        expect(ownerPhoneFromPayload({ customer_phone: '60111111111' })).toBeNull()
        expect(ownerEmailFromPayload({ created_by_email: 'owner@shop.test' })).toBe('owner@shop.test')
    })
})
