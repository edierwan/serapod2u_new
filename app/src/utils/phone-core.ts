const E164_REGEX = /^\+[1-9]\d{7,14}$/

export type ParsedPhone = {
    input: unknown
    digits: string
    e164: string | null
    provider: string | null
    valid: boolean
    reason: string | null
}

function stripToDigits(value: unknown): string {
    return String(value || '').replace(/\D/g, '')
}

function buildErrorResult(input: unknown, reason: string): ParsedPhone {
    return {
        input,
        digits: '',
        e164: null,
        provider: null,
        valid: false,
        reason,
    }
}

export function parsePhone(
    input: unknown,
    options: { defaultCountryCode?: string; throwOnInvalid?: boolean } = {},
): ParsedPhone {
    const raw = String(input || '').trim()
    const defaultCountryCode = String(options.defaultCountryCode || '60')

    if (!raw) {
        return buildErrorResult(input, 'empty')
    }

    let digits = stripToDigits(raw)
    if (!digits) {
        return buildErrorResult(input, 'no_digits')
    }

    const hadInternationalPrefix = raw.startsWith('+') || raw.startsWith('00')
    if (raw.startsWith('00')) {
        digits = digits.slice(2)
    }

    if (!digits) {
        return buildErrorResult(input, 'no_digits')
    }

    if (!hadInternationalPrefix) {
        if (digits.startsWith('0')) {
            digits = `${defaultCountryCode}${digits.slice(1)}`
        } else if (defaultCountryCode === '60' && /^1\d{7,9}$/.test(digits)) {
            digits = `${defaultCountryCode}${digits}`
        } else if (!digits.startsWith(defaultCountryCode)) {
            digits = `${defaultCountryCode}${digits}`
        }
    }

    const e164 = `+${digits}`
    if (!E164_REGEX.test(e164)) {
        return buildErrorResult(input, 'invalid_e164')
    }

    return {
        input,
        digits,
        e164,
        provider: digits,
        valid: true,
        reason: null,
    }
}

export function normalizePhoneToE164(
    input: unknown,
    options: { defaultCountryCode?: string; throwOnInvalid?: boolean } = {},
): string | null {
    const parsed = parsePhone(input, options)
    if (!parsed.valid) {
        if (options.throwOnInvalid) {
            throw new Error(`Invalid phone number: ${parsed.reason}`)
        }
        return null
    }
    return parsed.e164
}

export function isValidE164Phone(input: unknown): boolean {
    return E164_REGEX.test(String(input || '').trim())
}

export function toProviderPhone(
    input: unknown,
    options: { defaultCountryCode?: string; throwOnInvalid?: boolean } = {},
): string | null {
    const parsed = parsePhone(input, options)
    if (!parsed.valid) {
        if (options.throwOnInvalid) {
            throw new Error(`Invalid phone number: ${parsed.reason}`)
        }
        return null
    }
    return parsed.provider
}

export function samePhone(
    left: unknown,
    right: unknown,
    options: { defaultCountryCode?: string } = {},
): boolean {
    const a = normalizePhoneToE164(left, options)
    const b = normalizePhoneToE164(right, options)
    return Boolean(a && b && a === b)
}

export function formatPhoneDisplay(
    input: unknown,
    options: { defaultCountryCode?: string } = {},
): string {
    const normalized = normalizePhoneToE164(input, options)
    if (!normalized) return ''

    if (normalized.startsWith('+60')) {
        const number = normalized.slice(3)
        if (number.length === 9) {
            return `+60 ${number.slice(0, 2)}-${number.slice(2, 5)} ${number.slice(5)}`
        }
        if (number.length === 10) {
            return `+60 ${number.slice(0, 2)}-${number.slice(2, 6)} ${number.slice(6)}`
        }
    }

    return normalized
}

export function jidToPhone(
    jid: unknown,
    options: { defaultCountryCode?: string } = {},
): string | null {
    if (!jid) return null
    const phone = String(jid).split('@')[0].split(':')[0]
    return normalizePhoneToE164(phone, options)
}

export function phoneToJid(
    input: unknown,
    options: { defaultCountryCode?: string; throwOnInvalid?: boolean } = {},
): string {
    const provider = toProviderPhone(input, options)
    if (!provider) return ''
    return `${provider}@s.whatsapp.net`
}

export function maskPhone(
    input: unknown,
    options: { defaultCountryCode?: string } = {},
): string {
    const normalized = normalizePhoneToE164(input, options)
    if (!normalized) return ''
    if (normalized.length < 8) return normalized
    const visible = 4
    return `${normalized.slice(0, normalized.length - visible - 3)}***${normalized.slice(-visible)}`
}