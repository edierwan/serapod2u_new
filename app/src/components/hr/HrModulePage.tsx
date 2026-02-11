'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface HrModuleSection {
    title: string
    description: string
    bullets?: string[]
    actions?: { label: string }[]
}

interface HrModulePageProps {
    title: string
    subtitle: string
    sections: HrModuleSection[]
}

export default function HrModulePage({ title, subtitle, sections }: HrModulePageProps) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <CardTitle className="text-lg">{title}</CardTitle>
                        <Badge variant="outline" className="text-blue-600 border-blue-200">Phase 1</Badge>
                    </div>
                    <CardDescription>{subtitle}</CardDescription>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sections.map((section) => (
                    <Card key={section.title}>
                        <CardHeader>
                            <CardTitle className="text-base">{section.title}</CardTitle>
                            <CardDescription>{section.description}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {section.bullets && (
                                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                    {section.bullets.map((bullet) => (
                                        <li key={bullet}>{bullet}</li>
                                    ))}
                                </ul>
                            )}
                            {section.actions && (
                                <div className="flex flex-wrap gap-2">
                                    {section.actions.map((action) => (
                                        <Button key={action.label} variant="outline" size="sm" disabled>
                                            {action.label}
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
