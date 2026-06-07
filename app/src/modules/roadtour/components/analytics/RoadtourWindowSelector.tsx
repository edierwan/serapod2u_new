'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ImpactWindow } from '@/modules/roadtour/types/analytics'
import {
    IMPACT_WINDOW_ERROR_MESSAGE,
    IMPACT_WINDOW_PRESETS,
    formatImpactWindowShortLabel,
    isPresetImpactWindow,
    validateImpactWindowDays,
} from '@/modules/roadtour/lib/analytics/windowDays'

interface RoadtourWindowSelectorProps {
    windowDays: ImpactWindow
    onWindowChange: (windowDays: ImpactWindow) => void
}

export function RoadtourWindowSelector({ windowDays, onWindowChange }: RoadtourWindowSelectorProps) {
    const [customValue, setCustomValue] = useState(() => (isPresetImpactWindow(windowDays) ? '' : String(windowDays)))
    const [customError, setCustomError] = useState<string | null>(null)

    useEffect(() => {
        if (isPresetImpactWindow(windowDays)) {
            setCustomError(null)
            return
        }

        setCustomValue(String(windowDays))
        setCustomError(null)
    }, [windowDays])

    const applyCustomValue = (value: string, showError = true) => {
        const validation = validateImpactWindowDays(value)
        if (validation.error) {
            setCustomError(showError ? validation.error : null)
            return
        }

        setCustomError(null)
        onWindowChange(validation.value)
    }

    const customSelected = !isPresetImpactWindow(windowDays)

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-start gap-2">
                {IMPACT_WINDOW_PRESETS.map((preset) => (
                    <Button
                        key={preset}
                        type="button"
                        variant={windowDays === preset ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                            setCustomError(null)
                            onWindowChange(preset)
                        }}
                        className="min-w-[3.75rem]"
                    >
                        {formatImpactWindowShortLabel(preset)}
                    </Button>
                ))}

                <Button
                    type="button"
                    variant={customSelected ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => applyCustomValue(customValue, true)}
                    className="min-w-[5rem]"
                >
                    Custom
                </Button>

                <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Days"
                    value={customValue}
                    onChange={(event) => {
                        const nextValue = event.target.value.replace(/\D/g, '')
                        setCustomValue(nextValue)

                        if (nextValue.trim() === '') {
                            setCustomError(customSelected ? IMPACT_WINDOW_ERROR_MESSAGE : null)
                            return
                        }

                        applyCustomValue(nextValue, true)
                    }}
                    onBlur={() => {
                        if (customSelected) {
                            applyCustomValue(customValue, true)
                        }
                    }}
                    className={`h-9 w-24 ${customError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                    aria-invalid={customError ? 'true' : 'false'}
                />
            </div>

            {customError && (
                <p className="text-xs text-red-600">{customError}</p>
            )}
        </div>
    )
}