import { describe, expect, it } from 'vitest'

import {
    formatPhoneDisplay,
    isValidMalaysianPhone,
    jidToPhone,
    maskPhone,
    normalizePhoneE164,
    phoneToJid,
    phonesEqual,
    toProviderPhone,
} from './phone'
import { normalizePhone, validateMalaysianMobileNumber, validatePhoneNumber } from '@/lib/utils'

describe('phone normalization', () => {
    it('normalizes local and provider inputs to canonical E.164', () => {
        expect(normalizePhoneE164('012-345 6789')).toBe('+60123456789')
        expect(normalizePhoneE164('60123456789')).toBe('+60123456789')
        expect(normalizePhoneE164('+60123456789')).toBe('+60123456789')
        expect(normalizePhone('012-345 6789')).toBe('+60123456789')
    })

    it('converts to provider format only at the adapter boundary', () => {
        expect(toProviderPhone('+60123456789')).toBe('60123456789')
        expect(toProviderPhone('0123456789')).toBe('60123456789')
        expect(phoneToJid('+60123456789')).toBe('60123456789@s.whatsapp.net')
        expect(jidToPhone('60123456789@s.whatsapp.net')).toBe('+60123456789')
    })

    it('treats equivalent phone inputs as the same user reference', () => {
        expect(phonesEqual('+60123456789', '0123456789')).toBe(true)
        expect(phonesEqual('60123456789', '+60123456789')).toBe(true)
        expect(phonesEqual('+60123456789', '+60123456780')).toBe(false)
    })

    it('formats and masks canonical phones consistently', () => {
        expect(formatPhoneDisplay('+60123456789')).toBe('+60 12-345 6789')
        expect(maskPhone('+60123456789')).toBe('+6012***6789')
    })

    it('rejects invalid phone values', () => {
        expect(normalizePhoneE164('abc')).toBe('')
        expect(toProviderPhone('abc')).toBeNull()
        expect(validatePhoneNumber('abc')).toEqual({
            isValid: false,
            error: 'Phone number is required',
        })
        expect(validatePhoneNumber('0123456789')).toEqual({
            isValid: true,
            formatted: '+60123456789',
        })
    })

    it('accepts only Malaysia mobile numbers for shop contact verification', () => {
        expect(isValidMalaysianPhone('0123456789')).toBe(true)
        expect(isValidMalaysianPhone('+60123456789')).toBe(true)
        expect(isValidMalaysianPhone('+60312345678')).toBe(false)
        expect(isValidMalaysianPhone('+60912345678')).toBe(false)
        expect(validateMalaysianMobileNumber('03-1234 5678')).toEqual({
            isValid: false,
            error: 'Please enter a valid Malaysia mobile number.',
        })
    })
})