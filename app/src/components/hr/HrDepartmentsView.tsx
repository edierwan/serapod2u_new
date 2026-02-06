'use client'

import DepartmentsTab from '@/components/settings/DepartmentsTab'
import { usePermissions } from '@/hooks/usePermissions'

interface HrDepartmentsViewProps {
    userProfile: {
        organizations: { id: string }
        roles: { role_level: number }
        role_code: string
        department_id?: string | null
    }
}

export default function HrDepartmentsView({ userProfile }: HrDepartmentsViewProps) {
    const { hasPermission } = usePermissions(
        userProfile.roles.role_level,
        userProfile.role_code,
        userProfile.department_id
    )

    const canEdit =
        userProfile.roles.role_level <= 20 ||
        hasPermission('manage_org_chart') ||
        hasPermission('edit_org_settings')

    return (
        <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                This is the HR view. You can also manage these under Settings &gt; Organization.
            </div>
            <DepartmentsTab
                organizationId={userProfile.organizations.id}
                canEdit={canEdit}
            />
        </div>
    )
}
