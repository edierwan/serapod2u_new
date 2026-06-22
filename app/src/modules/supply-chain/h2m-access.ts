export function isHqOrganization(orgType?: string | null) {
    return String(orgType || '').trim().toUpperCase() === 'HQ'
}

/** Role levels 1-40 are level 40 or higher privilege in this hierarchy. */
export function canCreateH2MOrder(orgType?: string | null, roleLevel?: number | null) {
    return isHqOrganization(orgType)
        && typeof roleLevel === 'number'
        && Number.isFinite(roleLevel)
        && roleLevel <= 40
}

export function canOpenOrderEditor(roleLevel?: number | null) {
    return typeof roleLevel === 'number'
        && Number.isFinite(roleLevel)
        && roleLevel <= 40
}
