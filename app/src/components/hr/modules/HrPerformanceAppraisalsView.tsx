'use client'

import HrModulePage from '@/components/hr/HrModulePage'

export default function HrPerformanceAppraisalsView() {
    return (
        <HrModulePage
            title="Appraisals"
            subtitle="Plan appraisal cycles and calibration meetings."
            sections={[
                {
                    title: 'Appraisal Cycles',
                    description: 'Annual or quarterly appraisals.',
                    bullets: ['Self review', 'Manager review', 'Calibration']
                },
                {
                    title: 'Documentation',
                    description: 'Maintain appraisal records and attachments.',
                    actions: [{ label: 'Start Cycle' }]
                }
            ]}
        />
    )
}
