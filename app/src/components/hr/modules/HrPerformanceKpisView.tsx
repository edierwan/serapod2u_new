'use client'

import HrModulePage from '@/components/hr/HrModulePage'

export default function HrPerformanceKpisView() {
    return (
        <HrModulePage
            title="KPIs"
            subtitle="Define role-based KPIs and tracking cycles."
            sections={[
                {
                    title: 'KPI Library',
                    description: 'Create KPI templates by department or position.',
                    bullets: ['Target values', 'Weighting', 'Quarterly reviews']
                },
                {
                    title: 'Scorecards',
                    description: 'Employee scorecards with manager review workflow.',
                    actions: [{ label: 'Create KPI' }]
                }
            ]}
        />
    )
}
