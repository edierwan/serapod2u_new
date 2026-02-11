'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Construction } from 'lucide-react'

interface FinancePlaceholderViewProps {
    title: string
    subtitle: string
    groupLabel: string
    features?: string[]
}

/**
 * Placeholder view for Finance sub-modules that are not yet implemented.
 * Shows a "Coming Soon" notice with planned features.
 */
export default function FinancePlaceholderView({ title, subtitle, groupLabel, features }: FinancePlaceholderViewProps) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <CardTitle>{title}</CardTitle>
                        <Badge variant="outline" className="text-amber-600 border-amber-200">
                            <Construction className="h-3 w-3 mr-1" />
                            Coming Soon
                        </Badge>
                    </div>
                    <CardDescription>{subtitle}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-3">
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                            This {groupLabel} feature is planned for a future release. The following capabilities will be available:
                        </p>
                        {features && features.length > 0 && (
                            <ul className="list-disc list-inside text-sm text-amber-700 dark:text-amber-300 space-y-1">
                                {features.map((f, i) => (
                                    <li key={i}>{f}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
