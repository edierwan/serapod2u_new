'use client'

import HrModulePage from '@/components/hr/HrModulePage'

export default function HrSettingsPermissionsView() {
    return (
        <HrModulePage
            title="HR Permissions"
            subtitle="Assign HR permissions by role or department."
            sections={[
                {
                    title: 'Role Permissions',
                    description: 'Map HR permissions to roles (Phase 2).',
                    actions: [{ label: 'Configure Roles' }]
                },
                {
                    title: 'Department Overrides',
                    description: 'Allow department-specific overrides.',
                    actions: [{ label: 'Configure Overrides' }]
                }
            ]}
        />
    )
}
