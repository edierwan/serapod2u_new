export interface ShopRequestFormInput {
    shopName: string
    branch?: string | null
    contactName?: string | null
    contactPhone?: string | null
    address?: string | null
    state?: string | null
    notes?: string | null
}

export interface ShopRequestRecord extends ShopRequestFormInput {
    id: string
    requesterName?: string | null
    requesterPhone?: string | null
    reviewNotes?: string | null
}

export function buildPendingShopRequestInsert(input: {
    notificationOrgId?: string | null
    requesterUserId: string
    requesterName?: string | null
    requesterPhone?: string | null
    form: ShopRequestFormInput
}) {
    const form = sanitizeShopRequestForm(input.form)

    return {
        notification_org_id: input.notificationOrgId || null,
        requester_user_id: input.requesterUserId,
        requester_name: cleanText(input.requesterName),
        requester_phone: cleanText(input.requesterPhone),
        requested_shop_name: form.shopName,
        requested_branch: form.branch || null,
        requested_contact_name: form.contactName || null,
        requested_contact_phone: form.contactPhone || null,
        requested_address: form.address || null,
        requested_state: form.state || null,
        notes: form.notes || null,
        status: 'pending' as const,
    }
}

function cleanText(value?: string | null): string | null {
    const normalized = String(value || '').trim()
    return normalized ? normalized : null
}

export function sanitizeShopRequestForm(input: ShopRequestFormInput): ShopRequestFormInput {
    return {
        shopName: String(input.shopName || '').trim(),
        branch: cleanText(input.branch),
        contactName: cleanText(input.contactName),
        contactPhone: cleanText(input.contactPhone),
        address: cleanText(input.address),
        state: cleanText(input.state),
        notes: cleanText(input.notes),
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
        address: request.address || '-',
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
        address: input.request.address || null,
        state_id: input.stateId || null,
        is_active: true,
        created_by: input.createdBy,
        updated_by: input.createdBy,
    }
}