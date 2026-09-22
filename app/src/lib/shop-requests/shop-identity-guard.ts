/**
 * Shop Identity / Duplicate Guard — single source of truth for self-service SHOP creation.
 *
 * Policy (phone/email are NOT unique shop identities — chains share HQ contacts):
 *   STRONG duplicate (hard block, no self-service override):
 *     equivalent address AND (same phone OR same email OR similar name + same state/branch)
 *   POSSIBLE existing outlet (requires explicit confirmDifferentOutlet):
 *     same phone or email with a different/unknown address, an equivalent address with
 *     an unrelated name, or an identical name in the same branch/state with no address to compare
 *   NAME suggestion (requires the existing generic confirmCreate):
 *     similar name only
 *
 * Address equivalence is deliberately conservative: formatting noise (case, commas,
 * line breaks, spacing, common street abbreviations) is ignored, but every number/unit
 * token must match exactly, so "No 35 Jalan A" never equals "No 53 Jalan A".
 */
import { maskEmail } from '@/lib/auth/registration-otp-email'
import { formatPhoneDisplay, normalizePhoneE164 } from '@/utils/phone'
import { sanitizeShopRequestForm, type ShopRequestFormInput } from './core'

export type ShopMatchReason = 'phone' | 'email' | 'address' | 'name'

export interface ShopIdentityCandidateRow {
    id: string
    org_name: string
    branch?: string | null
    address?: string | null
    contact_phone?: string | null
    contact_email?: string | null
    states?: { state_name?: string | null } | null
}

export interface ShopIdentityMatch {
    org_id: string
    org_name: string
    branch: string | null
    state_name: string | null
    address: string | null
    contact_phone: string | null
    contact_email: string | null
    match_reasons: ShopMatchReason[]
}

export interface ShopIdentityAssessment {
    strongConflicts: ShopIdentityMatch[]
    outletCandidates: ShopIdentityMatch[]
    nameSuggestions: ShopIdentityMatch[]
    requiresDifferentOutletConfirmation: boolean
    requiresSimilarNameConfirmation: boolean
}

export interface ShopIdentityConfirmations {
    /** User explicitly stated "This is a different outlet / branch". */
    confirmDifferentOutlet?: boolean
    /** User dismissed the similar-name suggestions ("None of these"). */
    confirmSimilarName?: boolean
}

export const SHOP_DUPLICATE_BLOCKED_CODE = 'SHOP_DUPLICATE_BLOCKED'
export const SHOP_DIFFERENT_OUTLET_CONFIRMATION_CODE = 'SHOP_DIFFERENT_OUTLET_CONFIRMATION_REQUIRED'
export const SHOP_SIMILAR_NAME_WARNING_CODE = 'SHOP_SIMILAR_NAME_WARNING'

export const SHOP_DUPLICATE_BLOCKED_MESSAGE =
    'We found an existing shop that appears to be the same outlet. Please select the existing shop instead of creating another one.'
export const SHOP_DIFFERENT_OUTLET_MESSAGE =
    'We found other outlets using the same phone, email or address. Please confirm this is a different outlet / branch.'
export const SHOP_SIMILAR_NAME_MESSAGE = 'Similar shops already exist. Please confirm creation.'

export type ShopCreationDecision =
    | { allowed: true }
    | {
        allowed: false
        status: 409
        body: {
            success: false
            code: string
            error: string
            duplicates: ShopIdentityMatch[]
            duplicateBlocked?: true
            requiresDifferentOutletConfirmation?: true
            duplicateWarning?: true
            nameSuggestions?: ShopIdentityMatch[]
        }
    }

export class ShopIdentityConflictError extends Error {
    readonly decision: Extract<ShopCreationDecision, { allowed: false }>

    constructor(decision: Extract<ShopCreationDecision, { allowed: false }>) {
        super(decision.body.error)
        this.name = 'ShopIdentityConflictError'
        this.decision = decision
    }
}

export function isShopIdentityConflictError(error: unknown): error is ShopIdentityConflictError {
    return error instanceof ShopIdentityConflictError
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function foldText(value?: string | null) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
}

export function normalizeShopPhone(value?: string | null): string {
    const raw = String(value || '').trim()
    return raw ? normalizePhoneE164(raw) : ''
}

export function normalizeShopEmail(value?: string | null): string {
    return String(value || '').trim().toLowerCase()
}

export function normalizeShopNameKey(value?: string | null): string {
    return foldText(value)
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function compactShopNameKey(value?: string | null) {
    return normalizeShopNameKey(value).replace(/\s+/g, '')
}

function normalizeLooseLabel(value?: string | null) {
    return normalizeShopNameKey(value)
}

// Token-level expansions only; never touches number/unit tokens.
const ADDRESS_TOKEN_EXPANSIONS: Record<string, string> = {
    jln: 'jalan',
    jl: 'jalan',
    tmn: 'taman',
    lrg: 'lorong',
    kg: 'kampung',
    kpg: 'kampung',
    kampong: 'kampung',
    bdr: 'bandar',
    psn: 'persiaran',
    lbh: 'lebuh',
    lbhraya: 'lebuhraya',
    sek: 'seksyen',
    st: 'street',
    rd: 'road',
}

export function normalizeShopAddressKey(value?: string | null): string {
    const cleaned = foldText(value)
        // Anything that is not a letter/digit/unit separator becomes whitespace
        // (commas, periods, line breaks, #, parentheses, etc.)
        .replace(/[^a-z0-9/\-]+/g, ' ')
        // Unit separators are kept (they distinguish "3-1" from "3-2"); spacing
        // around a digit-digit separator is ignored ("3 - 1" == "3-1").
        .replace(/(\d)\s*([/\-])\s*(?=\d)/g, '$1$2')
        .replace(/([a-z])[/\-](?=[a-z])/g, '$1 ')
        .replace(/(^|\s)[/\-]+|[/\-]+(?=\s|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    if (!cleaned) return ''

    const tokens = cleaned.split(' ').map((token) => ADDRESS_TOKEN_EXPANSIONS[token] || token)
    const result: string[] = []
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]
        const next = tokens[index + 1]
        // "No 35" / "No. 35" → "35"
        if (token === 'no' && next && /\d/.test(next)) continue
        result.push(token)
    }
    if (result.length > 1 && result[result.length - 1] === 'malaysia') {
        result.pop()
    }

    return result.join(' ')
}

/**
 * Conservative physical-address equivalence. Requires a meaningful address
 * (at least two tokens and at least one number) so that vague locality-only
 * text like "Kepala Batas" never counts as the same outlet.
 */
export function shopAddressesEquivalent(left?: string | null, right?: string | null): boolean {
    const a = normalizeShopAddressKey(left)
    const b = normalizeShopAddressKey(right)
    if (!a || !b || a !== b) return false
    return a.split(' ').length >= 2 && /\d/.test(a)
}

function bigrams(value: string) {
    const grams: string[] = []
    for (let index = 0; index < value.length - 1; index += 1) {
        grams.push(value.slice(index, index + 2))
    }
    return grams
}

function diceCoefficient(left: string, right: string) {
    if (left === right) return 1
    if (left.length < 2 || right.length < 2) return 0
    const leftGrams = bigrams(left)
    const rightCounts = new Map<string, number>()
    for (const gram of bigrams(right)) rightCounts.set(gram, (rightCounts.get(gram) || 0) + 1)
    let overlap = 0
    for (const gram of leftGrams) {
        const count = rightCounts.get(gram) || 0
        if (count > 0) {
            overlap += 1
            rightCounts.set(gram, count - 1)
        }
    }
    return (2 * overlap) / (leftGrams.length + right.length - 1)
}

/**
 * Name similarity used only as supporting evidence / suggestions — never as a
 * hard identity on its own. Also compares "name + branch" so "Vaporworld" with
 * branch "Kepala Batas" lines up with "Vapor Word (Kepala Batas)".
 */
export function shopNamesSimilar(
    left: { name?: string | null; branch?: string | null },
    right: { name?: string | null; branch?: string | null },
): boolean {
    const leftVariants = [compactShopNameKey(left.name), compactShopNameKey(`${left.name || ''} ${left.branch || ''}`)]
    const rightVariants = [compactShopNameKey(right.name), compactShopNameKey(`${right.name || ''} ${right.branch || ''}`)]

    for (const a of leftVariants) {
        for (const b of rightVariants) {
            if (!a || !b) continue
            if (a === b) return true
            const shorter = a.length <= b.length ? a : b
            const longer = a.length <= b.length ? b : a
            if (shorter.length >= 6 && longer.startsWith(shorter)) return true
            if (diceCoefficient(a, b) >= 0.8) return true
        }
    }
    return false
}

// ---------------------------------------------------------------------------
// Classification (pure)
// ---------------------------------------------------------------------------

/**
 * Response shape for a candidate. These responses reach unauthenticated QR users, so:
 *  - phone/email are shown in full only when the requester typed that same value,
 *    otherwise masked to country code + last 4 digits ("+60*****9818") / "ta***@gmail.com";
 *  - name-only suggestions carry no address or contact details at all (the public
 *    /api/shops/search exposes only name/branch/state and a masked phone);
 *  - strong/outlet candidates include the address so the user can recognise the outlet.
 */
/** Strong public phone mask: country code + last 4 digits only, e.g. "+60*****9818". */
export function maskShopContactPhone(phone?: string | null) {
    const e164 = normalizeShopPhone(phone)
    if (!e164 || e164.length < 8) return '***'
    return `${e164.slice(0, 3)}*****${e164.slice(-4)}`
}

function toMatch(
    row: ShopIdentityCandidateRow,
    reasons: ShopMatchReason[],
    kind: 'strong' | 'outlet' | 'name',
): ShopIdentityMatch {
    const phoneMatched = reasons.includes('phone')
    const emailMatched = reasons.includes('email')
    const phone = String(row.contact_phone || '').trim()
    const email = normalizeShopEmail(row.contact_email)
    const nameOnly = kind === 'name'

    return {
        org_id: row.id,
        org_name: row.org_name,
        branch: row.branch || null,
        state_name: row.states?.state_name || null,
        address: nameOnly ? null : row.address || null,
        contact_phone: nameOnly || !phone ? null : phoneMatched ? formatPhoneDisplay(phone) || phone : maskShopContactPhone(phone),
        contact_email: nameOnly || !email ? null : emailMatched ? email : maskEmail(email),
        match_reasons: reasons,
    }
}

export function classifyShopIdentityCandidates(
    input: ShopRequestFormInput,
    rows: ShopIdentityCandidateRow[],
    options: { nameSuggestionIds?: Iterable<string> } = {},
): ShopIdentityAssessment {
    const form = sanitizeShopRequestForm(input)
    const formPhone = normalizeShopPhone(form.contactPhone)
    const formEmail = normalizeShopEmail(form.contactEmail)
    const formNameKey = normalizeShopNameKey(form.shopName)
    const formState = normalizeLooseLabel(form.state)
    const formBranch = normalizeLooseLabel(form.branch)
    const formAddressKey = normalizeShopAddressKey(form.address)
    const prefixSuggestionIds = new Set(options.nameSuggestionIds || [])

    const strongConflicts: ShopIdentityMatch[] = []
    const outletCandidates: ShopIdentityMatch[] = []
    const nameSuggestions: ShopIdentityMatch[] = []
    const seen = new Set<string>()

    for (const row of rows) {
        if (!row?.id || seen.has(row.id)) continue
        seen.add(row.id)

        const rowState = normalizeLooseLabel(row.states?.state_name)
        const rowBranch = normalizeLooseLabel(row.branch)
        const phoneMatch = Boolean(formPhone) && normalizeShopPhone(row.contact_phone) === formPhone
        const emailMatch = Boolean(formEmail) && normalizeShopEmail(row.contact_email) === formEmail
        const addressMatch = shopAddressesEquivalent(form.address, row.address)
        const bothHaveAddress = Boolean(formAddressKey) && Boolean(normalizeShopAddressKey(row.address))
        const nameSimilar = shopNamesSimilar(
            { name: form.shopName, branch: form.branch },
            { name: row.org_name, branch: row.branch },
        )
        const nameExact = Boolean(formNameKey) && normalizeShopNameKey(row.org_name) === formNameKey
        const stateMatch = Boolean(formState) && formState === rowState
        const branchMatch = Boolean(formBranch) && formBranch === rowBranch

        const reasons: ShopMatchReason[] = []
        if (phoneMatch) reasons.push('phone')
        if (emailMatch) reasons.push('email')
        if (addressMatch) reasons.push('address')
        if (nameSimilar || nameExact) reasons.push('name')

        const isStrong = addressMatch && (phoneMatch || emailMatch || (nameSimilar && (stateMatch || branchMatch)))
        if (isStrong) {
            strongConflicts.push(toMatch(row, reasons, 'strong'))
            continue
        }

        const branchCompatible = !formBranch || !rowBranch || branchMatch
        const sameNameSameArea = nameExact && !bothHaveAddress && branchCompatible && (branchMatch || stateMatch)
        if (phoneMatch || emailMatch || addressMatch || sameNameSameArea) {
            outletCandidates.push(toMatch(row, reasons, 'outlet'))
            continue
        }

        if (nameSimilar || nameExact || prefixSuggestionIds.has(row.id)) {
            nameSuggestions.push(toMatch(row, reasons.length ? reasons : ['name'], 'name'))
        }
    }

    return {
        strongConflicts,
        outletCandidates,
        nameSuggestions,
        requiresDifferentOutletConfirmation: outletCandidates.length > 0,
        requiresSimilarNameConfirmation: nameSuggestions.length > 0,
    }
}

/**
 * Single decision point shared by every self-service creation path.
 * A strong conflict has no self-service override.
 */
export function decideShopCreation(
    assessment: ShopIdentityAssessment,
    confirmations: ShopIdentityConfirmations = {},
): ShopCreationDecision {
    if (assessment.strongConflicts.length > 0) {
        return {
            allowed: false,
            status: 409,
            body: {
                success: false,
                code: SHOP_DUPLICATE_BLOCKED_CODE,
                duplicateBlocked: true,
                duplicates: assessment.strongConflicts,
                error: SHOP_DUPLICATE_BLOCKED_MESSAGE,
            },
        }
    }

    const confirmedDifferentOutlet = confirmations.confirmDifferentOutlet === true
    if (assessment.requiresDifferentOutletConfirmation && !confirmedDifferentOutlet) {
        return {
            allowed: false,
            status: 409,
            body: {
                success: false,
                code: SHOP_DIFFERENT_OUTLET_CONFIRMATION_CODE,
                requiresDifferentOutletConfirmation: true,
                duplicates: assessment.outletCandidates,
                nameSuggestions: assessment.nameSuggestions,
                error: SHOP_DIFFERENT_OUTLET_MESSAGE,
            },
        }
    }

    // Confirming "different outlet" also acknowledges the similar-name list shown alongside it.
    const confirmedSimilarName = confirmations.confirmSimilarName === true || confirmedDifferentOutlet
    if (assessment.requiresSimilarNameConfirmation && !confirmedSimilarName) {
        return {
            allowed: false,
            status: 409,
            body: {
                success: false,
                code: SHOP_SIMILAR_NAME_WARNING_CODE,
                duplicateWarning: true,
                duplicates: assessment.nameSuggestions,
                error: SHOP_SIMILAR_NAME_MESSAGE,
            },
        }
    }

    return { allowed: true }
}

// ---------------------------------------------------------------------------
// Candidate lookup (DB)
// ---------------------------------------------------------------------------

const CANDIDATE_SELECT = 'id, org_name, branch, address, contact_phone, contact_email, states(state_name)'
const GENERIC_ADDRESS_TOKENS = new Set([
    'jalan', 'taman', 'lorong', 'kampung', 'bandar', 'persiaran', 'lebuh', 'seksyen', 'street', 'road',
    'lot', 'unit', 'blok', 'block', 'tingkat', 'floor', 'ground', 'pulau', 'pinang', 'kuala', 'lumpur',
    'selangor', 'johor', 'perak', 'kedah', 'sabah', 'sarawak', 'melaka', 'pahang', 'kelantan', 'terengganu',
    'perlis', 'negeri', 'sembilan', 'wilayah', 'persekutuan', 'malaysia', 'batu', 'bukit', 'sungai',
])

function escapeLikePattern(value: string) {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function phoneLookupVariants(phone: string) {
    const e164 = normalizeShopPhone(phone)
    if (!e164) return []
    const digits = e164.replace(/^\+/, '')
    const variants = new Set([e164, digits])
    if (digits.startsWith('60')) variants.add(`0${digits.slice(2)}`)
    return Array.from(variants)
}

export function pickAddressSearchToken(address?: string | null): string | null {
    const key = normalizeShopAddressKey(address)
    if (!key) return null
    const postcode = key.match(/(?:^|\s)(\d{5})(?=\s|$)/)
    if (postcode) return postcode[1]
    const tokens = key
        .split(' ')
        .filter((token) => token.length >= 4 && !/^\d+$/.test(token) && !GENERIC_ADDRESS_TOKENS.has(token))
        .sort((a, b) => b.length - a.length)
    return tokens[0] || null
}

function activeShopQuery(adminClient: any) {
    return adminClient
        .from('organizations')
        .select(CANDIDATE_SELECT)
        .eq('org_type_code', 'SHOP')
        .eq('is_active', true)
}

async function runCandidateQuery(query: PromiseLike<{ data: any[] | null; error: any }>) {
    const { data, error } = await query
    if (error) {
        throw new Error(`Shop duplicate check failed: ${error.message || 'unknown error'}`)
    }
    return (data || []) as ShopIdentityCandidateRow[]
}

export async function findShopIdentityCandidates(adminClient: any, form: ShopRequestFormInput) {
    const phoneVariants = phoneLookupVariants(form.contactPhone || '')
    const email = normalizeShopEmail(form.contactEmail)
    const shopName = String(form.shopName || '').trim()
    const addressToken = pickAddressSearchToken(form.address)

    const [byPhone, byEmail, byName, byAddress] = await Promise.all([
        phoneVariants.length
            ? runCandidateQuery(activeShopQuery(adminClient).in('contact_phone', phoneVariants).limit(100))
            : Promise.resolve([]),
        email
            ? runCandidateQuery(activeShopQuery(adminClient).ilike('contact_email', escapeLikePattern(email)).limit(100))
            : Promise.resolve([]),
        shopName
            ? runCandidateQuery(activeShopQuery(adminClient).ilike('org_name', `${escapeLikePattern(shopName)}%`).limit(5))
            : Promise.resolve([]),
        addressToken
            ? runCandidateQuery(activeShopQuery(adminClient).ilike('address', `%${escapeLikePattern(addressToken)}%`).limit(200))
            : Promise.resolve([]),
    ])

    return {
        rows: [...byPhone, ...byEmail, ...byName, ...byAddress],
        nameSuggestionIds: byName.map((row) => row.id),
    }
}

export async function assessShopIdentity(
    adminClient: any,
    input: ShopRequestFormInput,
): Promise<ShopIdentityAssessment> {
    const form = sanitizeShopRequestForm(input)
    const { rows, nameSuggestionIds } = await findShopIdentityCandidates(adminClient, form)
    return classifyShopIdentityCandidates(form, rows, { nameSuggestionIds })
}

/** Assess + decide in one call. Throws ShopIdentityConflictError when creation must not proceed. */
export async function assertShopCreationAllowed(
    adminClient: any,
    input: ShopRequestFormInput,
    confirmations: ShopIdentityConfirmations = {},
) {
    const assessment = await assessShopIdentity(adminClient, input)
    const decision = decideShopCreation(assessment, confirmations)
    if (!decision.allowed) {
        throw new ShopIdentityConflictError(decision)
    }
    return assessment
}
