/**
 * Manual WhatsApp Numbers — parsing, normalization & validation.
 *
 * Stored format: digits-only WhatsApp-style international number (no plus sign).
 *   Malaysia:  60123456789
 *   China:     8613812345678
 *
 * Rules:
 *  - Strip spaces, dashes, brackets and a leading '+'.
 *  - If only digits remain after cleanup, treat as candidate; otherwise invalid.
 *  - Malaysia local 0XXXXXXXXX => 60XXXXXXXXX (drop leading 0, prefix 60).
 *  - Numbers already starting with a known country prefix kept as-is.
 *  - Reject letters, symbols-after-cleanup, too short (<8) or too long (>15).
 *  - Deduplicate (case-insensitive after normalize). Duplicates are reported separately.
 */

export type ManualPhoneCountry = 'Malaysia' | 'China' | 'International'

export interface ValidManualPhone {
    normalized: string
    country: ManualPhoneCountry
    original: string
}

export interface InvalidManualPhone {
    original: string
    reason: string
}

export interface ManualPhoneParseResult {
    valid: ValidManualPhone[]
    invalid: InvalidManualPhone[]
    duplicatesRemoved: number
    totalEntered: number
}

const SEPARATOR_REGEX = /[\s,;]+/

export function splitManualPhoneInput(input: string): string[] {
    if (!input) return []
    return String(input)
        .split(SEPARATOR_REGEX)
        .map((s) => s.trim())
        .filter(Boolean)
}

export function detectCountry(normalized: string): ManualPhoneCountry {
    if (normalized.startsWith('60')) return 'Malaysia'
    if (normalized.startsWith('86')) return 'China'
    return 'International'
}

/**
 * Normalize a single manual phone number entry.
 * Returns either a valid normalized record or an invalid reason.
 */
export function normalizeManualPhone(raw: string): ValidManualPhone | InvalidManualPhone {
    const original = String(raw || '').trim()
    if (!original) {
        return { original, reason: 'Empty value' }
    }

    // Reject obvious garbage with letters
    if (/[a-zA-Z]/.test(original)) {
        return { original, reason: 'Contains letters' }
    }

    // Strip allowed punctuation: spaces, dashes, brackets, leading +
    let cleaned = original
        .replace(/^\+/, '')
        .replace(/[\s\-()]/g, '')

    if (!/^\d+$/.test(cleaned)) {
        return { original, reason: 'Invalid characters' }
    }

    // Malaysia local form: starts with 0 and looks like 9-11 digits total
    if (cleaned.startsWith('0') && cleaned.length >= 9 && cleaned.length <= 11) {
        cleaned = '60' + cleaned.slice(1)
    }

    if (cleaned.length < 8) {
        return { original, reason: 'Invalid length (too short)' }
    }
    if (cleaned.length > 15) {
        return { original, reason: 'Invalid length (too long)' }
    }

    return {
        normalized: cleaned,
        country: detectCountry(cleaned),
        original,
    }
}

function isValid(p: ValidManualPhone | InvalidManualPhone): p is ValidManualPhone {
    return typeof (p as ValidManualPhone).normalized === 'string'
}

/**
 * Parse and validate a full input string (textarea / chips).
 * Performs dedupe across the valid set.
 */
export function parseManualPhoneInput(input: string): ManualPhoneParseResult {
    const entries = splitManualPhoneInput(input)
    const seen = new Set<string>()
    const valid: ValidManualPhone[] = []
    const invalid: InvalidManualPhone[] = []
    let duplicatesRemoved = 0

    for (const entry of entries) {
        const result = normalizeManualPhone(entry)
        if (isValid(result)) {
            if (seen.has(result.normalized)) {
                duplicatesRemoved++
                continue
            }
            seen.add(result.normalized)
            valid.push(result)
        } else {
            invalid.push(result)
        }
    }

    return {
        valid,
        invalid,
        duplicatesRemoved,
        totalEntered: entries.length,
    }
}

/**
 * Dedupe a pre-normalized list (used on the server).
 * Silently drops invalid entries.
 */
export function normalizeAndDedupeManualPhones(list: unknown): string[] {
    if (!Array.isArray(list)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of list) {
        const result = normalizeManualPhone(String(raw ?? ''))
        if (isValid(result) && !seen.has(result.normalized)) {
            seen.add(result.normalized)
            out.push(result.normalized)
        }
    }
    return out
}
