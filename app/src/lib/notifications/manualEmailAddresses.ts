export interface ValidManualEmail {
    normalized: string
    original: string
}

export interface InvalidManualEmail {
    original: string
    reason: string
}

export interface ManualEmailParseResult {
    valid: ValidManualEmail[]
    invalid: InvalidManualEmail[]
    duplicatesRemoved: number
    totalEntered: number
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function splitManualEmailInput(input: string): string[] {
    return String(input || '').split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean)
}

export function normalizeManualEmail(raw: string): ValidManualEmail | InvalidManualEmail {
    const original = String(raw || '').trim()
    const normalized = original.toLowerCase()
    if (!original) return { original, reason: 'Empty value' }
    if (original.length > 254 || !EMAIL_PATTERN.test(normalized)) {
        return { original, reason: 'Invalid email address' }
    }
    return { normalized, original }
}

function isValid(value: ValidManualEmail | InvalidManualEmail): value is ValidManualEmail {
    return 'normalized' in value
}

export function parseManualEmailInput(input: string): ManualEmailParseResult {
    const entries = splitManualEmailInput(input)
    const seen = new Set<string>()
    const valid: ValidManualEmail[] = []
    const invalid: InvalidManualEmail[] = []
    let duplicatesRemoved = 0

    for (const entry of entries) {
        const result = normalizeManualEmail(entry)
        if (!isValid(result)) {
            invalid.push(result)
        } else if (seen.has(result.normalized)) {
            duplicatesRemoved += 1
        } else {
            seen.add(result.normalized)
            valid.push(result)
        }
    }
    return { valid, invalid, duplicatesRemoved, totalEntered: entries.length }
}

export function normalizeAndDedupeManualEmails(value: unknown): string[] {
    const input = Array.isArray(value) ? value.join('\n') : String(value || '')
    return parseManualEmailInput(input).valid.map((entry) => entry.normalized)
}
