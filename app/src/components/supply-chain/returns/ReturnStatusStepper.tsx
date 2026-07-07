'use client'

import { Check, Ban } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    RETURN_STEPPER_STATUSES,
    RETURN_STATUS_LABELS,
    returnStatusIndex,
    type ReturnStatus,
} from '@/lib/returns/constants'

/**
 * Simple horizontal progress stepper for the 5 return statuses:
 * Return Draft → Return Submitted → Return Received → Return Processing → Return Completed
 */
export default function ReturnStatusStepper({ status }: { status: ReturnStatus }) {
    const cancelled = status === 'return_cancelled'
    const currentIndex = cancelled ? -1 : returnStatusIndex(status)

    if (cancelled) {
        return (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                <Ban className="h-4 w-4" />
                This return was cancelled.
            </div>
        )
    }

    return (
        <div className="flex items-center">
            {RETURN_STEPPER_STATUSES.map((s, i) => {
                const done = i < currentIndex
                const active = i === currentIndex
                return (
                    <div key={s} className="flex flex-1 items-center last:flex-none">
                        <div className="flex flex-col items-center gap-1">
                            <div
                                className={cn(
                                    'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                                    done && 'border-emerald-500 bg-emerald-500 text-white',
                                    active && 'border-blue-600 bg-blue-600 text-white ring-2 ring-blue-200 dark:ring-blue-900',
                                    !done && !active && 'border-border bg-muted text-muted-foreground',
                                )}
                            >
                                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                            </div>
                            <span
                                className={cn(
                                    'whitespace-nowrap text-[11px]',
                                    active ? 'font-semibold text-foreground' : 'text-muted-foreground',
                                )}
                            >
                                {RETURN_STATUS_LABELS[s]}
                            </span>
                        </div>
                        {i < RETURN_STEPPER_STATUSES.length - 1 && (
                            <div
                                className={cn(
                                    'mx-1 h-0.5 flex-1 rounded transition-colors',
                                    i < currentIndex ? 'bg-emerald-500' : 'bg-border',
                                )}
                            />
                        )}
                    </div>
                )
            })}
        </div>
    )
}
