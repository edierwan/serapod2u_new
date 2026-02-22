'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
    Rocket, CheckCircle2, AlertCircle, ArrowRight, Loader2, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ── Types ────────────────────────────────────────────────────────

interface AuditSection {
    title?: string
    section?: string
    checks: { label: string; status: 'ok' | 'warning' | 'error' | 'configured' | 'partial' | 'missing' }[]
}

interface SetupReadinessBannerProps {
    /** API endpoint to fetch audit data from */
    auditEndpoint: string
    /** Where the "Go to Settings" button navigates */
    settingsHref: string
    /** Module name for display */
    moduleName: string
    /** Accent color class */
    accentColor?: string
}

// ── Component ────────────────────────────────────────────────────

export default function SetupReadinessBanner({
    auditEndpoint,
    settingsHref,
    moduleName,
    accentColor = 'blue',
}: SetupReadinessBannerProps) {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [percentage, setPercentage] = useState(0)
    const [totalChecks, setTotalChecks] = useState(0)
    const [passedChecks, setPassedChecks] = useState(0)
    const [criticalMissing, setCriticalMissing] = useState<string[]>([])

    useEffect(() => {
        let mounted = true
        async function fetchAudit() {
            try {
                const res = await fetch(auditEndpoint)
                if (!res.ok) return
                const json = await res.json()
                if (!mounted) return

                const sections: AuditSection[] = json.sections || []
                let total = 0
                let passed = 0
                const missing: string[] = []

                for (const section of sections) {
                    for (const check of section.checks) {
                        total++
                        if (check.status === 'ok' || check.status === 'configured') {
                            passed++
                        } else if (check.status === 'error' || check.status === 'missing') {
                            missing.push(check.label)
                        }
                    }
                }

                setTotalChecks(total)
                setPassedChecks(passed)
                setPercentage(total > 0 ? Math.round((passed / total) * 100) : 0)
                setCriticalMissing(missing.slice(0, 3))
            } catch {
                // Silently fail — banner just won't show
            } finally {
                if (mounted) setLoading(false)
            }
        }
        fetchAudit()
        return () => { mounted = false }
    }, [auditEndpoint])

    // Don't render while loading or if 100% complete
    if (loading) {
        return (
            <div className="bg-muted/50 border border-border rounded-xl p-4 flex items-center gap-3 animate-pulse">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Checking {moduleName} setup...</span>
            </div>
        )
    }

    if (percentage === 100) {
        return (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div className="flex-1">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                        {moduleName} is fully configured
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">
                        All {totalChecks} configuration checks passed. You&apos;re ready to go!
                    </p>
                </div>
                <Sparkles className="h-4 w-4 text-green-500" />
            </div>
        )
    }

    const isLow = percentage < 30
    const borderColor = isLow
        ? 'border-red-200 dark:border-red-800'
        : 'border-amber-200 dark:border-amber-800'
    const bgColor = isLow
        ? 'bg-red-50 dark:bg-red-900/20'
        : 'bg-amber-50 dark:bg-amber-900/20'
    const textColor = isLow
        ? 'text-red-800 dark:text-red-200'
        : 'text-amber-800 dark:text-amber-200'
    const subTextColor = isLow
        ? 'text-red-600 dark:text-red-400'
        : 'text-amber-600 dark:text-amber-400'
    const barColor = isLow
        ? 'bg-red-500'
        : percentage < 70 ? 'bg-amber-500' : 'bg-green-500'

    return (
        <div className={`${bgColor} ${borderColor} border rounded-xl p-4 space-y-3`}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <Rocket className={`h-5 w-5 ${subTextColor}`} />
                    <div>
                        <p className={`text-sm font-medium ${textColor}`}>
                            {moduleName} Setup — {percentage}% Complete
                        </p>
                        <p className={`text-xs ${subTextColor}`}>
                            {passedChecks} of {totalChecks} configuration checks passed
                        </p>
                    </div>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(settingsHref)}
                    className="gap-1 text-xs"
                >
                    Complete Setup <ArrowRight className="h-3 w-3" />
                </Button>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                    className={`${barColor} h-2 rounded-full transition-all duration-500`}
                    style={{ width: `${percentage}%` }}
                />
            </div>

            {/* Critical missing items */}
            {criticalMissing.length > 0 && (
                <div className="flex items-start gap-2">
                    <AlertCircle className={`h-3.5 w-3.5 mt-0.5 ${subTextColor} flex-shrink-0`} />
                    <p className={`text-xs ${subTextColor}`}>
                        <strong>Needs attention:</strong> {criticalMissing.join(', ')}
                    </p>
                </div>
            )}
        </div>
    )
}
