export const DEFAULT_NOTIFICATION_ADMIN_ROLE = 'HQ_ADMIN'

const ROLE_ALIAS_GROUPS: string[][] = [
    ['SUPER', 'SUPER_ADMIN', 'SA', 'super_admin'],
    ['HQ_ADMIN', 'HQ', 'ADMIN', 'admin', 'hq_admin', 'admin_hq'],
    ['POWER_USER', 'POWER'],
    ['DIST_ADMIN', 'DIST', 'DISTRIBUTOR'],
    ['WH_MANAGER', 'WH', 'WAREHOUSE'],
    ['MANU_ADMIN', 'MANUFACTURER', 'MFG', 'MFR'],
    ['USER', 'STAFF'],
]

export function expandNotificationRoleCodes(input: Array<string | null | undefined>): string[] {
    const expanded = new Set<string>()

    for (const rawValue of input) {
        const value = String(rawValue || '').trim()
        if (!value) continue

        const upperValue = value.toUpperCase()
        const aliasGroup = ROLE_ALIAS_GROUPS.find((group) =>
            group.some((alias) => alias.toUpperCase() === upperValue)
        )

        if (aliasGroup) {
            for (const alias of aliasGroup) {
                expanded.add(alias)
            }
            continue
        }

        expanded.add(value)
    }

    return Array.from(expanded)
}