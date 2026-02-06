'use client'

import HrModulePage from '@/components/hr/HrModulePage'

export default function HrPerformanceReviewsView() {
    return (
        <HrModulePage
            title="Reviews"
            subtitle="360 reviews and manager feedback cycles."
            sections={[
                {
                    title: 'Review Templates',
                    description: 'Configure review forms and scoring rubrics.',
                    bullets: ['360 feedback', 'Peer review', 'Manager review']
                },
                {
                    title: 'Review Actions',
                    description: 'Schedule and close review sessions.',
                    actions: [{ label: 'Create Review' }]
                }
            ]}
        />
    )
}
