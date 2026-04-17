import { normalizePhone, toTitleCaseWords, validatePhoneNumber } from '@/lib/utils'
import { EMAIL_REGEX } from '@/lib/utils/orgValidation'

export interface ShopRequestFormInput {
    shopName: string
    branch?: string | null
    contactName?: string | null
    contactPhone?: string | null
    contactEmail?: string | null
    address?: string | null
    state?: string | null
    hotFlavourBrands?: string | null
    sellsSerapodFlavour?: boolean
    sellsSbox?: boolean
    sellsSboxSpecialEdition?: boolean
    notes?: string | null
}

export interface ShopRequestRecord extends ShopRequestFormInput {
    id: string
    parentOrgId?: string | null
    requesterName?: string | null
    requesterPhone?: string | null
    reviewNotes?: string | null
}

export interface ShopRequestValidationResult {
    valid: boolean
    errors: string[]
}

export function buildPendingShopRequestInsert(input: {
    notificationOrgId?: string | null
    parentOrgId?: string | null
    requesterUserId: string
    requesterName?: string | null
    requesterPhone?: string | null
    form: ShopRequestFormInput
}) {
    const form = sanitizeShopRequestForm(input.form)

    return {
        notification_org_id: input.notificationOrgId || null,
        requested_parent_org_id: input.parentOrgId || null,
        requester_user_id: input.requesterUserId,
        requester_name: cleanText(input.requesterName),
        requester_phone: cleanText(input.requesterPhone),
        requested_org_type_code: 'SHOP',
        requested_shop_name: form.shopName,
        requested_branch: form.branch || null,
        requested_contact_name: form.contactName || null,
        requested_contact_phone: form.contactPhone || null,
        requested_contact_email: form.contactEmail || null,
        requested_address: form.address || null,
        requested_state: form.state || null,
        requested_hot_flavour_brands: form.hotFlavourBrands || null,
        requested_sells_serapod_flavour: form.sellsSerapodFlavour,
        requested_sells_sbox: form.sellsSbox,
        requested_sells_sbox_special_edition: form.sellsSboxSpecialEdition,
        notes: form.notes || null,
        status: 'pending' as const,
    }
}

function cleanText(value?: string | null): string | null {
    const normalized = String(value || '').trim()
    return normalized ? normalized : null
}

function cleanTitleCase(value?: string | null): string | null {
    const normalized = cleanText(value)
    return normalized ? toTitleCaseWords(normalized) : null
}

function cleanUppercaseEmail(value?: string | null): string | null {
    const normalized = cleanText(value)
    return normalized ? normalized.toLowerCase() : null
}

function cleanBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
        return value.trim().toLowerCase() === 'true'
    }
    return false
}

export function sanitizeShopRequestForm(input: ShopRequestFormInput): ShopRequestFormInput {
    return {
        shopName: cleanTitleCase(input.shopName) || '',
        branch: cleanTitleCase(input.branch),
        contactName: cleanTitleCase(input.contactName),
        contactPhone: cleanText(input.contactPhone) ? normalizePhone(String(input.contactPhone)) : null,
        contactEmail: cleanUppercaseEmail(input.contactEmail),
        address: cleanTitleCase(input.address),
        state: cleanTitleCase(input.state),
        hotFlavourBrands: cleanTitleCase(input.hotFlavourBrands),
        sellsSerapodFlavour: cleanBoolean(input.sellsSerapodFlavour),
        sellsSbox: cleanBoolean(input.sellsSbox),
        sellsSboxSpecialEdition: cleanBoolean(input.sellsSboxSpecialEdition),
        notes: cleanText(input.notes),
    }
}

export function validateShopRequestForm(input: ShopRequestFormInput): ShopRequestValidationResult {
    const form = sanitizeShopRequestForm(input)
    const errors: string[] = []

    if (!form.shopName) {
        errors.push('Shop name is required.')
    }

    if (!form.contactName) {
        errors.push('Contact name is required.')
    }

    if (!form.contactPhone) {
        errors.push('Contact phone is required.')
    } else {
        const validation = validatePhoneNumber(form.contactPhone)
        if (!validation.isValid) {
            errors.push(validation.error || 'Contact phone is invalid.')
        }
    }

    if (form.contactEmail && !EMAIL_REGEX.test(form.contactEmail)) {
        errors.push('Contact email is invalid.')
    }

    return {
        valid: errors.length === 0,
        errors,
    }
}

export function buildShopOrgCode(seed = Date.now(), randomSuffix = Math.floor(Math.random() * 900) + 100): string {
    return `SH${String(seed).slice(-6)}${String(randomSuffix)}`
}

export function buildShopRequestTemplateValues(request: ShopRequestRecord) {
    return {
        requester_name: request.requesterName || 'Unknown requester',
        requester_phone: request.requesterPhone || '-',
        shop_name: request.shopName,
        branch: request.branch || '-',
        state: request.state || '-',
        contact_name: request.contactName || '-',
        contact_phone: request.contactPhone || '-',
        contact_email: request.contactEmail || '-',
        address: request.address || '-',
        hot_flavour_brands: request.hotFlavourBrands || '-',
        sells_serapod_flavour: request.sellsSerapodFlavour ? 'Ya' : 'Tidak',
        sells_sbox: request.sellsSbox ? 'Ya' : 'Tidak',
        sells_sbox_special_edition: request.sellsSboxSpecialEdition ? 'Ya' : 'Tidak',
        notes: request.notes || '-',
        review_notes: request.reviewNotes || '-',
    }
}

export function applyShopRequestTemplate(template: string, values: Record<string, string>) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] ?? '')
}

export function buildApprovedShopOrganization(input: {
    request: ShopRequestRecord
    parentOrgId?: string | null
    stateId?: string | null
    createdBy: string
}) {
    return {
        org_code: buildShopOrgCode(),
        org_name: input.request.shopName,
        org_type_code: 'SHOP',
        parent_org_id: input.parentOrgId || null,
        branch: input.request.branch || null,
        contact_name: input.request.contactName || null,
        contact_phone: input.request.contactPhone || null,
        contact_email: input.request.contactEmail || null,
        address: input.request.address || null,
        state_id: input.stateId || null,
        hot_flavour_brands: input.request.hotFlavourBrands || null,
        sells_serapod_flavour: input.request.sellsSerapodFlavour ?? false,
        sells_sbox: input.request.sellsSbox ?? false,
        sells_sbox_special_edition: input.request.sellsSboxSpecialEdition ?? false,
        is_active: true,
        created_by: input.createdBy,
        updated_by: input.createdBy,
    }
}