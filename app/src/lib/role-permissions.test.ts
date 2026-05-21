import { describe, expect, it } from 'vitest'

import {
    buildDefaultPermissionMap,
    normalizeRolePermissions,
    resolveRoleLevel,
} from './role-permissions'

describe('role-permissions', () => {
    it('includes reset-password access for admin defaults', () => {
        const permissions = buildDefaultPermissionMap(10)

        expect(permissions.reset_passwords).toBe(true)
    })

    it('keeps default admin permissions when DB payload is partial', () => {
        const permissions = normalizeRolePermissions(10, {
            view_dashboard: true,
            manage_notifications: true,
        })

        expect(permissions.view_users).toBe(true)
        expect(permissions.manage_org_chart).toBe(true)
    })

    it('keeps explicit DB denials over default admin permissions', () => {
        const permissions = normalizeRolePermissions(10, {
            view_users: false,
        })

        expect(permissions.view_users).toBe(false)
    })

    it('resolves known admin role-code aliases when role level is missing', () => {
        expect(resolveRoleLevel(undefined, 'hq_admin')).toBe(10)
        expect(resolveRoleLevel(undefined, 'admin')).toBe(10)
        expect(resolveRoleLevel(undefined, 'sa')).toBe(1)
    })

    it('builds default permissions for standard users', () => {
        const permissions = buildDefaultPermissionMap(50)

        expect(permissions.view_dashboard).toBe(true)
        expect(permissions.view_users).toBeUndefined()
    })
})