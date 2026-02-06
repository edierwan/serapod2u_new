'use client'

import HrSettingsView from '@/components/hr/HrSettingsView'

interface HrSettingsApprovalRulesViewProps {
    organizationId: string
    canEdit: boolean
}

export default function HrSettingsApprovalRulesView({ organizationId, canEdit }: HrSettingsApprovalRulesViewProps) {
    return <HrSettingsView organizationId={organizationId} canEdit={canEdit} />
}
